/**
 * Agent Registry Program Stress Tests (Mocha/Anchor)
 *
 * Goals:
 * - Stress identity + metadata PDAs
 * - Stress feedback + responses flows
 * - Economical funding (only top up if needed)
 * - Persist test wallets for recovery
 *
 * Tunables (env):
 * - STRESS_AGENTS (default 3)
 * - STRESS_CLIENTS (default 5)
 * - STRESS_FEEDBACKS_PER_AGENT (default 6)
 * - STRESS_METADATA_KEYS (default 3)
 * - STRESS_OWNER_SOL (default 0.05)
 * - STRESS_CLIENT_SOL (default 0.02)
 * - STRESS_RETURN_FUNDS (default true)
 *
 * NOTE: Validation module removed in v0.5.0 - archived for future upgrade
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../types/atom_engine";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
  getMetadataEntryPda,
  getRegistryAuthorityPda,
  computeKeyHash,
  randomHash,
  fundKeypairs,
  returnFunds,
  getAtomProgram,
} from "./utils/helpers";

import { loadTestWallets, saveTestWallets } from "./utils/test-wallets";

// ----------------------------------------------------------------------------
// Env / Tunables
// ----------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const STRESS_AGENTS = Math.max(1, envInt("STRESS_AGENTS", 3));
const STRESS_CLIENTS = Math.max(2, envInt("STRESS_CLIENTS", 5));
const STRESS_FEEDBACKS_PER_AGENT = Math.max(1, envInt("STRESS_FEEDBACKS_PER_AGENT", 6));
const STRESS_METADATA_KEYS = Math.max(1, envInt("STRESS_METADATA_KEYS", 3));

const OWNER_SOL = envFloat("STRESS_OWNER_SOL", 0.05);
const CLIENT_SOL = envFloat("STRESS_CLIENT_SOL", 0.02);
const RETURN_FUNDS = process.env.STRESS_RETURN_FUNDS !== "false";

// ----------------------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------------------

describe("Program Stress Tests (Agent Registry)", function () {
  this.timeout(300000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = getAtomProgram(provider) as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  const fundedKeypairs: Keypair[] = [];

  // Test wallets (persisted)
  let owners: Keypair[] = [];
  let clients: Keypair[] = [];

  type AgentInfo = {
    asset: Keypair;
    agentPda: PublicKey;
    statsPda: PublicKey;
    owner: Keypair;
  };
  const agents: AgentInfo[] = [];

  type FeedbackRecord = {
    asset: PublicKey;
    agentPda: PublicKey;
    owner: Keypair;
    client: Keypair;
    index: anchor.BN;
  };
  const feedbackRecords: FeedbackRecord[] = [];

  before(async () => {
    console.log("\n=== Registry Stress Test Setup ===");
    console.log("Provider:", provider.wallet.publicKey.toBase58());
    console.log("Agents:", STRESS_AGENTS, "Clients:", STRESS_CLIENTS);

    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    const rootInfo = await provider.connection.getAccountInfo(rootConfigPda);
    if (!rootInfo) {
      throw new Error("RootConfig missing. Run tests/init-localnet.ts first.");
    }

    const rootConfig = program.coder.accounts.decode("rootConfig", rootInfo.data);
    collectionPubkey = rootConfig.baseCollection;

    [registryConfigPda] = getRegistryConfigPda(collectionPubkey, program.programId);
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    if (!registryAccountInfo) {
      throw new Error("RegistryConfig missing. Run tests/init-localnet.ts first.");
    }

    const atomConfigInfo = await provider.connection.getAccountInfo(atomConfigPda);
    if (!atomConfigInfo) {
      throw new Error("AtomConfig missing. Run atom-engine init first.");
    }

    // Load or create wallets
    const saved = loadTestWallets() ?? {};
    const wallets: Record<string, Keypair> = { ...saved };

    const getWallet = (name: string): Keypair => {
      if (!wallets[name]) {
        wallets[name] = Keypair.generate();
      }
      return wallets[name];
    };

    const ownerCount = Math.max(1, Math.min(2, STRESS_AGENTS));
    owners = Array.from({ length: ownerCount }, (_, i) => getWallet(`stressOwner${i + 1}`));
    clients = Array.from({ length: STRESS_CLIENTS }, (_, i) => getWallet(`stressClient${i + 1}`));

    // Persist wallets immediately (crash recovery)
    saveTestWallets(wallets);

    // Fund wallets economically (only top-up if below 50% target)
    const ownerLamports = Math.floor(OWNER_SOL * LAMPORTS_PER_SOL);
    const clientLamports = Math.floor(CLIENT_SOL * LAMPORTS_PER_SOL);

    const ownersToFund: Keypair[] = [];
    for (const kp of owners) {
      const bal = await provider.connection.getBalance(kp.publicKey);
      if (bal < ownerLamports * 0.5) ownersToFund.push(kp);
    }
    const clientsToFund: Keypair[] = [];
    for (const kp of clients) {
      const bal = await provider.connection.getBalance(kp.publicKey);
      if (bal < clientLamports * 0.5) clientsToFund.push(kp);
    }

    if (ownersToFund.length > 0) {
      await fundKeypairs(provider, ownersToFund, ownerLamports);
      fundedKeypairs.push(...ownersToFund);
    }
    if (clientsToFund.length > 0) {
      await fundKeypairs(provider, clientsToFund, clientLamports);
      fundedKeypairs.push(...clientsToFund);
    }

    console.log("Collection:", collectionPubkey.toBase58());
    console.log("Owners:", owners.map(o => o.publicKey.toBase58()).join(", "));
  });

  after(async () => {
    if (RETURN_FUNDS && fundedKeypairs.length > 0) {
      console.log(`\nReturning funds from ${fundedKeypairs.length} wallets...`);
      const recovered = await returnFunds(provider, fundedKeypairs);
      console.log(`Recovered ${(recovered / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } else if (!RETURN_FUNDS) {
      console.log("Skipping return funds (STRESS_RETURN_FUNDS=false)");
    }
  });

  it("registers agents and initializes ATOM stats", async () => {
    for (let i = 0; i < STRESS_AGENTS; i++) {
      const owner = owners[i % owners.length];
      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [statsPda] = getAtomStatsPda(asset.publicKey);

      const uri = `https://stress.test/agent/${Date.now()}-${i}`;

      await program.methods
        .registerWithOptions(uri, true)
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset, owner])
        .rpc();

      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: owner.publicKey,
          asset: asset.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: statsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      agents.push({ asset, agentPda, statsPda, owner });
    }

    expect(agents.length).to.equal(STRESS_AGENTS);
  });

  it("writes metadata PDAs under load", async () => {
    for (const agent of agents) {
      for (let i = 0; i < STRESS_METADATA_KEYS; i++) {
        const key = `k_${i}_${agent.asset.publicKey.toBase58().slice(0, 6)}`;
        const value = Buffer.from(`v_${i}_${Date.now()}`);
        const keyHash = computeKeyHash(key);

        await program.methods
          .setMetadataPda(Array.from(keyHash), key, value, false)
          .accounts({
            metadataEntry: getMetadataEntryPda(agent.asset.publicKey, keyHash, program.programId)[0],
            agentAccount: agent.agentPda,
            asset: agent.asset.publicKey,
            owner: agent.owner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([agent.owner])
          .rpc();
      }
    }
  });

  it("creates feedback at scale and appends responses", async () => {
    const feedbackIndexMap = new Map<string, number>();

    const nextIndex = (asset: PublicKey, client: PublicKey): anchor.BN => {
      const key = `${asset.toBase58()}:${client.toBase58()}`;
      const next = feedbackIndexMap.get(key) ?? 0;
      feedbackIndexMap.set(key, next + 1);
      return new anchor.BN(next);
    };

    for (const agent of agents) {
      for (let i = 0; i < STRESS_FEEDBACKS_PER_AGENT; i++) {
        const client = clients[i % clients.length];
        const feedbackIndex = nextIndex(agent.asset.publicKey, client.publicKey);
        const value = new anchor.BN(100 + i); // raw metric
        const valueDecimals = 2;
        const score = 70 + (i % 25);

        await program.methods
          .giveFeedback(
            value,
            valueDecimals,
            score,
            Array.from(randomHash()),
            feedbackIndex,
            "stress",
            "load",
            "https://stress.test/api",
            `https://stress.test/feedback/${agent.asset.publicKey.toBase58()}/${i}`
          )
          .accounts({
            client: client.publicKey,
            agentAccount: agent.agentPda,
            asset: agent.asset.publicKey,
            collection: collectionPubkey,
            systemProgram: SystemProgram.programId,
            atomConfig: atomConfigPda,
            atomStats: agent.statsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            registryAuthority: registryAuthorityPda,
          })
          .signers([client])
          .rpc();

        feedbackRecords.push({
          asset: agent.asset.publicKey,
          agentPda: agent.agentPda,
          owner: agent.owner,
          client,
          index: feedbackIndex,
        });
      }
    }

    // Append responses for a subset (economical)
    const responseTargets = feedbackRecords.slice(0, Math.min(5, feedbackRecords.length));
    for (const rec of responseTargets) {
      await program.methods
        .appendResponse(
          rec.asset,
          rec.client.publicKey,
          rec.index,
          `https://stress.test/response/${Date.now()}`,
          Array.from(randomHash())
        )
        .accounts({
          responder: rec.owner.publicKey,
          agentAccount: rec.agentPda,
          asset: rec.asset,
        })
        .signers([rec.owner])
        .rpc();
    }

    expect(feedbackRecords.length).to.equal(STRESS_AGENTS * STRESS_FEEDBACKS_PER_AGENT);
  });

  // NOTE: Validation tests removed in v0.5.0 - archived for future upgrade
});
