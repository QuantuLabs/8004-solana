import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import { Metaplex, keypairIdentity } from "@metaplex-foundation/js";

/**
 * LOT 1: FeedbackAuth Tests
 *
 * Tests the ERC-8004 feedbackAuth signature system that prevents spam
 * by requiring agent owner authorization before clients can give feedback.
 *
 * Coverage:
 * 1. Valid feedbackAuth - client can submit feedback
 * 2. Expired feedbackAuth - fails after expiry timestamp
 * 3. Wrong client_address - fails if client doesn't match auth
 * 4. Index limit exceeded - fails when client exceeds authorized limit
 * 5. Wrong signer - fails if signer is not agent owner
 * 6. Multiple clients - different clients can have independent auths
 * 7. FeedbackAuth reuse - same auth can be used for multiple feedbacks within limit
 * 8. Sequential index validation - ensures feedbacks respect index ordering
 */
describe("Reputation Registry - FeedbackAuth Tests (LOT 1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;
  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const metaplex = Metaplex.make(provider.connection).use(keypairIdentity(provider.wallet as any));

  // Test wallets
  let agentOwner: Keypair;
  let client1: Keypair;
  let client2: Keypair;
  let unauthorized: Keypair;
  let payer: Keypair;

  // Agent data
  let agentMint: PublicKey;
  let agentId: number = 1;
  let agentPda: PublicKey;

  // Helper: Airdrop SOL
  async function airdrop(pubkey: PublicKey, amount: number = 2) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      amount * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  // Helper: Create FeedbackAuth object
  function createFeedbackAuth(
    agentId: number,
    clientAddress: PublicKey,
    indexLimit: number,
    expiryOffset: number, // seconds from now
    signerAddress: PublicKey
  ): any {
    const now = Math.floor(Date.now() / 1000);
    return {
      agentId: new anchor.BN(agentId),
      clientAddress: clientAddress,
      indexLimit: new anchor.BN(indexLimit),
      expiry: new anchor.BN(now + expiryOffset),
      chainId: "solana-localnet",
      identityRegistry: identityProgram.programId,
      signerAddress: signerAddress,
      signature: Buffer.alloc(64), // Mock signature (Ed25519 verification is TODO)
    };
  }

  // Helper: Get PDAs
  function getAgentPda(agentMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );
  }

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

  function getAgentReputationPda(agentId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("agent_reputation"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  before(async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Initialize wallets
    agentOwner = Keypair.generate();
    client1 = Keypair.generate();
    client2 = Keypair.generate();
    unauthorized = Keypair.generate();
    payer = Keypair.generate();

    // Airdrop SOL
    await airdrop(agentOwner.publicKey, 5);
    await airdrop(client1.publicKey, 3);
    await airdrop(client2.publicKey, 3);
    await airdrop(unauthorized.publicKey, 3);
    await airdrop(payer.publicKey, 5);

    console.log("✅ Wallets funded");

    // Create agent NFT using Metaplex
    try {
      const { nft } = await metaplex.nfts().create({
        uri: "https://example.com/agent-metadata.json",
        name: "Test Agent",
        sellerFeeBasisPoints: 0,
        updateAuthority: agentOwner,
      });

      agentMint = nft.address;
      console.log(`✅ Agent NFT created: ${agentMint.toBase58()}`);
    } catch (err) {
      console.error("❌ Failed to create NFT:", err);
      throw err;
    }

    // Derive agent PDA
    [agentPda] = getAgentPda(agentMint);

    // Register agent in Identity Registry
    try {
      await identityProgram.methods
        .registerAgent(new anchor.BN(agentId), "Test Agent", "https://example.com")
        .accounts({
          owner: agentOwner.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([agentOwner])
        .rpc();

      console.log(`✅ Agent registered: ID=${agentId}, PDA=${agentPda.toBase58()}`);
    } catch (err) {
      console.error("❌ Failed to register agent:", err);
      throw err;
    }

    console.log("\n🎯 Test environment ready!\n");
  });

  describe("FeedbackAuth Validation", () => {
    it("✅ Test 1: Valid feedbackAuth allows feedback submission", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        5, // Can submit up to 5 feedbacks
        3600, // Valid for 1 hour
        agentOwner.publicKey // Signed by agent owner
      );

      const score = 85;
      const tag1 = Buffer.alloc(32);
      tag1.write("quality");
      const tag2 = Buffer.alloc(32);
      tag2.write("responsive");
      const fileUri = "ipfs://QmTest1";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0;

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agentId);

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex),
          feedbackAuth
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      assert.equal(feedback.score, 85);
      assert.equal(feedback.feedbackIndex.toNumber(), 0);
      console.log("✅ Feedback submitted with valid auth");
    });

    it("❌ Test 2: Expired feedbackAuth fails", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client2.publicKey,
        5,
        -3600, // Expired 1 hour ago
        agentOwner.publicKey
      );

      const score = 90;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmTest2";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0;

      const [clientIndexPda] = getClientIndexPda(agentId, client2.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client2.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agentId);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex),
            feedbackAuth
          )
          .accounts({
            client: client2.publicKey,
            payer: client2.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client2])
          .rpc();

        assert.fail("Should have failed with expired auth");
      } catch (err: any) {
        assert.include(err.toString(), "FeedbackAuthExpired");
        console.log("✅ Correctly rejected expired feedbackAuth");
      }
    });

    it("❌ Test 3: Wrong client_address fails", async () => {
      // Auth for client2, but client1 tries to use it
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client2.publicKey, // Auth for client2
        5,
        3600,
        agentOwner.publicKey
      );

      const score = 75;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmTest3";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 1; // client1's next index

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agentId);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex),
            feedbackAuth
          )
          .accounts({
            client: client1.publicKey, // client1 signing, but auth is for client2
            payer: client1.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with client mismatch");
      } catch (err: any) {
        assert.include(err.toString(), "FeedbackAuthClientMismatch");
        console.log("✅ Correctly rejected mismatched client");
      }
    });

    it("❌ Test 4: Index limit exceeded fails", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client2.publicKey,
        1, // Only 1 feedback allowed (index 0)
        3600,
        agentOwner.publicKey
      );

      // First feedback should succeed (index 0)
      const score1 = 80;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri1 = "ipfs://QmTest4a";
      const fileHash = Buffer.alloc(32);

      const [clientIndexPda] = getClientIndexPda(agentId, client2.publicKey);
      const [feedbackPda1] = getFeedbackPda(agentId, client2.publicKey, 0);
      const [reputationPda] = getAgentReputationPda(agentId);

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          score1,
          Array.from(tag1),
          Array.from(tag2),
          fileUri1,
          Array.from(fileHash),
          new anchor.BN(0),
          feedbackAuth
        )
        .accounts({
          client: client2.publicKey,
          payer: client2.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda1,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client2])
        .rpc();

      console.log("✅ First feedback succeeded (index 0)");

      // Second feedback should fail (index 1, exceeds limit of 1)
      const [feedbackPda2] = getFeedbackPda(agentId, client2.publicKey, 1);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            85,
            Array.from(tag1),
            Array.from(tag2),
            "ipfs://QmTest4b",
            Array.from(fileHash),
            new anchor.BN(1),
            feedbackAuth
          )
          .accounts({
            client: client2.publicKey,
            payer: client2.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda2,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client2])
          .rpc();

        assert.fail("Should have failed with index limit exceeded");
      } catch (err: any) {
        assert.include(err.toString(), "FeedbackAuthIndexLimitExceeded");
        console.log("✅ Correctly rejected feedback beyond index limit");
      }
    });

    it("❌ Test 5: Unauthorized signer (not agent owner) fails", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        5,
        3600,
        unauthorized.publicKey // Wrong signer (not agent owner)
      );

      const score = 70;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmTest5";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 1;

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agentId);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            score,
            Array.from(tag1),
            Array.from(tag2),
            fileUri,
            Array.from(fileHash),
            new anchor.BN(feedbackIndex),
            feedbackAuth
          )
          .accounts({
            client: client1.publicKey,
            payer: client1.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with unauthorized signer");
      } catch (err: any) {
        assert.include(err.toString(), "UnauthorizedSigner");
        console.log("✅ Correctly rejected unauthorized signer");
      }
    });

    it("✅ Test 6: Multiple clients with independent index limits", async () => {
      // This test demonstrates that different clients can have different limits
      // and their indices are tracked independently

      // Already tested in previous tests - client1 has higher limit (5),
      // client2 has lower limit (1)

      // Verify client1 can still submit (has submitted 1, limit is 5)
      const feedbackAuth1 = createFeedbackAuth(
        agentId,
        client1.publicKey,
        5,
        3600,
        agentOwner.publicKey
      );

      const [clientIndexPda1] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda1] = getFeedbackPda(agentId, client1.publicKey, 1);
      const [reputationPda] = getAgentReputationPda(agentId);

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          88,
          Array.from(Buffer.alloc(32)),
          Array.from(Buffer.alloc(32)),
          "ipfs://QmTest6",
          Array.from(Buffer.alloc(32)),
          new anchor.BN(1),
          feedbackAuth1
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          clientIndex: clientIndexPda1,
          feedbackAccount: feedbackPda1,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      console.log("✅ Multiple clients can have independent limits");
    });

    it("✅ Test 7: Same feedbackAuth can be reused within limit", async () => {
      // Client1 has submitted 2 feedbacks so far (indices 0, 1)
      // Auth allows up to 5, so can submit 3 more
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        5,
        3600,
        agentOwner.publicKey
      );

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Submit feedback at index 2
      const [feedbackPda2] = getFeedbackPda(agentId, client1.publicKey, 2);
      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          92,
          Array.from(Buffer.alloc(32)),
          Array.from(Buffer.alloc(32)),
          "ipfs://QmTest7a",
          Array.from(Buffer.alloc(32)),
          new anchor.BN(2),
          feedbackAuth
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda2,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      // Submit feedback at index 3 (same auth, still within limit)
      const [feedbackPda3] = getFeedbackPda(agentId, client1.publicKey, 3);
      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          95,
          Array.from(Buffer.alloc(32)),
          Array.from(Buffer.alloc(32)),
          "ipfs://QmTest7b",
          Array.from(Buffer.alloc(32)),
          new anchor.BN(3),
          feedbackAuth
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda3,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      console.log("✅ FeedbackAuth successfully reused for multiple feedbacks");
    });

    it("✅ Test 8: Sequential index validation with feedbackAuth", async () => {
      // Verify that feedbackAuth respects sequential index validation
      // Client1 has submitted up to index 3, next must be 4
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        10, // Higher limit
        3600,
        agentOwner.publicKey
      );

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda4] = getFeedbackPda(agentId, client1.publicKey, 4);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Submit at correct index (4)
      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          89,
          Array.from(Buffer.alloc(32)),
          Array.from(Buffer.alloc(32)),
          "ipfs://QmTest8",
          Array.from(Buffer.alloc(32)),
          new anchor.BN(4),
          feedbackAuth
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda4,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      // Try to skip index (submit at index 6 instead of 5) - should fail
      const [feedbackPda6] = getFeedbackPda(agentId, client1.publicKey, 6);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            91,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmTest8bad",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(6), // Skipping index 5
            feedbackAuth
          )
          .accounts({
            client: client1.publicKey,
            payer: client1.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda6,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with invalid index");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidFeedbackIndex");
        console.log("✅ Sequential index validation works with feedbackAuth");
      }
    });
  });
});
