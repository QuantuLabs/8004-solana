import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  randomHash,
  uniqueNonce,
} from "./utils/helpers";

/**
 * Anti-Gaming Security Tests v2.0.0
 *
 * Tests the self-feedback and self-validation prevention mechanisms.
 * v2.0.0: Events-only architecture for Reputation and Validation
 */
describe("Anti-Gaming Security (Events-Only v2.0.0)", () => {
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

  before(async () => {
    console.log("\n Anti-Gaming Test Setup (v2.0.0 Events-Only)");
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

    await program.methods
      .register("https://test.com/anti-gaming-agent")
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: testAgentPda,
        asset: testAgentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
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

  describe("Self-Feedback Prevention", () => {
    it("giveFeedback() FAILS when client is agent owner (self-feedback)", async () => {
      const feedbackIndex = new BN(0);

      try {
        await program.methods
          .giveFeedback(
            100,
            "great",
            "service",
            "/api/test",
            "https://feedback.uri",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey, // SAME as agent owner - should fail
            asset: testAgentAsset.publicKey,
            agentAccount: testAgentPda,
          })
          .rpc();

        expect.fail("Should have failed with SelfFeedbackNotAllowed");
      } catch (err: any) {
        const errStr = err.toString();
        const hasSelfFeedbackError = errStr.includes("SelfFeedbackNotAllowed") || errStr.includes("6300");
        expect(hasSelfFeedbackError, `Expected SelfFeedbackNotAllowed error, got: ${errStr.slice(0, 200)}`).to.be.true;
        console.log("   Correctly rejected self-feedback");
      }
    });

    it("giveFeedback() SUCCEEDS when client is different from owner", async () => {
      const feedbackIndex = new BN(0);

      const sig = await program.methods
        .giveFeedback(
          85,
          "helpful",
          "fast",
          "/api/test",
          "https://feedback.uri",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
        })
        .signers([otherUser])
        .rpc();

      console.log(`   Feedback from different user succeeded: ${sig.slice(0, 16)}...`);
      // Events-only: no account to fetch, event was emitted
    });
  });

  describe("Self-Validation Prevention", () => {
    it("requestValidation() FAILS when validator_address is agent owner", async () => {
      const nonce = uniqueNonce();

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
            asset: testAgentAsset.publicKey,
            agentAccount: testAgentPda,
            validator: provider.wallet.publicKey,
          })
          .rpc();

        expect.fail("Should have failed with SelfValidationNotAllowed");
      } catch (err: any) {
        expect(err.toString()).to.include("SelfValidationNotAllowed");
        console.log("   Correctly rejected self-validation request");
      }
    });

    it("requestValidation() SUCCEEDS when validator is different from owner", async () => {
      const nonce = uniqueNonce();

      const sig = await program.methods
        .requestValidation(
          otherUser.publicKey,
          nonce,
          "https://request.uri",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          validator: otherUser.publicKey,
        })
        .rpc();

      console.log(`   Validation request with different validator succeeded: ${sig.slice(0, 16)}...`);
      // Events-only: event was emitted
    });

    it("respondToValidation() FAILS when validator is agent owner", async () => {
      const nonce = uniqueNonce();

      // First create a request with a different validator
      await program.methods
        .requestValidation(
          otherUser.publicKey,
          nonce,
          "https://request.uri",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          validator: otherUser.publicKey,
        })
        .rpc();

      // Owner tries to respond (should fail due to self-validation check)
      try {
        await program.methods
          .respondToValidation(
            nonce,
            80,
            "https://response.uri",
            Array.from(randomHash()),
            "approved"
          )
          .accounts({
            validator: provider.wallet.publicKey, // Owner trying to validate - should fail
            asset: testAgentAsset.publicKey,
            agentAccount: testAgentPda,
          })
          .rpc();

        expect.fail("Should have failed with SelfValidationNotAllowed");
      } catch (err: any) {
        expect(err.toString()).to.include("SelfValidationNotAllowed");
        console.log("   Correctly rejected self-validation response");
      }
    });

    it("respondToValidation() SUCCEEDS when validator is not agent owner", async () => {
      const nonce = uniqueNonce();

      // Create request
      await program.methods
        .requestValidation(
          otherUser.publicKey,
          nonce,
          "https://request.uri",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
          validator: otherUser.publicKey,
        })
        .rpc();

      // Respond as otherUser (not the owner)
      const sig = await program.methods
        .respondToValidation(
          nonce,
          80,
          "https://response.uri",
          Array.from(randomHash()),
          "approved"
        )
        .accounts({
          validator: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
        })
        .signers([otherUser])
        .rpc();

      console.log(`   Validation response from non-owner validator succeeded: ${sig.slice(0, 16)}...`);
      // Events-only: event was emitted
    });
  });

  describe("Edge Cases", () => {
    it("Different user can give multiple feedbacks", async () => {
      const feedbackIndex = new BN(1);

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
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
        })
        .signers([otherUser])
        .rpc();

      console.log("   Multiple feedbacks from same user allowed");
    });

    it("Same index can be reused (events-only)", async () => {
      const feedbackIndex = new BN(0);

      // Events-only allows duplicate indices
      await program.methods
        .giveFeedback(
          75,
          "good",
          "reused",
          "/api/v3",
          "https://feedback3.uri",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          agentAccount: testAgentPda,
        })
        .signers([otherUser])
        .rpc();

      console.log("   Reused index allowed (events-only, indexer dedupes)");
    });
  });
});
