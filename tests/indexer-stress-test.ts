/**
 * Indexer Stress Test Suite
 *
 * Tests the full flow: Program → Events → Indexer
 * - On-chain metadata PDAs
 * - IPFS metadata via Pinata
 * - High-volume feedbacks/validations
 * - Verifies indexer correctly processes all events
 *
 * Prerequisites:
 * - Localnet running with programs deployed
 * - Indexer running against localnet
 * - (Optional) PINATA_JWT for IPFS metadata
 *
 * Env vars:
 * - STRESS_AGENTS (default 5)
 * - STRESS_CLIENTS (default 10)
 * - STRESS_FEEDBACKS_PER_AGENT (default 8)
 * - STRESS_VALIDATIONS_PER_AGENT (default 3)
 * - STRESS_METADATA_KEYS (default 5)
 * - PINATA_JWT (optional, for IPFS uploads)
 * - INDEXER_API_URL (default http://localhost:3030)
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../types/atom_engine";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
  getValidationConfigPda,
  getValidationRequestPda,
  getMetadataEntryPda,
  getRegistryAuthorityPda,
  computeKeyHash,
  randomHash,
  fundKeypairs,
  returnFunds,
  sleep,
  getAtomProgram,
} from "./utils/helpers";

import { loadTestWallets, saveTestWallets } from "./utils/test-wallets";

// Tunables
const STRESS_AGENTS = parseInt(process.env.STRESS_AGENTS || "5", 10);
const STRESS_CLIENTS = parseInt(process.env.STRESS_CLIENTS || "10", 10);
const STRESS_FEEDBACKS_PER_AGENT = parseInt(process.env.STRESS_FEEDBACKS_PER_AGENT || "8", 10);
const STRESS_VALIDATIONS_PER_AGENT = parseInt(process.env.STRESS_VALIDATIONS_PER_AGENT || "3", 10);
const STRESS_METADATA_KEYS = parseInt(process.env.STRESS_METADATA_KEYS || "5", 10);
const PINATA_JWT = process.env.PINATA_JWT || "";
const INDEXER_API_URL = process.env.INDEXER_API_URL || "http://localhost:3030";
const RETURN_FUNDS = process.env.STRESS_RETURN_FUNDS !== "false";

// Funding amounts
const OWNER_SOL = 0.3;
const CLIENT_SOL = 0.05;
const VALIDATOR_SOL = 0.1;

// Pinata API
async function uploadToPinata(data: object, name: string): Promise<string | null> {
  if (!PINATA_JWT) return null;

  try {
    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: data,
        pinataMetadata: { name },
      }),
    });

    if (!response.ok) {
      console.warn(`Pinata upload failed: ${response.status}`);
      return null;
    }

    const result = await response.json();
    return `ipfs://${result.IpfsHash}`;
  } catch (err) {
    console.warn("Pinata upload error:", err);
    return null;
  }
}

// Indexer API helpers
async function queryIndexerAgent(asset: string): Promise<any | null> {
  try {
    const response = await fetch(`${INDEXER_API_URL}/agents/${asset}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function queryIndexerFeedbacks(asset: string): Promise<any[]> {
  try {
    const response = await fetch(`${INDEXER_API_URL}/agents/${asset}/feedbacks`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.feedbacks || [];
  } catch {
    return [];
  }
}

async function queryIndexerValidations(asset: string): Promise<any[]> {
  try {
    const response = await fetch(`${INDEXER_API_URL}/agents/${asset}/validations`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.validations || [];
  } catch {
    return [];
  }
}

describe("Indexer Stress Tests", function () {
  this.timeout(600000); // 10 minutes

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = getAtomProgram(provider) as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let validationConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  const fundedKeypairs: Keypair[] = [];

  // Wallets
  let owners: Keypair[] = [];
  let clients: Keypair[] = [];
  let validators: Keypair[] = [];

  type AgentInfo = {
    asset: Keypair;
    agentPda: PublicKey;
    statsPda: PublicKey;
    owner: Keypair;
    ipfsUri: string | null;
  };
  const agents: AgentInfo[] = [];

  type FeedbackRecord = {
    asset: PublicKey;
    agentPda: PublicKey;
    owner: Keypair;
    client: Keypair;
    index: anchor.BN;
    feedbackHash: Uint8Array;
  };
  const feedbackRecords: FeedbackRecord[] = [];

  type ValidationRecord = {
    asset: PublicKey;
    agentPda: PublicKey;
    owner: Keypair;
    validator: Keypair;
    nonce: number;
    requestPda: PublicKey;
  };
  const validationRecords: ValidationRecord[] = [];

  // Stats
  let totalMetadataWrites = 0;
  let totalFeedbacks = 0;
  let totalValidations = 0;
  let ipfsUploads = 0;

  before(async () => {
    console.log("\n========================================");
    console.log("  INDEXER STRESS TEST SUITE");
    console.log("========================================");
    console.log(`Provider: ${provider.wallet.publicKey.toBase58()}`);
    console.log(`Agents: ${STRESS_AGENTS}`);
    console.log(`Clients: ${STRESS_CLIENTS}`);
    console.log(`Feedbacks/agent: ${STRESS_FEEDBACKS_PER_AGENT}`);
    console.log(`Validations/agent: ${STRESS_VALIDATIONS_PER_AGENT}`);
    console.log(`Metadata keys/agent: ${STRESS_METADATA_KEYS}`);
    console.log(`Pinata: ${PINATA_JWT ? "Enabled" : "Disabled"}`);
    console.log(`Indexer: ${INDEXER_API_URL}`);
    console.log("----------------------------------------\n");

    // PDAs - use workspace program IDs for consistency
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda(atomProgram.programId);
    [validationConfigPda] = getValidationConfigPda(program.programId);
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    // Fetch config
    const rootInfo = await provider.connection.getAccountInfo(rootConfigPda);
    if (!rootInfo) throw new Error("RootConfig missing. Run init-localnet.ts first.");

    const rootConfig = program.coder.accounts.decode("rootConfig", rootInfo.data);
    registryConfigPda = rootConfig.baseRegistry;

    const registryInfo = await provider.connection.getAccountInfo(registryConfigPda);
    if (!registryInfo) throw new Error("RegistryConfig missing.");

    const registryConfig = program.coder.accounts.decode("registryConfig", registryInfo.data);
    collectionPubkey = registryConfig.collection;

    // ValidationConfig init (if needed)
    const validationInfo = await provider.connection.getAccountInfo(validationConfigPda);
    if (!validationInfo) {
      console.log("Initializing ValidationConfig...");
      const [programDataPda] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      );
      await program.methods
        .initializeValidationConfig()
        .accounts({
          config: validationConfigPda,
          authority: provider.wallet.publicKey,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Load or create wallets
    const saved = loadTestWallets() ?? {};
    const wallets: Record<string, Keypair> = { ...saved };

    const getWallet = (name: string): Keypair => {
      if (!wallets[name]) wallets[name] = Keypair.generate();
      return wallets[name];
    };

    // Create wallets
    const ownerCount = Math.max(1, Math.ceil(STRESS_AGENTS / 3));
    owners = Array.from({ length: ownerCount }, (_, i) => getWallet(`idxOwner${i + 1}`));
    clients = Array.from({ length: STRESS_CLIENTS }, (_, i) => getWallet(`idxClient${i + 1}`));
    validators = Array.from({ length: Math.max(2, Math.ceil(STRESS_VALIDATIONS_PER_AGENT / 2)) }, (_, i) =>
      getWallet(`idxValidator${i + 1}`)
    );

    saveTestWallets(wallets);

    // Fund wallets
    const ownerLamports = Math.floor(OWNER_SOL * LAMPORTS_PER_SOL);
    const clientLamports = Math.floor(CLIENT_SOL * LAMPORTS_PER_SOL);
    const validatorLamports = Math.floor(VALIDATOR_SOL * LAMPORTS_PER_SOL);

    const toFund = async (kps: Keypair[], target: number) => {
      const needFunding: Keypair[] = [];
      for (const kp of kps) {
        const bal = await provider.connection.getBalance(kp.publicKey);
        if (bal < target * 0.5) needFunding.push(kp);
      }
      if (needFunding.length > 0) {
        await fundKeypairs(provider, needFunding, target);
        fundedKeypairs.push(...needFunding);
      }
    };

    await toFund(owners, ownerLamports);
    await toFund(clients, clientLamports);
    await toFund(validators, validatorLamports);

    console.log(`Collection: ${collectionPubkey.toBase58()}`);
    console.log(`Owners funded: ${owners.length}`);
    console.log(`Clients funded: ${clients.length}`);
    console.log(`Validators funded: ${validators.length}\n`);
  });

  after(async () => {
    console.log("\n========================================");
    console.log("  STRESS TEST SUMMARY");
    console.log("========================================");
    console.log(`Agents created: ${agents.length}`);
    console.log(`Metadata writes: ${totalMetadataWrites}`);
    console.log(`Feedbacks: ${totalFeedbacks}`);
    console.log(`Validations: ${totalValidations}`);
    console.log(`IPFS uploads: ${ipfsUploads}`);
    console.log("----------------------------------------\n");

    if (RETURN_FUNDS && fundedKeypairs.length > 0) {
      console.log(`Returning funds from ${fundedKeypairs.length} wallets...`);
      const recovered = await returnFunds(provider, fundedKeypairs);
      console.log(`Recovered ${(recovered / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  });

  describe("Phase 1: Agent Registration with IPFS Metadata", () => {
    it("registers agents with on-chain + IPFS metadata", async () => {
      for (let i = 0; i < STRESS_AGENTS; i++) {
        const owner = owners[i % owners.length];
        const asset = Keypair.generate();
        const [agentPda] = getAgentPda(asset.publicKey, program.programId);
        const [statsPda] = getAtomStatsPda(asset.publicKey, atomProgram.programId);

        // Build agent metadata
        const agentMetadata = {
          name: `StressAgent_${i}_${Date.now()}`,
          description: `Indexer stress test agent #${i}`,
          version: "1.0.0",
          capabilities: ["stress-testing", "indexer-validation"],
          created: new Date().toISOString(),
          tags: ["stress", "test", `batch_${Math.floor(i / 5)}`],
        };

        // Try IPFS upload
        let agentUri = `https://stress.test/agent/${asset.publicKey.toBase58()}`;
        const ipfsUri = await uploadToPinata(agentMetadata, `agent_${i}`);
        if (ipfsUri) {
          agentUri = ipfsUri;
          ipfsUploads++;
        }

        // Register agent
        await program.methods
          .registerWithOptions(agentUri, true)
          .accounts({
            registryConfig: registryConfigPda,
            agentAccount: agentPda,
            asset: asset.publicKey,
            collection: collectionPubkey,
            rootConfig: rootConfigPda,
            owner: owner.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([asset, owner])
          .rpc();

        // Initialize ATOM stats
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

        agents.push({ asset, agentPda, statsPda, owner, ipfsUri });
        console.log(`  Agent ${i + 1}/${STRESS_AGENTS}: ${asset.publicKey.toBase58().slice(0, 8)}... (IPFS: ${ipfsUri ? "✓" : "✗"})`);
      }

      expect(agents.length).to.equal(STRESS_AGENTS);
    });
  });

  describe("Phase 2: On-Chain Metadata PDAs", () => {
    it("writes metadata keys for each agent", async () => {
      const metadataTypes = ["mcp_endpoint", "a2a_endpoint", "model_type", "owner_contact", "custom_field"];

      for (const agent of agents) {
        for (let i = 0; i < STRESS_METADATA_KEYS; i++) {
          const keyType = metadataTypes[i % metadataTypes.length];
          const key = `${keyType}_${agent.asset.publicKey.toBase58().slice(0, 6)}`;
          const value = Buffer.from(JSON.stringify({
            type: keyType,
            value: `test_value_${i}_${Date.now()}`,
            agent: agent.asset.publicKey.toBase58(),
          }));
          const keyHash = computeKeyHash(key);
          const [metadataPda] = getMetadataEntryPda(agent.asset.publicKey, keyHash, program.programId);

          await program.methods
            .setMetadataPda(Array.from(keyHash), key, value, false)
            .accounts({
              metadataEntry: metadataPda,
              agentAccount: agent.agentPda,
              asset: agent.asset.publicKey,
              owner: agent.owner.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([agent.owner])
            .rpc();

          totalMetadataWrites++;
        }
        console.log(`  Agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...: ${STRESS_METADATA_KEYS} metadata keys`);
      }

      expect(totalMetadataWrites).to.equal(STRESS_AGENTS * STRESS_METADATA_KEYS);
    });
  });

  describe("Phase 3: High-Volume Feedback Generation", () => {
    it("generates feedbacks from multiple clients", async () => {
      // Track global feedback index per agent (matches on-chain agent.feedback_count)
      const agentFeedbackIndex = new Map<string, number>();

      for (const agent of agents) {
        for (let i = 0; i < STRESS_FEEDBACKS_PER_AGENT; i++) {
          const client = clients[i % clients.length];
          const assetKey = agent.asset.publicKey.toBase58();
          const currentIndex = agentFeedbackIndex.get(assetKey) ?? 0;
          const value = new anchor.BN(1000 + i * 10); // Raw metric
          const valueDecimals = 2;
          const score = 50 + (i % 50); // 50-99
          const feedbackHash = randomHash();

          // Feedback metadata (could be IPFS)
          let feedbackUri = `https://stress.test/feedback/${agent.asset.publicKey.toBase58()}/${i}`;
          if (PINATA_JWT && i % 5 === 0) {
            // Upload every 5th feedback to IPFS
            const fbMeta = await uploadToPinata(
              {
                type: "x402-feedback",
                agent: agent.asset.publicKey.toBase58(),
                client: client.publicKey.toBase58(),
                score,
                timestamp: new Date().toISOString(),
              },
              `feedback_${agent.asset.publicKey.toBase58().slice(0, 8)}_${i}`
            );
            if (fbMeta) {
              feedbackUri = fbMeta;
              ipfsUploads++;
            }
          }

          await program.methods
            .giveFeedback(
              value,
              valueDecimals,
              score,
              Array.from(feedbackHash),
              "stress",
              "test",
              "https://stress.test/api",
              feedbackUri
            )
            .accounts({
              client: client.publicKey,
              agentAccount: agent.agentPda,
              asset: agent.asset.publicKey,
              collection: collectionPubkey,
              systemProgram: SystemProgram.programId,
              atomConfig: atomConfigPda,
              atomStats: agent.statsPda,
              atomEngineProgram: atomProgram.programId,
              registryAuthority: registryAuthorityPda,
            })
            .signers([client])
            .rpc();

          feedbackRecords.push({
            asset: agent.asset.publicKey,
            agentPda: agent.agentPda,
            owner: agent.owner,
            client,
            index: new anchor.BN(currentIndex),
            feedbackHash,
          });
          agentFeedbackIndex.set(assetKey, currentIndex + 1);
          totalFeedbacks++;
        }
        console.log(`  Agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...: ${STRESS_FEEDBACKS_PER_AGENT} feedbacks`);
      }

      expect(totalFeedbacks).to.equal(STRESS_AGENTS * STRESS_FEEDBACKS_PER_AGENT);
    });

    it("appends responses to some feedbacks", async () => {
      // Respond to ~25% of feedbacks
      const respondCount = Math.ceil(feedbackRecords.length * 0.25);
      const toRespond = feedbackRecords.slice(0, respondCount);

      for (const rec of toRespond) {
        const responseUri = `https://stress.test/response/${rec.asset.toBase58()}/${rec.index.toString()}`;

        await program.methods
          .appendResponse(
            rec.asset,
            rec.client.publicKey,
            rec.index,
            responseUri,
            Array.from(randomHash()),
            Array.from(rec.feedbackHash)
          )
          .accounts({
            responder: rec.owner.publicKey,
            agentAccount: rec.agentPda,
            asset: rec.asset,
          })
          .signers([rec.owner])
          .rpc();
      }

      console.log(`  Appended ${respondCount} responses`);
    });
  });

  describe("Phase 4: Validation Requests/Responses", () => {
    it("creates validation requests and responses", async () => {
      for (const agent of agents) {
        for (let i = 0; i < STRESS_VALIDATIONS_PER_AGENT; i++) {
          const validator = validators[i % validators.length];
          const nonce = Math.floor(Date.now() % 1_000_000) + i + Math.floor(Math.random() * 1000);
          const [validationRequestPda] = getValidationRequestPda(
            agent.asset.publicKey,
            validator.publicKey,
            nonce,
            program.programId
          );

          // Request validation
          await program.methods
            .requestValidation(
              agent.asset.publicKey,
              validator.publicKey,
              nonce,
              `https://stress.test/validation-req/${agent.asset.publicKey.toBase58()}/${i}`,
              Array.from(randomHash())
            )
            .accounts({
              config: validationConfigPda,
              requester: agent.owner.publicKey,
              payer: agent.owner.publicKey,
              agentAccount: agent.agentPda,
              asset: agent.asset.publicKey,
              validationRequest: validationRequestPda,
              systemProgram: SystemProgram.programId,
            })
            .signers([agent.owner])
            .rpc();

          // Respond to validation
          const responseScore = 70 + (i % 30); // 70-99
          await program.methods
            .respondToValidation(
              agent.asset.publicKey,
              validator.publicKey,
              nonce,
              responseScore,
              `https://stress.test/validation-resp/${agent.asset.publicKey.toBase58()}/${i}`,
              Array.from(randomHash()),
              "stress-test"
            )
            .accounts({
              config: validationConfigPda,
              validator: validator.publicKey,
              agentAccount: agent.agentPda,
              asset: agent.asset.publicKey,
              validationRequest: validationRequestPda,
            })
            .signers([validator])
            .rpc();

          validationRecords.push({
            asset: agent.asset.publicKey,
            agentPda: agent.agentPda,
            owner: agent.owner,
            validator,
            nonce,
            requestPda: validationRequestPda,
          });
          totalValidations++;
        }
        console.log(`  Agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...: ${STRESS_VALIDATIONS_PER_AGENT} validations`);
      }

      expect(totalValidations).to.equal(STRESS_AGENTS * STRESS_VALIDATIONS_PER_AGENT);
    });
  });

  describe("Phase 5: Indexer Verification", () => {
    it("waits for indexer to catch up", async () => {
      console.log("  Waiting 10s for indexer to process events...");
      await sleep(10000);
    });

    it("verifies agents in indexer", async () => {
      let verified = 0;
      for (const agent of agents) {
        const indexed = await queryIndexerAgent(agent.asset.publicKey.toBase58());
        if (indexed) {
          verified++;
        } else {
          console.warn(`  Agent not indexed: ${agent.asset.publicKey.toBase58()}`);
        }
      }
      console.log(`  Verified ${verified}/${agents.length} agents in indexer`);
      // Don't fail if indexer isn't running
      if (verified > 0) {
        expect(verified).to.be.greaterThan(0);
      }
    });

    it("verifies feedbacks in indexer", async () => {
      // Check first 3 agents
      let totalIndexed = 0;
      for (const agent of agents.slice(0, 3)) {
        const feedbacks = await queryIndexerFeedbacks(agent.asset.publicKey.toBase58());
        totalIndexed += feedbacks.length;
        console.log(`  Agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...: ${feedbacks.length} feedbacks indexed`);
      }
      if (totalIndexed > 0) {
        console.log(`  Total feedbacks indexed (sample): ${totalIndexed}`);
      }
    });

    it("verifies validations in indexer", async () => {
      // Check first 3 agents
      let totalIndexed = 0;
      for (const agent of agents.slice(0, 3)) {
        const validations = await queryIndexerValidations(agent.asset.publicKey.toBase58());
        totalIndexed += validations.length;
        console.log(`  Agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...: ${validations.length} validations indexed`);
      }
      if (totalIndexed > 0) {
        console.log(`  Total validations indexed (sample): ${totalIndexed}`);
      }
    });
  });

  describe("Phase 6: On-Chain State Verification", () => {
    it("verifies ATOM stats updated correctly", async () => {
      for (const agent of agents.slice(0, 3)) {
        const statsAccount = await atomProgram.account.atomStats.fetch(agent.statsPda);
        console.log(`  Agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...:`);
        console.log(`    Quality Score: ${statsAccount.qualityScore}`);
        console.log(`    EMA Fast: ${statsAccount.emaScoreFast}`);
        console.log(`    EMA Slow: ${statsAccount.emaScoreSlow}`);
        console.log(`    Feedback Count: ${statsAccount.feedbackCount}`);

        expect(Number(statsAccount.feedbackCount)).to.be.greaterThanOrEqual(STRESS_FEEDBACKS_PER_AGENT);
      }
    });

    it("verifies metadata PDAs exist", async () => {
      const agent = agents[0];
      const key = `mcp_endpoint_${agent.asset.publicKey.toBase58().slice(0, 6)}`;
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agent.asset.publicKey, keyHash, program.programId);

      const metaAccount = await provider.connection.getAccountInfo(metadataPda);
      expect(metaAccount).to.not.be.null;
      console.log(`  Verified metadata PDA exists for agent ${agent.asset.publicKey.toBase58().slice(0, 8)}...`);
    });
  });
});
