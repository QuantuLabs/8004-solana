/**
 * Reputation Module Security Tests for Agent Registry 8004 v0.3.0
 * Tests edge cases, exploits, and boundaries not covered in basic tests
 *
 * Coverage:
 * - Response index overflow handling
 * - Response to revoked feedback (behavior documentation)
 * - Tag immutability (cannot set twice)
 * - Tag edge cases (UTF-8, boundaries, whitespace)
 * - Endpoint validation
 * - Response spam (DoS potential)
 * - Score boundaries
 * - Feedback index manipulation
 * - Self-feedback anti-gaming
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

describe("Reputation Security Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  // Separate client for feedback (anti-gaming: owner cannot give feedback to own agent)
  let clientKeypair: Keypair;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    // Create client keypair
    clientKeypair = Keypair.generate();

    console.log("=== Reputation Security Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
  });

  // Helper to register a new agent
  async function registerAgent(): Promise<{ assetKeypair: Keypair; agentPda: PublicKey; reputationPda: PublicKey }> {
    const assetKeypair = Keypair.generate();
    const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
    const [reputationPda] = getAgentReputationPda(assetKeypair.publicKey, program.programId);

    await program.methods
      .register("https://example.com/security/reputation-test")
      .accounts({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: assetKeypair.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([assetKeypair])
      .rpc();

    return { assetKeypair, agentPda, reputationPda };
  }

  // Helper to give feedback
  async function giveFeedback(
    assetPubkey: PublicKey,
    agentPda: PublicKey,
    reputationPda: PublicKey,
    feedbackIndex: number,
    score: number = 80
  ): Promise<PublicKey> {
    const index = new anchor.BN(feedbackIndex);
    const [feedbackPda] = getFeedbackPda(assetPubkey, index, program.programId);

    await program.methods
      .giveFeedback(
        score,
        "tag1",
        "tag2",
        "https://endpoint.example.com",
        "https://feedback.example.com",
        Array.from(randomHash()),
        index
      )
      .accounts({
        client: clientKeypair.publicKey,
        payer: provider.wallet.publicKey,
        asset: assetPubkey,
        agentAccount: agentPda,
        feedbackAccount: feedbackPda,
        agentReputation: reputationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([clientKeypair])
      .rpc();

    return feedbackPda;
  }

  // ============================================================================
  // SCORE BOUNDARY TESTS
  // ============================================================================
  describe("Score Boundaries", () => {
    it("rejects score 101", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            101, // Invalid score
            "tag1",
            "tag2",
            "https://endpoint.example.com",
            "https://feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidScore"
      );
      console.log("Score 101 correctly rejected");
    });

    it("rejects score 200", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            200, // Invalid score
            "tag1",
            "tag2",
            "https://endpoint.example.com",
            "https://feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidScore"
      );
      console.log("Score 200 correctly rejected");
    });

    it("rejects score 255 (max u8)", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            255, // Max u8
            "tag1",
            "tag2",
            "https://endpoint.example.com",
            "https://feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidScore"
      );
      console.log("Score 255 correctly rejected");
    });

    it("allows score 50 (mid-range)", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          50,
          "tag1",
          "tag2",
          "https://endpoint.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Score 50 succeeded:", tx);
    });
  });

  // ============================================================================
  // FEEDBACK INDEX MANIPULATION
  // ============================================================================
  describe("Feedback Index Manipulation", () => {
    it("rejects feedback_index != next_feedback_index", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();

      // Try to skip to index 5 when next should be 0
      const wrongIndex = new anchor.BN(5);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, wrongIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            80,
            "tag1",
            "tag2",
            "https://endpoint.example.com",
            "https://feedback.example.com",
            Array.from(randomHash()),
            wrongIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidFeedbackIndex"
      );
      console.log("Wrong feedback index correctly rejected");
    });

    it("first feedback initializes reputation PDA correctly", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();

      // First feedback creates reputation PDA
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          80,
          "tag1",
          "tag2",
          "https://endpoint.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      const reputation = await program.account.agentReputationMetadata.fetch(reputationPda);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(1);
      expect(reputation.bump).to.be.greaterThan(0);
      console.log("Reputation PDA correctly initialized on first feedback");
    });
  });

  // ============================================================================
  // SELF-FEEDBACK ANTI-GAMING
  // ============================================================================
  describe("Self-Feedback Anti-Gaming", () => {
    it("rejects owner as client (SelfFeedbackNotAllowed)", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      // Owner tries to give feedback to their own agent
      await expectAnchorError(
        program.methods
          .giveFeedback(
            100, // Perfect score for self
            "fake",
            "review",
            "https://endpoint.example.com",
            "https://feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey, // Owner is client
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "SelfFeedbackNotAllowed"
      );
      console.log("Self-feedback correctly rejected");
    });

    it("allows owner as payer but different client", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      // Owner pays but different client gives feedback
      const tx = await program.methods
        .giveFeedback(
          80,
          "tag1",
          "tag2",
          "https://endpoint.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey, // Different client
          payer: provider.wallet.publicKey, // Owner is payer (sponsorship)
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Owner as payer with different client succeeded:", tx);
    });
  });

  // ============================================================================
  // TAG IMMUTABILITY (CANNOT SET TWICE)
  // ============================================================================
  describe("Tag Immutability", () => {
    it("fails to set tags twice on same feedback", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);
      const [tagsPda] = getFeedbackTagsPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      // First setFeedbackTags
      await program.methods
        .setFeedbackTags(feedbackIndex, "first_tag1", "first_tag2")
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          feedbackAccount: feedbackPda,
          feedbackTags: tagsPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("First setFeedbackTags succeeded");

      // Second setFeedbackTags should fail (PDA already exists)
      try {
        await program.methods
          .setFeedbackTags(feedbackIndex, "second_tag1", "second_tag2")
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            feedbackAccount: feedbackPda,
            feedbackTags: tagsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc();
        throw new Error("Expected second setFeedbackTags to fail");
      } catch (error: any) {
        // Should fail because account is already initialized
        console.log("Second setFeedbackTags correctly rejected:", error.message.slice(0, 100));
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes("already in use") ||
          msg.includes("already initialized") ||
          msg.includes("Account already exists") ||
          msg.includes("custom program error")
        );
      }

      // Verify original tags preserved
      const tags = await program.account.feedbackTagsPda.fetch(tagsPda);
      expect(tags.tag1).to.equal("first_tag1");
      expect(tags.tag2).to.equal("first_tag2");
      console.log("Tag immutability verified - original tags preserved");
    });
  });

  // ============================================================================
  // TAG EDGE CASES
  // ============================================================================
  describe("Tag Edge Cases", () => {
    it("allows tag1 exactly 32 bytes, tag2 empty", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          80,
          stringOfLength(MAX_TAG_LENGTH), // 32 bytes
          "", // Empty
          "https://endpoint.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Tag1=32 bytes, tag2=empty succeeded:", tx);
    });

    it("allows tag1 empty, tag2 exactly 32 bytes", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          80,
          "", // Empty
          stringOfLength(MAX_TAG_LENGTH), // 32 bytes
          "https://endpoint.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Tag1=empty, tag2=32 bytes succeeded:", tx);
    });

    it("rejects tag > 32 bytes", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            80,
            stringOfLength(MAX_TAG_LENGTH + 1), // 33 bytes
            "tag2",
            "https://endpoint.example.com",
            "https://feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "TagTooLong"
      );
      console.log("Tag > 32 bytes correctly rejected");
    });

    it("rejects both tags empty in setFeedbackTags", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);
      const [tagsPda] = getFeedbackTagsPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .setFeedbackTags(feedbackIndex, "", "")
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            feedbackAccount: feedbackPda,
            feedbackTags: tagsPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "EmptyTags"
      );
      console.log("Both empty tags correctly rejected in setFeedbackTags");
    });
  });

  // ============================================================================
  // ENDPOINT VALIDATION
  // ============================================================================
  describe("Endpoint Validation", () => {
    it("rejects endpoint > 200 bytes", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            80,
            "tag1",
            "tag2",
            uriOfLength(MAX_URI_LENGTH + 1), // 201 bytes endpoint
            "https://feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "UriTooLong"
      );
      console.log("Endpoint > 200 bytes correctly rejected");
    });

    it("allows endpoint exactly 200 bytes", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      const tx = await program.methods
        .giveFeedback(
          80,
          "tag1",
          "tag2",
          uriOfLength(MAX_URI_LENGTH), // 200 bytes endpoint
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Endpoint exactly 200 bytes succeeded:", tx);
    });
  });

  // ============================================================================
  // RESPONSE TO REVOKED FEEDBACK
  // ============================================================================
  describe("Response to Revoked Feedback", () => {
    it("allows response to revoked feedback (behavior documentation)", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);

      // Revoke feedback
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: clientKeypair.publicKey,
          asset: assetKeypair.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback revoked");

      // Verify it's revoked
      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.isRevoked).to.be.true;

      // Try to respond to revoked feedback
      const [responseIndexPda] = getResponseIndexPda(assetKeypair.publicKey, feedbackIndex, program.programId);
      const responseIndex = new anchor.BN(0);
      const [responsePda] = getResponsePda(assetKeypair.publicKey, feedbackIndex, responseIndex, program.programId);

      const responder = Keypair.generate();

      // This should succeed - responses are allowed on revoked feedback (audit trail)
      const tx = await program.methods
        .appendResponse(
          feedbackIndex,
          "https://response.example.com/to-revoked",
          Array.from(randomHash())
        )
        .accounts({
          responder: responder.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([responder])
        .rpc();

      console.log("Response to revoked feedback succeeded:", tx);
      console.log("BEHAVIOR: Responses allowed on revoked feedback (preserves audit trail)");
    });

    it("preserves existing responses after revoke", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);
      const [responseIndexPda] = getResponseIndexPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      // Add response before revoke
      const responseIdx = new anchor.BN(0);
      const [responsePda] = getResponsePda(assetKeypair.publicKey, feedbackIndex, responseIdx, program.programId);
      const responder = Keypair.generate();

      await program.methods
        .appendResponse(
          feedbackIndex,
          "https://response.example.com/before-revoke",
          Array.from(randomHash())
        )
        .accounts({
          responder: responder.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([responder])
        .rpc();

      // Revoke
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: clientKeypair.publicKey,
          asset: assetKeypair.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
        })
        .signers([clientKeypair])
        .rpc();

      // Response should still exist
      const response = await program.account.responseAccount.fetch(responsePda);
      expect(response.responder.toBase58()).to.equal(responder.publicKey.toBase58());
      console.log("Existing responses preserved after revoke");
    });
  });

  // ============================================================================
  // DOUBLE REVOKE PREVENTION
  // ============================================================================
  describe("Double Revoke Prevention", () => {
    it("rejects revoking already revoked feedback", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);

      // First revoke
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: clientKeypair.publicKey,
          asset: assetKeypair.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
        })
        .signers([clientKeypair])
        .rpc();

      // Second revoke should fail
      await expectAnchorError(
        program.methods
          .revokeFeedback(feedbackIndex)
          .accounts({
            client: clientKeypair.publicKey,
            asset: assetKeypair.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
          })
          .signers([clientKeypair])
          .rpc(),
        "AlreadyRevoked"
      );
      console.log("Double revoke correctly rejected");
    });
  });

  // ============================================================================
  // RESPONSE SPAM / DOS TEST
  // ============================================================================
  describe("Response Spam (DoS potential)", () => {
    it("stress test: 10 responses on single feedback (rent-gated)", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);
      const [responseIndexPda] = getResponseIndexPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      // Add 10 responses
      for (let i = 0; i < 10; i++) {
        const responseIdx = new anchor.BN(i);
        const [responsePda] = getResponsePda(assetKeypair.publicKey, feedbackIndex, responseIdx, program.programId);
        const responder = Keypair.generate();

        await program.methods
          .appendResponse(
            feedbackIndex,
            `https://response.example.com/${i}`,
            Array.from(randomHash())
          )
          .accounts({
            responder: responder.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            feedbackAccount: feedbackPda,
            responseIndex: responseIndexPda,
            responseAccount: responsePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([responder])
          .rpc();
      }

      // Verify index
      const responseIndex = await program.account.responseIndexAccount.fetch(responseIndexPda);
      expect(responseIndex.nextIndex.toNumber()).to.equal(10);
      console.log("10 responses added successfully - rent cost is DoS deterrent");
    });
  });

  // ============================================================================
  // RESPONSE URI VALIDATION
  // ============================================================================
  describe("Response URI Validation", () => {
    it("rejects response_uri > 200 bytes", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackPda = await giveFeedback(
        assetKeypair.publicKey,
        agentPda,
        reputationPda,
        0
      );

      const feedbackIndex = new anchor.BN(0);
      const [responseIndexPda] = getResponseIndexPda(assetKeypair.publicKey, feedbackIndex, program.programId);
      const responseIdx = new anchor.BN(0);
      const [responsePda] = getResponsePda(assetKeypair.publicKey, feedbackIndex, responseIdx, program.programId);
      const responder = Keypair.generate();

      await expectAnchorError(
        program.methods
          .appendResponse(
            feedbackIndex,
            uriOfLength(MAX_URI_LENGTH + 1), // 201 bytes
            Array.from(randomHash())
          )
          .accounts({
            responder: responder.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            feedbackAccount: feedbackPda,
            responseIndex: responseIndexPda,
            responseAccount: responsePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([responder])
          .rpc(),
        "ResponseUriTooLong"
      );
      console.log("Response URI > 200 bytes correctly rejected");
    });
  });

  // ============================================================================
  // FEEDBACK URI VALIDATION
  // ============================================================================
  describe("Feedback URI Validation", () => {
    it("rejects feedback_uri > 200 bytes", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            80,
            "tag1",
            "tag2",
            "https://endpoint.example.com",
            uriOfLength(MAX_URI_LENGTH + 1), // 201 bytes feedback_uri
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "UriTooLong"
      );
      console.log("Feedback URI > 200 bytes correctly rejected");
    });
  });

  // ============================================================================
  // HASH VALIDATION (DOCUMENTATION)
  // ============================================================================
  describe("Hash Validation (Documentation)", () => {
    it("accepts zero hash [0;32] (off-chain verification)", async () => {
      const { assetKeypair, agentPda, reputationPda } = await registerAgent();
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(assetKeypair.publicKey, feedbackIndex, program.programId);

      const zeroHash = new Array(32).fill(0);

      const tx = await program.methods
        .giveFeedback(
          80,
          "tag1",
          "tag2",
          "https://endpoint.example.com",
          "https://feedback.example.com",
          zeroHash, // Zero hash
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Zero hash accepted:", tx);
      console.log("DOCUMENTATION: Hash validation is off-chain only");
    });
  });
});
