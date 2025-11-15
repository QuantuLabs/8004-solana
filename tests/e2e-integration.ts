import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  ComputeBudgetProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ReputationRegistry } from "../target/types/reputation_registry";

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

describe("E2E Integration: Identity Registry + Reputation Registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;

  // Identity Registry state
  let configPda: PublicKey;
  let collectionMint: Keypair;
  let collectionMetadata: PublicKey;
  let collectionMasterEdition: PublicKey;
  let collectionTokenAccount: PublicKey;

  // Test agents
  let agent1Mint: Keypair;
  let agent1Pda: PublicKey;
  let agent1Metadata: PublicKey;
  let agent1MasterEdition: PublicKey;
  let agent1TokenAccount: PublicKey;
  let agent1Id: number = 0;

  // Test clients
  let client1: Keypair;
  let client2: Keypair;
  let client3: Keypair;
  let sponsor: Keypair; // For sponsored feedback

  // Helper: Derive Metaplex metadata PDA
  function getMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  // Helper: Derive Metaplex master edition PDA
  function getMasterEditionPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer(), Buffer.from("edition")],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  // Helper: Derive agent account PDA
  function getAgentPda(agentMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );
  }

  // Helper: Derive agent by ID PDA
  function getAgentByIdPda(agentId: number): [PublicKey, number] {
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
  function getFeedbackPda(agentId: number, client: PublicKey, feedbackIndex: number): [PublicKey, number] {
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

  // Helper: Derive agent reputation PDA
  function getAgentReputationPda(agentId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent_reputation"), Buffer.from(new anchor.BN(agentId).toArray("le", 8))],
      reputationProgram.programId
    );
  }

  // Helper: Derive response index PDA
  function getResponseIndexPda(agentId: number, client: PublicKey, feedbackIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("response_index"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        client.toBuffer(),
        Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  // Helper: Derive response PDA
  function getResponsePda(
    agentId: number,
    client: PublicKey,
    feedbackIndex: number,
    responseIndex: number
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("response"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        client.toBuffer(),
        Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
        Buffer.from(new anchor.BN(responseIndex).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  // Helper: Airdrop SOL
  async function airdrop(pubkey: PublicKey, amount: number = 2) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      amount * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  before(async () => {
    // Initialize wallets
    client1 = Keypair.generate();
    client2 = Keypair.generate();
    client3 = Keypair.generate();
    sponsor = Keypair.generate();

    // Airdrop SOL
    await airdrop(client1.publicKey, 2);
    await airdrop(client2.publicKey, 2);
    await airdrop(client3.publicKey, 2);
    await airdrop(sponsor.publicKey, 5);

    // Derive config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      identityProgram.programId
    );
  });

  describe("Setup: Initialize Identity Registry", () => {
    it("✅ Initializes Identity Registry with Collection NFT", async () => {
      collectionMint = Keypair.generate();
      collectionMetadata = getMetadataPda(collectionMint.publicKey);
      collectionMasterEdition = getMasterEditionPda(collectionMint.publicKey);
      collectionTokenAccount = getAssociatedTokenAddressSync(
        collectionMint.publicKey,
        provider.wallet.publicKey
      );

      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

      const initIx = await identityProgram.methods
        .initialize()
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionMasterEdition: collectionMasterEdition,
          collectionTokenAccount: collectionTokenAccount,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .instruction();

      const tx = new Transaction().add(computeBudgetIx, initIx);
      await provider.sendAndConfirm(tx, [collectionMint]);

      const config = await identityProgram.account.registryConfig.fetch(configPda);
      assert.equal(config.nextAgentId.toNumber(), 0);
      assert.equal(config.totalAgents.toNumber(), 0);
    });
  });

  describe("Setup: Register Agent via Identity Registry", () => {
    it("✅ Registers agent #0 with metadata", async () => {
      agent1Mint = Keypair.generate();
      [agent1Pda] = getAgentPda(agent1Mint.publicKey);
      agent1Metadata = getMetadataPda(agent1Mint.publicKey);
      agent1MasterEdition = getMasterEditionPda(agent1Mint.publicKey);
      agent1TokenAccount = getAssociatedTokenAddressSync(
        agent1Mint.publicKey,
        provider.wallet.publicKey
      );

      const tokenUri = "ipfs://QmAgentMetadata";
      const metadata = [
        { key: "name", value: Buffer.from("Alice AI") },
        { key: "type", value: Buffer.from("customer_support") },
      ];

      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

      const registerIx = await identityProgram.methods
        .registerWithMetadata(tokenUri, metadata)
        .accounts({
          owner: provider.wallet.publicKey,
          config: configPda,
          agentAccount: agent1Pda,
          agentMint: agent1Mint.publicKey,
          agentMetadata: agent1Metadata,
          agentMasterEdition: agent1MasterEdition,
          agentTokenAccount: agent1TokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionMasterEdition: collectionMasterEdition,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .instruction();

      const tx = new Transaction().add(computeBudgetIx, registerIx);
      await provider.sendAndConfirm(tx, [agent1Mint]);

      const agent = await identityProgram.account.agentAccount.fetch(agent1Pda);
      assert.equal(agent.agentId.toNumber(), 0);
      assert.equal(agent.owner.toBase58(), provider.wallet.publicKey.toBase58());
      assert.equal(agent.tokenUri, tokenUri);

      agent1Id = agent.agentId.toNumber();
      console.log(`      Agent registered: ID=${agent1Id}, Mint=${agent1Mint.publicKey.toBase58()}`);
    });
  });

  describe("E2E Flow: Give Feedback", () => {
    it("✅ Client1 gives first feedback (score 85)", async () => {
      const score = 85;
      const tag1 = Buffer.alloc(32);
      tag1.write("quality");
      const tag2 = Buffer.alloc(32);
      tag2.write("responsive");
      const fileUri = "ipfs://QmFeedback1";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0;

      const [clientIndexPda] = getClientIndexPda(agent1Id, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agent1Id, client1.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agent1Id);
      const [agentAccountPda] = getAgentByIdPda(agent1Id);

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agent1Id),
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentAccount: agentAccountPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      // Verify feedback
      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      assert.equal(feedback.score, 85);
      assert.equal(feedback.isRevoked, false);

      // Verify reputation
      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 1);
      assert.equal(reputation.averageScore, 85);

      console.log(`      Feedback given: score=${score}, avg=${reputation.averageScore}`);
    });

    it("✅ Client2 gives feedback with sponsorship (score 90)", async () => {
      const score = 90;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmFeedback2";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0;

      const [clientIndexPda] = getClientIndexPda(agent1Id, client2.publicKey);
      const [feedbackPda] = getFeedbackPda(agent1Id, client2.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agent1Id);
      const [agentAccountPda] = getAgentByIdPda(agent1Id);

      const sponsorBalanceBefore = await provider.connection.getBalance(sponsor.publicKey);

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agent1Id),
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client2.publicKey,
          payer: sponsor.publicKey, // Sponsor pays
          agentAccount: agentAccountPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client2, sponsor])
        .rpc();

      const sponsorBalanceAfter = await provider.connection.getBalance(sponsor.publicKey);
      assert.isBelow(sponsorBalanceAfter, sponsorBalanceBefore);

      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 2);
      // Average: (85 + 90) / 2 = 87.5 -> 87
      assert.equal(reputation.averageScore, 87);

      console.log(`      Sponsored feedback: score=${score}, sponsor paid rent`);
    });

    it("✅ Client3 gives low score (score 60)", async () => {
      const score = 60;
      const tag1 = Buffer.alloc(32);
      const tag2 = Buffer.alloc(32);
      const fileUri = "ipfs://QmFeedback3";
      const fileHash = Buffer.alloc(32);
      const feedbackIndex = 0;

      const [clientIndexPda] = getClientIndexPda(agent1Id, client3.publicKey);
      const [feedbackPda] = getFeedbackPda(agent1Id, client3.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agent1Id);
      const [agentAccountPda] = getAgentByIdPda(agent1Id);

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agent1Id),
          score,
          Array.from(tag1),
          Array.from(tag2),
          fileUri,
          Array.from(fileHash),
          new anchor.BN(feedbackIndex)
        )
        .accounts({
          client: client3.publicKey,
          payer: client3.publicKey,
          agentAccount: agentAccountPda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client3])
        .rpc();

      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 3);
      // Average: (85 + 90 + 60) / 3 = 78.33 -> 78
      assert.equal(reputation.averageScore, 78);

      console.log(`      Low score feedback: avg dropped to ${reputation.averageScore}`);
    });
  });

  describe("E2E Flow: Revoke Feedback", () => {
    it("✅ Client3 revokes their low score feedback", async () => {
      const feedbackIndex = 0;
      const [feedbackPda] = getFeedbackPda(agent1Id, client3.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agent1Id);

      await reputationProgram.methods
        .revokeFeedback(new anchor.BN(agent1Id), new anchor.BN(feedbackIndex))
        .accounts({
          client: client3.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
        })
        .signers([client3])
        .rpc();

      // Verify revocation
      const feedback = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
      assert.equal(feedback.isRevoked, true);

      // Verify reputation updated (excludes revoked)
      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 2); // Excluded revoked
      // Average: (85 + 90) / 2 = 87.5 -> 87
      assert.equal(reputation.averageScore, 87);

      console.log(`      Feedback revoked: avg increased to ${reputation.averageScore}`);
    });

    it("❌ Client1 cannot revoke Client2's feedback", async () => {
      const feedbackIndex = 0;
      const [feedbackPda] = getFeedbackPda(agent1Id, client2.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agent1Id);

      try {
        await reputationProgram.methods
          .revokeFeedback(new anchor.BN(agent1Id), new anchor.BN(feedbackIndex))
          .accounts({
            client: client1.publicKey, // Wrong client
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
          })
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with Unauthorized");
      } catch (error: any) {
        assert.include(error.toString(), "Unauthorized");
        console.log(`      ✓ Correctly rejected unauthorized revocation`);
      }
    });
  });

  describe("E2E Flow: Append Response", () => {
    it("✅ Agent owner responds to Client1's feedback", async () => {
      const client = client1.publicKey;
      const feedbackIndex = 0;
      const responseUri = "ipfs://QmResponse1";
      const responseHash = Buffer.alloc(32);

      const [feedbackPda] = getFeedbackPda(agent1Id, client, feedbackIndex);
      const [responseIndexPda] = getResponseIndexPda(agent1Id, client, feedbackIndex);
      const [responsePda] = getResponsePda(agent1Id, client, feedbackIndex, 0);

      await reputationProgram.methods
        .appendResponse(
          new anchor.BN(agent1Id),
          client,
          new anchor.BN(feedbackIndex),
          responseUri,
          Array.from(responseHash)
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

      // Verify response
      const response = await reputationProgram.account.responseAccount.fetch(responsePda);
      assert.equal(response.responseUri, responseUri);
      assert.equal(response.responder.toBase58(), provider.wallet.publicKey.toBase58());

      // Verify response index
      const responseIndex = await reputationProgram.account.responseIndexAccount.fetch(responseIndexPda);
      assert.equal(responseIndex.nextIndex.toNumber(), 1);

      console.log(`      Agent responded to feedback`);
    });

    it("✅ Third party appends response (spam flag)", async () => {
      const client = client2.publicKey;
      const feedbackIndex = 0;
      const responseUri = "ipfs://QmSpamFlag";
      const responseHash = Buffer.alloc(32);

      const [feedbackPda] = getFeedbackPda(agent1Id, client, feedbackIndex);
      const [responseIndexPda] = getResponseIndexPda(agent1Id, client, feedbackIndex);
      const [responsePda] = getResponsePda(agent1Id, client, feedbackIndex, 0);

      await reputationProgram.methods
        .appendResponse(
          new anchor.BN(agent1Id),
          client,
          new anchor.BN(feedbackIndex),
          responseUri,
          Array.from(responseHash)
        )
        .accounts({
          responder: client3.publicKey, // Third party
          payer: client3.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([client3])
        .rpc();

      const response = await reputationProgram.account.responseAccount.fetch(responsePda);
      assert.equal(response.responder.toBase58(), client3.publicKey.toBase58());

      console.log(`      Third party flagged feedback as spam`);
    });

    it("✅ Multiple responses to same feedback", async () => {
      const client = client1.publicKey;
      const feedbackIndex = 0;
      const responseUri = "ipfs://QmResponse2";
      const responseHash = Buffer.alloc(32);

      const [feedbackPda] = getFeedbackPda(agent1Id, client, feedbackIndex);
      const [responseIndexPda] = getResponseIndexPda(agent1Id, client, feedbackIndex);
      const [responsePda] = getResponsePda(agent1Id, client, feedbackIndex, 1); // Second response

      await reputationProgram.methods
        .appendResponse(
          new anchor.BN(agent1Id),
          client,
          new anchor.BN(feedbackIndex),
          responseUri,
          Array.from(responseHash)
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

      const responseIndex = await reputationProgram.account.responseIndexAccount.fetch(responseIndexPda);
      assert.equal(responseIndex.nextIndex.toNumber(), 2);

      console.log(`      Multiple responses: count=${responseIndex.nextIndex.toNumber()}`);
    });
  });

  describe("E2E Summary: Final State", () => {
    it("✅ Verifies final reputation state", async () => {
      const [reputationPda] = getAgentReputationPda(agent1Id);
      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);

      console.log(`\n      📊 Final Reputation for Agent #${agent1Id}:`);
      console.log(`         Total feedbacks (non-revoked): ${reputation.totalFeedbacks.toNumber()}`);
      console.log(`         Average score: ${reputation.averageScore}/100`);
      console.log(`         Total score sum: ${reputation.totalScoreSum.toNumber()}`);

      assert.equal(reputation.totalFeedbacks.toNumber(), 2);
      assert.equal(reputation.averageScore, 87);
    });

    it("✅ Lists all feedback accounts created", async () => {
      console.log(`\n      📋 Feedback Records:`);

      // Client1 feedback
      const [feedback1Pda] = getFeedbackPda(agent1Id, client1.publicKey, 0);
      const feedback1 = await reputationProgram.account.feedbackAccount.fetch(feedback1Pda);
      console.log(`         Client1: score=${feedback1.score}, revoked=${feedback1.isRevoked}`);

      // Client2 feedback
      const [feedback2Pda] = getFeedbackPda(agent1Id, client2.publicKey, 0);
      const feedback2 = await reputationProgram.account.feedbackAccount.fetch(feedback2Pda);
      console.log(`         Client2: score=${feedback2.score}, revoked=${feedback2.isRevoked}`);

      // Client3 feedback (revoked)
      const [feedback3Pda] = getFeedbackPda(agent1Id, client3.publicKey, 0);
      const feedback3 = await reputationProgram.account.feedbackAccount.fetch(feedback3Pda);
      console.log(`         Client3: score=${feedback3.score}, revoked=${feedback3.isRevoked}`);

      assert.equal(feedback1.isRevoked, false);
      assert.equal(feedback2.isRevoked, false);
      assert.equal(feedback3.isRevoked, true); // Revoked
    });

    it("✅ Lists all response counts", async () => {
      console.log(`\n      💬 Response Counts:`);

      // Client1 feedback has 2 responses
      const [response1IndexPda] = getResponseIndexPda(agent1Id, client1.publicKey, 0);
      const response1Index = await reputationProgram.account.responseIndexAccount.fetch(response1IndexPda);
      console.log(`         Client1 feedback: ${response1Index.nextIndex.toNumber()} responses`);

      // Client2 feedback has 1 response
      const [response2IndexPda] = getResponseIndexPda(agent1Id, client2.publicKey, 0);
      const response2Index = await reputationProgram.account.responseIndexAccount.fetch(response2IndexPda);
      console.log(`         Client2 feedback: ${response2Index.nextIndex.toNumber()} response`);

      assert.equal(response1Index.nextIndex.toNumber(), 2);
      assert.equal(response2Index.nextIndex.toNumber(), 1);
    });
  });
});
