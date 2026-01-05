/**
 * E2E Test: Revoke Feedback Counter Verification
 * Verifies that total_feedbacks and total_score_sum are properly decremented on revoke
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
  randomHash,
} from "./utils/helpers";

describe("E2E Revoke Feedback Counter Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let configPda: PublicKey;
  let collectionPubkey: PublicKey;

  // Test agent
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let agentId: anchor.BN;
  let agentReputationPda: PublicKey;

  before(async () => {
    [configPda] = getConfigPda(program.programId);
    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    agentId = config.nextAgentId;

    // Register agent
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    [agentReputationPda] = getAgentReputationPda(agentId, program.programId);

    console.log("\n=== E2E Revoke Counter Test Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent ID:", agentId.toNumber());

    await program.methods
      .register("https://example.com/agent/revoke-counter-test")
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

    console.log("✓ Agent registered");
  });

  it("Give feedback, verify counts, revoke, verify counts decremented", async () => {
    const testScore = 75;
    const feedbackIndex = new anchor.BN(0);
    const [feedbackPda] = getFeedbackPda(agentId, feedbackIndex, program.programId);

    // Step 1: Give feedback
    console.log("\n--- Step 1: Give Feedback ---");
    const giveTx = await program.methods
      .giveFeedback(
        agentId,
        testScore,
        "test",
        "revoke",
        "https://example.com/feedback/e2e-revoke",
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

    console.log("Give feedback TX:", giveTx);

    // Verify reputation after give
    const repAfterGive = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    console.log("\n--- After Give Feedback ---");
    console.log("  total_feedbacks:", repAfterGive.totalFeedbacks.toNumber());
    console.log("  total_score_sum:", repAfterGive.totalScoreSum.toNumber());
    console.log("  average_score:", repAfterGive.averageScore);

    expect(repAfterGive.totalFeedbacks.toNumber()).to.equal(1, "Should have 1 feedback");
    expect(repAfterGive.totalScoreSum.toNumber()).to.equal(testScore, `Score sum should be ${testScore}`);
    expect(repAfterGive.averageScore).to.equal(testScore, `Average should be ${testScore}`);
    console.log("✓ Feedback counts verified after give");

    // Step 2: Revoke feedback
    console.log("\n--- Step 2: Revoke Feedback ---");
    const revokeTx = await program.methods
      .revokeFeedback(agentId, feedbackIndex)
      .accounts({
        client: provider.wallet.publicKey,
        feedbackAccount: feedbackPda,
        agentReputation: agentReputationPda,
      })
      .rpc();

    console.log("Revoke TX:", revokeTx);

    // Verify feedback is revoked
    const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
    expect(feedback.isRevoked).to.equal(true, "Feedback should be revoked");
    console.log("✓ Feedback marked as revoked");

    // Verify reputation after revoke
    const repAfterRevoke = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    console.log("\n--- After Revoke Feedback ---");
    console.log("  total_feedbacks:", repAfterRevoke.totalFeedbacks.toNumber());
    console.log("  total_score_sum:", repAfterRevoke.totalScoreSum.toNumber());
    console.log("  average_score:", repAfterRevoke.averageScore);

    expect(repAfterRevoke.totalFeedbacks.toNumber()).to.equal(0, "Should have 0 feedbacks after revoke");
    expect(repAfterRevoke.totalScoreSum.toNumber()).to.equal(0, "Score sum should be 0 after revoke");
    expect(repAfterRevoke.averageScore).to.equal(0, "Average should be 0 after revoke");

    console.log("\n=== RESULTS ===");
    console.log("✅ SUCCESS: total_feedbacks decremented from 1 to 0");
    console.log("✅ SUCCESS: total_score_sum decremented from", testScore, "to 0");
    console.log("✅ SUCCESS: average_score recalculated to 0");
  });

  it("Multiple feedbacks, revoke one, verify partial decrement", async () => {
    const score1 = 80;
    const score2 = 60;
    const feedbackIndex1 = new anchor.BN(1);
    const feedbackIndex2 = new anchor.BN(2);
    const [feedbackPda1] = getFeedbackPda(agentId, feedbackIndex1, program.programId);
    const [feedbackPda2] = getFeedbackPda(agentId, feedbackIndex2, program.programId);

    // Give two feedbacks
    console.log("\n--- Give Two Feedbacks ---");
    await program.methods
      .giveFeedback(agentId, score1, "test1", "multi", "uri1", Array.from(randomHash()), feedbackIndex1)
      .accounts({
        client: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        agentAccount: agentPda,
        feedbackAccount: feedbackPda1,
        agentReputation: agentReputationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .giveFeedback(agentId, score2, "test2", "multi", "uri2", Array.from(randomHash()), feedbackIndex2)
      .accounts({
        client: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        agentAccount: agentPda,
        feedbackAccount: feedbackPda2,
        agentReputation: agentReputationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const repBefore = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    console.log("Before revoke:");
    console.log("  total_feedbacks:", repBefore.totalFeedbacks.toNumber());
    console.log("  total_score_sum:", repBefore.totalScoreSum.toNumber());
    console.log("  average_score:", repBefore.averageScore);

    expect(repBefore.totalFeedbacks.toNumber()).to.equal(2);
    expect(repBefore.totalScoreSum.toNumber()).to.equal(score1 + score2);
    expect(repBefore.averageScore).to.equal(Math.floor((score1 + score2) / 2));

    // Revoke first feedback
    console.log("\n--- Revoke First Feedback (score=80) ---");
    await program.methods
      .revokeFeedback(agentId, feedbackIndex1)
      .accounts({
        client: provider.wallet.publicKey,
        feedbackAccount: feedbackPda1,
        agentReputation: agentReputationPda,
      })
      .rpc();

    const repAfter = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    console.log("After revoke:");
    console.log("  total_feedbacks:", repAfter.totalFeedbacks.toNumber());
    console.log("  total_score_sum:", repAfter.totalScoreSum.toNumber());
    console.log("  average_score:", repAfter.averageScore);

    expect(repAfter.totalFeedbacks.toNumber()).to.equal(1, "Should have 1 feedback");
    expect(repAfter.totalScoreSum.toNumber()).to.equal(score2, `Score sum should be ${score2}`);
    expect(repAfter.averageScore).to.equal(score2, `Average should be ${score2}`);

    console.log("\n=== RESULTS ===");
    console.log("✅ SUCCESS: total_feedbacks decremented from 2 to 1");
    console.log("✅ SUCCESS: total_score_sum decremented from", score1 + score2, "to", score2);
    console.log("✅ SUCCESS: average_score recalculated to", score2);
  });
});
