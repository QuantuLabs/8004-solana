/**
 * Reputation Module Tests for Agent Registry 8004
 * Tests feedback creation, revocation, responses, and aggregation
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
  getConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getFeedbackTagsPda,
  getResponseIndexPda,
  getResponsePda,
  randomHash,
  randomUri,
  randomTag,
  uriOfLength,
  stringOfLength,
  expectAnchorError,
} from "./utils/helpers";

describe("Reputation Module Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let configPda: PublicKey;
  let collectionPubkey: PublicKey;

  // Agent for reputation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let agentId: anchor.BN;
  let agentReputationPda: PublicKey;

  before(async () => {
    [configPda] = getConfigPda(program.programId);
    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    agentId = config.nextAgentId;

    // Register agent for reputation tests
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    [agentReputationPda] = getAgentReputationPda(agentId, program.programId);

    await program.methods
      .register("https://example.com/agent/reputation-test")
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

    console.log("=== Reputation Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent ID:", agentId.toNumber());
  });

  // ============================================================================
  // FEEDBACK CREATION TESTS
  // ============================================================================
  describe("Feedback Creation", () => {
    it("giveFeedback() creates feedback with index 0", async () => {
      const feedbackIndex = new anchor.BN(0);
      const score = 80;
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          agentId,
          score,
          "quality",
          "reliable",
          "https://example.com/feedback/0",
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

      console.log("Feedback #0 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.feedbackIndex.toNumber()).to.equal(0);
      expect(feedback.score).to.equal(score);
      expect(feedback.agentId.toNumber()).to.equal(agentId.toNumber());
      expect(feedback.clientAddress.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(feedback.isRevoked).to.equal(false);

      const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(1);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(1);
      expect(reputation.averageScore).to.equal(80);
    });

    it("giveFeedback() with score=0 (edge case)", async () => {
      const feedbackIndex = new anchor.BN(1);
      const score = 0;
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          agentId,
          score,
          "poor",
          "issue",
          "https://example.com/feedback/zero",
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

      console.log("Feedback with score=0 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(0);

      const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      expect(reputation.averageScore).to.equal(40); // (80+0)/2
    });

    it("giveFeedback() with score=100 (edge case)", async () => {
      const feedbackIndex = new anchor.BN(2);
      const score = 100;
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          agentId,
          score,
          "perfect",
          "excellent",
          "https://example.com/feedback/perfect",
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

      console.log("Feedback with score=100 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(100);
    });

    it("giveFeedback() fails with score > 100", async () => {
      const feedbackIndex = new anchor.BN(3);
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            agentId,
            101, // Invalid score
            "invalid",
            "score",
            "https://example.com/feedback/invalid",
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
          .rpc(),
        "InvalidScore"
      );
    });

    it("giveFeedback() with empty URI (allowed)", async () => {
      const feedbackIndex = new anchor.BN(3);
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          agentId,
          75,
          "good",
          "fast",
          "", // Empty URI is allowed
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

      console.log("Feedback with empty URI tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      // v0.2.0: fileUri removed from account, stored in events only
      // Verify the feedback was created with correct score
      expect(feedback.score).to.equal(75);
    });

    it("giveFeedback() fails with URI > 200 bytes", async () => {
      const feedbackIndex = new anchor.BN(4);
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            agentId,
            50,
            "tag1",
            "tag2",
            longUri,
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
          .rpc(),
        "UriTooLong"
      );
    });

    it("giveFeedback() with empty tags (allowed)", async () => {
      const feedbackIndex = new anchor.BN(4);
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          agentId,
          60,
          "", // Empty tag1
          "", // Empty tag2
          "https://example.com/feedback/empty-tags",
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

      console.log("Feedback with empty tags tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      // Tags removed from FeedbackAccount - stored in FeedbackTagsPda if needed
      expect(feedback.score).to.equal(60);
    });

    it("giveFeedback() fails with tag > 32 bytes", async () => {
      const feedbackIndex = new anchor.BN(5);
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            agentId,
            50,
            longTag,
            "valid",
            "https://example.com/feedback/long-tag",
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
          .rpc(),
        "TagTooLong"
      );
    });

    it("giveFeedback() fails with invalid feedback index", async () => {
      // Try to use index 10 when next expected is 5
      const wrongIndex = new anchor.BN(10);
      const [feedbackPda] = getFeedbackPda(agentId, wrongIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            agentId,
            50,
            "tag1",
            "tag2",
            "https://example.com/feedback/wrong-index",
            Array.from(randomHash()),
            wrongIndex
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
          .rpc(),
        "InvalidFeedbackIndex"
      );
    });

    it("giveFeedback() works with same wallet as payer", async () => {
      // Test that client and payer can be the same (wallet pays for itself)
      const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      const feedbackIndex = reputation.nextFeedbackIndex;
      const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          agentId,
          70,
          "self",
          "paid",
          "https://example.com/feedback/self-paid",
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

      console.log("Self-paid feedback tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.clientAddress.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });
  });

  // ============================================================================
  // FEEDBACK TAGS PDA TESTS
  // ============================================================================
  describe("FeedbackTagsPda Operations", () => {
    let tagsAgentAsset: Keypair;
    let tagsAgentPda: PublicKey;
    let tagsAgentId: anchor.BN;
    let tagsReputationPda: PublicKey;

    before(async () => {
      // Register a separate agent for tags tests
      const config = await program.account.registryConfig.fetch(configPda);
      tagsAgentId = config.nextAgentId;
      tagsAgentAsset = Keypair.generate();
      [tagsAgentPda] = getAgentPda(tagsAgentAsset.publicKey, program.programId);
      [tagsReputationPda] = getAgentReputationPda(tagsAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/tags-test")
        .accounts({
          config: configPda,
          agentAccount: tagsAgentPda,
          asset: tagsAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([tagsAgentAsset])
        .rpc();

      // Create feedback without tags
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(tagsAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          tagsAgentId,
          88,
          "", // Empty tags in giveFeedback
          "",
          "https://example.com/feedback/no-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          agentAccount: tagsAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: tagsReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("setFeedbackTags() creates optional tags PDA", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(tagsAgentId, feedbackIndex, program.programId);
      const [feedbackTagsPda] = getFeedbackTagsPda(tagsAgentId, feedbackIndex, program.programId);

      const tx = await program.methods
        .setFeedbackTags(
          tagsAgentId,
          feedbackIndex,
          "excellent",
          "fast"
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          feedbackTags: feedbackTagsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("SetFeedbackTags tx:", tx);

      const tagsPda = await program.account.feedbackTagsPda.fetch(feedbackTagsPda);
      expect(tagsPda.tag1).to.equal("excellent");
      expect(tagsPda.tag2).to.equal("fast");
      expect(tagsPda.agentId.toNumber()).to.equal(tagsAgentId.toNumber());
      expect(tagsPda.feedbackIndex.toNumber()).to.equal(0);
    });

    it("setFeedbackTags() fails if non-author", async () => {
      // Create a new feedback with a different author
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(tagsAgentId, feedbackIndex, program.programId);
      const [feedbackTagsPda] = getFeedbackTagsPda(tagsAgentId, feedbackIndex, program.programId);

      // First create the feedback
      await program.methods
        .giveFeedback(
          tagsAgentId,
          75,
          "",
          "",
          "https://example.com/feedback/for-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          agentAccount: tagsAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: tagsReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to set tags with a different wallet
      const otherWallet = Keypair.generate();

      await expectAnchorError(
        program.methods
          .setFeedbackTags(
            tagsAgentId,
            feedbackIndex,
            "tag1",
            "tag2"
          )
          .accounts({
            client: otherWallet.publicKey,
            payer: provider.wallet.publicKey,
            feedbackAccount: feedbackPda,
            feedbackTags: feedbackTagsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([otherWallet])
          .rpc(),
        "Unauthorized"
      );
    });

    it("setFeedbackTags() fails with empty tags", async () => {
      // Create a new feedback for this test
      const reputation = await program.account.agentReputationMetadata.fetch(tagsReputationPda);
      const feedbackIndex = reputation.nextFeedbackIndex;
      const [feedbackPda] = getFeedbackPda(tagsAgentId, feedbackIndex, program.programId);
      const [feedbackTagsPda] = getFeedbackTagsPda(tagsAgentId, feedbackIndex, program.programId);

      // Create feedback first
      await program.methods
        .giveFeedback(
          tagsAgentId,
          80,
          "",
          "",
          "https://example.com/feedback/empty-tags-test",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          agentAccount: tagsAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: tagsReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to set empty tags
      await expectAnchorError(
        program.methods
          .setFeedbackTags(
            tagsAgentId,
            feedbackIndex,
            "", // Empty tag1
            ""  // Empty tag2
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            feedbackAccount: feedbackPda,
            feedbackTags: feedbackTagsPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "EmptyTags"
      );
    });
  });

  // ============================================================================
  // FEEDBACK REVOCATION TESTS
  // ============================================================================
  describe("Feedback Revocation", () => {
    let revokeAgentAsset: Keypair;
    let revokeAgentPda: PublicKey;
    let revokeAgentId: anchor.BN;
    let revokeReputationPda: PublicKey;

    before(async () => {
      // Register a separate agent for revocation tests
      const config = await program.account.registryConfig.fetch(configPda);
      revokeAgentId = config.nextAgentId;
      revokeAgentAsset = Keypair.generate();
      [revokeAgentPda] = getAgentPda(revokeAgentAsset.publicKey, program.programId);
      [revokeReputationPda] = getAgentReputationPda(revokeAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/revoke-test")
        .accounts({
          config: configPda,
          agentAccount: revokeAgentPda,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([revokeAgentAsset])
        .rpc();

      // Create feedback to revoke
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(revokeAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          revokeAgentId,
          90,
          "high",
          "quality",
          "https://example.com/feedback/to-revoke",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: revokeAgentAsset.publicKey,
          agentAccount: revokeAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: revokeReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("revokeFeedback() by the author", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(revokeAgentId, feedbackIndex, program.programId);

      const reputationBefore = await program.account.agentReputationMetadata.fetch(revokeReputationPda);

      const tx = await program.methods
        .revokeFeedback(revokeAgentId, feedbackIndex)
        .accounts({
          client: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: revokeReputationPda,
        })
        .rpc();

      console.log("Revoke feedback tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.isRevoked).to.equal(true);

      const reputationAfter = await program.account.agentReputationMetadata.fetch(revokeReputationPda);
      expect(reputationAfter.totalFeedbacks.toNumber()).to.equal(
        reputationBefore.totalFeedbacks.toNumber() - 1
      );
    });

    it("revokeFeedback() fails if non-author", async () => {
      // Create a new feedback first
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(revokeAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          revokeAgentId,
          85,
          "test",
          "revoke",
          "https://example.com/feedback/non-author",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: revokeAgentAsset.publicKey,
          agentAccount: revokeAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: revokeReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to revoke with different client
      const fakeClient = Keypair.generate();

      await expectAnchorError(
        program.methods
          .revokeFeedback(revokeAgentId, feedbackIndex)
          .accounts({
            client: fakeClient.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: revokeReputationPda,
          })
          .signers([fakeClient])
          .rpc(),
        "Unauthorized"
      );
    });

    it("revokeFeedback() fails if already revoked", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(revokeAgentId, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .revokeFeedback(revokeAgentId, feedbackIndex)
          .accounts({
            client: provider.wallet.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: revokeReputationPda,
          })
          .rpc(),
        "AlreadyRevoked"
      );
    });
  });

  // ============================================================================
  // RESPONSE OPERATION TESTS
  // ============================================================================
  describe("Response Operations", () => {
    let responseAgentAsset: Keypair;
    let responseAgentPda: PublicKey;
    let responseAgentId: anchor.BN;
    let responseReputationPda: PublicKey;
    const feedbackIndex = new anchor.BN(0);

    before(async () => {
      // Register a separate agent for response tests
      const config = await program.account.registryConfig.fetch(configPda);
      responseAgentId = config.nextAgentId;
      responseAgentAsset = Keypair.generate();
      [responseAgentPda] = getAgentPda(responseAgentAsset.publicKey, program.programId);
      [responseReputationPda] = getAgentReputationPda(responseAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/response-test")
        .accounts({
          config: configPda,
          agentAccount: responseAgentPda,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([responseAgentAsset])
        .rpc();

      // Create feedback to respond to
      const [feedbackPda] = getFeedbackPda(responseAgentId, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          responseAgentId,
          75,
          "feedback",
          "test",
          "https://example.com/feedback/for-response",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
          agentAccount: responseAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: responseReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("appendResponse() adds response to feedback", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentId, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentId, feedbackIndex, program.programId);
      const responseIndex = new anchor.BN(0);
      const [responsePda] = getResponsePda(responseAgentId, feedbackIndex, responseIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          responseAgentId,
          feedbackIndex,
          "https://example.com/response/0",
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

      console.log("AppendResponse tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      expect(response.feedbackIndex.toNumber()).to.equal(0);
      expect(response.responseIndex.toNumber()).to.equal(0);
      expect(response.responder.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });

    it("appendResponse() using wallet as responder", async () => {
      // Test response from wallet (no airdrop needed)
      const [feedbackPda] = getFeedbackPda(responseAgentId, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentId, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentId, feedbackIndex, nextIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          responseAgentId,
          feedbackIndex,
          "https://example.com/response/wallet-responder",
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

      console.log("Response by wallet tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      expect(response.responder.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });

    it("appendResponse() multiple responses to same feedback", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentId, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentId, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentId, feedbackIndex, nextIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          responseAgentId,
          feedbackIndex,
          "https://example.com/response/followup",
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

      console.log("Multiple response tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      expect(response.responseIndex.toNumber()).to.equal(nextIndex.toNumber());

      const updatedIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      expect(updatedIndexAccount.nextIndex.toNumber()).to.equal(nextIndex.toNumber() + 1);
    });

    it("appendResponse() fails with URI > 200 bytes", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentId, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentId, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentId, feedbackIndex, nextIndex, program.programId);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .appendResponse(
            responseAgentId,
            feedbackIndex,
            longUri,
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
          .rpc(),
        "ResponseUriTooLong"
      );
    });

    it("appendResponse() with empty URI (allowed)", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentId, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentId, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentId, feedbackIndex, nextIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          responseAgentId,
          feedbackIndex,
          "", // Empty URI
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

      console.log("Response with empty URI tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      // v0.2.0: responseUri removed from account, stored in events only
      // Verify the response was created with correct responder
      expect(response.responder.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });
  });

  // ============================================================================
  // REPUTATION AGGREGATION TESTS
  // ============================================================================
  describe("Reputation Aggregation", () => {
    let aggAgentAsset: Keypair;
    let aggAgentPda: PublicKey;
    let aggAgentId: anchor.BN;
    let aggReputationPda: PublicKey;

    before(async () => {
      // Register a fresh agent for aggregation tests
      const config = await program.account.registryConfig.fetch(configPda);
      aggAgentId = config.nextAgentId;
      aggAgentAsset = Keypair.generate();
      [aggAgentPda] = getAgentPda(aggAgentAsset.publicKey, program.programId);
      [aggReputationPda] = getAgentReputationPda(aggAgentId, program.programId);

      await program.methods
        .register("https://example.com/agent/aggregation-test")
        .accounts({
          config: configPda,
          agentAccount: aggAgentPda,
          asset: aggAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([aggAgentAsset])
        .rpc();
    });

    it("Correct averageScore after multiple feedbacks", async () => {
      const scores = [80, 90, 70]; // Average = 80

      for (let i = 0; i < scores.length; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(aggAgentId, feedbackIndex, program.programId);

        await program.methods
          .giveFeedback(
            aggAgentId,
            scores[i],
            `tag${i}`,
            "test",
            `https://example.com/feedback/agg-${i}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: aggAgentAsset.publicKey,
            agentAccount: aggAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: aggReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const reputation = await program.account.agentReputationMetadata.fetch(aggReputationPda);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(3);
      expect(reputation.averageScore).to.equal(80); // (80+90+70)/3 = 80
      expect(reputation.totalScoreSum.toNumber()).to.equal(240);
    });

    it("averageScore recalculated after revocation", async () => {
      // Revoke the first feedback (score 80)
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(aggAgentId, feedbackIndex, program.programId);

      await program.methods
        .revokeFeedback(aggAgentId, feedbackIndex)
        .accounts({
          client: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: aggReputationPda,
        })
        .rpc();

      const reputation = await program.account.agentReputationMetadata.fetch(aggReputationPda);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(2);
      expect(reputation.averageScore).to.equal(80); // (90+70)/2 = 80
      expect(reputation.totalScoreSum.toNumber()).to.equal(160);
    });

    it("Division by zero avoided if all feedbacks revoked", async () => {
      // Revoke remaining feedbacks
      for (let i = 1; i <= 2; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(aggAgentId, feedbackIndex, program.programId);

        await program.methods
          .revokeFeedback(aggAgentId, feedbackIndex)
          .accounts({
            client: provider.wallet.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: aggReputationPda,
          })
          .rpc();
      }

      const reputation = await program.account.agentReputationMetadata.fetch(aggReputationPda);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(0);
      expect(reputation.averageScore).to.equal(0); // Zero when no feedbacks
      expect(reputation.totalScoreSum.toNumber()).to.equal(0);
    });
  });
});
