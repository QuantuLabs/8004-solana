/**
 * Edge Cases Tests for Agent Registry 8004
 * Tests string limits, numeric limits, and empty values
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  MAX_URI_LENGTH,
  MAX_TAG_LENGTH,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  getConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getValidationStatsPda,
  getValidationRequestPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

describe("Edge Cases Tests", () => {
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

    console.log("=== Edge Cases Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
  });

  // ============================================================================
  // STRING LIMITS TESTS
  // ============================================================================
  describe("String Limits", () => {
    let edgeAsset: Keypair;
    let edgeAgentPda: PublicKey;
    let edgeAgentId: anchor.BN;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      edgeAgentId = config.nextAgentId;
      edgeAsset = Keypair.generate();
      [edgeAgentPda] = getAgentPda(edgeAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/edge-test")
        .accounts({
          config: configPda,
          agentAccount: edgeAgentPda,
          asset: edgeAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([edgeAsset])
        .rpc();
    });

    it("URI exactly 200 bytes (accepted)", async () => {
      const exactUri = uriOfLength(MAX_URI_LENGTH); // 200 bytes

      const tx = await program.methods
        .setAgentUri(exactUri)
        .accounts({
          config: configPda,
          asset: edgeAsset.publicKey,
          agentAccount: edgeAgentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("URI 200 bytes tx:", tx);

      const agent = await program.account.agentAccount.fetch(edgeAgentPda);
      expect(agent.agentUri.length).to.equal(MAX_URI_LENGTH);
    });

    it("URI 201 bytes (rejected)", async () => {
      const longUri = uriOfLength(MAX_URI_LENGTH + 1); // 201 bytes

      await expectAnchorError(
        program.methods
          .setAgentUri(longUri)
          .accounts({
            config: configPda,
            asset: edgeAsset.publicKey,
            agentAccount: edgeAgentPda,
            collection: collectionPubkey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .rpc(),
        "UriTooLong"
      );
    });

    it("Metadata key exactly 32 bytes (accepted)", async () => {
      const exactKey = stringOfLength(MAX_METADATA_KEY_LENGTH); // 32 bytes
      const value = Buffer.from("test");

      const tx = await program.methods
        .setMetadata(exactKey, value)
        .accounts({
          asset: edgeAsset.publicKey,
          agentAccount: edgeAgentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Key 32 bytes tx:", tx);

      const agent = await program.account.agentAccount.fetch(edgeAgentPda);
      const entry = agent.metadata.find((m) => m.metadataKey === exactKey);
      expect(entry).to.exist;
      expect(entry!.metadataKey.length).to.equal(MAX_METADATA_KEY_LENGTH);
    });

    it("Metadata key 33 bytes (rejected)", async () => {
      const longKey = stringOfLength(MAX_METADATA_KEY_LENGTH + 1); // 33 bytes
      const value = Buffer.from("test");

      await expectAnchorError(
        program.methods
          .setMetadata(longKey, value)
          .accounts({
            asset: edgeAsset.publicKey,
            agentAccount: edgeAgentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "KeyTooLong"
      );
    });

    it("Metadata value exactly 256 bytes (accepted)", async () => {
      // Use the existing key to update value (since MAX_METADATA_ENTRIES=1)
      const agent = await program.account.agentAccount.fetch(edgeAgentPda);
      const existingKey = agent.metadata[0]?.metadataKey || "test";
      const exactValue = Buffer.alloc(MAX_METADATA_VALUE_LENGTH); // 256 bytes
      exactValue.fill(0x42);

      const tx = await program.methods
        .setMetadata(existingKey, exactValue)
        .accounts({
          asset: edgeAsset.publicKey,
          agentAccount: edgeAgentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Value 256 bytes tx:", tx);

      const updatedAgent = await program.account.agentAccount.fetch(edgeAgentPda);
      const entry = updatedAgent.metadata.find((m) => m.metadataKey === existingKey);
      expect(entry).to.exist;
      expect(entry!.metadataValue.length).to.equal(MAX_METADATA_VALUE_LENGTH);
    });

    it("Metadata value 257 bytes (rejected)", async () => {
      // Use existing key to avoid MetadataLimitReached error
      const agent = await program.account.agentAccount.fetch(edgeAgentPda);
      const existingKey = agent.metadata[0]?.metadataKey || "test";
      const longValue = Buffer.alloc(MAX_METADATA_VALUE_LENGTH + 1); // 257 bytes

      await expectAnchorError(
        program.methods
          .setMetadata(existingKey, longValue)
          .accounts({
            asset: edgeAsset.publicKey,
            agentAccount: edgeAgentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "ValueTooLong"
      );
    });

    it("Tag exactly 32 bytes (accepted)", async () => {
      const [reputationPda] = getAgentReputationPda(edgeAgentId, program.programId);

      // Get current feedback index
      let feedbackIndex: anchor.BN;
      try {
        const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
        feedbackIndex = reputation.nextFeedbackIndex;
      } catch {
        feedbackIndex = new anchor.BN(0);
      }

      const [feedbackPda] = getFeedbackPda(edgeAgentId, feedbackIndex, program.programId);
      const exactTag = stringOfLength(MAX_TAG_LENGTH); // 32 bytes

      const tx = await program.methods
        .giveFeedback(
          edgeAgentId,
          75,
          exactTag,
          "normal",
          "https://example.com/feedback/exact-tag",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: edgeAsset.publicKey,
          agentAccount: edgeAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Tag 32 bytes tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.tag1.length).to.equal(MAX_TAG_LENGTH);
    });

    it("Tag 33 bytes (rejected)", async () => {
      const [reputationPda] = getAgentReputationPda(edgeAgentId, program.programId);
      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      const feedbackIndex = reputation.nextFeedbackIndex;
      const [feedbackPda] = getFeedbackPda(edgeAgentId, feedbackIndex, program.programId);
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1); // 33 bytes

      await expectAnchorError(
        program.methods
          .giveFeedback(
            edgeAgentId,
            75,
            longTag,
            "normal",
            "https://example.com/feedback/long-tag",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: edgeAsset.publicKey,
            agentAccount: edgeAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "TagTooLong"
      );
    });
  });

  // ============================================================================
  // NUMERIC LIMITS TESTS
  // ============================================================================
  describe("Numeric Limits", () => {
    let numericAsset: Keypair;
    let numericAgentPda: PublicKey;
    let numericAgentId: anchor.BN;
    let numericReputationPda: PublicKey;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      numericAgentId = config.nextAgentId;
      numericAsset = Keypair.generate();
      [numericAgentPda] = getAgentPda(numericAsset.publicKey, program.programId);
      [numericReputationPda] = getAgentReputationPda(numericAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/numeric-test")
        .accounts({
          config: configPda,
          agentAccount: numericAgentPda,
          asset: numericAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([numericAsset])
        .rpc();
    });

    it("Score = 0 (accepted)", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(numericAgentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          numericAgentId,
          0, // Minimum score
          "zero",
          "score",
          "https://example.com/feedback/zero",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: numericAsset.publicKey,
          agentAccount: numericAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: numericReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Score 0 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(0);
    });

    it("Score = 100 (accepted)", async () => {
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(numericAgentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          numericAgentId,
          100, // Maximum score
          "perfect",
          "score",
          "https://example.com/feedback/perfect",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: numericAsset.publicKey,
          agentAccount: numericAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: numericReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Score 100 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(100);
    });

    it("Score = 101 (rejected)", async () => {
      const feedbackIndex = new anchor.BN(2);
      const [feedbackPda] = getFeedbackPda(numericAgentId, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            numericAgentId,
            101, // Out of bounds
            "invalid",
            "score",
            "https://example.com/feedback/invalid",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: numericAsset.publicKey,
            agentAccount: numericAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: numericReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidScore"
      );
    });

    it("Validation response = 0 (accepted)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        numericAgentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          numericAgentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/response-zero",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: numericAsset.publicKey,
          agentAccount: numericAgentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          0, // Minimum response
          "https://example.com/validation/response-zero-result",
          Array.from(randomHash()),
          "failed"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      console.log("Validation response 0 tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(0);
    });

    it("Validation response = 100 (accepted)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        numericAgentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          numericAgentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/response-hundred",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: numericAsset.publicKey,
          agentAccount: numericAgentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          100, // Maximum response
          "https://example.com/validation/response-hundred-result",
          Array.from(randomHash()),
          "perfect"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      console.log("Validation response 100 tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(100);
    });
  });

  // ============================================================================
  // EMPTY VALUES TESTS
  // ============================================================================
  describe("Empty Values", () => {
    let emptyAsset: Keypair;
    let emptyAgentPda: PublicKey;
    let emptyAgentId: anchor.BN;
    let emptyReputationPda: PublicKey;

    before(async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      emptyAgentId = config.nextAgentId;
      emptyAsset = Keypair.generate();
      [emptyAgentPda] = getAgentPda(emptyAsset.publicKey, program.programId);
      [emptyReputationPda] = getAgentReputationPda(emptyAgentId, program.programId);
    });

    it("registerEmpty() creates agent with empty URI", async () => {
      const tx = await program.methods
        .registerEmpty()
        .accounts({
          config: configPda,
          agentAccount: emptyAgentPda,
          asset: emptyAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([emptyAsset])
        .rpc();

      console.log("RegisterEmpty tx:", tx);

      const agent = await program.account.agentAccount.fetch(emptyAgentPda);
      expect(agent.agentUri).to.equal("");
    });

    it("Empty URI in feedback (accepted)", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(emptyAgentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          emptyAgentId,
          80,
          "tag1",
          "tag2",
          "", // Empty URI
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: emptyAsset.publicKey,
          agentAccount: emptyAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: emptyReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Empty URI feedback tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.fileUri).to.equal("");
    });

    it("Empty tags in feedback (accepted)", async () => {
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(emptyAgentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          emptyAgentId,
          85,
          "", // Empty tag1
          "", // Empty tag2
          "https://example.com/feedback/empty-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: emptyAsset.publicKey,
          agentAccount: emptyAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: emptyReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Empty tags feedback tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.tag1).to.equal("");
      expect(feedback.tag2).to.equal("");
    });

    it("Empty URI in validation request (accepted)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        emptyAgentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          emptyAgentId,
          provider.wallet.publicKey,
          nonce,
          "", // Empty URI
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: emptyAsset.publicKey,
          agentAccount: emptyAgentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Empty URI validation tx:", tx);

      // Note: URI is stored in events only, not on-chain
      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.agentId.toNumber()).to.equal(emptyAgentId.toNumber());
    });

    it("Empty tag in validation response (accepted)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        emptyAgentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          emptyAgentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/empty-tag",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: emptyAsset.publicKey,
          agentAccount: emptyAgentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          1,
          "https://example.com/validation/empty-tag-response",
          Array.from(randomHash()),
          "" // Empty tag
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      console.log("Empty tag validation response tx:", tx);

      // Note: tag is stored in events only, not on-chain
      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(1);
    });
  });
});
