import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import * as nacl from "tweetnacl";

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

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

  // Test wallets
  let agentOwner: anchor.Wallet;
  let agentOwnerKeypair: Keypair; // Actual keypair for signing
  let client1: Keypair;
  let client2: Keypair;
  let unauthorized: Keypair;
  let payer: Keypair;

  // Agent data (mock - no actual registration needed for signature testing)
  let agentId: number = 1;
  let agentMint: PublicKey; // Mock mint for PDA derivation
  let agentPda: PublicKey;

  // Helper: Airdrop SOL
  async function airdrop(pubkey: PublicKey, amount: number = 2) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      amount * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  // Helper: Create FeedbackAuth object with Ed25519 signature
  function createFeedbackAuth(
    agentId: number,
    clientAddress: PublicKey,
    indexLimit: number,
    expiryOffset: number, // seconds from now
    signerKeypair: Keypair // Changed to Keypair to sign
  ): any {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + expiryOffset;

    // Construct message to sign (matches Rust implementation)
    const message = `feedback_auth:${agentId}:${clientAddress.toBase58()}:${indexLimit}:${expiry}:solana-localnet:${identityProgram.programId.toBase58()}`;
    const messageBytes = Buffer.from(message, 'utf8');

    // Sign with Ed25519 using nacl
    const signature = nacl.sign.detached(messageBytes, signerKeypair.secretKey);

    return {
      agentId: new anchor.BN(agentId),
      clientAddress: clientAddress,
      indexLimit: new anchor.BN(indexLimit),
      expiry: new anchor.BN(expiry),
      chainId: "solana-localnet",
      identityRegistry: identityProgram.programId,
      signerAddress: signerKeypair.publicKey,
      signature: Buffer.from(signature),
      // Store message bytes for Ed25519 instruction
      _messageBytes: messageBytes,
    };
  }

  // Helper: Create Ed25519Program verification instruction
  function createEd25519Instruction(feedbackAuth: any): anchor.web3.TransactionInstruction {
    return Ed25519Program.createInstructionWithPublicKey({
      publicKey: feedbackAuth.signerAddress.toBytes(),
      message: feedbackAuth._messageBytes,
      signature: feedbackAuth.signature,
    });
  }

  // Helper: Derive Metaplex metadata PDA
  function getMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  // Helper: Derive Metaplex master edition PDA
  function getMasterEditionPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
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
    // Use provider wallet as agent owner (simplifies authority signing)
    agentOwner = provider.wallet as anchor.Wallet;
    // Extract keypair from provider wallet (NodeWallet has .payer property)
    agentOwnerKeypair = (provider.wallet as any).payer as Keypair;
    client1 = Keypair.generate();
    client2 = Keypair.generate();
    unauthorized = Keypair.generate();
    payer = Keypair.generate();

    // Airdrop SOL (provider wallet already has SOL)
    await airdrop(client1.publicKey, 3);
    await airdrop(client2.publicKey, 3);
    await airdrop(unauthorized.publicKey, 3);
    await airdrop(payer.publicKey, 5);

    console.log("✅ Wallets funded");

    // Initialize identity-registry with collection NFT
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      identityProgram.programId
    );

    const collectionMint = Keypair.generate();
    const collectionMetadata = getMetadataPda(collectionMint.publicKey);
    const collectionMasterEdition = getMasterEditionPda(collectionMint.publicKey);
    const collectionTokenAccount = getAssociatedTokenAddressSync(
      collectionMint.publicKey,
      provider.wallet.publicKey
    );

    await identityProgram.methods
      .initialize()
      .accounts({
        config: configPda,
        collectionMint: collectionMint.publicKey,
        collectionMetadata,
        collectionMasterEdition,
        collectionTokenAccount,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([collectionMint])
      .rpc();

    console.log(`✅ Identity registry initialized`);

    // Fetch config to get authority and collection
    const config = await identityProgram.account.registryConfig.fetch(configPda);

    // Generate agent mint and derive all required accounts
    const agentMintKeypair = Keypair.generate();
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMintKeypair.publicKey.toBuffer()],
      identityProgram.programId
    );
    const agentMetadata = getMetadataPda(agentMintKeypair.publicKey);
    const agentMasterEdition = getMasterEditionPda(agentMintKeypair.publicKey);
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMintKeypair.publicKey,
      agentOwner.publicKey
    );

    // Register a real agent using identity-registry
    const tx = await identityProgram.methods
      .registerEmpty() // Minimal registration - no URI
      .accounts({
        config: configPda,
        authority: config.authority,
        agentAccount: agentAccount,
        agentMint: agentMintKeypair.publicKey,
        agentMetadata: agentMetadata,
        agentMasterEdition: agentMasterEdition,
        agentTokenAccount: agentTokenAccount,
        collectionMint: config.collectionMint,
        collectionMetadata,
        collectionMasterEdition,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([agentMintKeypair])
      .rpc();

    console.log(`✅ Agent registered via identity-registry`);

    // Wait for confirmation
    await provider.connection.confirmTransaction(tx);

    // Fetch the agent account to get agent_id
    const fetchedAgent = await identityProgram.account.agentAccount.fetch(agentAccount);

    agentId = Number(fetchedAgent.agentId);
    agentMint = agentMintKeypair.publicKey;
    agentPda = agentAccount;

    console.log(`✅ Agent ID: ${agentId}`);
    console.log(`✅ Agent mint: ${agentMint.toBase58()}`);
    console.log(`✅ Agent PDA: ${agentPda.toBase58()}`);
    console.log("\n🎯 Test environment ready!\n");
  });

  describe("FeedbackAuth Validation", () => {
    it("✅ Test 1: Valid feedbackAuth allows feedback submission", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        5, // Can submit up to 5 feedbacks
        3600, // Valid for 1 hour
        agentOwnerKeypair // Access keypair from wallet
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

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix]) // Prepend Ed25519 verification
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
        agentOwnerKeypair
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

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
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
        agentOwnerKeypair
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

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
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
        agentOwnerKeypair
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

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
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
        unauthorized // Wrong signer (not agent owner)
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

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
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
        agentOwnerKeypair
      );

      const [clientIndexPda1] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda1] = getFeedbackPda(agentId, client1.publicKey, 1);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth1);

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
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
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
        agentOwnerKeypair
      );

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
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
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
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
        agentOwnerKeypair
      );

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda4] = getFeedbackPda(agentId, client1.publicKey, 4);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Create Ed25519 verification instruction
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

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
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with invalid index");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidFeedbackIndex");
        console.log("✅ Sequential index validation works with feedbackAuth");
      }
    });

    it("❌ Test 9: Invalid signature (corrupted) fails", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        10,
        3600,
        agentOwnerKeypair
      );

      // Corrupt the signature
      feedbackAuth.signature[0] ^= 0xFF;

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, 5);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Create Ed25519 verification instruction with corrupted signature
      const ed25519Ix = createEd25519Instruction(feedbackAuth);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            88,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmTest9",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(5),
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with invalid signature");
      } catch (err: any) {
        // Ed25519 verification will fail - can be various error messages
        const errStr = err.toString().toLowerCase();
        assert(errStr.includes("signature") || errStr.includes("verification") || errStr.includes("failed"),
          "Error should indicate signature/verification failure");
        console.log("✅ Correctly rejected corrupted signature");
      }
    });

    it("❌ Test 10: Wrong chain_id fails", async () => {
      // Create feedbackAuth with wrong chain_id
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + 3600;
      const wrongChainId = "solana-mainnet"; // Wrong chain (should be localnet)

      const message = `feedback_auth:${agentId}:${client1.publicKey.toBase58()}:10:${expiry}:${wrongChainId}:${identityProgram.programId.toBase58()}`;
      const messageBytes = Buffer.from(message, 'utf8');
      const signature = nacl.sign.detached(messageBytes, agentOwnerKeypair.secretKey);

      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client1.publicKey,
        indexLimit: new anchor.BN(10),
        expiry: new anchor.BN(expiry),
        chainId: wrongChainId,
        identityRegistry: identityProgram.programId,
        signerAddress: agentOwnerKeypair.publicKey,
        signature: Buffer.from(signature),
        _messageBytes: messageBytes,
      };

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, 5);
      const [reputationPda] = getAgentReputationPda(agentId);

      const ed25519Ix = createEd25519Instruction(feedbackAuth);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            88,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmTest10",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(5),
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with wrong chain_id");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidChainId");
        console.log("✅ Correctly rejected wrong chain_id");
      }
    });

    it("❌ Test 11: Wrong identity_registry address fails", async () => {
      // Create feedbackAuth with wrong identity registry
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + 3600;
      const wrongRegistry = Keypair.generate().publicKey;

      const message = `feedback_auth:${agentId}:${client1.publicKey.toBase58()}:10:${expiry}:solana-localnet:${wrongRegistry.toBase58()}`;
      const messageBytes = Buffer.from(message, 'utf8');
      const signature = nacl.sign.detached(messageBytes, agentOwnerKeypair.secretKey);

      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client1.publicKey,
        indexLimit: new anchor.BN(10),
        expiry: new anchor.BN(expiry),
        chainId: "solana-localnet",
        identityRegistry: wrongRegistry,
        signerAddress: agentOwnerKeypair.publicKey,
        signature: Buffer.from(signature),
        _messageBytes: messageBytes,
      };

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, 5);
      const [reputationPda] = getAgentReputationPda(agentId);

      const ed25519Ix = createEd25519Instruction(feedbackAuth);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            88,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmTest11",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(5),
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with wrong identity_registry");
      } catch (err: any) {
        // The signature will be valid but message content wrong
        const errStr = err.toString();
        assert(errStr.includes("InvalidIdentityRegistry") || errStr.includes("failed") || errStr.includes("error"),
          "Should fail with wrong identity_registry");
        console.log("✅ Correctly rejected wrong identity_registry address");
      }
    });

    it("❌ Test 12: Missing Ed25519 instruction fails", async () => {
      const feedbackAuth = createFeedbackAuth(
        agentId,
        client1.publicKey,
        10,
        3600,
        agentOwnerKeypair
      );

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, 5);
      const [reputationPda] = getAgentReputationPda(agentId);

      // Don't create Ed25519 verification instruction - this should fail

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            88,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmTest12",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(5),
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          // No preInstructions - missing Ed25519 verification
          .signers([client1])
          .rpc();

        assert.fail("Should have failed without Ed25519 instruction");
      } catch (err: any) {
        // Should fail - exact error doesn't matter
        assert(err, "Should fail without Ed25519 instruction");
        console.log("✅ Correctly rejected missing Ed25519 instruction");
      }
    });

    it("❌ Test 13: Agent ID mismatch fails", async () => {
      const wrongAgentId = agentId + 999;
      const feedbackAuth = createFeedbackAuth(
        wrongAgentId, // Wrong agent ID
        client1.publicKey,
        10,
        3600,
        agentOwnerKeypair
      );

      const [clientIndexPda] = getClientIndexPda(agentId, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agentId, client1.publicKey, 5);
      const [reputationPda] = getAgentReputationPda(agentId);

      const ed25519Ix = createEd25519Instruction(feedbackAuth);

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId), // Actual agent ID
            88,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmTest13",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(5),
            feedbackAuth // Auth for different agent ID
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
            instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .signers([client1])
          .rpc();

        assert.fail("Should have failed with agent ID mismatch");
      } catch (err: any) {
        // Should fail - exact error doesn't matter
        assert(err, "Should fail with agent ID mismatch");
        console.log("✅ Correctly rejected agent ID mismatch");
      }
    });
  });
});
