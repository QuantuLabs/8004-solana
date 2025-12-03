/**
 * LOT 5: MetadataExtension + Response Limit Tests
 *
 * Tests extended metadata functionality and response management:
 * - Metadata extension CRUD operations
 * - Multiple extensions per agent
 * - Large metadata values
 * - Response submission limits
 * - Multiple responses to same feedback
 * - Large response datasets
 * - Response ordering and pagination
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { assert } from "chai";

describe("Metadata Extension + Response Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;

  const identityProgramId = identityProgram.programId;
  const reputationProgramId = reputationProgram.programId;

  // Test accounts
  let agentOwner: Keypair;
  let client: Keypair;
  let responder1: Keypair;
  let responder2: Keypair;
  let agentId: BN;
  let agentMint: PublicKey;

  // PDAs
  let agentPda: PublicKey;
  let aggregatePda: PublicKey;

  before(async () => {
    agentOwner = Keypair.generate();
    client = Keypair.generate();
    responder1 = Keypair.generate();
    responder2 = Keypair.generate();

    // Airdrop SOL
    const airdropAmount = 5 * anchor.web3.LAMPORTS_PER_SOL;
    await provider.connection.requestAirdrop(agentOwner.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(client.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(responder1.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(responder2.publicKey, airdropAmount);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Register agent
    const agentUri = "ipfs://Qm_metadata_test";
    const metadataUri = "ipfs://Qm_metadata_extension_test";
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

    // Get agent ID and mint from event
    const events = await identityProgram.account.agent.all();
    const agentAccount = events[events.length - 1].account;
    agentId = agentAccount.agentId;
    agentMint = agentAccount.agentMint;

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
   * Test 1: Create metadata extension
   */
  it("Should create a metadata extension", async () => {
    const extensionIndex = 0;

    const [metadataExtensionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata_extension"),
        agentMint.toBuffer(),
        Buffer.from([extensionIndex]),
      ],
      identityProgramId
    );

    const tx = await identityProgram.methods
      .createMetadataExtension(extensionIndex)
      .accounts({
        metadataExtension: metadataExtensionPda,
        agentAccount: agentPda,
        agentMint: agentMint,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Verify extension was created
    const extension = await identityProgram.account.metadataExtension.fetch(
      metadataExtensionPda
    );
    assert.equal(extension.agentMint.toBase58(), agentMint.toBase58());
    assert.equal(extension.extensionIndex, extensionIndex);
    assert.equal(extension.metadata.length, 0);

    console.log("✓ Metadata extension created successfully");
  });

  /**
   * Test 2: Update metadata extension (set values)
   */
  it("Should set metadata values in extension", async () => {
    const extensionIndex = 0;

    const [metadataExtensionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata_extension"),
        agentMint.toBuffer(),
        Buffer.from([extensionIndex]),
      ],
      identityProgramId
    );

    // Set multiple key-value pairs
    const metadataEntries = [
      { key: "capability", value: Buffer.from("mcp:prompts") },
      { key: "model", value: Buffer.from("gpt-4") },
      { key: "version", value: Buffer.from("1.0.0") },
    ];

    for (const entry of metadataEntries) {
      await identityProgram.methods
        .setMetadataExtended(extensionIndex, entry.key, Array.from(entry.value))
        .accounts({
          metadataExtension: metadataExtensionPda,
          agentAccount: agentPda,
          agentMint: agentMint,
          authority: agentOwner.publicKey,
        } as any)
        .signers([agentOwner])
        .rpc();
    }

    // Verify all entries were set
    const extension = await identityProgram.account.metadataExtension.fetch(
      metadataExtensionPda
    );
    assert.equal(extension.metadata.length, metadataEntries.length);

    for (const entry of metadataEntries) {
      const found = extension.metadata.find((e: any) => e.key === entry.key);
      assert.exists(found, `Key ${entry.key} should exist`);
      assert.deepEqual(Buffer.from(found.value), entry.value);
    }

    console.log(`✓ Set ${metadataEntries.length} metadata entries`);
  });

  /**
   * Test 3: Update existing metadata value
   */
  it("Should update existing metadata value", async () => {
    const extensionIndex = 0;

    const [metadataExtensionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata_extension"),
        agentMint.toBuffer(),
        Buffer.from([extensionIndex]),
      ],
      identityProgramId
    );

    // Get initial value
    let extension = await identityProgram.account.metadataExtension.fetch(
      metadataExtensionPda
    );
    const initialCount = extension.metadata.length;

    // Update existing key "model" with new value
    const updatedValue = Buffer.from("gpt-4-turbo");
    await identityProgram.methods
      .setMetadataExtended(extensionIndex, "model", Array.from(updatedValue))
      .accounts({
        metadataExtension: metadataExtensionPda,
        agentAccount: agentPda,
        agentMint: agentMint,
        authority: agentOwner.publicKey,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Verify value was updated (not added as new entry)
    extension = await identityProgram.account.metadataExtension.fetch(
      metadataExtensionPda
    );
    assert.equal(extension.metadata.length, initialCount);

    const modelEntry = extension.metadata.find((e: any) => e.key === "model");
    assert.deepEqual(Buffer.from(modelEntry.value), updatedValue);

    console.log("✓ Metadata value updated successfully");
  });

  /**
   * Test 4: Multiple metadata extensions per agent
   */
  it("Should create and manage multiple extensions", async () => {
    const extensionIndices = [1, 2, 3];

    for (const index of extensionIndices) {
      const [metadataExtensionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_extension"),
          agentMint.toBuffer(),
          Buffer.from([index]),
        ],
        identityProgramId
      );

      // Create extension
      await identityProgram.methods
        .createMetadataExtension(index)
        .accounts({
          metadataExtension: metadataExtensionPda,
          agentAccount: agentPda,
          agentMint: agentMint,
          owner: agentOwner.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agentOwner])
        .rpc();

      // Add unique metadata to each extension
      await identityProgram.methods
        .setMetadataExtended(
          index,
          `ext_${index}_key`,
          Array.from(Buffer.from(`Extension ${index} data`))
        )
        .accounts({
          metadataExtension: metadataExtensionPda,
          agentAccount: agentPda,
          agentMint: agentMint,
          authority: agentOwner.publicKey,
        } as any)
        .signers([agentOwner])
        .rpc();
    }

    // Verify all extensions exist and have unique data
    for (const index of extensionIndices) {
      const [metadataExtensionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_extension"),
          agentMint.toBuffer(),
          Buffer.from([index]),
        ],
        identityProgramId
      );

      const extension = await identityProgram.account.metadataExtension.fetch(
        metadataExtensionPda
      );
      assert.equal(extension.extensionIndex, index);
      assert.equal(extension.metadata.length, 1);
      assert.equal(extension.metadata[0].key, `ext_${index}_key`);
    }

    console.log(`✓ Created and verified ${extensionIndices.length} extensions`);
  });

  /**
   * Test 5: Large metadata values (max 256 bytes)
   */
  it("Should handle maximum-size metadata values", async () => {
    const extensionIndex = 4;

    const [metadataExtensionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata_extension"),
        agentMint.toBuffer(),
        Buffer.from([extensionIndex]),
      ],
      identityProgramId
    );

    // Create extension
    await identityProgram.methods
      .createMetadataExtension(extensionIndex)
      .accounts({
        metadataExtension: metadataExtensionPda,
        agentAccount: agentPda,
        agentMint: agentMint,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Create maximum-size value (256 bytes)
    const maxValue = Buffer.alloc(256, 0xAB);

    await identityProgram.methods
      .setMetadataExtended(extensionIndex, "large_data", Array.from(maxValue))
      .accounts({
        metadataExtension: metadataExtensionPda,
        agentAccount: agentPda,
        agentMint: agentMint,
        authority: agentOwner.publicKey,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Verify large value was stored correctly
    const extension = await identityProgram.account.metadataExtension.fetch(
      metadataExtensionPda
    );
    const largeEntry = extension.metadata.find((e: any) => e.key === "large_data");
    assert.equal(largeEntry.value.length, 256);
    assert.deepEqual(Buffer.from(largeEntry.value), maxValue);

    console.log("✓ Maximum-size (256 bytes) metadata value handled correctly");

    // Test that values exceeding 256 bytes are rejected
    const oversizedValue = Buffer.alloc(257, 0xFF);

    try {
      await identityProgram.methods
        .setMetadataExtended(extensionIndex, "oversized", Array.from(oversizedValue))
        .accounts({
          metadataExtension: metadataExtensionPda,
          agentAccount: agentPda,
          agentMint: agentMint,
          authority: agentOwner.publicKey,
        } as any)
        .signers([agentOwner])
        .rpc();

      assert.fail("Oversized value should be rejected");
    } catch (err) {
      console.log("✓ Oversized value correctly rejected");
      assert.include(err.toString(), "ValueTooLong");
    }
  });

  /**
   * Test 6: Response submission for feedback
   */
  it("Should submit response to feedback", async () => {
    // First, create a feedback
    const feedbackAuth = {
      agentId,
      clientAddress: client.publicKey,
      indexLimit: new BN(10),
      expiry: new BN(Math.floor(Date.now() / 1000) + 3600),
      chainId: "solana-devnet",
      identityRegistry: identityProgramId,
      signerAddress: agentOwner.publicKey,
      signature: Buffer.alloc(64, 0),
    };

    const tag1 = Buffer.alloc(32, 1);
    const tag2 = Buffer.alloc(32, 2);
    const fileUri = "ipfs://Qm_feedback_for_response";
    const fileHash = Buffer.alloc(32, 3);
    const feedbackIndex = new BN(0);

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    await reputationProgram.methods
      .giveFeedback(agentId, 80, tag1, tag2, fileUri, fileHash, feedbackIndex, feedbackAuth)
      .accounts({
        feedback: feedbackPda,
        aggregate: aggregatePda,
        agent: agentPda,
        client: client.publicKey,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([client])
      .rpc();

    // Now submit a response to this feedback
    const responseIndex = new BN(0);
    const responseUri = "ipfs://Qm_response_1";
    const responseHash = Buffer.alloc(32, 4);

    const [responsePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("response"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
        responseIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    const [responseIndexPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("response_index"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    await reputationProgram.methods
      .appendResponse(agentId, feedbackIndex, responseUri, responseHash, responseIndex)
      .accounts({
        response: responsePda,
        responseIndex: responseIndexPda,
        feedback: feedbackPda,
        responder: responder1.publicKey,
        agent: agentPda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([responder1])
      .rpc();

    // Verify response was created
    const response = await reputationProgram.account.responseAccount.fetch(responsePda);
    assert.equal(response.agentId.toString(), agentId.toString());
    assert.equal(response.clientAddress.toBase58(), client.publicKey.toBase58());
    assert.equal(response.feedbackIndex.toString(), feedbackIndex.toString());
    assert.equal(response.responseIndex.toString(), responseIndex.toString());
    assert.equal(response.responder.toBase58(), responder1.publicKey.toBase58());
    assert.equal(response.responseUri, responseUri);

    console.log("✓ Response submitted successfully");
  });

  /**
   * Test 7: Multiple responses to same feedback
   */
  it("Should handle multiple responses to same feedback", async () => {
    const feedbackIndex = new BN(0);
    const responseCount = 5;

    for (let i = 1; i <= responseCount; i++) {
      const responseIndex = new BN(i);
      const responseUri = `ipfs://Qm_response_${i}`;
      const responseHash = Buffer.alloc(32, i);

      const [responsePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
          responseIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      const [responseIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response_index"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      await reputationProgram.methods
        .appendResponse(agentId, feedbackIndex, responseUri, responseHash, responseIndex)
        .accounts({
          response: responsePda,
          responseIndex: responseIndexPda,
          feedback: feedbackPda,
          responder: i % 2 === 0 ? responder1.publicKey : responder2.publicKey,
          agent: agentPda,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([i % 2 === 0 ? responder1 : responder2])
        .rpc();
    }

    // Verify all responses exist
    for (let i = 1; i <= responseCount; i++) {
      const responseIndex = new BN(i);
      const [responsePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
          responseIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      const response = await reputationProgram.account.responseAccount.fetch(responsePda);
      assert.equal(response.responseIndex.toString(), responseIndex.toString());
      assert.equal(response.responseUri, `ipfs://Qm_response_${i}`);
    }

    console.log(`✓ ${responseCount} responses submitted to same feedback`);
  });

  /**
   * Test 8: Large response dataset (stress test)
   */
  it("Should handle large number of responses", async () => {
    // Create a new feedback for this test
    const feedbackAuth = {
      agentId,
      clientAddress: client.publicKey,
      indexLimit: new BN(10),
      expiry: new BN(Math.floor(Date.now() / 1000) + 3600),
      chainId: "solana-devnet",
      identityRegistry: identityProgramId,
      signerAddress: agentOwner.publicKey,
      signature: Buffer.alloc(64, 0),
    };

    const tag1 = Buffer.alloc(32, 5);
    const tag2 = Buffer.alloc(32, 6);
    const fileUri = "ipfs://Qm_feedback_stress";
    const fileHash = Buffer.alloc(32, 7);
    const feedbackIndex = new BN(1);

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    await reputationProgram.methods
      .giveFeedback(agentId, 90, tag1, tag2, fileUri, fileHash, feedbackIndex, feedbackAuth)
      .accounts({
        feedback: feedbackPda,
        aggregate: aggregatePda,
        agent: agentPda,
        client: client.publicKey,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([client])
      .rpc();

    // Submit 20 responses
    const responseCount = 20;

    for (let i = 0; i < responseCount; i++) {
      const responseIndex = new BN(i);
      const responseUri = `ipfs://Qm_large_response_${i}`;
      const responseHash = Buffer.alloc(32, i);

      const [responsePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
          responseIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      const [responseIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response_index"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      await reputationProgram.methods
        .appendResponse(agentId, feedbackIndex, responseUri, responseHash, responseIndex)
        .accounts({
          response: responsePda,
          responseIndex: responseIndexPda,
          feedback: feedbackPda,
          responder: responder1.publicKey,
          agent: agentPda,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([responder1])
        .rpc();
    }

    // Verify response index account tracks correct count
    const [responseIndexPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("response_index"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgramId
    );

    const responseIndexAccount = await reputationProgram.account.responseIndexAccount.fetch(
      responseIndexPda
    );
    assert.equal(responseIndexAccount.nextIndex.toNumber(), responseCount);

    console.log(`✓ ${responseCount} responses submitted successfully (stress test)`);
  });

  /**
   * Test 9: Response ordering verification
   */
  it("Should maintain response ordering", async () => {
    const feedbackIndex = new BN(1);
    const responseCount = 20;

    // Fetch all responses and verify they're in sequential order
    for (let i = 0; i < responseCount; i++) {
      const responseIndex = new BN(i);
      const [responsePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response"),
          agentId.toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
          responseIndex.toArrayLike(Buffer, "le", 8),
        ],
        reputationProgramId
      );

      const response = await reputationProgram.account.responseAccount.fetch(responsePda);
      assert.equal(response.responseIndex.toNumber(), i);
      assert.equal(response.responseUri, `ipfs://Qm_large_response_${i}`);

      // Verify timestamp ordering (later responses have later timestamps)
      if (i > 0) {
        const prevResponseIndex = new BN(i - 1);
        const [prevResponsePda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("response"),
            agentId.toArrayLike(Buffer, "le", 8),
            client.publicKey.toBuffer(),
            feedbackIndex.toArrayLike(Buffer, "le", 8),
            prevResponseIndex.toArrayLike(Buffer, "le", 8),
          ],
          reputationProgramId
        );

        const prevResponse = await reputationProgram.account.responseAccount.fetch(
          prevResponsePda
        );
        assert.isTrue(
          response.createdAt.toNumber() >= prevResponse.createdAt.toNumber(),
          "Responses should maintain chronological order"
        );
      }
    }

    console.log(`✓ Response ordering verified for ${responseCount} responses`);
  });
});
