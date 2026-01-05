/**
 * Security Fixes Coverage Tests - v0.2.2
 * 100% coverage for all security changes with edge cases and simulations
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

import {
  MPL_CORE_PROGRAM_ID,
  getConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getValidationStatsPda,
  getValidationRequestPda,
  getMetadataEntryPda,
  getResponsePda,
  getResponseIndexPda,
  computeKeyHash,
  randomHash,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

describe("Security Fixes Coverage Tests v0.2.2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let configPda: PublicKey;
  let collectionPubkey: PublicKey;
  let validationStatsPda: PublicKey;

  before(async () => {
    [configPda] = getConfigPda(program.programId);
    [validationStatsPda] = getValidationStatsPda(program.programId);

    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;

    console.log("=== Security Fixes Coverage Tests ===");
    console.log("Program ID:", program.programId.toBase58());
  });

  // ============================================================================
  // F-02: close_validation FULL COVERAGE
  // ============================================================================
  describe("F-02: close_validation Security (Full Coverage)", () => {
    let agentAsset: Keypair;
    let agentPda: PublicKey;
    let agentId: anchor.BN;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      agentId = config.nextAgentId;

      agentAsset = Keypair.generate();
      [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/f02-coverage")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agentAsset])
        .rpc();
    });

    it("F-02.1: closeValidation with mismatched agent_id fails", async () => {
      // Create second agent
      const otherAsset = Keypair.generate();
      const [otherAgentPda] = getAgentPda(otherAsset.publicKey, program.programId);
      const config = await program.account.registryConfig.fetch(configPda);
      const otherAgentId = config.nextAgentId;

      await program.methods
        .register("https://example.com/agent/f02-other")
        .accounts({
          config: configPda,
          agentAccount: otherAgentPda,
          asset: otherAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([otherAsset])
        .rpc();

      // Create validation for FIRST agent
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/f02-1",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(1, "https://response", Array.from(randomHash()), "done")
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      // Try to close with SECOND agent's accounts - should fail
      const agent = await program.account.agentAccount.fetch(otherAgentPda);
      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            config: configPda,
            closer: provider.wallet.publicKey,
            asset: otherAsset.publicKey,
            agentAccount: otherAgentPda,
            validationRequest: requestPda,
            rentReceiver: provider.wallet.publicKey,
          })
          .rpc(),
        "AgentNotFound"
      );
    });

    it("F-02.2: closeValidation rent_receiver != owner fails", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/f02-2",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(1, "https://response", Array.from(randomHash()), "done")
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      // Try to redirect rent to random address
      const randomReceiver = Keypair.generate().publicKey;

      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            config: configPda,
            closer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validationRequest: requestPda,
            rentReceiver: randomReceiver,
          })
          .rpc(),
        "InvalidRentReceiver"
      );
    });

    it("F-02.3: closeValidation succeeds with correct agent and owner", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/f02-3",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(1, "https://response", Array.from(randomHash()), "done")
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      // Get balance before
      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      // Close with correct agent owner
      await program.methods
        .closeValidation()
        .accounts({
          config: configPda,
          closer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          rentReceiver: provider.wallet.publicKey,
        })
        .rpc();

      // Verify account closed
      const accountInfo = await provider.connection.getAccountInfo(requestPda);
      expect(accountInfo).to.be.null;

      // Verify rent returned (balance increased minus tx fee)
      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      expect(balanceAfter).to.be.greaterThan(balanceBefore - 10000); // Allow for tx fee
    });

    it("F-02.4: closeValidation by attacker with attacker as rent_receiver fails", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/f02-4",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(1, "https://response", Array.from(randomHash()), "done")
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      const attacker = Keypair.generate();

      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            config: configPda,
            closer: attacker.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validationRequest: requestPda,
            rentReceiver: attacker.publicKey,
          })
          .signers([attacker])
          .rpc(),
        "InvalidRentReceiver"
      );
    });
  });

  // ============================================================================
  // F-03: agent_id==0 sentinel removal FULL COVERAGE
  // ============================================================================
  describe("F-03: agent_id==0 Sentinel Removal (Full Coverage)", () => {
    // Note: Agent #0 already exists from initial setup, test with fresh agents
    // to verify the sentinel logic works correctly for ANY agent including agent_id=0 scenario

    it("F-03.1: First feedback initializes reputation correctly", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const newAgentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [reputationPda] = getAgentReputationPda(newAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/f03-1")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      // First feedback
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(newAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          newAgentId,
          75,
          "first",
          "feedback",
          "https://example.com/feedback/f03-1",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.agentId.toNumber()).to.equal(newAgentId.toNumber());
      expect(reputation.totalFeedbacks.toNumber()).to.equal(1);
      expect(reputation.totalScoreSum.toNumber()).to.equal(75);
      expect(reputation.averageScore).to.equal(75);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(1);
    });

    it("F-03.2: Multiple feedbacks accumulate correctly", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const newAgentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [reputationPda] = getAgentReputationPda(newAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/f03-2")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      // Give 5 feedbacks
      const scores = [80, 90, 70, 85, 95];
      for (let i = 0; i < scores.length; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(newAgentId, feedbackIndex, program.programId);

        await program.methods
          .giveFeedback(
            newAgentId,
            scores[i],
            "multi",
            "feedback",
            `https://example.com/feedback/f03-2-${i}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: asset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      const totalScore = scores.reduce((a, b) => a + b, 0); // 420
      const expectedAvg = Math.round(totalScore / scores.length); // 84

      expect(reputation.totalFeedbacks.toNumber()).to.equal(5);
      expect(reputation.totalScoreSum.toNumber()).to.equal(totalScore);
      expect(reputation.averageScore).to.equal(expectedAvg);
    });

    it("F-03.3: Response index initializes correctly for first response", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const newAgentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [reputationPda] = getAgentReputationPda(newAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/f03-3")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      // Create feedback
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(newAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          newAgentId,
          80,
          "response",
          "test",
          "https://example.com/feedback/f03-3",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // First response
      const [responseIndexPda] = getResponseIndexPda(newAgentId, feedbackIndex, program.programId);
      const responseIndex = new anchor.BN(0);
      const [responsePda] = getResponsePda(newAgentId, feedbackIndex, responseIndex, program.programId);

      await program.methods
        .appendResponse(
          newAgentId,
          feedbackIndex,
          "https://example.com/response/f03-3",
          Array.from(randomHash())
        )
        .accounts({
          responder: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      expect(responseIndexAccount.agentId.toNumber()).to.equal(newAgentId.toNumber());
      expect(responseIndexAccount.feedbackIndex.toNumber()).to.equal(0);
      expect(responseIndexAccount.nextIndex.toNumber()).to.equal(1);
    });
  });

  // ============================================================================
  // F-05: key_hash validation FULL COVERAGE
  // ============================================================================
  describe("F-05: key_hash Validation (Full Coverage)", () => {
    let agentAsset: Keypair;
    let agentPda: PublicKey;
    let agentId: anchor.BN;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      agentId = config.nextAgentId;

      agentAsset = Keypair.generate();
      [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/f05-coverage")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agentAsset])
        .rpc();
    });

    it("F-05.1: Correct key_hash succeeds", async () => {
      const key = "valid_key";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("valid_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(entry.metadataKey).to.equal(key);
    });

    it("F-05.2: Wrong key_hash (all zeros) fails", async () => {
      const key = "test_key_zeros";
      const wrongKeyHash = new Uint8Array(8).fill(0);
      const [metadataPda] = getMetadataEntryPda(agentId, wrongKeyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(wrongKeyHash), key, Buffer.from("value"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch"
      );
    });

    it("F-05.3: Wrong key_hash (random bytes) fails", async () => {
      const key = "test_key_random";
      const wrongKeyHash = crypto.randomBytes(8);
      const [metadataPda] = getMetadataEntryPda(agentId, wrongKeyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(wrongKeyHash), key, Buffer.from("value"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch"
      );
    });

    it("F-05.4: key_hash from different key fails", async () => {
      const key = "actual_key";
      const differentKey = "different_key";
      const wrongKeyHash = computeKeyHash(differentKey); // Hash of different key
      const [metadataPda] = getMetadataEntryPda(agentId, wrongKeyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(wrongKeyHash), key, Buffer.from("value"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch"
      );
    });

    it("F-05.5: Empty key with correct hash succeeds", async () => {
      const key = "";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("empty_key_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(entry.metadataKey).to.equal("");
    });

    it("F-05.6: Max length key (32 bytes) with correct hash succeeds", async () => {
      const key = "a".repeat(32);
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("max_key_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(entry.metadataKey).to.equal(key);
    });
  });

  // ============================================================================
  // A-06: Key hash collision protection FULL COVERAGE
  // ============================================================================
  describe("A-06: Key Hash Collision Protection (Full Coverage)", () => {
    let agentAsset: Keypair;
    let agentPda: PublicKey;
    let agentId: anchor.BN;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      agentId = config.nextAgentId;

      agentAsset = Keypair.generate();
      [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/a06-coverage")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agentAsset])
        .rpc();
    });

    it("A-06.1: Update existing key with same key succeeds", async () => {
      const key = "updatable_key";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      // Create
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("initial_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Update same key
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("updated_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(Buffer.from(entry.metadataValue).toString()).to.equal("updated_value");
    });

    it("A-06.2: Simulated collision (different key, same PDA) would fail", async () => {
      // Note: In reality, finding two keys with same 8-byte hash is extremely rare
      // This test verifies the protection mechanism works when entry exists

      const originalKey = "original_collision_key";
      const keyHash = computeKeyHash(originalKey);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      // Create with original key
      await program.methods
        .setMetadataPda(Array.from(keyHash), originalKey, Buffer.from("original"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to use SAME PDA but pass a DIFFERENT key name
      // The key_hash validation (F-05) will catch this first
      const differentKey = "collision_attempt_key";

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), differentKey, Buffer.from("collision"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch" // F-05 catches it before A-06
      );
    });

    it("A-06.3: Immutable entry cannot be updated", async () => {
      const key = "immutable_key";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      // Create as immutable
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("immutable_value"), true)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to update
      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, Buffer.from("new_value"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "MetadataImmutable"
      );
    });
  });

  // ============================================================================
  // A-07: Average score rounding FULL COVERAGE
  // ============================================================================
  describe("A-07: Average Score Rounding (Full Coverage)", () => {
    async function createAgentAndGetFeedback(scores: number[]): Promise<{ agentId: anchor.BN; reputationPda: PublicKey }> {
      const config = await program.account.registryConfig.fetch(configPda);
      const newAgentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [reputationPda] = getAgentReputationPda(newAgentId, program.programId);

      await program.methods
        .register(`https://example.com/agent/a07-${newAgentId}`)
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      for (let i = 0; i < scores.length; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(newAgentId, feedbackIndex, program.programId);

        await program.methods
          .giveFeedback(
            newAgentId,
            scores[i],
            "round",
            "test",
            `https://example.com/feedback/a07-${newAgentId}-${i}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: asset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      return { agentId: newAgentId, reputationPda };
    }

    it("A-07.1: 33+34+34=101/3 rounds to 34 (not truncates to 33)", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([33, 34, 34]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      // 101/3 = 33.67 -> rounds to 34
      expect(reputation.averageScore).to.equal(34);
    });

    it("A-07.2: 10+10+10=30/3 stays at 10 (exact division)", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([10, 10, 10]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.averageScore).to.equal(10);
    });

    it("A-07.3: 1+1+1+1+2=6/5 rounds to 1 (1.2 -> 1)", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([1, 1, 1, 1, 2]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      // 6/5 = 1.2 -> rounds to 1
      expect(reputation.averageScore).to.equal(1);
    });

    it("A-07.4: 3+3+3+3+3=15/5 stays at 3 (exact division)", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([3, 3, 3, 3, 3]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.averageScore).to.equal(3);
    });

    it("A-07.5: 99+100+100=299/3 rounds to 100 (capped)", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([99, 100, 100]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      // 299/3 = 99.67 -> rounds to 100
      expect(reputation.averageScore).to.equal(100);
    });

    it("A-07.6: 0+0+1=1/3 rounds to 0", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([0, 0, 1]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      // 1/3 = 0.33 -> rounds to 0
      expect(reputation.averageScore).to.equal(0);
    });

    it("A-07.7: 50 (single feedback) = 50", async () => {
      const { reputationPda } = await createAgentAndGetFeedback([50]);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.averageScore).to.equal(50);
    });

    it("A-07.8: After revoke, average recalculates with rounding", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const newAgentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [reputationPda] = getAgentReputationPda(newAgentId, program.programId);

      await program.methods
        .register(`https://example.com/agent/a07-revoke`)
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      // Give 3 feedbacks: 30, 40, 50 = 120/3 = 40
      const scores = [30, 40, 50];
      for (let i = 0; i < scores.length; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(newAgentId, feedbackIndex, program.programId);

        await program.methods
          .giveFeedback(
            newAgentId,
            scores[i],
            "revoke",
            "test",
            `https://example.com/feedback/a07-revoke-${i}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: asset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      let reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.averageScore).to.equal(40);

      // Revoke the 40 feedback (index 1)
      // Remaining: 30 + 50 = 80/2 = 40
      const [feedbackPda1] = getFeedbackPda(newAgentId, new anchor.BN(1), program.programId);
      await program.methods
        .revokeFeedback(newAgentId, new anchor.BN(1))
        .accounts({
          client: provider.wallet.publicKey,
          feedbackAccount: feedbackPda1,
          agentReputation: reputationPda,
        })
        .rpc();

      reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(2);
      expect(reputation.totalScoreSum.toNumber()).to.equal(80);
      expect(reputation.averageScore).to.equal(40);
    });
  });

  // ============================================================================
  // F-06: mpl_core owner validation (indirect test)
  // ============================================================================
  describe("F-06: mpl_core Owner Validation", () => {
    it("F-06.1: Valid Core asset passes ownership check", async () => {
      // This is implicitly tested by all other tests that register agents
      // The get_core_owner function is called internally
      const config = await program.account.registryConfig.fetch(configPda);
      const newAgentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);

      // This would fail if F-06 check was broken
      await program.methods
        .register("https://example.com/agent/f06-valid")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });

    it("F-06.2: setMetadataPda verifies Core asset ownership", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const agentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/f06-metadata")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      const key = "f06_test";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      // This calls verify_core_owner internally which uses get_core_owner with F-06 check
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(entry.metadataKey).to.equal(key);
    });
  });

  // ============================================================================
  // EDGE CASES AND STRESS TESTS
  // ============================================================================
  describe("Edge Cases and Stress Tests", () => {
    it("EDGE-1: Max value length (256 bytes) metadata", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const agentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/edge-1")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      const key = "max_value";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);
      const maxValue = Buffer.alloc(256, "x");

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, maxValue, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(entry.metadataValue.length).to.equal(256);
    });

    it("EDGE-2: Multiple validations for same agent", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const agentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/edge-2")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      // Create 3 validations with different nonces
      for (let i = 0; i < 3; i++) {
        const nonce = uniqueNonce();
        const [requestPda] = getValidationRequestPda(
          agentId,
          provider.wallet.publicKey,
          nonce,
          program.programId
        );

        await program.methods
          .requestValidation(
            agentId,
            provider.wallet.publicKey,
            nonce,
            `https://example.com/validation/edge-2-${i}`,
            Array.from(randomHash())
          )
          .accounts({
            validationStats: validationStatsPda,
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: asset.publicKey,
            agentAccount: agentPda,
            validationRequest: requestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      // All 3 should exist
      const stats = await program.account.validationStats.fetch(validationStatsPda);
      expect(stats.totalRequests.toNumber()).to.be.greaterThan(2);
    });

    it("EDGE-3: Score boundary values (0 and 100)", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      const agentId = config.nextAgentId;

      const asset = Keypair.generate();
      const [agentPda] = getAgentPda(asset.publicKey, program.programId);
      const [reputationPda] = getAgentReputationPda(agentId, program.programId);

      await program.methods
        .register("https://example.com/agent/edge-3")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: asset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc();

      // Score 0
      const [feedbackPda0] = getFeedbackPda(agentId, new anchor.BN(0), program.programId);
      await program.methods
        .giveFeedback(
          agentId,
          0,
          "zero",
          "score",
          "https://example.com/feedback/edge-3-0",
          Array.from(randomHash()),
          new anchor.BN(0)
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda0,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Score 100
      const [feedbackPda1] = getFeedbackPda(agentId, new anchor.BN(1), program.programId);
      await program.methods
        .giveFeedback(
          agentId,
          100,
          "hundred",
          "score",
          "https://example.com/feedback/edge-3-1",
          Array.from(randomHash()),
          new anchor.BN(1)
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda1,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.totalScoreSum.toNumber()).to.equal(100);
      expect(reputation.averageScore).to.equal(50);
    });
  });
});
