import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";

describe("Reputation Registry (ERC-8004 Phase 2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;
  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  // Test wallets
  let client1: Keypair;
  let client2: Keypair;
  let payer: Keypair;

  // Test agent
  let agent1Id: anchor.BN;
  let agent1Mint: Keypair;
  let agent1Pda: PublicKey;

  // PDAs
  let client1IndexPda: PublicKey;
  let client2IndexPda: PublicKey;
  let agent1ReputationPda: PublicKey;

  // Helper: Derive agent account PDA from Identity Registry
  function getAgentPda(agentId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), Buffer.from(new anchor.BN(agentId).toArray("le", 8))],
      identityProgram.programId
    );
  }

  // Helper: Derive client index PDA
  function getClientIndexPda(agentId: number, client: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("client_index"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        client.toBuffer(),
      ],
      reputationProgram.programId
    );
  }

  // Helper: Derive feedback PDA
  function getFeedbackPda(
    agentId: number,
    client: PublicKey,
    feedbackIndex: number
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        client.toBuffer(),
        Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  // Helper: Derive agent reputation metadata PDA
  function getAgentReputationPda(agentId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("agent_reputation"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  // Helper: Airdrop SOL to account
  async function airdrop(pubkey: PublicKey, amount: number = 2) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      amount * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  before(async () => {
    // Create test wallets
    client1 = Keypair.generate();
    client2 = Keypair.generate();
    payer = Keypair.generate();

    // Airdrop SOL
    await airdrop(client1.publicKey);
    await airdrop(client2.publicKey);
    await airdrop(payer.publicKey, 5);

    // Register agent1 in Identity Registry for testing
    // Note: This assumes Identity Registry is already initialized
    // For now, we'll create a mock agent ID and PDA
    agent1Id = new anchor.BN(0); // Assuming first agent
    [agent1Pda] = getAgentPda(0);

    // Derive reputation PDAs
    [client1IndexPda] = getClientIndexPda(0, client1.publicKey);
    [client2IndexPda] = getClientIndexPda(0, client2.publicKey);
    [agent1ReputationPda] = getAgentReputationPda(0);
  });

  describe("give_feedback", () => {
    it("✅ Successfully creates first feedback (index 0)", async () => {
      const score = 85;
      const tag1 = Buffer.alloc(32);
      tag1.write("quality");
      const tag2 = Buffer.alloc(32);
      tag2.write("responsive");
      const fileUri = "ipfs://QmTest123";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      try {
        await reputationProgram.methods
          .giveFeedback(
            agent1Id,
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex)
          )
          .accounts({
            client: client1.publicKey,
            payer: payer.publicKey,
            agentAccount: agent1Pda,
            clientIndex: client1IndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: agent1ReputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1, payer])
          .rpc();

        // Verify feedback account
        const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
        assert.equal(feedback.agentId.toNumber(), 0);
        assert.equal(feedback.clientAddress.toBase58(), client1.publicKey.toBase58());
        assert.equal(feedback.feedbackIndex.toNumber(), 0);
        assert.equal(feedback.score, 85);
        assert.equal(feedback.fileUri, fileUri);
        assert.equal(feedback.isRevoked, false);

        // Verify client index
        const clientIndex = await reputationProgram.account.clientIndexAccount.fetch(client1IndexPda);
        assert.equal(clientIndex.lastIndex.toNumber(), 1); // Next index

        // Verify reputation metadata
        const reputation = await reputationProgram.account.agentReputationMetadata.fetch(agent1ReputationPda);
        assert.equal(reputation.totalFeedbacks.toNumber(), 1);
        assert.equal(reputation.averageScore, 85);
      } catch (error) {
        console.error("Error details:", error);
        throw error;
      }
    });

    it("✅ Successfully creates second feedback (index 1) from same client", async () => {
      const score = 90;
      const tag1 = Buffer.alloc(32);
      tag1.write("excellent");
      const tag2 = Buffer.alloc(32);
      tag2.write("fast");
      const fileUri = "ipfs://QmTest456";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 1;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client1.publicKey,
          payer: payer.publicKey,
          agentAccount: agent1Pda,
          clientIndex: client1IndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1, payer])
        .rpc();

      // Verify feedback
      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      assert.equal(feedback.feedbackIndex.toNumber(), 1);
      assert.equal(feedback.score, 90);

      // Verify client index incremented
      const clientIndex = await reputationProgram.account.clientIndexAccount.fetch(client1IndexPda);
      assert.equal(clientIndex.lastIndex.toNumber(), 2);

      // Verify reputation updated (average of 85 and 90 = 87.5 -> 87)
      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(agent1ReputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 2);
      assert.equal(reputation.totalScoreSum.toNumber(), 175);
      assert.equal(reputation.averageScore, 87);
    });

    it("✅ Successfully creates feedback from different client (index 0 for client2)", async () => {
      const score = 95;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmTest789";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0; // Client2's first feedback

      const [feedbackPda] = getFeedbackPda(0, client2.publicKey, feedbackIndex);

      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client2.publicKey,
          payer: payer.publicKey,
          agentAccount: agent1Pda,
          clientIndex: client2IndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client2, payer])
        .rpc();

      // Verify independent indexing per client
      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      assert.equal(feedback.clientAddress.toBase58(), client2.publicKey.toBase58());
      assert.equal(feedback.feedbackIndex.toNumber(), 0); // Client2's first feedback

      // Verify client2 index
      const client2Index = await reputationProgram.account.clientIndexAccount.fetch(client2IndexPda);
      assert.equal(client2Index.lastIndex.toNumber(), 1);

      // Verify reputation includes all 3 feedbacks
      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(agent1ReputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 3);
    });

    it("✅ Supports sponsorship (different payer than client)", async () => {
      const sponsor = Keypair.generate();
      await airdrop(sponsor.publicKey, 2);

      const score = 75;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmSponsored";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 2;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      const sponsorBalanceBefore = await provider.connection.getBalance(sponsor.publicKey);
      const client1BalanceBefore = await provider.connection.getBalance(client1.publicKey);

      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client1.publicKey,
          payer: sponsor.publicKey, // Different from client
          agentAccount: agent1Pda,
          clientIndex: client1IndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1, sponsor])
        .rpc();

      // Verify sponsor paid for account creation
      const sponsorBalanceAfter = await provider.connection.getBalance(sponsor.publicKey);
      const client1BalanceAfter = await provider.connection.getBalance(client1.publicKey);

      // Sponsor balance decreased (paid rent)
      assert.isBelow(sponsorBalanceAfter, sponsorBalanceBefore);
      // Client balance unchanged (except tx fee)
      assert.approximately(client1BalanceAfter, client1BalanceBefore, 10000);
    });

    it("❌ Fails with invalid score (> 100)", async () => {
      const score = 101; // Invalid
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmInvalid";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 3;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      try {
        await reputationProgram.methods
          .giveFeedback(
            agent1Id,
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex)
          )
          .accounts({
            client: client1.publicKey,
            payer: payer.publicKey,
            agentAccount: agent1Pda,
            clientIndex: client1IndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: agent1ReputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1, payer])
          .rpc();

        assert.fail("Should have failed with InvalidScore");
      } catch (error: any) {
        assert.include(error.toString(), "InvalidScore");
      }
    });

    it("❌ Fails with URI too long (> 200 bytes)", async () => {
      const score = 80;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://" + "a".repeat(250); // 257 chars > 200 limit
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 3;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      try {
        await reputationProgram.methods
          .giveFeedback(
            agent1Id,
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex)
          )
          .accounts({
            client: client1.publicKey,
            payer: payer.publicKey,
            agentAccount: agent1Pda,
            clientIndex: client1IndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: agent1ReputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1, payer])
          .rpc();

        assert.fail("Should have failed with UriTooLong");
      } catch (error: any) {
        assert.include(error.toString(), "UriTooLong");
      }
    });

    it("❌ Fails with wrong feedback_index", async () => {
      const score = 80;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmWrong";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 99; // Wrong index (should be 3)

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      try {
        await reputationProgram.methods
          .giveFeedback(
            agent1Id,
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex)
          )
          .accounts({
            client: client1.publicKey,
            payer: payer.publicKey,
            agentAccount: agent1Pda,
            clientIndex: client1IndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: agent1ReputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1, payer])
          .rpc();

        assert.fail("Should have failed with InvalidFeedbackIndex");
      } catch (error: any) {
        assert.include(error.toString(), "InvalidFeedbackIndex");
      }
    });

    it("✅ Stores full bytes32 tags (ERC-8004 compliance)", async () => {
      const score = 88;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      // Fill with specific pattern to verify full 32 bytes stored
      for (let i = 0; i < 32; i++) {
        tag1[i] = i;
        tag2[i] = 255 - i;
      }
      const fileUri = "ipfs://QmTags";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 3;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client1.publicKey,
          payer: payer.publicKey,
          agentAccount: agent1Pda,
          clientIndex: client1IndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1, payer])
        .rpc();

      // Verify all 32 bytes stored correctly
      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      for (let i = 0; i < 32; i++) {
        assert.equal(feedback.tag1[i], i);
        assert.equal(feedback.tag2[i], 255 - i);
      }
    });

    it("✅ Handles score edge cases (0 and 100)", async () => {
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmEdge";
      const fileHash = Buffer.alloc(32);

      // Test score = 0
      const [feedback0Pda] = getFeedbackPda(0, client1.publicKey, 4);
      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          0,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(4)
        )
        .accounts({
          client: client1.publicKey,
          payer: payer.publicKey,
          agentAccount: agent1Pda,
          clientIndex: client1IndexPda,
          feedbackAccount: feedback0Pda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1, payer])
        .rpc();

      const feedback0 = await reputationProgram.account.feedbackAccount.fetch(feedback0Pda);
      assert.equal(feedback0.score, 0);

      // Test score = 100
      const [feedback100Pda] = getFeedbackPda(0, client1.publicKey, 5);
      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          100,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(5)
        )
        .accounts({
          client: client1.publicKey,
          payer: payer.publicKey,
          agentAccount: agent1Pda,
          clientIndex: client1IndexPda,
          feedbackAccount: feedback100Pda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1, payer])
        .rpc();

      const feedback100 = await reputationProgram.account.feedbackAccount.fetch(feedback100Pda);
      assert.equal(feedback100.score, 100);
    });

    it("✅ Handles empty file URI (ERC-8004 allows empty)", async () => {
      const score = 70;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = ""; // Empty URI
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 6;

      const [feedbackPda] = getFeedbackPda(0, client1.publicKey, feedbackIndex);

      await reputationProgram.methods
        .giveFeedback(
          agent1Id,
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client1.publicKey,
          payer: payer.publicKey,
          agentAccount: agent1Pda,
          clientIndex: client1IndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1, payer])
        .rpc();

      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      assert.equal(feedback.fileUri, "");
    });
  });
});
