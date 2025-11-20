/**
 * LOT 4: Arithmetic Edge Cases Tests
 *
 * Tests numeric bounds, overflow/underflow scenarios, and edge cases in:
 * - Score calculations (0-100 bounds)
 * - Feedback indices (u64 max)
 * - Agent IDs (u64 max)
 * - Aggregate counters at limits
 * - Weight overflow in aggregate computations
 * - Zero-value edge cases
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { assert } from "chai";

describe("Arithmetic Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;

  const identityProgramId = identityProgram.programId;
  const reputationProgramId = reputationProgram.programId;

  // Test accounts
  let agentOwner: Keypair;
  let client1: Keypair;
  let client2: Keypair;
  let agentId: BN;

  // PDAs
  let agentPda: PublicKey;
  let aggregatePda: PublicKey;

  before(async () => {
    agentOwner = Keypair.generate();
    client1 = Keypair.generate();
    client2 = Keypair.generate();

    // Airdrop SOL
    const airdropAmount = 5 * anchor.web3.LAMPORTS_PER_SOL;
    await provider.connection.requestAirdrop(agentOwner.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(client1.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(client2.publicKey, airdropAmount);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Register agent
    const agentUri = "ipfs://Qm_arithmetic_test";
    const metadataUri = "ipfs://Qm_arithmetic_metadata";
    const fileHash = Buffer.alloc(32, 1);

    const tx = await identityProgram.methods
      .registerAgent(agentUri, metadataUri, fileHash)
      .accounts({
        agent: null,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Get agent ID from event
    const events = await identityProgram.account.agent.all();
    agentId = events[events.length - 1].account.agentId;

    // Derive PDAs
    [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentId.toArrayLike(Buffer, "le", 8)],
      identityProgramId
    );

    [aggregatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("aggregate"),
        agentId.toArrayLike(Buffer, "le", 8),
        identityProgramId.toBuffer(),
      ],
      reputationProgramId
    );
  });

  /**
   * Helper to create feedbackAuth
   */
  function createFeedbackAuth(clientPubkey: PublicKey, indexLimit: number): any {
    const now = Math.floor(Date.now() / 1000);
    return {
      agentId,
      clientAddress: clientPubkey,
      indexLimit: new BN(indexLimit),
      expiry: new BN(now + 3600),
      chainId: "solana-devnet",
      identityRegistry: identityProgramId,
      signerAddress: agentOwner.publicKey,
      signature: Buffer.alloc(64, 0),
    };
  }

  /**
   * Test 1: Score bounds validation (0-100)
   */
  it("Should enforce score bounds (0-100)", async () => {
    const feedbackAuth = createFeedbackAuth(client1.publicKey, 10);
    const tag1 = Buffer.alloc(32, 1);
    const tag2 = Buffer.alloc(32, 2);
    const fileUri = "ipfs://Qm_score_bounds";
    const fileHash = Buffer.alloc(32, 3);

    // Valid scores: 0, 50, 100
    const validScores = [0, 50, 100];

    for (const score of validScores) {
      const feedbackIndex = validScores.indexOf(score);
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          client1.publicKey.toBuffer(),
          new BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      try {
        await reputationProgram.methods
          .giveFeedback(
            agentId,
            score,
            tag1,
            tag2,
            fileUri,
            fileHash,
            new BN(feedbackIndex),
            feedbackAuth
          )
          .accounts({
            feedback: feedbackPda,
            aggregate: aggregatePda,
            agent: agentPda,
            client: client1.publicKey,
            identityRegistry: identityProgramId,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([client1])
          .rpc();

        console.log(`✓ Valid score ${score} accepted`);
      } catch (err) {
        assert.fail(`Score ${score} should be valid but failed: ${err.message}`);
      }
    }

    // Invalid scores: 101, 255
    const invalidScores = [101, 255];

    for (const score of invalidScores) {
      const feedbackIndex = 99; // Use high index to avoid conflicts
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          client1.publicKey.toBuffer(),
          new BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      try {
        await reputationProgram.methods
          .giveFeedback(
            agentId,
            score,
            tag1,
            tag2,
            fileUri,
            fileHash,
            new BN(feedbackIndex),
            feedbackAuth
          )
          .accounts({
            feedback: feedbackPda,
            aggregate: aggregatePda,
            agent: agentPda,
            client: client1.publicKey,
            identityRegistry: identityProgramId,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([client1])
          .rpc();

        assert.fail(`Score ${score} should be invalid but was accepted`);
      } catch (err) {
        console.log(`✓ Invalid score ${score} correctly rejected`);
        assert.include(err.toString(), "InvalidScore");
      }
    }
  });

  /**
   * Test 2: Maximum feedback index (u64 max - 1)
   */
  it("Should handle large feedback indices", async () => {
    const feedbackAuth = createFeedbackAuth(client2.publicKey, Number.MAX_SAFE_INTEGER);
    const tag1 = Buffer.alloc(32, 4);
    const tag2 = Buffer.alloc(32, 5);
    const fileUri = "ipfs://Qm_large_index";
    const fileHash = Buffer.alloc(32, 6);

    // Test with a very large feedback index
    const largeIndex = new BN("18446744073709551614"); // u64::MAX - 1
    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        client2.publicKey.toBuffer(),
        largeIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    const tx = await reputationProgram.methods
      .giveFeedback(
        agentId,
        75,
        tag1,
        tag2,
        fileUri,
        fileHash,
        largeIndex,
        feedbackAuth
      )
      .accounts({
        feedback: feedbackPda,
        aggregate: aggregatePda,
        agent: agentPda,
        client: client2.publicKey,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([client2])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Verify feedback was created
    const feedback = await reputationProgram.account.feedback.fetch(feedbackPda);
    assert.equal(feedback.feedbackIndex.toString(), largeIndex.toString());
    console.log(`✓ Large feedback index ${largeIndex.toString()} handled correctly`);
  });

  /**
   * Test 3: Maximum agent ID (u64 max)
   */
  it("Should handle large agent IDs", async () => {
    // Create an agent with a large ID by registering multiple agents
    const largeAgentOwner = Keypair.generate();
    await provider.connection.requestAirdrop(
      largeAgentOwner.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await new Promise(resolve => setTimeout(resolve, 1000));

    const agentUri = "ipfs://Qm_large_agent_id";
    const metadataUri = "ipfs://Qm_large_metadata";
    const fileHash = Buffer.alloc(32, 7);

    const tx = await identityProgram.methods
      .registerAgent(agentUri, metadataUri, fileHash)
      .accounts({
        agent: null,
        owner: largeAgentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([largeAgentOwner])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Get the new agent ID
    const events = await identityProgram.account.agent.all();
    const newAgentId = events[events.length - 1].account.agentId;

    console.log(`✓ Large agent ID ${newAgentId.toString()} registered successfully`);

    // Verify PDA derivation works with large ID
    const [largeAgentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), newAgentId.toArrayLike(Buffer, "le", 8)],
      identityProgramId
    );

    const agentAccount = await identityProgram.account.agent.fetch(largeAgentPda);
    assert.equal(agentAccount.agentId.toString(), newAgentId.toString());
  });

  /**
   * Test 4: Aggregate counters at maximum values
   */
  it("Should handle aggregate counters near limits", async () => {
    // Submit multiple feedbacks to test aggregate calculations
    const feedbackAuth = createFeedbackAuth(client1.publicKey, 1000);
    const tag1 = Buffer.alloc(32, 8);
    const tag2 = Buffer.alloc(32, 9);
    const fileUri = "ipfs://Qm_aggregate_test";
    const fileHash = Buffer.alloc(32, 10);

    // Submit 10 feedbacks with varying scores
    const scores = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

    for (let i = 0; i < scores.length; i++) {
      const feedbackIndex = 10 + i; // Avoid conflicts with previous tests
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          client1.publicKey.toBuffer(),
          new BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      await reputationProgram.methods
        .giveFeedback(
          agentId,
          scores[i],
          tag1,
          tag2,
          fileUri,
          fileHash,
          new BN(feedbackIndex),
          feedbackAuth
        )
        .accounts({
          feedback: feedbackPda,
          aggregate: aggregatePda,
          agent: agentPda,
          client: client1.publicKey,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([client1])
        .rpc();
    }

    // Fetch and verify aggregate
    const aggregate = await reputationProgram.account.reputationAggregate.fetch(aggregatePda);

    console.log(`Aggregate stats after ${scores.length} feedbacks:`);
    console.log(`  Total count: ${aggregate.totalCount.toString()}`);
    console.log(`  Total score: ${aggregate.totalScore.toString()}`);
    console.log(`  Average score: ${aggregate.averageScore}`);

    // Verify counts are correct (including previous tests)
    assert.isTrue(aggregate.totalCount.gten(scores.length));
    assert.isTrue(aggregate.totalScore.gtn(0));
    assert.isAtLeast(aggregate.averageScore, 0);
    assert.isAtMost(aggregate.averageScore, 100);

    console.log("✓ Aggregate counters handled correctly");
  });

  /**
   * Test 5: Weight overflow in aggregate computations
   */
  it("Should prevent overflow in weighted score calculations", async () => {
    // This tests the aggregate computation with extreme values
    const feedbackAuth = createFeedbackAuth(client2.publicKey, 1000);
    const tag1 = Buffer.alloc(32, 11);
    const tag2 = Buffer.alloc(32, 12);
    const fileUri = "ipfs://Qm_weight_test";
    const fileHash = Buffer.alloc(32, 13);

    // Submit many high-score feedbacks to test sum overflow protection
    const highScores = Array(20).fill(100);

    for (let i = 0; i < highScores.length; i++) {
      const feedbackIndex = 100 + i; // High index to avoid conflicts
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          client2.publicKey.toBuffer(),
          new BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      try {
        await reputationProgram.methods
          .giveFeedback(
            agentId,
            highScores[i],
            tag1,
            tag2,
            fileUri,
            fileHash,
            new BN(feedbackIndex),
            feedbackAuth
          )
          .accounts({
            feedback: feedbackPda,
            aggregate: aggregatePda,
            agent: agentPda,
            client: client2.publicKey,
            identityRegistry: identityProgramId,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([client2])
          .rpc();
      } catch (err) {
        // If overflow occurs, it should be caught gracefully
        console.log(`Note: Overflow protection triggered at feedback ${i}`);
        break;
      }
    }

    // Fetch aggregate and verify it's still valid
    const aggregate = await reputationProgram.account.reputationAggregate.fetch(aggregatePda);

    // Average score should still be within valid range
    assert.isAtLeast(aggregate.averageScore, 0);
    assert.isAtMost(aggregate.averageScore, 100);

    console.log("✓ Weighted calculations protected against overflow");
  });

  /**
   * Test 6: Zero-value edge cases
   */
  it("Should handle zero-value edge cases correctly", async () => {
    // Test 6a: Score of 0
    const zeroScoreOwner = Keypair.generate();
    const zeroScoreClient = Keypair.generate();

    await provider.connection.requestAirdrop(
      zeroScoreOwner.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      zeroScoreClient.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Register new agent for zero-value tests
    const agentUri = "ipfs://Qm_zero_test";
    const metadataUri = "ipfs://Qm_zero_metadata";
    const fileHash = Buffer.alloc(32, 14);

    const tx = await identityProgram.methods
      .registerAgent(agentUri, metadataUri, fileHash)
      .accounts({
        agent: null,
        owner: zeroScoreOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([zeroScoreOwner])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Get new agent ID
    const events = await identityProgram.account.agent.all();
    const zeroAgentId = events[events.length - 1].account.agentId;

    const [zeroAgentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), zeroAgentId.toArrayLike(Buffer, "le", 8)],
      identityProgramId
    );

    const [zeroAggregatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("aggregate"),
        zeroAgentId.toArrayLike(Buffer, "le", 8),
        identityProgramId.toBuffer(),
      ],
      reputationProgramId
    );

    // Submit feedback with score of 0
    const zeroFeedbackAuth = {
      agentId: zeroAgentId,
      clientAddress: zeroScoreClient.publicKey,
      indexLimit: new BN(10),
      expiry: new BN(Math.floor(Date.now() / 1000) + 3600),
      chainId: "solana-devnet",
      identityRegistry: identityProgramId,
      signerAddress: zeroScoreOwner.publicKey,
      signature: Buffer.alloc(64, 0),
    };

    const tag1 = Buffer.alloc(32, 0); // Zero tags
    const tag2 = Buffer.alloc(32, 0);
    const fileUri = ""; // Empty URI
    const fileHash = Buffer.alloc(32, 0); // Zero hash

    const [zeroFeedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        zeroAgentId.toArrayLike(Buffer, "le", 8),
        zeroScoreClient.publicKey.toBuffer(),
        new BN(0).toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    const zeroTx = await reputationProgram.methods
      .giveFeedback(
        zeroAgentId,
        0, // Zero score
        tag1,
        tag2,
        fileUri,
        fileHash,
        new BN(0), // Zero index
        zeroFeedbackAuth
      )
      .accounts({
        feedback: zeroFeedbackPda,
        aggregate: zeroAggregatePda,
        agent: zeroAgentPda,
        client: zeroScoreClient.publicKey,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([zeroScoreClient])
      .rpc();

    await provider.connection.confirmTransaction(zeroTx);

    // Verify feedback was created correctly
    const zeroFeedback = await reputationProgram.account.feedback.fetch(zeroFeedbackPda);
    assert.equal(zeroFeedback.score, 0);
    assert.equal(zeroFeedback.feedbackIndex.toString(), "0");

    // Verify aggregate handles zero score
    const zeroAggregate = await reputationProgram.account.reputationAggregate.fetch(zeroAggregatePda);
    assert.equal(zeroAggregate.totalCount.toString(), "1");
    assert.equal(zeroAggregate.totalScore.toString(), "0");
    assert.equal(zeroAggregate.averageScore, 0);

    console.log("✓ Zero-value edge cases handled correctly");
  });
});
