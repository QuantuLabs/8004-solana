import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Anti-Gaming Security Tests
 *
 * Tests the self-feedback and self-validation prevention mechanisms.
 */
describe("Anti-Gaming Security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  const MPL_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  // PDAs
  let userCollectionAuthorityPda: PublicKey;

  // Test wallets
  let agentOwner: Keypair;
  let otherUser: Keypair;

  // Test data
  let testCollection: Keypair;
  let testRegistryPda: PublicKey;
  let testAgentAsset: Keypair;
  let testAgentPda: PublicKey;

  before(async () => {
    console.log("\n📋 Anti-Gaming Test Setup");
    console.log(`   Program ID: ${program.programId.toString()}`);

    // Derive PDA
    [userCollectionAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collection_authority")],
      program.programId
    );

    // Create test wallets
    agentOwner = provider.wallet.payer as Keypair;

    // Generate other user - we'll use provider as payer for their txs
    otherUser = Keypair.generate();

    console.log(`   Agent Owner: ${agentOwner.publicKey.toString().slice(0, 16)}...`);
    console.log(`   Other User: ${otherUser.publicKey.toString().slice(0, 16)}...`);

    // Create a user registry and agent for testing
    testCollection = Keypair.generate();
    [testRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_config"), testCollection.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createUserRegistry("Anti-Gaming Test Registry", "https://test.com")
      .accounts({
        collectionAuthority: userCollectionAuthorityPda,
        registryConfig: testRegistryPda,
        collection: testCollection.publicKey,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_ID,
      })
      .signers([testCollection])
      .rpc();

    // Create an agent owned by agentOwner
    testAgentAsset = Keypair.generate();
    [testAgentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), testAgentAsset.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerAgentInRegistry("https://test.com/agent")
      .accountsPartial({
        registryConfig: testRegistryPda,
        agentAccount: testAgentPda,
        asset: testAgentAsset.publicKey,
        collection: testCollection.publicKey,
        userCollectionAuthority: userCollectionAuthorityPda,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_ID,
      })
      .signers([testAgentAsset])
      .rpc();

    // Verify agent created
    const agent = await program.account.agentAccount.fetch(testAgentPda);
    console.log(`   Test Agent ID: ${agent.agentId.toString()}`);
    console.log(`   Test Agent Owner: ${agent.owner.toString().slice(0, 16)}...`);
  });

  describe("Self-Feedback Prevention", () => {
    // Helper to get next available feedback index
    async function getNextFeedbackIndex(agentId: BN): Promise<BN> {
      const [agentReputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      try {
        const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
        return new BN(reputation.nextFeedbackIndex);
      } catch {
        // Account doesn't exist yet, so next index is 0
        return new BN(0);
      }
    }

    it("give_feedback() FAILS when client is agent owner (self-feedback)", async () => {
      const agent = await program.account.agentAccount.fetch(testAgentPda);
      const agentId = new BN(agent.agentId);

      // Get next available feedback index
      const feedbackIndex = await getNextFeedbackIndex(agentId);
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [agentReputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      try {
        await program.methods
          .giveFeedback(
            agentId,
            100, // score
            "great", // tag1
            "service", // tag2
            "/api/test", // endpoint
            "https://feedback.uri", // feedback_uri
            Array(32).fill(0) as any, // feedback_hash
            feedbackIndex
          )
          .accounts({
            client: agentOwner.publicKey, // SAME as agent owner - should fail
            payer: agentOwner.publicKey,
            asset: testAgentAsset.publicKey,
            agentAccount: testAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        expect.fail("Should have failed with SelfFeedbackNotAllowed");
      } catch (err: any) {
        const errStr = err.toString();
        // Accept either the specific error or a constraint error (which includes it)
        const hasSelfFeedbackError = errStr.includes("SelfFeedbackNotAllowed") ||
                                      errStr.includes("6300");
        expect(hasSelfFeedbackError, `Expected SelfFeedbackNotAllowed error, got: ${errStr.slice(0, 200)}`).to.be.true;
        console.log("   ✅ Correctly rejected self-feedback");
      }
    });

    it("give_feedback() SUCCEEDS when client is different from owner", async () => {
      const agent = await program.account.agentAccount.fetch(testAgentPda);
      const agentId = new BN(agent.agentId);

      // Get next available feedback index (should be same as before since self-feedback failed)
      const feedbackIndex = await getNextFeedbackIndex(agentId);
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [agentReputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Use otherUser as client (different from agent owner)
      const sig = await program.methods
        .giveFeedback(
          agentId,
          85, // score
          "helpful", // tag1
          "fast", // tag2
          "/api/test", // endpoint
          "https://feedback.uri", // feedback_uri
          Array(32).fill(1) as any, // feedback_hash
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey, // Different from agent owner
          payer: agentOwner.publicKey, // Payer can be anyone
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
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
    it("request_validation() FAILS when validator_address is agent owner", async () => {
      const agent = await program.account.agentAccount.fetch(testAgentPda);
      const agentId = agent.agentId;

      const nonce = 1;
      const [validationRequestPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentId.toArrayLike(Buffer, "le", 8),
          agentOwner.publicKey.toBuffer(), // validator = owner
          new BN(nonce).toArrayLike(Buffer, "le", 4),
        ],
        program.programId
      );

      const [validationStatsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("validation_config")],
        program.programId
      );

      try {
        await program.methods
          .requestValidation(
            agentId,
            agentOwner.publicKey, // validator = agent owner - should fail
            nonce,
            "https://request.uri",
            Array(32).fill(0) as any
          )
          .accounts({
            validationStats: validationStatsPda,
            requester: agentOwner.publicKey,
            payer: agentOwner.publicKey,
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

    it("request_validation() SUCCEEDS when validator is different from owner", async () => {
      const agent = await program.account.agentAccount.fetch(testAgentPda);
      const agentId = agent.agentId;

      const nonce = 2;
      const [validationRequestPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentId.toArrayLike(Buffer, "le", 8),
          otherUser.publicKey.toBuffer(), // validator = other user
          new BN(nonce).toArrayLike(Buffer, "le", 4),
        ],
        program.programId
      );

      const [validationStatsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("validation_config")],
        program.programId
      );

      const sig = await program.methods
        .requestValidation(
          agentId,
          otherUser.publicKey, // Different from owner
          nonce,
          "https://request.uri",
          Array(32).fill(2) as any
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: agentOwner.publicKey,
          payer: agentOwner.publicKey,
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

    it("respond_to_validation() SUCCEEDS when validator is not agent owner", async () => {
      // The otherUser can respond because they are the designated validator
      // and they are NOT the current agent owner
      const agent = await program.account.agentAccount.fetch(testAgentPda);
      const agentId = agent.agentId;

      const nonce = 2; // Use the request we created above
      const [validationRequestPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentId.toArrayLike(Buffer, "le", 8),
          otherUser.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 4),
        ],
        program.programId
      );

      const [validationStatsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("validation_config")],
        program.programId
      );

      const sig = await program.methods
        .respondToValidation(
          80, // response
          "https://response.uri",
          Array(32).fill(3) as any,
          "approved"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: otherUser.publicKey,
          validationRequest: validationRequestPda,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
        })
        .signers([otherUser])
        .rpc();

      console.log(`   ✅ Validation response from non-owner validator succeeded: ${sig.slice(0, 16)}...`);

      // Verify response was recorded
      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(80);
    });
  });

  describe("Edge Cases", () => {
    it("Different user can give multiple feedbacks", async () => {
      const agent = await program.account.agentAccount.fetch(testAgentPda);
      const agentId = agent.agentId;

      const [agentReputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Get current feedback index from reputation metadata
      const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      const feedbackIndex = reputation.nextFeedbackIndex;

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .giveFeedback(
          agentId,
          90,
          "excellent",
          "reliable",
          "/api/v2",
          "https://feedback2.uri",
          Array(32).fill(4) as any,
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey,
          payer: agentOwner.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log("   ✅ Multiple feedbacks from same user allowed");
    });
  });
});
