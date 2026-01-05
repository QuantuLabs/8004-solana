/**
 * Security Tests for Agent Registry 8004
 * Tests access control, PDA derivation, state validation, and asset ownership
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getValidationStatsPda,
  getValidationRequestPda,
  getMetadataEntryPda,
  computeKeyHash,
  randomHash,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

describe("Security Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let configPda: PublicKey;
  let collectionPubkey: PublicKey;
  let validationStatsPda: PublicKey;

  // Test agents
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let agentId: anchor.BN;
  let agentReputationPda: PublicKey;

  before(async () => {
    [configPda] = getConfigPda(program.programId);
    [validationStatsPda] = getValidationStatsPda(program.programId);

    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    agentId = config.nextAgentId;

    // Register test agent
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    [agentReputationPda] = getAgentReputationPda(agentId, program.programId);

    await program.methods
      .register("https://example.com/agent/security-test")
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

    console.log("=== Security Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent ID:", agentId.toNumber());
  });

  // ============================================================================
  // ACCESS CONTROL TESTS
  // ============================================================================
  describe("Access Control", () => {
    it("Non-owner cannot setMetadataPda", async () => {
      const attacker = Keypair.generate();
      // Fund attacker from provider wallet
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: attacker.publicKey,
          lamports: 10000000,
        })
      );
      await provider.sendAndConfirm(transferTx);

      const key = "malicious_key";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, Buffer.from("malicious_value"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            owner: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });

    it("Non-owner cannot setAgentUri", async () => {
      const attacker = Keypair.generate();

      await expectAnchorError(
        program.methods
          .setAgentUri("https://malicious.com/hijack")
          .accounts({
            config: configPda,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            collection: collectionPubkey,
            owner: attacker.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });

    it("Non-author cannot revokeFeedback", async () => {
      // First create feedback as the wallet
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          agentId,
          80,
          "security",
          "test",
          "https://example.com/feedback/security",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to revoke as different user
      const attacker = Keypair.generate();

      await expectAnchorError(
        program.methods
          .revokeFeedback(agentId, feedbackIndex)
          .accounts({
            client: attacker.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });

    it("Non-validator cannot respondToValidation", async () => {
      const nonce = uniqueNonce();
      const realValidator = provider.wallet.publicKey;
      const [requestPda] = getValidationRequestPda(
        agentId,
        realValidator,
        nonce,
        program.programId
      );

      // Create request with real validator
      await program.methods
        .requestValidation(
          agentId,
          realValidator,
          nonce,
          "https://example.com/validation/security",
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

      // Try to respond as attacker
      const attacker = Keypair.generate();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            1,
            "https://example.com/validation/fake",
            Array.from(randomHash()),
            "fake"
          )
          .accounts({
            validationStats: validationStatsPda,
            validator: attacker.publicKey,
            validationRequest: requestPda,
          })
          .signers([attacker])
          .rpc(),
        "UnauthorizedValidator"
      );
    });

    it("Non-owner/non-authority cannot closeValidation", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      // Create and respond to validation
      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/close-security",
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
        .respondToValidation(
          1,
          "https://example.com/validation/close-security-response",
          Array.from(randomHash()),
          "done"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      // Try to close as attacker (F-02v2: closer verified against Core owner first)
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
        "Unauthorized" // F-02v2: closer is verified against Core owner first
      );
    });
  });

  // ============================================================================
  // PDA DERIVATION TESTS
  // ============================================================================
  describe("PDA Derivation Security", () => {
    it("Feedback with wrong agent_id fails (constraint mismatch)", async () => {
      // Create a second agent
      const otherAsset = Keypair.generate();
      const [otherAgentPda] = getAgentPda(otherAsset.publicKey, program.programId);

      const otherConfig = await program.account.registryConfig.fetch(configPda);
      const otherAgentId = otherConfig.nextAgentId;

      await program.methods
        .register("https://example.com/agent/other")
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

      // Try to give feedback with mismatched agent_id and asset
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(otherAgentId, feedbackIndex, program.programId);
      const [otherReputationPda] = getAgentReputationPda(otherAgentId, program.programId);

      // This should fail because we're passing the wrong asset for the agent_id
      await expectAnchorError(
        program.methods
          .giveFeedback(
            otherAgentId, // Other agent's ID
            80,
            "cross",
            "agent",
            "https://example.com/feedback/cross",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: agentAsset.publicKey, // Wrong asset!
            agentAccount: agentPda, // Wrong PDA!
            feedbackAccount: feedbackPda,
            agentReputation: otherReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "AgentNotFound"
      );
    });
  });

  // ============================================================================
  // STATE VALIDATION TESTS
  // ============================================================================
  describe("State Validation", () => {
    let stateAgentAsset: Keypair;
    let stateAgentPda: PublicKey;
    let stateAgentId: anchor.BN;
    let stateReputationPda: PublicKey;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      stateAgentId = config.nextAgentId;

      stateAgentAsset = Keypair.generate();
      [stateAgentPda] = getAgentPda(stateAgentAsset.publicKey, program.programId);
      [stateReputationPda] = getAgentReputationPda(stateAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/state-test")
        .accounts({
          config: configPda,
          agentAccount: stateAgentPda,
          asset: stateAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([stateAgentAsset])
        .rpc();
    });

    it("Double revocation fails", async () => {
      // Create feedback
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(stateAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          stateAgentId,
          85,
          "double",
          "revoke",
          "https://example.com/feedback/double-revoke",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: stateAgentAsset.publicKey,
          agentAccount: stateAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: stateReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // First revoke succeeds
      await program.methods
        .revokeFeedback(stateAgentId, feedbackIndex)
        .accounts({
          client: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: stateReputationPda,
        })
        .rpc();

      // Second revoke fails
      await expectAnchorError(
        program.methods
          .revokeFeedback(stateAgentId, feedbackIndex)
          .accounts({
            client: provider.wallet.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: stateReputationPda,
          })
          .rpc(),
        "AlreadyRevoked"
      );
    });

    it("Feedback index must be sequential", async () => {
      // Try to create feedback with wrong index (skipping index 1)
      const wrongIndex = new anchor.BN(5);
      const [feedbackPda] = getFeedbackPda(stateAgentId, wrongIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            stateAgentId,
            90,
            "wrong",
            "index",
            "https://example.com/feedback/wrong-index",
            Array.from(randomHash()),
            wrongIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: stateAgentAsset.publicKey,
            agentAccount: stateAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: stateReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidFeedbackIndex"
      );
    });

    it("Score out of bounds fails", async () => {
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(stateAgentId, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            stateAgentId,
            101, // > 100
            "invalid",
            "score",
            "https://example.com/feedback/invalid-score",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: stateAgentAsset.publicKey,
            agentAccount: stateAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: stateReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidScore"
      );
    });
  });

  // ============================================================================
  // ASSET OWNERSHIP VERIFICATION TESTS
  // ============================================================================
  describe("Asset Ownership Verification", () => {
    it("Operations with wrong asset fail", async () => {
      // Create another agent
      const otherAsset = Keypair.generate();
      const [otherAgentPda] = getAgentPda(otherAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/wrong-asset-test")
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

      // Try to set metadata using wrong asset (use first agent's metadata PDA with second agent's asset)
      const key = "wrong";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, Buffer.from("asset"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: otherAsset.publicKey, // Wrong asset for agentPda
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidAsset"
      );
    });

    it("Cannot register same asset twice", async () => {
      // Try to register with the same asset keypair
      const [duplicatePda] = getAgentPda(agentAsset.publicKey, program.programId);

      // This will fail because the PDA already exists
      try {
        await program.methods
          .register("https://example.com/agent/duplicate")
          .accounts({
            config: configPda,
            agentAccount: duplicatePda,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([agentAsset])
          .rpc();
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        // Can be either "already in use" or "constraint" error
        expect(
          error.toString().includes("already in use") ||
            error.toString().includes("Constraint") ||
            error.toString().includes("custom program error")
        ).to.be.true;
      }
    });
  });

  // ============================================================================
  // SECURITY FIX VALIDATION TESTS (v0.2.2)
  // ============================================================================
  describe("Security Fix Validation", () => {
    let fixAgentAsset: Keypair;
    let fixAgentPda: PublicKey;
    let fixAgentId: anchor.BN;
    let fixReputationPda: PublicKey;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      fixAgentId = config.nextAgentId;

      fixAgentAsset = Keypair.generate();
      [fixAgentPda] = getAgentPda(fixAgentAsset.publicKey, program.programId);
      [fixReputationPda] = getAgentReputationPda(fixAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/fix-test")
        .accounts({
          config: configPda,
          agentAccount: fixAgentPda,
          asset: fixAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([fixAgentAsset])
        .rpc();
    });

    // F-02: close_validation must verify agent_id and rent goes to owner
    it("F-02: closeValidation with wrong agent fails", async () => {
      // Create a second agent
      const otherAsset = Keypair.generate();
      const [otherAgentPda] = getAgentPda(otherAsset.publicKey, program.programId);
      const config = await program.account.registryConfig.fetch(configPda);
      const otherAgentId = config.nextAgentId;

      await program.methods
        .register("https://example.com/agent/other-close-test")
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

      // Create validation for first agent
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        fixAgentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          fixAgentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/f02-test",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: fixAgentAsset.publicKey,
          agentAccount: fixAgentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          1,
          "https://example.com/validation/f02-response",
          Array.from(randomHash()),
          "done"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      // Try to close using OTHER agent's asset - should fail
      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            config: configPda,
            closer: provider.wallet.publicKey,
            asset: otherAsset.publicKey, // Wrong asset!
            agentAccount: otherAgentPda, // Wrong agent!
            validationRequest: requestPda,
            rentReceiver: provider.wallet.publicKey,
          })
          .rpc(),
        "AgentNotFound"
      );
    });

    it("F-02: closeValidation rent_receiver must be agent owner", async () => {
      // Create validation
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        fixAgentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          fixAgentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/f02-rent-test",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: fixAgentAsset.publicKey,
          agentAccount: fixAgentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          1,
          "https://example.com/validation/f02-rent-response",
          Array.from(randomHash()),
          "done"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      // Try to redirect rent to attacker
      const attacker = Keypair.generate();

      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            config: configPda,
            closer: provider.wallet.publicKey,
            asset: fixAgentAsset.publicKey,
            agentAccount: fixAgentPda,
            validationRequest: requestPda,
            rentReceiver: attacker.publicKey, // Wrong receiver!
          })
          .rpc(),
        "InvalidRentReceiver"
      );
    });

    // F-05: key_hash must match SHA256(key)
    it("F-05: Invalid key_hash fails", async () => {
      const key = "test_key";
      const wrongKeyHash = new Uint8Array(8).fill(0); // All zeros - definitely wrong
      const correctKeyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(fixAgentId, correctKeyHash, program.programId);

      // Use wrong hash in instruction but correct PDA (won't even find PDA)
      // Actually, the PDA uses the passed key_hash, so we need to use wrong hash in both
      const [wrongMetadataPda] = getMetadataEntryPda(fixAgentId, wrongKeyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(wrongKeyHash), key, Buffer.from("value"), false)
          .accounts({
            metadataEntry: wrongMetadataPda,
            agentAccount: fixAgentPda,
            asset: fixAgentAsset.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch"
      );
    });

    // A-07: Average score rounds correctly
    it("A-07: Average score rounds instead of truncating", async () => {
      // Create a fresh agent for this test
      const roundAsset = Keypair.generate();
      const [roundAgentPda] = getAgentPda(roundAsset.publicKey, program.programId);
      const config = await program.account.registryConfig.fetch(configPda);
      const roundAgentId = config.nextAgentId;
      const [roundReputationPda] = getAgentReputationPda(roundAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/round-test")
        .accounts({
          config: configPda,
          agentAccount: roundAgentPda,
          asset: roundAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([roundAsset])
        .rpc();

      // Give 3 feedbacks with scores that require rounding
      // 33 + 34 + 34 = 101, avg = 33.67 should round to 34
      for (let i = 0; i < 3; i++) {
        const score = i === 0 ? 33 : 34;
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(roundAgentId, feedbackIndex, program.programId);

        await program.methods
          .giveFeedback(
            roundAgentId,
            score,
            "round",
            "test",
            `https://example.com/feedback/round-${i}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: roundAsset.publicKey,
            agentAccount: roundAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: roundReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const reputation = await program.account.agentReputationMetadata.fetch(roundReputationPda);
      // 33 + 34 + 34 = 101
      // Truncating: 101 / 3 = 33
      // Rounding: (101 + 1) / 3 = 34
      expect(reputation.averageScore).to.equal(34, "Average should round to 34, not truncate to 33");
    });
  });

  // ============================================================================
  // TRANSFER SECURITY TESTS
  // ============================================================================
  describe("Transfer Security", () => {
    it("Cannot transfer agent if not owner", async () => {
      const attacker = Keypair.generate();
      const targetOwner = Keypair.generate();

      // Create a new agent for transfer tests
      const transferAsset = Keypair.generate();
      const [transferAgentPda] = getAgentPda(transferAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/transfer-security")
        .accounts({
          config: configPda,
          agentAccount: transferAgentPda,
          asset: transferAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([transferAsset])
        .rpc();

      // Try to transfer as non-owner
      await expectAnchorError(
        program.methods
          .transferAgent()
          .accounts({
            asset: transferAsset.publicKey,
            agentAccount: transferAgentPda,
            collection: collectionPubkey,
            owner: attacker.publicKey, // Wrong owner
            newOwner: targetOwner.publicKey,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });
  });
});
