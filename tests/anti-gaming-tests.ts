import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getValidationRequestPda,
  randomHash,
  uniqueNonce,
} from "./utils/helpers";

/**
 * Anti-Gaming Security Tests v0.3.0
 *
 * Tests the self-feedback and self-validation prevention mechanisms.
 * v0.3.0: Uses asset (Pubkey) instead of agent_id as identifier
 */
describe("Anti-Gaming Security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  // Test wallets
  let otherUser: Keypair;

  // Test data
  let testAgentAsset: Keypair;
  let testAgentPda: PublicKey;
  let testAgentReputationPda: PublicKey;

  before(async () => {
    console.log("\n📋 Anti-Gaming Test Setup (v0.3.0)");
    console.log(`   Program ID: ${program.programId.toString()}`);

    // Get root config
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    // Generate other user for non-owner operations
    otherUser = Keypair.generate();
    console.log(`   Agent Owner: ${provider.wallet.publicKey.toString().slice(0, 16)}...`);
    console.log(`   Other User: ${otherUser.publicKey.toString().slice(0, 16)}...`);

    // Create an agent owned by provider.wallet
    testAgentAsset = Keypair.generate();
    [testAgentPda] = getAgentPda(testAgentAsset.publicKey, program.programId);
    [testAgentReputationPda] = getAgentReputationPda(testAgentAsset.publicKey, program.programId);

    await program.methods
      .register("https://test.com/anti-gaming-agent")
      .accounts({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: testAgentPda,
        asset: testAgentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([testAgentAsset])
      .rpc();

    // Verify agent created
    const agent = await program.account.agentAccount.fetch(testAgentPda);
    console.log(`   Test Agent Asset: ${testAgentAsset.publicKey.toString().slice(0, 16)}...`);
    console.log(`   Test Agent Owner: ${agent.owner.toString().slice(0, 16)}...`);
  });

  // Helper to get next available feedback index
  async function getNextFeedbackIndex(): Promise<BN> {
    try {
      const reputation = await program.account.agentReputationMetadata.fetch(testAgentReputationPda);
      return new BN(reputation.nextFeedbackIndex);
    } catch {
      // Account doesn't exist yet, so next index is 0
      return new BN(0);
    }
  }

  describe("Self-Feedback Prevention", () => {
    it("giveFeedback() FAILS when client is agent owner (self-feedback)", async () => {
      const feedbackIndex = await getNextFeedbackIndex();
      const [feedbackPda] = getFeedbackPda(testAgentAsset.publicKey, feedbackIndex, program.programId);

      try {
        await program.methods
          .giveFeedback(
            100, // score
            "great", // tag1
            "service", // tag2
            "/api/test", // endpoint
            "https://feedback.uri", // feedback_uri
            Array.from(randomHash()), // feedback_hash
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey, // SAME as agent owner - should fail
            payer: provider.wallet.publicKey,
            asset: testAgentAsset.publicKey,
            agentAccount: testAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: testAgentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        expect.fail("Should have failed with SelfFeedbackNotAllowed");
      } catch (err: any) {
        const errStr = err.toString();
        const hasSelfFeedbackError = errStr.includes("SelfFeedbackNotAllowed") || errStr.includes("6300");
        expect(hasSelfFeedbackError, `Expected SelfFeedbackNotAllowed error, got: ${errStr.slice(0, 200)}`).to.be.true;
        console.log("   ✅ Correctly rejected self-feedback");
      }
    });

    it("giveFeedback() SUCCEEDS when client is different from owner", async () => {
      const feedbackIndex = await getNextFeedbackIndex();
      const [feedbackPda] = getFeedbackPda(testAgentAsset.publicKey, feedbackIndex, program.programId);

      // Use otherUser as client (different from agent owner)
      const sig = await program.methods
        .giveFeedback(
          85, // score
          "helpful", // tag1
          "fast", // tag2
          "/api/test", // endpoint
          "https://feedback.uri", // feedback_uri
          Array.from(randomHash()), // feedback_hash
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey, // Different from agent owner
          payer: provider.wallet.publicKey, // Payer can be anyone
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: testAgentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log(`   ✅ Feedback from different user succeeded: ${sig.slice(0, 16)}...`);

      // Verify feedback was created
      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.clientAddress.toString()).to.equal(otherUser.publicKey.toString());
      expect(feedback.score).to.equal(85);
    });
  });

  describe("Self-Validation Prevention", () => {
    it("requestValidation() FAILS when validator_address is agent owner", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        testAgentAsset.publicKey,
        provider.wallet.publicKey, // validator = owner
        nonce,
        program.programId
      );

      try {
        await program.methods
          .requestValidation(
            provider.wallet.publicKey, // validator = agent owner - should fail
            nonce,
            "https://request.uri",
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: testAgentAsset.publicKey,
            agentAccount: testAgentPda,
            validationRequest: validationRequestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        expect.fail("Should have failed with SelfValidationNotAllowed");
      } catch (err: any) {
        expect(err.toString()).to.include("SelfValidationNotAllowed");
        console.log("   ✅ Correctly rejected self-validation request");
      }
    });

    it("requestValidation() SUCCEEDS when validator is different from owner", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        testAgentAsset.publicKey,
        otherUser.publicKey, // validator = other user
        nonce,
        program.programId
      );

      const sig = await program.methods
        .requestValidation(
          otherUser.publicKey, // Different from owner
          nonce,
          "https://request.uri",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`   ✅ Validation request with different validator succeeded: ${sig.slice(0, 16)}...`);

      // Verify request was created
      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.validatorAddress.toString()).to.equal(otherUser.publicKey.toString());
    });

    it("respondToValidation() SUCCEEDS when validator is not agent owner", async () => {
      // Create a fresh request for this test
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        testAgentAsset.publicKey,
        otherUser.publicKey,
        nonce,
        program.programId
      );

      // First create the request
      await program.methods
        .requestValidation(
          otherUser.publicKey,
          nonce,
          "https://request.uri",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Now respond as otherUser (the validator, who is NOT the owner)
      const sig = await program.methods
        .respondToValidation(
          80, // response
          "https://response.uri",
          Array.from(randomHash()),
          "approved"
        )
        .accounts({
          validator: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          validationRequest: validationRequestPda,
        })
        .signers([otherUser])
        .rpc();

      console.log(`   ✅ Validation response from non-owner validator succeeded: ${sig.slice(0, 16)}...`);

      // Verify response was recorded
      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(80);
      expect(request.hasResponse).to.be.true;
    });
  });

  describe("Edge Cases", () => {
    it("Different user can give multiple feedbacks", async () => {
      const feedbackIndex = await getNextFeedbackIndex();
      const [feedbackPda] = getFeedbackPda(testAgentAsset.publicKey, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          90,
          "excellent",
          "reliable",
          "/api/v2",
          "https://feedback2.uri",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey,
          payer: provider.wallet.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: testAgentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log("   ✅ Multiple feedbacks from same user allowed");
    });

    it("Owner as payer but different client succeeds", async () => {
      const feedbackIndex = await getNextFeedbackIndex();
      const [feedbackPda] = getFeedbackPda(testAgentAsset.publicKey, feedbackIndex, program.programId);

      // Owner pays (sponsors) but different user gives feedback
      await program.methods
        .giveFeedback(
          75,
          "good",
          "sponsored",
          "/api/v3",
          "https://feedback3.uri",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey, // Client is different
          payer: provider.wallet.publicKey, // Owner sponsors the tx
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: testAgentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log("   ✅ Owner as payer with different client allowed (sponsorship)");
    });
  });
});
