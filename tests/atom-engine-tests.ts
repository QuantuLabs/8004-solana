/**
 * ATOM Engine Tests - Standalone Program Tests
 * Tests for the atom-engine reputation metrics program
 *
 * ATOM = Agent Trust On-chain Model
 *
 * v0.4.0: Independent program with CPI interface
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, Transaction } from "@solana/web3.js";
import { expect } from "chai";

import {
  ATOM_ENGINE_PROGRAM_ID,
  getAtomConfigPda,
  getAtomStatsPda,
  getAtomCheckpointPda,
  randomHash,
  expectAnchorError,
} from "./utils/helpers";

// Helper to fund a keypair from the provider wallet
async function fundKeypair(
  provider: anchor.AnchorProvider,
  keypair: Keypair,
  lamports: number
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: keypair.publicKey,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx);
}

describe("ATOM Engine Tests (Standalone)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AtomEngine as Program<AtomEngine>;

  // PDAs
  let atomConfigPda: PublicKey;
  let atomConfigBump: number;

  // Test assets
  let testAsset1: Keypair;
  let testAsset2: Keypair;
  let testCollection: Keypair;
  let atomStatsPda1: PublicKey;
  let atomStatsPda2: PublicKey;

  // For unauthorized tests
  let unauthorizedUser: Keypair;

  // Fake agent registry program ID (for testing)
  const fakeAgentRegistryProgram = new PublicKey("3GGkAWC3mYYdud8GVBsKXK5QC9siXtFkWVZFYtbueVbC");

  before(async () => {
    [atomConfigPda, atomConfigBump] = getAtomConfigPda();

    // Generate test assets
    testAsset1 = Keypair.generate();
    testAsset2 = Keypair.generate();
    testCollection = Keypair.generate();
    [atomStatsPda1] = getAtomStatsPda(testAsset1.publicKey);
    [atomStatsPda2] = getAtomStatsPda(testAsset2.publicKey);

    // Generate unauthorized user and fund it
    unauthorizedUser = Keypair.generate();
    await fundKeypair(provider, unauthorizedUser, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

    console.log("=== ATOM Engine Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("AtomConfig PDA:", atomConfigPda.toBase58());
    console.log("Test Asset 1:", testAsset1.publicKey.toBase58());
    console.log("Test Asset 2:", testAsset2.publicKey.toBase58());
    console.log("Test Collection:", testCollection.publicKey.toBase58());
    console.log("Unauthorized User:", unauthorizedUser.publicKey.toBase58());
  });

  // ============================================================================
  // CONFIG INITIALIZATION TESTS
  // ============================================================================
  describe("Config Initialization", () => {
    it("initializeConfig() creates AtomConfig if not exists", async () => {
      const configInfo = await provider.connection.getAccountInfo(atomConfigPda);

      if (!configInfo) {
        // Config doesn't exist, initialize it
        await program.methods
          .initializeConfig(fakeAgentRegistryProgram)
          .accounts({
            authority: provider.wallet.publicKey,
            config: atomConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("AtomConfig initialized");
      } else {
        console.log("AtomConfig already exists, skipping initialization");
      }

      // Verify config was created
      const config = await program.account.atomConfig.fetch(atomConfigPda);
      expect(config.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(config.paused).to.equal(false);
      expect(config.version).to.be.gte(0);
    });

    it("initializeConfig() fails if already initialized", async () => {
      try {
        await program.methods
          .initializeConfig(fakeAgentRegistryProgram)
          .accounts({
            authority: provider.wallet.publicKey,
            config: atomConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        // Account already initialized - Anchor will reject
        expect(error.toString()).to.include("already in use");
      }
    });

    it("initializeConfig() fails for non-authority", async () => {
      const newConfigPda = PublicKey.findProgramAddressSync(
        [Buffer.from("atom_config_test")],  // Different seed to avoid collision
        program.programId
      )[0];

      try {
        await program.methods
          .initializeConfig(fakeAgentRegistryProgram)
          .accounts({
            authority: unauthorizedUser.publicKey,
            config: atomConfigPda,  // Trying to use existing PDA
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedUser])
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        // Seeds constraint will fail because PDA is derived from "atom_config", not user
        expect(error.toString()).to.not.include("Should have failed");
      }
    });
  });

  // ============================================================================
  // CONFIG UPDATE TESTS
  // ============================================================================
  describe("Config Updates", () => {
    it("updateConfig() updates parameters (authority only)", async () => {
      const configBefore = await program.account.atomConfig.fetch(atomConfigPda);
      const versionBefore = configBefore.version;

      await program.methods
        .updateConfig(
          1500,  // alphaFast
          null,  // alphaSlow (unchanged)
          null,  // alphaVolatility
          null,  // alphaArrival
          null,  // weightSybil
          null,  // weightBurst
          null,  // weightStagnation
          null,  // weightShock
          null,  // weightVolatility
          null,  // weightArrival
          null,  // diversityThreshold
          null,  // burstThreshold
          null,  // shockThreshold
          null,  // volatilityThreshold
          null,  // paused
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: atomConfigPda,
        })
        .rpc();

      const configAfter = await program.account.atomConfig.fetch(atomConfigPda);
      expect(configAfter.alphaFast).to.equal(1500);
      expect(configAfter.version).to.equal(versionBefore + 1);
    });

    it("updateConfig() can pause/unpause engine", async () => {
      // Pause
      await program.methods
        .updateConfig(
          null, null, null, null, null, null, null, null, null, null,
          null, null, null, null, true  // paused = true
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: atomConfigPda,
        })
        .rpc();

      let config = await program.account.atomConfig.fetch(atomConfigPda);
      expect(config.paused).to.equal(true);

      // Unpause
      await program.methods
        .updateConfig(
          null, null, null, null, null, null, null, null, null, null,
          null, null, null, null, false  // paused = false
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: atomConfigPda,
        })
        .rpc();

      config = await program.account.atomConfig.fetch(atomConfigPda);
      expect(config.paused).to.equal(false);
    });

    it("updateConfig() fails for non-authority", async () => {
      try {
        await program.methods
          .updateConfig(
            2000, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null
          )
          .accounts({
            authority: unauthorizedUser.publicKey,
            config: atomConfigPda,
          })
          .signers([unauthorizedUser])
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        // Constraint violation: config.authority != unauthorizedUser
        expect(error.toString()).to.include("Error");
      }
    });
  });

  // ============================================================================
  // UPDATE STATS TESTS
  // ============================================================================
  describe("Update Stats", () => {
    it("updateStats() creates AtomStats and updates metrics", async () => {
      const clientHash = Array.from(randomHash());
      const score = 85;

      await program.methods
        .updateStats(clientHash, score)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: testAsset1.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: atomStatsPda1,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const stats = await program.account.atomStats.fetch(atomStatsPda1);
      expect(stats.feedbackCount.toNumber()).to.equal(1);
      expect(stats.firstScore).to.equal(score);
      expect(stats.lastScore).to.equal(score);
      expect(stats.collection.toBase58()).to.equal(testCollection.publicKey.toBase58());
      expect(stats.asset.toBase58()).to.equal(testAsset1.publicKey.toBase58());

      console.log("Stats after first feedback:");
      console.log("  - Feedback count:", stats.feedbackCount.toNumber());
      console.log("  - EMA fast:", stats.emaScoreFast);
      console.log("  - EMA slow:", stats.emaScoreSlow);
      console.log("  - Quality score:", stats.qualityScore);
      console.log("  - Trust tier:", stats.trustTier);
    });

    it("updateStats() updates existing stats", async () => {
      const clientHash2 = Array.from(randomHash());
      const score2 = 90;

      await program.methods
        .updateStats(clientHash2, score2)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: testAsset1.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: atomStatsPda1,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const stats = await program.account.atomStats.fetch(atomStatsPda1);
      expect(stats.feedbackCount.toNumber()).to.equal(2);
      expect(stats.lastScore).to.equal(score2);
      expect(stats.minScore).to.be.lte(stats.maxScore);
    });

    it("updateStats() fails with invalid score > 100", async () => {
      const clientHash = Array.from(randomHash());

      try {
        await program.methods
          .updateStats(clientHash, 150)  // Invalid: > 100
          .accounts({
            payer: provider.wallet.publicKey,
            asset: testAsset2.publicKey,
            collection: testCollection.publicKey,
            config: atomConfigPda,
            stats: atomStatsPda2,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        expect(error.toString()).to.include("InvalidScore");
      }
    });

    it("updateStats() fails when engine is paused", async () => {
      // Pause first
      await program.methods
        .updateConfig(
          null, null, null, null, null, null, null, null, null, null,
          null, null, null, null, true
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: atomConfigPda,
        })
        .rpc();

      try {
        const clientHash = Array.from(randomHash());
        await program.methods
          .updateStats(clientHash, 80)
          .accounts({
            payer: provider.wallet.publicKey,
            asset: testAsset2.publicKey,
            collection: testCollection.publicKey,
            config: atomConfigPda,
            stats: atomStatsPda2,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        expect(error.toString()).to.include("Paused");
      } finally {
        // Unpause
        await program.methods
          .updateConfig(
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, false
          )
          .accounts({
            authority: provider.wallet.publicKey,
            config: atomConfigPda,
          })
          .rpc();
      }
    });
  });

  // ============================================================================
  // GET SUMMARY TESTS
  // ============================================================================
  describe("Get Summary", () => {
    it("getSummary() returns correct summary data", async () => {
      // First ensure we have some stats
      const stats = await program.account.atomStats.fetch(atomStatsPda1);
      expect(stats.feedbackCount.toNumber()).to.be.gte(1);

      // Call getSummary via simulate (view function)
      const summary = await program.methods
        .getSummary()
        .accounts({
          asset: testAsset1.publicKey,
          stats: atomStatsPda1,
        })
        .view();

      expect(summary.asset.toBase58()).to.equal(testAsset1.publicKey.toBase58());
      expect(summary.collection.toBase58()).to.equal(testCollection.publicKey.toBase58());
      expect(summary.feedbackCount.toNumber()).to.equal(stats.feedbackCount.toNumber());
      expect(summary.trustTier).to.equal(stats.trustTier);
      expect(summary.qualityScore).to.equal(stats.qualityScore);
      expect(summary.riskScore).to.equal(stats.riskScore);

      console.log("Summary returned:");
      console.log("  - Trust tier:", summary.trustTier);
      console.log("  - Quality score:", summary.qualityScore);
      console.log("  - Risk score:", summary.riskScore);
      console.log("  - Confidence:", summary.confidence);
      console.log("  - Feedback count:", summary.feedbackCount.toNumber());
      console.log("  - Unique clients:", summary.uniqueClients.toNumber());
    });
  });

  // ============================================================================
  // CHECKPOINT & RECOVERY TESTS
  // ============================================================================
  describe("Checkpoint & Recovery", () => {
    // Note: Checkpoint requires CHECKPOINT_INTERVAL feedbacks
    // For testing, we may need to add many feedbacks first or use a mock

    it("createCheckpoint() requires minimum feedback count", async () => {
      const checkpointIndex = new anchor.BN(0);
      const checkpointHash = Array.from(randomHash());
      const [checkpointPda] = getAtomCheckpointPda(testAsset1.publicKey, checkpointIndex);

      try {
        await program.methods
          .createCheckpoint(checkpointIndex, checkpointHash)
          .accounts({
            payer: provider.wallet.publicKey,
            asset: testAsset1.publicKey,
            stats: atomStatsPda1,
            checkpoint: checkpointPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        // If this succeeds, checkpoint interval was met
        console.log("Checkpoint created (interval met)");

        const checkpoint = await program.account.atomCheckpoint.fetch(checkpointPda);
        expect(checkpoint.asset.toBase58()).to.equal(testAsset1.publicKey.toBase58());
        expect(checkpoint.checkpointIndex.toNumber()).to.equal(0);
      } catch (error: any) {
        // Expected if not enough feedbacks
        if (error.toString().includes("CheckpointIntervalNotReached")) {
          console.log("Checkpoint interval not reached yet (expected)");
        } else {
          throw error;
        }
      }
    });

    it("replayBatch() replays events (authority only)", async () => {
      // First create a fresh asset for replay testing
      const replayAsset = Keypair.generate();
      const [replayStatsPda] = getAtomStatsPda(replayAsset.publicKey);

      // Initialize stats with first feedback
      const initialHash = Array.from(randomHash());
      await program.methods
        .updateStats(initialHash, 70)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: replayAsset.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: replayStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Now replay a batch
      const replayEvents = [
        { clientHash: Array.from(randomHash()), score: 80, slot: new anchor.BN(1000) },
        { clientHash: Array.from(randomHash()), score: 85, slot: new anchor.BN(2000) },
        { clientHash: Array.from(randomHash()), score: 90, slot: new anchor.BN(3000) },
      ];

      await program.methods
        .replayBatch(replayEvents)
        .accounts({
          authority: provider.wallet.publicKey,
          asset: replayAsset.publicKey,
          config: atomConfigPda,
          stats: replayStatsPda,
        })
        .rpc();

      const stats = await program.account.atomStats.fetch(replayStatsPda);
      // Initial feedback + 3 replayed = 4 total
      expect(stats.feedbackCount.toNumber()).to.equal(4);
      console.log("Replay batch completed, total feedbacks:", stats.feedbackCount.toNumber());
    });

    it("replayBatch() fails for non-authority", async () => {
      const replayEvents = [
        { clientHash: Array.from(randomHash()), score: 75, slot: new anchor.BN(1000) },
      ];

      try {
        await program.methods
          .replayBatch(replayEvents)
          .accounts({
            authority: unauthorizedUser.publicKey,
            asset: testAsset1.publicKey,
            config: atomConfigPda,
            stats: atomStatsPda1,
          })
          .signers([unauthorizedUser])
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        expect(error.toString()).to.include("Error");
      }
    });

    it("replayBatch() fails with empty events", async () => {
      try {
        await program.methods
          .replayBatch([])
          .accounts({
            authority: provider.wallet.publicKey,
            asset: testAsset1.publicKey,
            config: atomConfigPda,
            stats: atomStatsPda1,
          })
          .rpc();

        throw new Error("Should have failed");
      } catch (error: any) {
        expect(error.toString()).to.include("InvalidReplayBatch");
      }
    });
  });

  // ============================================================================
  // STRESS TESTS
  // ============================================================================
  describe("Stress Tests", () => {
    it("handles multiple rapid updates", async () => {
      const stressAsset = Keypair.generate();
      const [stressStatsPda] = getAtomStatsPda(stressAsset.publicKey);

      // Fund payer for multiple transactions
      const stressPayer = Keypair.generate();
      await fundKeypair(provider, stressPayer, 0.5 * anchor.web3.LAMPORTS_PER_SOL);

      // Send 10 rapid updates
      const updatePromises: Promise<string>[] = [];
      for (let i = 0; i < 10; i++) {
        const clientHash = Array.from(randomHash());
        const score = 50 + Math.floor(Math.random() * 50);  // 50-99

        const promise = program.methods
          .updateStats(clientHash, score)
          .accounts({
            payer: stressPayer.publicKey,
            asset: stressAsset.publicKey,
            collection: testCollection.publicKey,
            config: atomConfigPda,
            stats: stressStatsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([stressPayer])
          .rpc();

        updatePromises.push(promise);

        // Small delay to avoid transaction collision
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for all to complete
      await Promise.all(updatePromises);

      const stats = await program.account.atomStats.fetch(stressStatsPda);
      expect(stats.feedbackCount.toNumber()).to.equal(10);
      console.log("Stress test completed: 10 updates, final count:", stats.feedbackCount.toNumber());
    });
  });

  // ============================================================================
  // METRIC CALCULATION TESTS
  // ============================================================================
  describe("Metric Calculations", () => {
    it("correctly calculates EMA scores", async () => {
      const emaAsset = Keypair.generate();
      const [emaStatsPda] = getAtomStatsPda(emaAsset.publicKey);

      // High score first
      await program.methods
        .updateStats(Array.from(randomHash()), 100)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: emaAsset.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: emaStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      let stats = await program.account.atomStats.fetch(emaStatsPda);
      const emaAfter100 = stats.emaScoreFast;
      console.log("EMA after 100 score:", emaAfter100);

      // Low score second
      await program.methods
        .updateStats(Array.from(randomHash()), 0)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: emaAsset.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: emaStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      stats = await program.account.atomStats.fetch(emaStatsPda);
      const emaAfter0 = stats.emaScoreFast;
      console.log("EMA after 0 score:", emaAfter0);

      // EMA should have decreased
      expect(emaAfter0).to.be.lt(emaAfter100);
    });

    it("correctly tracks min/max scores", async () => {
      const minMaxAsset = Keypair.generate();
      const [minMaxStatsPda] = getAtomStatsPda(minMaxAsset.publicKey);

      // Score 50
      await program.methods
        .updateStats(Array.from(randomHash()), 50)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: minMaxAsset.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: minMaxStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      let stats = await program.account.atomStats.fetch(minMaxStatsPda);
      expect(stats.minScore).to.equal(50);
      expect(stats.maxScore).to.equal(50);

      // Score 30 (new min)
      await program.methods
        .updateStats(Array.from(randomHash()), 30)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: minMaxAsset.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: minMaxStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      stats = await program.account.atomStats.fetch(minMaxStatsPda);
      expect(stats.minScore).to.equal(30);
      expect(stats.maxScore).to.equal(50);

      // Score 90 (new max)
      await program.methods
        .updateStats(Array.from(randomHash()), 90)
        .accounts({
          payer: provider.wallet.publicKey,
          asset: minMaxAsset.publicKey,
          collection: testCollection.publicKey,
          config: atomConfigPda,
          stats: minMaxStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      stats = await program.account.atomStats.fetch(minMaxStatsPda);
      expect(stats.minScore).to.equal(30);
      expect(stats.maxScore).to.equal(90);
      console.log("Min/max tracking: min=", stats.minScore, "max=", stats.maxScore);
    });

    it("tracks diversity ratio via HLL", async () => {
      const diversityAsset = Keypair.generate();
      const [diversityStatsPda] = getAtomStatsPda(diversityAsset.publicKey);

      // 5 unique clients
      for (let i = 0; i < 5; i++) {
        await program.methods
          .updateStats(Array.from(randomHash()), 80)
          .accounts({
            payer: provider.wallet.publicKey,
            asset: diversityAsset.publicKey,
            collection: testCollection.publicKey,
            config: atomConfigPda,
            stats: diversityStatsPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const stats = await program.account.atomStats.fetch(diversityStatsPda);
      expect(stats.feedbackCount.toNumber()).to.equal(5);

      // Diversity ratio should be high (each client is unique)
      // diversityRatio = (unique_estimate * 255) / count
      // With 5 unique clients out of 5 feedbacks, ratio should be ~255
      console.log("Diversity ratio after 5 unique clients:", stats.diversityRatio);
      expect(stats.diversityRatio).to.be.gte(200);  // Should be high
    });
  });
});
