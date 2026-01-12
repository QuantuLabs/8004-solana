/**
 * ATOM Engine Stress Tests - Attack Vector Validation
 * Tests HLL attacks, Burst bypasses, EMA manipulation, and Collusion
 *
 * Funding: All test wallets are funded from provider wallet
 * and remaining funds are returned after tests complete.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
} from "./utils/helpers";

import {
  generateDistinctFingerprintKeypairs,
  generateFingerprintCollisionKeypairs,
  generateClientHash,
  generateRandomClientHashes,
  calculateWhitewashFeedbacks,
  calculateBurstResetUpdates,
  analyzeHllDistribution,
  analyzeFingerprintDistribution,
  splitmix64Fp16,
  HLL_REGISTERS,
} from "./utils/attack-helpers";

// ============================================================================
// FUND MANAGEMENT HELPERS
// ============================================================================

const FUND_AMOUNT = 0.02 * LAMPORTS_PER_SOL;  // 0.02 SOL per test keypair (for rent + fees)
const MIN_RENT = 0.001 * LAMPORTS_PER_SOL;    // Minimum to keep for rent

/**
 * Fund multiple keypairs from provider wallet
 */
async function fundKeypairs(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[],
  lamportsEach: number = FUND_AMOUNT
): Promise<void> {
  // Batch transfers for efficiency (max 10 per tx)
  const batchSize = 10;
  for (let i = 0; i < keypairs.length; i += batchSize) {
    const batch = keypairs.slice(i, i + batchSize);
    const tx = new Transaction();

    for (const keypair of batch) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: keypair.publicKey,
          lamports: lamportsEach,
        })
      );
    }

    await provider.sendAndConfirm(tx);
  }
}

/**
 * Return remaining funds from keypairs back to provider
 */
async function returnFunds(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[]
): Promise<number> {
  let totalReturned = 0;

  for (const keypair of keypairs) {
    try {
      const balance = await provider.connection.getBalance(keypair.publicKey);
      if (balance > MIN_RENT) {
        const returnAmount = balance - 5000;  // Keep 5000 lamports for tx fee
        if (returnAmount > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: provider.wallet.publicKey,
              lamports: returnAmount,
            })
          );
          await provider.sendAndConfirm(tx, [keypair]);
          totalReturned += returnAmount;
        }
      }
    } catch (e) {
      // Ignore errors for empty accounts
    }
  }

  return totalReturned;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("ATOM Stress Tests - Attack Vectors", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = anchor.workspace.AtomEngine as Program<AtomEngine>;

  // PDAs
  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;

  // Track all funded keypairs for cleanup
  const allFundedKeypairs: Keypair[] = [];

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();

    // Get existing config
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);
    registryConfigPda = rootConfig.currentBaseRegistry;

    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== ATOM Stress Tests Setup ===");
    console.log("Provider wallet:", provider.wallet.publicKey.toBase58());
    console.log("Collection:", collectionPubkey.toBase58());
  });

  after(async () => {
    // Return all remaining funds to provider
    if (allFundedKeypairs.length > 0) {
      console.log(`\nReturning funds from ${allFundedKeypairs.length} test wallets...`);
      const returned = await returnFunds(provider, allFundedKeypairs);
      console.log(`Returned ${(returned / LAMPORTS_PER_SOL).toFixed(4)} SOL to provider`);
    }
  });

  // ============================================================================
  // 1. BURST DETECTION ATTACKS
  // ============================================================================
  describe("Burst Detection Attacks", () => {
    let testAgent: Keypair;
    let agentPda: PublicKey;
    let atomStatsPda: PublicKey;

    before(async () => {
      // Create a test agent for burst tests
      testAgent = Keypair.generate();
      [agentPda] = getAgentPda(testAgent.publicKey, program.programId);
      [atomStatsPda] = getAtomStatsPda(testAgent.publicKey);

      await program.methods
        .register("https://stress.test/burst-agent")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: testAgent.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([testAgent])
        .rpc();

      // Initialize AtomStats for this agent
      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: provider.wallet.publicKey,
          asset: testAgent.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: atomStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Created burst test agent:", testAgent.publicKey.toBase58());
    });

    it("Ring Buffer Bypass: 4 wallets should evade burst detection", async () => {
      // Generate 4 wallets with distinct fingerprints
      const attackWallets = generateDistinctFingerprintKeypairs(4);
      allFundedKeypairs.push(...attackWallets);

      // Fund them
      await fundKeypairs(provider, attackWallets);
      console.log("Funded 4 attack wallets");

      // Verify distinct fingerprints
      const fps = attackWallets.map(k => splitmix64Fp16(k.publicKey.toBytes()));
      const uniqueFps = new Set(fps);
      expect(uniqueFps.size).to.equal(4, "Should have 4 unique fingerprints");
      console.log("Fingerprints:", fps);

      // Rotate through wallets: A→B→C→D→A→B→C→D... (20 cycles = 80 feedbacks)
      const cycles = 20;
      let feedbackIndex = 0;

      for (let cycle = 0; cycle < cycles; cycle++) {
        for (let w = 0; w < 4; w++) {
          const wallet = attackWallets[w];
          const clientHash = Array.from(generateClientHash(wallet));

          await program.methods
            .giveFeedback(
              85,  // Good score
              "burst",
              "test",
              "https://burst.test/api",
              `https://burst.test/feedback/${feedbackIndex}`,
              clientHash,
              new anchor.BN(feedbackIndex)
            )
            .accounts({
              client: wallet.publicKey,
              asset: testAgent.publicKey,
              collection: collectionPubkey,
              agentAccount: agentPda,
              atomConfig: atomConfigPda,
              atomStats: atomStatsPda,
              atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([wallet])
            .rpc();

          feedbackIndex++;
        }

        // Check burst_pressure every 10 cycles
        if ((cycle + 1) % 10 === 0) {
          const stats = await atomProgram.account.atomStats.fetch(atomStatsPda);
          console.log(`Cycle ${cycle + 1}: burst_pressure = ${stats.burstPressure}, feedback_count = ${stats.feedbackCount.toNumber()}`);
        }
      }

      // Final check
      const finalStats = await atomProgram.account.atomStats.fetch(atomStatsPda);
      console.log("\nFinal results:");
      console.log("  - Feedback count:", finalStats.feedbackCount.toNumber());
      console.log("  - Burst pressure:", finalStats.burstPressure);
      console.log("  - Trust tier:", finalStats.trustTier);

      // ASSERTION: If burst_pressure stays low with 80 rapid feedbacks from "4 clients",
      // the ring buffer bypass is confirmed
      if (finalStats.burstPressure < 30) {
        console.log("  - VULNERABILITY CONFIRMED: Ring buffer bypass successful");
        console.log("  - 4 wallets can evade burst detection with rapid rotation");
      } else {
        console.log("  - Detection working: burst_pressure elevated");
      }

      expect(finalStats.feedbackCount.toNumber()).to.equal(80);
    });

    it("Fingerprint Collision: 2 wallets with same fp16 should trigger false positive", async () => {
      // Find 2 wallets with same fingerprint
      const collision = generateFingerprintCollisionKeypairs(2, 500);

      if (!collision) {
        console.log("SKIP: Could not find fingerprint collision in 500 attempts");
        return;
      }

      const [wallet1, wallet2] = collision.keypairs;
      allFundedKeypairs.push(wallet1, wallet2);
      await fundKeypairs(provider, [wallet1, wallet2]);

      console.log("Found collision:");
      console.log("  - Wallet 1:", wallet1.publicKey.toBase58());
      console.log("  - Wallet 2:", wallet2.publicKey.toBase58());
      console.log("  - Shared fingerprint:", collision.fingerprint);

      // Create a new agent for this test
      const collisionAgent = Keypair.generate();
      const [collisionAgentPda] = getAgentPda(collisionAgent.publicKey, program.programId);
      const [collisionStatsPda] = getAtomStatsPda(collisionAgent.publicKey);

      await program.methods
        .register("https://stress.test/collision-agent")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: collisionAgentPda,
          asset: collisionAgent.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([collisionAgent])
        .rpc();

      // Initialize AtomStats for collision agent
      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: provider.wallet.publicKey,
          asset: collisionAgent.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: collisionStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Alternate between the two wallets (should look like same caller to burst detector)
      let feedbackIdx = 0;
      for (let i = 0; i < 10; i++) {
        const wallet = i % 2 === 0 ? wallet1 : wallet2;

        await program.methods
          .giveFeedback(
            80,
            "collision",
            "test",
            "https://collision.test/api",
            `https://collision.test/feedback/${feedbackIdx}`,
            Array.from(generateClientHash(wallet)),
            new anchor.BN(feedbackIdx)
          )
          .accounts({
            client: wallet.publicKey,
            asset: collisionAgent.publicKey,
            collection: collectionPubkey,
            agentAccount: collisionAgentPda,
            atomConfig: atomConfigPda,
            atomStats: collisionStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet])
          .rpc();

        feedbackIdx++;
      }

      const stats = await atomProgram.account.atomStats.fetch(collisionStatsPda);
      console.log("\nCollision test results:");
      console.log("  - Feedback count:", stats.feedbackCount.toNumber());
      console.log("  - Burst pressure:", stats.burstPressure);
      console.log("  - Diversity ratio:", stats.diversityRatio);

      // With same fingerprint, burst detector sees "same caller" → pressure should rise
      if (stats.burstPressure > 50) {
        console.log("  - FALSE POSITIVE CONFIRMED: 2 distinct wallets trigger burst");
        console.log("  - Attackers can grief legitimate clients by finding fp16 collisions");
      } else {
        console.log("  - Fingerprints not colliding as expected in ring buffer");
      }
    });
  });

  // ============================================================================
  // 2. EMA ATTACKS
  // ============================================================================
  describe("EMA Manipulation Attacks", () => {
    it("Whitewashing Attack: measure feedbacks needed to recover from score 0", async () => {
      // Create agent
      const washAgent = Keypair.generate();
      const [washAgentPda] = getAgentPda(washAgent.publicKey, program.programId);
      const [washStatsPda] = getAtomStatsPda(washAgent.publicKey);

      await program.methods
        .register("https://stress.test/wash-agent")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: washAgentPda,
          asset: washAgent.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([washAgent])
        .rpc();

      // Initialize AtomStats for wash agent
      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: provider.wallet.publicKey,
          asset: washAgent.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: washStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create and fund client wallets (reduced for devnet SOL limits)
      const numClients = 25;
      const clients = Array.from({ length: numClients }, () => Keypair.generate());
      allFundedKeypairs.push(...clients);
      await fundKeypairs(provider, clients);

      console.log("Testing whitewashing attack...");

      // First: give a score of 0 (very bad)
      await program.methods
        .giveFeedback(
          0,  // Bad score
          "bad",
          "service",
          "https://wash.test/api",
          "https://wash.test/feedback/0",
          Array.from(generateClientHash(clients[0])),
          new anchor.BN(0)
        )
        .accounts({
          client: clients[0].publicKey,
          asset: washAgent.publicKey,
          collection: collectionPubkey,
          agentAccount: washAgentPda,
          atomConfig: atomConfigPda,
          atomStats: washStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([clients[0]])
        .rpc();

      let stats = await atomProgram.account.atomStats.fetch(washStatsPda);
      console.log(`After score 0: ema_fast=${stats.emaScoreFast}, ema_slow=${stats.emaScoreSlow}`);

      // Now spam with score 70 to "wash" the bad score
      const washScore = 70;
      const history: { idx: number; fast: number; slow: number; quality: number; tier: number }[] = [];

      for (let i = 1; i < numClients; i++) {
        await program.methods
          .giveFeedback(
            washScore,
            "wash",
            "attempt",
            "https://wash.test/api",
            `https://wash.test/feedback/${i}`,
            Array.from(generateClientHash(clients[i])),
            new anchor.BN(i)
          )
          .accounts({
            client: clients[i].publicKey,
            asset: washAgent.publicKey,
            collection: collectionPubkey,
            agentAccount: washAgentPda,
            atomConfig: atomConfigPda,
            atomStats: washStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([clients[i]])
          .rpc();

        stats = await atomProgram.account.atomStats.fetch(washStatsPda);
        history.push({
          idx: i,
          fast: stats.emaScoreFast,
          slow: stats.emaScoreSlow,
          quality: stats.qualityScore,
          tier: stats.trustTier,
        });

        // Log every 10 feedbacks
        if (i % 10 === 0) {
          console.log(`Feedback ${i}: quality=${stats.qualityScore}, tier=${stats.trustTier}, ema_slow=${stats.emaScoreSlow}`);
        }
      }

      // Find when metrics recovered to acceptable levels
      const targetEmaFast = 6000;  // 60% of max
      const targetEmaSlow = 5000;  // 50% of max
      const targetQuality = 5000;  // Gold tier threshold
      const recoveryFast = history.findIndex(h => h.fast >= targetEmaFast);
      const recoverySlow = history.findIndex(h => h.slow >= targetEmaSlow);
      const recoveryQuality = history.findIndex(h => h.quality >= targetQuality);
      const recoveryTier2 = history.findIndex(h => h.tier >= 2);

      console.log("\n=== Whitewashing Results ===");
      console.log(`Feedbacks to recover ema_fast to ${targetEmaFast}: ${recoveryFast + 1}`);
      console.log(`Feedbacks to recover ema_slow to ${targetEmaSlow}: ${recoverySlow === -1 ? `>${numClients}` : recoverySlow + 1}`);
      console.log(`Feedbacks to recover quality to ${targetQuality}: ${recoveryQuality === -1 ? `>${numClients}` : recoveryQuality + 1}`);
      console.log(`Feedbacks to reach Silver tier: ${recoveryTier2 === -1 ? `>${numClients}` : recoveryTier2 + 1}`);
      console.log(`Final quality: ${stats.qualityScore}, tier: ${stats.trustTier}`);

      // Theoretical calculation
      const theoretical = calculateWhitewashFeedbacks(0, 60, 70, 30);
      console.log(`Theoretical feedbacks needed (alpha=30%): ${theoretical}`);

      // Real protection metric: how hard is it to reach Silver tier after a bad score?
      // With probationary dampening, quality recovery is very slow when quality < 3000
      if (recoveryTier2 === -1 || recoveryTier2 > 50) {
        console.log("\nPROTECTION: Whitewashing to Silver tier requires many feedbacks (>50)");
      } else if (recoveryQuality === -1 || recoveryQuality > 30) {
        console.log("\nMODERATE: Quality recovery is slow but tier reached early");
      } else {
        console.log("\nVULNERABILITY: Quality recovers too fast - whitewashing is easy");
      }
    });
  });

  // ============================================================================
  // 3. COLLUSION ATTACKS
  // ============================================================================
  describe("Collusion Attacks", () => {
    it("Circular Cabal: 3 agents rating each other in circle", async () => {
      // Create 3 owners with agents
      const owners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const agents = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      allFundedKeypairs.push(...owners);
      await fundKeypairs(provider, owners);

      const agentPdas: PublicKey[] = [];
      const statsPdas: PublicKey[] = [];

      // Register 3 agents
      for (let i = 0; i < 3; i++) {
        const [agentPda] = getAgentPda(agents[i].publicKey, program.programId);
        const [statsPda] = getAtomStatsPda(agents[i].publicKey);
        agentPdas.push(agentPda);
        statsPdas.push(statsPda);

        await program.methods
          .register(`https://cabal.test/agent-${i}`)
          .accounts({
            registryConfig: registryConfigPda,
            agentAccount: agentPda,
            asset: agents[i].publicKey,
            collection: collectionPubkey,
            owner: owners[i].publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([agents[i], owners[i]])
          .rpc();

        // Initialize AtomStats for this agent
        await atomProgram.methods
          .initializeStats()
          .accounts({
            owner: owners[i].publicKey,
            asset: agents[i].publicKey,
            collection: collectionPubkey,
            config: atomConfigPda,
            stats: statsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([owners[i]])
          .rpc();
      }

      console.log("Created 3 agents for cabal test");

      // Circular feedback: Owner0 → Agent1, Owner1 → Agent2, Owner2 → Agent0
      const cycles = 30;
      for (let cycle = 0; cycle < cycles; cycle++) {
        for (let i = 0; i < 3; i++) {
          const raterOwner = owners[i];
          const targetAgentIdx = (i + 1) % 3;
          const feedbackIdx = cycle * 3 + i;

          await program.methods
            .giveFeedback(
              100,  // Perfect score
              "cabal",
              "collude",
              "https://cabal.test/api",
              `https://cabal.test/feedback/${feedbackIdx}`,
              Array.from(generateClientHash(raterOwner)),
              new anchor.BN(cycle)
            )
            .accounts({
              client: raterOwner.publicKey,
              asset: agents[targetAgentIdx].publicKey,
              collection: collectionPubkey,
              agentAccount: agentPdas[targetAgentIdx],
              atomConfig: atomConfigPda,
              atomStats: statsPdas[targetAgentIdx],
              atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([raterOwner])
            .rpc();
        }
      }

      console.log("\n=== Cabal Attack Results ===");
      for (let i = 0; i < 3; i++) {
        const stats = await atomProgram.account.atomStats.fetch(statsPdas[i]);
        console.log(`Agent ${i}:`);
        console.log(`  - Feedback count: ${stats.feedbackCount.toNumber()}`);
        console.log(`  - Trust tier: ${stats.trustTier}`);
        console.log(`  - Quality score: ${stats.qualityScore}`);
        console.log(`  - Diversity ratio: ${stats.diversityRatio}`);
        console.log(`  - Risk score: ${stats.riskScore}`);
      }

      // Check if collusion is detectable
      const stats0 = await atomProgram.account.atomStats.fetch(statsPdas[0]);
      if (stats0.trustTier >= 3 && stats0.diversityRatio < 50) {
        console.log("\nVULNERABILITY: Cabal achieved high tier with low diversity");
        console.log("Collusion is detectable via diversity_ratio but tier not penalized");
      } else if (stats0.trustTier >= 3) {
        console.log("\nVULNERABILITY: Cabal achieved high tier - collusion undetected");
      } else {
        console.log("\nPROTECTION: Low tier despite perfect scores - diversity check working");
      }
    });

    it("Wash Trading: 2 agents exchanging feedback", async () => {
      // Create 2 owner-agent pairs
      const owner1 = Keypair.generate();
      const owner2 = Keypair.generate();
      const agent1 = Keypair.generate();
      const agent2 = Keypair.generate();
      allFundedKeypairs.push(owner1, owner2);
      await fundKeypairs(provider, [owner1, owner2]);

      const [agent1Pda] = getAgentPda(agent1.publicKey, program.programId);
      const [agent2Pda] = getAgentPda(agent2.publicKey, program.programId);
      const [stats1Pda] = getAtomStatsPda(agent1.publicKey);
      const [stats2Pda] = getAtomStatsPda(agent2.publicKey);

      // Register both agents
      await program.methods
        .register("https://wash.test/agent-1")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: agent1Pda,
          asset: agent1.publicKey,
          collection: collectionPubkey,
          owner: owner1.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agent1, owner1])
        .rpc();

      // Initialize AtomStats for agent1
      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: owner1.publicKey,
          asset: agent1.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: stats1Pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner1])
        .rpc();

      await program.methods
        .register("https://wash.test/agent-2")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: agent2Pda,
          asset: agent2.publicKey,
          collection: collectionPubkey,
          owner: owner2.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agent2, owner2])
        .rpc();

      // Initialize AtomStats for agent2
      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: owner2.publicKey,
          asset: agent2.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: stats2Pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner2])
        .rpc();

      console.log("Testing wash trading between 2 agents...");

      // Owner1 rates Agent2, Owner2 rates Agent1 (alternating, reduced for SOL limits)
      for (let i = 0; i < 15; i++) {
        // Owner1 → Agent2
        await program.methods
          .giveFeedback(
            95,
            "wash",
            "trade",
            "https://wash.test/api",
            `https://wash.test/feedback/${i * 2}`,
            Array.from(generateClientHash(owner1)),
            new anchor.BN(i)
          )
          .accounts({
            client: owner1.publicKey,
            asset: agent2.publicKey,
            collection: collectionPubkey,
            agentAccount: agent2Pda,
            atomConfig: atomConfigPda,
            atomStats: stats2Pda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner1])
          .rpc();

        // Owner2 → Agent1
        await program.methods
          .giveFeedback(
            95,
            "wash",
            "trade",
            "https://wash.test/api",
            `https://wash.test/feedback/${i * 2 + 1}`,
            Array.from(generateClientHash(owner2)),
            new anchor.BN(i)
          )
          .accounts({
            client: owner2.publicKey,
            asset: agent1.publicKey,
            collection: collectionPubkey,
            agentAccount: agent1Pda,
            atomConfig: atomConfigPda,
            atomStats: stats1Pda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner2])
          .rpc();
      }

      const stats1 = await atomProgram.account.atomStats.fetch(stats1Pda);
      const stats2 = await atomProgram.account.atomStats.fetch(stats2Pda);

      console.log("\n=== Wash Trading Results ===");
      console.log("Agent 1:");
      console.log(`  - Feedback count: ${stats1.feedbackCount.toNumber()}`);
      console.log(`  - Trust tier: ${stats1.trustTier}`);
      console.log(`  - Diversity ratio: ${stats1.diversityRatio}`);
      console.log(`  - HLL estimate (unique clients): approx ${stats1.diversityRatio > 0 ? Math.round(stats1.feedbackCount.toNumber() * stats1.diversityRatio / 255) : 1}`);

      console.log("Agent 2:");
      console.log(`  - Feedback count: ${stats2.feedbackCount.toNumber()}`);
      console.log(`  - Trust tier: ${stats2.trustTier}`);
      console.log(`  - Diversity ratio: ${stats2.diversityRatio}`);

      // With only 1 unique client each, diversity_ratio should be very low
      if (stats1.diversityRatio <= 10) {
        console.log("\nPROTECTION: Low diversity correctly detected (ratio ≤ 10)");
      } else {
        console.log("\nWARNING: Diversity ratio unexpectedly high for single-client");
      }
    });
  });

  // ============================================================================
  // 4. SCALE TESTS
  // ============================================================================
  describe("Scale Tests", () => {
    it("Rapid concurrent updates from multiple clients", async () => {
      // Create agent
      const scaleAgent = Keypair.generate();
      const [scaleAgentPda] = getAgentPda(scaleAgent.publicKey, program.programId);
      const [scaleStatsPda] = getAtomStatsPda(scaleAgent.publicKey);

      await program.methods
        .register("https://scale.test/agent")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: scaleAgentPda,
          asset: scaleAgent.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([scaleAgent])
        .rpc();

      // Initialize AtomStats for scale agent
      await atomProgram.methods
        .initializeStats()
        .accounts({
          owner: provider.wallet.publicKey,
          asset: scaleAgent.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: scaleStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create clients (reduced for devnet SOL limits)
      const scaleClients = Array.from({ length: 10 }, () => Keypair.generate());
      allFundedKeypairs.push(...scaleClients);
      await fundKeypairs(provider, scaleClients);

      console.log("Testing rapid concurrent updates...");
      const startTime = Date.now();

      // Send all feedbacks with minimal delay
      const promises: Promise<string>[] = [];
      for (let i = 0; i < 10; i++) {
        const promise = program.methods
          .giveFeedback(
            70 + (i % 30),  // Varied scores
            "scale",
            "test",
            "https://scale.test/api",
            `https://scale.test/feedback/${i}`,
            Array.from(generateClientHash(scaleClients[i])),
            new anchor.BN(i)
          )
          .accounts({
            client: scaleClients[i].publicKey,
            asset: scaleAgent.publicKey,
            collection: collectionPubkey,
            agentAccount: scaleAgentPda,
            atomConfig: atomConfigPda,
            atomStats: scaleStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([scaleClients[i]])
          .rpc();

        promises.push(promise);
        // Small stagger to avoid same-slot conflicts
        await new Promise(r => setTimeout(r, 50));
      }

      await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      const stats = await atomProgram.account.atomStats.fetch(scaleStatsPda);
      console.log("\n=== Scale Test Results ===");
      console.log(`Time for 10 feedbacks: ${elapsed}ms`);
      console.log(`Feedback count: ${stats.feedbackCount.toNumber()}`);
      console.log(`All feedbacks recorded: ${stats.feedbackCount.toNumber() === 10}`);
      console.log(`Diversity ratio: ${stats.diversityRatio}`);

      expect(stats.feedbackCount.toNumber()).to.equal(10);
    });
  });
});
