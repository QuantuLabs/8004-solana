/**
 * Reputation Module Tests for Agent Registry 8004 v0.3.0
 * Tests feedback creation, revocation, responses, and tags
 * v0.3.0: Uses asset (Pubkey) instead of agent_id as identifier
 * Aggregation (totalFeedbacks, averageScore) is now off-chain via indexer
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
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getFeedbackTagsPda,
  getResponseIndexPda,
  getResponsePda,
  randomHash,
  uriOfLength,
  stringOfLength,
  expectAnchorError,
} from "./utils/helpers";

describe("Reputation Module Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  // Agent for reputation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let agentReputationPda: PublicKey;

  // Separate client for feedback (anti-gaming: owner cannot give feedback to own agent)
  let clientKeypair: Keypair;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    // currentBaseRegistry IS the registryConfigPda (not the collection)
    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    // Create a separate client keypair (different from agent owner)
    // Anti-gaming rule: agent owner cannot give feedback to their own agent
    clientKeypair = Keypair.generate();

    // Register agent for reputation tests (owner = provider.wallet)
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    // v0.3.0: Use asset for AgentReputationPda
    [agentReputationPda] = getAgentReputationPda(agentAsset.publicKey, program.programId);

    await program.methods
      .register("https://example.com/agent/reputation-test")
      .accounts({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("=== Reputation Tests Setup (v0.3.0) ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent Asset:", agentAsset.publicKey.toBase58());
    console.log("Client (separate from owner):", clientKeypair.publicKey.toBase58());
  });

  // ============================================================================
  // FEEDBACK CREATION TESTS
  // ============================================================================
  describe("Feedback Creation", () => {
    it("giveFeedback() creates feedback with index 0", async () => {
      const feedbackIndex = new anchor.BN(0);
      const score = 80;
      // v0.3.0: Use asset instead of agentId
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      // Client must be different from agent owner (anti-gaming)
      const tx = await program.methods
        .giveFeedback(
          score,
          "quality",
          "reliable",
          "https://agent.example.com/api", // endpoint
          "https://example.com/feedback/0", // feedback_uri
          Array.from(randomHash()), // feedback_hash
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback #0 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.feedbackIndex.toNumber()).to.equal(0);
      expect(feedback.score).to.equal(score);
      // v0.3.0: asset instead of agentId
      expect(feedback.asset.toBase58()).to.equal(agentAsset.publicKey.toBase58());
      expect(feedback.clientAddress.toBase58()).to.equal(clientKeypair.publicKey.toBase58());
      expect(feedback.isRevoked).to.equal(false);

      const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(1);
      // v0.3.0: totalFeedbacks, averageScore removed (off-chain)
    });

    it("giveFeedback() with score=0 (edge case)", async () => {
      const feedbackIndex = new anchor.BN(1);
      const score = 0;
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          score,
          "poor",
          "issue",
          "https://agent.example.com/api",
          "https://example.com/feedback/zero",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback with score=0 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(0);
    });

    it("giveFeedback() with score=100 (edge case)", async () => {
      const feedbackIndex = new anchor.BN(2);
      const score = 100;
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          score,
          "perfect",
          "excellent",
          "https://agent.example.com/api",
          "https://example.com/feedback/perfect",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback with score=100 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(100);
    });

    it("giveFeedback() fails with score > 100", async () => {
      const feedbackIndex = new anchor.BN(3);
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            101, // Invalid score
            "invalid",
            "score",
            "https://agent.example.com/api",
            "https://example.com/feedback/invalid",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidScore"
      );
    });

    it("giveFeedback() with empty URI (allowed)", async () => {
      const feedbackIndex = new anchor.BN(3);
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          75,
          "good",
          "fast",
          "https://agent.example.com/api",
          "", // Empty URI is allowed
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback with empty URI tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(75);
    });

    it("giveFeedback() fails with URI > 200 bytes", async () => {
      const feedbackIndex = new anchor.BN(4);
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            50,
            "tag1",
            "tag2",
            "https://agent.example.com/api",
            longUri,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "UriTooLong"
      );
    });

    it("giveFeedback() with empty tags (allowed)", async () => {
      const feedbackIndex = new anchor.BN(4);
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          60,
          "", // Empty tag1
          "", // Empty tag2
          "https://agent.example.com/api",
          "https://example.com/feedback/empty-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback with empty tags tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.score).to.equal(60);
    });

    it("giveFeedback() fails with tag > 32 bytes", async () => {
      const feedbackIndex = new anchor.BN(5);
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            50,
            longTag,
            "valid",
            "https://agent.example.com/api",
            "https://example.com/feedback/long-tag",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "TagTooLong"
      );
    });

    it("giveFeedback() fails with invalid feedback index", async () => {
      // Try to use index 10 when next expected is 5
      const wrongIndex = new anchor.BN(10);
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, wrongIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            50,
            "tag1",
            "tag2",
            "https://agent.example.com/api",
            "https://example.com/feedback/wrong-index",
            Array.from(randomHash()),
            wrongIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidFeedbackIndex"
      );
    });

    it("giveFeedback() works with client as payer", async () => {
      // Note: This test was renamed - client is now separate from owner
      // The test verifies that client can also be the payer for their own feedback
      const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      const feedbackIndex = reputation.nextFeedbackIndex;
      const [feedbackPda] = getFeedbackPda(agentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          70,
          "self",
          "paid",
          "https://agent.example.com/api",
          "https://example.com/feedback/self-paid",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey, // Provider still pays
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Client feedback tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.clientAddress.toBase58()).to.equal(clientKeypair.publicKey.toBase58());
    });
  });

  // ============================================================================
  // FEEDBACK TAGS PDA TESTS
  // ============================================================================
  describe("FeedbackTagsPda Operations", () => {
    let tagsAgentAsset: Keypair;
    let tagsAgentPda: PublicKey;
    let tagsReputationPda: PublicKey;
    let tagsClientKeypair: Keypair;

    before(async () => {
      // Register a separate agent for tags tests
      tagsAgentAsset = Keypair.generate();
      [tagsAgentPda] = getAgentPda(tagsAgentAsset.publicKey, program.programId);
      // v0.3.0: Use asset for AgentReputationPda
      [tagsReputationPda] = getAgentReputationPda(tagsAgentAsset.publicKey, program.programId);
      // Separate client keypair (anti-gaming)
      tagsClientKeypair = Keypair.generate();

      await program.methods
        .register("https://example.com/agent/tags-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: tagsAgentPda,
          asset: tagsAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([tagsAgentAsset])
        .rpc();

      // Create feedback without tags (using separate client)
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          88,
          "", // Empty tags in giveFeedback
          "",
          "https://agent.example.com/api",
          "https://example.com/feedback/no-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: tagsClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          agentAccount: tagsAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: tagsReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([tagsClientKeypair])
        .rpc();
    });

    it("setFeedbackTags() creates optional tags PDA", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);
      // v0.3.0: Use asset instead of agentId
      const [feedbackTagsPda] = getFeedbackTagsPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .setFeedbackTags(
          feedbackIndex,
          "excellent",
          "fast"
        )
        .accounts({
          client: tagsClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          feedbackAccount: feedbackPda,
          feedbackTags: feedbackTagsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([tagsClientKeypair])
        .rpc();

      console.log("SetFeedbackTags tx:", tx);

      const tagsPda = await program.account.feedbackTagsPda.fetch(feedbackTagsPda);
      expect(tagsPda.tag1).to.equal("excellent");
      expect(tagsPda.tag2).to.equal("fast");
    });

    it("setFeedbackTags() fails if non-author", async () => {
      // Create a new feedback with a different author
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);
      const [feedbackTagsPda] = getFeedbackTagsPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);

      // First create the feedback (using tagsClientKeypair)
      await program.methods
        .giveFeedback(
          75,
          "",
          "",
          "https://agent.example.com/api",
          "https://example.com/feedback/for-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: tagsClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          agentAccount: tagsAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: tagsReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([tagsClientKeypair])
        .rpc();

      // Try to set tags with a different wallet
      const otherWallet = Keypair.generate();

      await expectAnchorError(
        program.methods
          .setFeedbackTags(
            feedbackIndex,
            "tag1",
            "tag2"
          )
          .accounts({
            client: otherWallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: tagsAgentAsset.publicKey,
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
      const [feedbackPda] = getFeedbackPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);
      const [feedbackTagsPda] = getFeedbackTagsPda(tagsAgentAsset.publicKey, feedbackIndex, program.programId);

      // Create feedback first (using tagsClientKeypair)
      await program.methods
        .giveFeedback(
          80,
          "",
          "",
          "https://agent.example.com/api",
          "https://example.com/feedback/empty-tags-test",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: tagsClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: tagsAgentAsset.publicKey,
          agentAccount: tagsAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: tagsReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([tagsClientKeypair])
        .rpc();

      // Try to set empty tags (using same client that created the feedback)
      await expectAnchorError(
        program.methods
          .setFeedbackTags(
            feedbackIndex,
            "", // Empty tag1
            ""  // Empty tag2
          )
          .accounts({
            client: tagsClientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: tagsAgentAsset.publicKey,
            feedbackAccount: feedbackPda,
            feedbackTags: feedbackTagsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([tagsClientKeypair])
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
    let revokeReputationPda: PublicKey;
    let revokeClientKeypair: Keypair;

    before(async () => {
      // Register a separate agent for revocation tests
      revokeAgentAsset = Keypair.generate();
      [revokeAgentPda] = getAgentPda(revokeAgentAsset.publicKey, program.programId);
      [revokeReputationPda] = getAgentReputationPda(revokeAgentAsset.publicKey, program.programId);
      // Separate client keypair (anti-gaming)
      revokeClientKeypair = Keypair.generate();

      await program.methods
        .register("https://example.com/agent/revoke-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: revokeAgentPda,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([revokeAgentAsset])
        .rpc();

      // Create feedback to revoke (using separate client)
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(revokeAgentAsset.publicKey, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          90,
          "high",
          "quality",
          "https://agent.example.com/api",
          "https://example.com/feedback/to-revoke",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: revokeClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: revokeAgentAsset.publicKey,
          agentAccount: revokeAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: revokeReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();
    });

    it("revokeFeedback() by the author", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(revokeAgentAsset.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          feedbackAccount: feedbackPda,
        })
        .signers([revokeClientKeypair])
        .rpc();

      console.log("Revoke feedback tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.isRevoked).to.equal(true);
    });

    it("revokeFeedback() fails if non-author", async () => {
      // Create a new feedback first
      const feedbackIndex = new anchor.BN(1);
      const [feedbackPda] = getFeedbackPda(revokeAgentAsset.publicKey, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          85,
          "test",
          "revoke",
          "https://agent.example.com/api",
          "https://example.com/feedback/non-author",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: revokeClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: revokeAgentAsset.publicKey,
          agentAccount: revokeAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: revokeReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();

      // Try to revoke with different client
      const fakeClient = Keypair.generate();

      await expectAnchorError(
        program.methods
          .revokeFeedback(feedbackIndex)
          .accounts({
            client: fakeClient.publicKey,
            asset: revokeAgentAsset.publicKey,
            feedbackAccount: feedbackPda,
          })
          .signers([fakeClient])
          .rpc(),
        "Unauthorized"
      );
    });

    it("revokeFeedback() fails if already revoked", async () => {
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(revokeAgentAsset.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .revokeFeedback(feedbackIndex)
          .accounts({
            client: revokeClientKeypair.publicKey,
            asset: revokeAgentAsset.publicKey,
            feedbackAccount: feedbackPda,
          })
          .signers([revokeClientKeypair])
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
    let responseReputationPda: PublicKey;
    let responseClientKeypair: Keypair;
    const feedbackIndex = new anchor.BN(0);

    before(async () => {
      // Register a separate agent for response tests
      responseAgentAsset = Keypair.generate();
      [responseAgentPda] = getAgentPda(responseAgentAsset.publicKey, program.programId);
      [responseReputationPda] = getAgentReputationPda(responseAgentAsset.publicKey, program.programId);
      // Separate client keypair (anti-gaming)
      responseClientKeypair = Keypair.generate();

      await program.methods
        .register("https://example.com/agent/response-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: responseAgentPda,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([responseAgentAsset])
        .rpc();

      // Create feedback to respond to (using separate client)
      const [feedbackPda] = getFeedbackPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          75,
          "feedback",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/for-response",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: responseClientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
          agentAccount: responseAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: responseReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([responseClientKeypair])
        .rpc();
    });

    it("appendResponse() adds response to feedback", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);
      // v0.3.0: Use asset instead of agentId
      const [responseIndexPda] = getResponseIndexPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);
      const responseIndex = new anchor.BN(0);
      const [responsePda] = getResponsePda(responseAgentAsset.publicKey, feedbackIndex, responseIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          feedbackIndex,
          "https://example.com/response/0",
          Array.from(randomHash())
        )
        .accounts({
          responder: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("AppendResponse tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      // v0.3.0: Simplified ResponseAccount - just responder + bump
      expect(response.responder.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });

    it("appendResponse() using wallet as responder", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentAsset.publicKey, feedbackIndex, nextIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          feedbackIndex,
          "https://example.com/response/wallet-responder",
          Array.from(randomHash())
        )
        .accounts({
          responder: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
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
      const [feedbackPda] = getFeedbackPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentAsset.publicKey, feedbackIndex, nextIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          feedbackIndex,
          "https://example.com/response/followup",
          Array.from(randomHash())
        )
        .accounts({
          responder: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Multiple response tx:", tx);

      const updatedIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      expect(updatedIndexAccount.nextIndex.toNumber()).to.equal(nextIndex.toNumber() + 1);
    });

    it("appendResponse() fails with URI > 200 bytes", async () => {
      const [feedbackPda] = getFeedbackPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentAsset.publicKey, feedbackIndex, nextIndex, program.programId);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .appendResponse(
            feedbackIndex,
            longUri,
            Array.from(randomHash())
          )
          .accounts({
            responder: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: responseAgentAsset.publicKey,
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
      const [feedbackPda] = getFeedbackPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(responseAgentAsset.publicKey, feedbackIndex, program.programId);

      // Get current response index from account
      const responseIndexAccount = await program.account.responseIndexAccount.fetch(responseIndexPda);
      const nextIndex = responseIndexAccount.nextIndex;
      const [responsePda] = getResponsePda(responseAgentAsset.publicKey, feedbackIndex, nextIndex, program.programId);

      const tx = await program.methods
        .appendResponse(
          feedbackIndex,
          "", // Empty URI
          Array.from(randomHash())
        )
        .accounts({
          responder: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Response with empty URI tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      expect(response.responder.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });
  });

  // ============================================================================
  // SEQUENCER INDEX TESTS (v0.3.0: replaces aggregation tests)
  // ============================================================================
  describe("Sequencer Index", () => {
    let seqAgentAsset: Keypair;
    let seqAgentPda: PublicKey;
    let seqReputationPda: PublicKey;
    let seqClientKeypair: Keypair;

    before(async () => {
      // Register a fresh agent for sequencer tests
      seqAgentAsset = Keypair.generate();
      [seqAgentPda] = getAgentPda(seqAgentAsset.publicKey, program.programId);
      [seqReputationPda] = getAgentReputationPda(seqAgentAsset.publicKey, program.programId);
      // Separate client keypair (anti-gaming)
      seqClientKeypair = Keypair.generate();

      await program.methods
        .register("https://example.com/agent/sequencer-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: seqAgentPda,
          asset: seqAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([seqAgentAsset])
        .rpc();
    });

    it("nextFeedbackIndex increments after each feedback", async () => {
      const scores = [80, 90, 70];

      for (let i = 0; i < scores.length; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(seqAgentAsset.publicKey, feedbackIndex, program.programId);

        await program.methods
          .giveFeedback(
            scores[i],
            `tag${i}`,
            "test",
            "https://agent.example.com/api",
            `https://example.com/feedback/seq-${i}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: seqClientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: seqAgentAsset.publicKey,
            agentAccount: seqAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: seqReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([seqClientKeypair])
          .rpc();
      }

      const reputation = await program.account.agentReputationMetadata.fetch(seqReputationPda);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(3);
      // v0.3.0: AgentReputationMetadata only has nextFeedbackIndex + bump
      // totalFeedbacks, averageScore, totalScoreSum are computed off-chain
    });

    it("nextFeedbackIndex persists after revocation (index never reused)", async () => {
      // Revoke all feedbacks (using the client that created them)
      for (let i = 0; i < 3; i++) {
        const feedbackIndex = new anchor.BN(i);
        const [feedbackPda] = getFeedbackPda(seqAgentAsset.publicKey, feedbackIndex, program.programId);

        await program.methods
          .revokeFeedback(feedbackIndex)
          .accounts({
            client: seqClientKeypair.publicKey,
            asset: seqAgentAsset.publicKey,
            feedbackAccount: feedbackPda,
          })
          .signers([seqClientKeypair])
          .rpc();
      }

      const reputation = await program.account.agentReputationMetadata.fetch(seqReputationPda);
      // Index still at 3 - revocation doesn't reuse indices
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(3);
    });
  });
});
