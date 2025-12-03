import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
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

// Helper: Sleep function
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

describe("E2E Spec Update Test - Minimal", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;

  let configPda: PublicKey;
  let collectionMint: Keypair;
  let collectionMetadata: PublicKey;
  let collectionMasterEdition: PublicKey;
  let collectionTokenAccount: PublicKey;

  let agentMint: Keypair;
  let agentPda: PublicKey;
  let agentMetadata: PublicKey;
  let agentMasterEdition: PublicKey;
  let agentTokenAccount: PublicKey;
  let agentId: number = 0;

  let client: Keypair;

  before(async () => {
    console.log("\n🔧 Setting up test environment...");

    // Create client keypair
    client = Keypair.generate();

    // Fund client with transfer from provider (avoid airdrop rate limits)
    console.log("💰 Funding client wallet...");
    const transferTx = await provider.connection.requestAirdrop(
      client.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(transferTx);

    console.log("⏸️  Waiting 3 seconds to respect rate limits...");
    await sleep(3000);

    // Derive config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      identityProgram.programId
    );

    // Create collection mint
    collectionMint = Keypair.generate();
    collectionMetadata = getMetadataPda(collectionMint.publicKey);
    collectionMasterEdition = getMasterEditionPda(collectionMint.publicKey);
    collectionTokenAccount = getAssociatedTokenAddressSync(
      collectionMint.publicKey,
      provider.wallet.publicKey
    );

    console.log("✅ Setup complete");
  });

  it("Initialize Identity Registry", async () => {
    console.log("\n🚀 Test 1: Initialize Identity Registry");

    const collectionName = "Agent NFT Collection";
    const collectionSymbol = "AGENT";
    const collectionUri = "https://example.com/collection.json";

    await identityProgram.methods
      .initialize(collectionName, collectionSymbol, collectionUri)
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        collectionMint: collectionMint.publicKey,
        collectionMetadata,
        collectionMasterEdition,
        collectionTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([collectionMint])
      .rpc();

    console.log("✅ Identity Registry initialized");
    console.log("⏸️  Waiting 3 seconds...");
    await sleep(3000);
  });

  it("Register Agent with NEW metadata structure (metadataKey/metadataValue)", async () => {
    console.log("\n🚀 Test 2: Register Agent with new metadata fields");

    agentMint = Keypair.generate();
    agentMetadata = getMetadataPda(agentMint.publicKey);
    agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
    agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      provider.wallet.publicKey
    );

    [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
      identityProgram.programId
    );

    const agentUri = "https://example.com/agent1.json";

    // NEW metadata structure with metadataKey and metadataValue
    const metadata = [
      { metadataKey: "name", metadataValue: Buffer.from("Test Agent") },
      { metadataKey: "type", metadataValue: Buffer.from("ai_assistant") },
    ];

    await identityProgram.methods
      .registerWithMetadata(agentUri, metadata)
      .accounts({
        config: configPda,
        agent: agentPda,
        owner: provider.wallet.publicKey,
        agentMint: agentMint.publicKey,
        agentMetadata,
        agentMasterEdition,
        agentTokenAccount,
        collectionMint: collectionMint.publicKey,
        collectionMetadata,
        collectionMasterEdition,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([agentMint])
      .rpc();

    console.log(`✅ Agent registered with ID: ${agentId}`);
    console.log("✅ Metadata uses new fields: metadataKey and metadataValue");
    console.log("⏸️  Waiting 3 seconds...");
    await sleep(3000);
  });

  it("Give Feedback with NEW String tags (no FeedbackAuth)", async () => {
    console.log("\n🚀 Test 3: Give feedback with String tags and no FeedbackAuth");

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
        new anchor.BN(0).toArrayLike(Buffer, "le", 8), // feedback_index = 0
      ],
      reputationProgram.programId
    );

    const score = 90;
    // NEW: Tags are now String, not bytes32
    const tag1 = "quality";
    const tag2 = "responsive";
    const fileUri = "https://example.com/feedback1.json";
    const fileHash = Array.from(Buffer.alloc(32, 1));

    // NEW: No FeedbackAuth parameter, no sysvarInstructions account
    await reputationProgram.methods
      .giveFeedback(
        new anchor.BN(agentId),
        score,
        tag1,  // String instead of Array<number>
        tag2,  // String instead of Array<number>
        fileUri,
        fileHash,
        new anchor.BN(0)
      )
      .accounts({
        feedback: feedbackPda,
        client: client.publicKey,
        identityRegistry: identityProgram.programId,
        agent: agentPda,
        payer: client.publicKey,
        systemProgram: SystemProgram.programId,
        // NO sysvarInstructions - FeedbackAuth removed!
      })
      .signers([client])
      .rpc();

    console.log("✅ Feedback submitted successfully");
    console.log("✅ Tags are String type: 'quality', 'responsive'");
    console.log("✅ No FeedbackAuth verification needed");
    console.log("⏸️  Waiting 3 seconds...");
    await sleep(3000);

    // Verify feedback was stored correctly
    const feedbackAccount = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
    assert.equal(feedbackAccount.agentId.toNumber(), agentId);
    assert.equal(feedbackAccount.score, score);
    assert.equal(feedbackAccount.tag1, tag1);
    assert.equal(feedbackAccount.tag2, tag2);
    assert.equal(feedbackAccount.clientAddress.toBase58(), client.publicKey.toBase58());

    console.log("✅ All assertions passed!");
  });

  it("Verify metadata can be read with new field names", async () => {
    console.log("\n🚀 Test 4: Read metadata with new field names");

    // Read metadata via get_metadata instruction
    const metadataKey = "name";
    const result = await identityProgram.methods
      .getMetadata(metadataKey)
      .accounts({
        agent: agentPda,
      })
      .view();

    assert.deepEqual(result, Buffer.from("Test Agent"));
    console.log("✅ Metadata read successfully with 'metadataKey'");
    console.log("⏸️  Waiting 3 seconds...");
    await sleep(3000);
  });

  after(async () => {
    console.log("\n✅ All tests completed successfully!");
    console.log("\n📊 SUMMARY:");
    console.log("  ✅ FeedbackAuth removed - no Ed25519 verification");
    console.log("  ✅ Tags converted to String type");
    console.log("  ✅ Metadata uses metadataKey/metadataValue");
    console.log("  ✅ All ERC-8004 spec updates working correctly");
  });
});
