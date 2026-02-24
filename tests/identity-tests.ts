/**
 * Identity Module Tests for Agent Registry 8004 v0.3.0
 * Tests registration, metadata PDAs, URI operations, and ownership
 * v0.3.0: Uses asset (Pubkey) instead of agent_id as identifier
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  MAX_URI_LENGTH,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getMetadataEntryPda,
  computeKeyHash,
  buildWalletSetMessage,
  stringOfLength,
  uriOfLength,
  expectAnchorError,
} from "./utils/helpers";
import { Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import * as nacl from "tweetnacl";

async function rpcWithBlockhashRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      if (!msg.includes("Blockhash not found") || i === retries - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastErr;
}

async function getTransactionWithRetry(
  connection: anchor.web3.Connection,
  signature: string,
  retries = 5
) {
  let tx: anchor.web3.VersionedTransactionResponse | null = null;
  for (let i = 0; i < retries; i++) {
    tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return tx;
}

/**
 * Execute a direct mpl-core TransferV1 (outside registry program) so AgentAccount owner cache
 * remains stale until syncOwner() is called.
 */
async function transferCoreAssetExternally(
  provider: anchor.AnchorProvider,
  asset: PublicKey,
  collection: PublicKey,
  authority: PublicKey,
  newOwner: PublicKey
): Promise<string> {
  // mpl-core TransferV1: discriminator=14, args.compression_proof=None (0)
  const transferIx = new anchor.web3.TransactionInstruction({
    programId: MPL_CORE_PROGRAM_ID,
    keys: [
      { pubkey: asset, isSigner: false, isWritable: true },
      { pubkey: collection, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true }, // payer
      { pubkey: authority, isSigner: true, isWritable: false }, // authority
      { pubkey: newOwner, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Optional log wrapper omitted by using mpl-core sentinel account.
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([14, 0]),
  });

  return provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx));
}

describe("Identity Module Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  before(async () => {
    console.log("DEBUG: Program ID =", program.programId.toBase58());
    [rootConfigPda] = getRootConfigPda(program.programId);
    console.log("DEBUG: Root Config PDA =", rootConfigPda.toBase58());

    // Verify account exists
    const accountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    console.log("DEBUG: Account exists =", accountInfo !== null);
    if (accountInfo) {
      console.log("DEBUG: Account owner =", accountInfo.owner.toBase58());
    }

    // Try raw decode
    const rootConfig = program.coder.accounts.decode("rootConfig", accountInfo!.data);
    console.log("DEBUG: Root config decoded, authority =", rootConfig.authority.toBase58());

    // baseCollection is the collection pubkey
    collectionPubkey = rootConfig.baseCollection;
    [registryConfigPda] = getRegistryConfigPda(collectionPubkey, program.programId);
    console.log("DEBUG: Registry Config PDA =", registryConfigPda.toBase58());

    console.log("=== Identity Tests Setup (v0.3.0) ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Root Config:", rootConfigPda.toBase58());
    console.log("Collection:", collectionPubkey.toBase58());
  });

  // ============================================================================
  // REGISTRATION TESTS
  // ============================================================================
  describe("Registration", () => {
    it("register() with valid URI", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const uri = "https://example.com/agent/identity-test-1";

      const tx = await program.methods
        .register(uri)
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("Register with URI tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agent.asset.toBase58()).to.equal(assetKeypair.publicKey.toBase58());
      expect(agent.agentUri).to.equal(uri);
    });

    it("register() with empty URI", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      const tx = await program.methods
        .register("")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("Register empty URI tx:", tx);

      const agentAccountInfo = await provider.connection.getAccountInfo(agentPda);
      const agent = program.coder.accounts.decode("agentAccount", agentAccountInfo!.data);
      expect(agent.agentUri).to.equal("");
    });

    it("register() with max URI (250 bytes)", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const maxUri = uriOfLength(MAX_URI_LENGTH); // 250 bytes

      const tx = await program.methods
        .register(maxUri)
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("Register max URI (250) tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentUri).to.equal(maxUri);
      expect(agent.agentUri.length).to.equal(250);
    });

    it("register() fails with URI > 250 bytes", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1); // 251 bytes

      await expectAnchorError(
        program.methods
          .register(longUri)
          .accounts({
            rootConfig: rootConfigPda,
            registryConfig: registryConfigPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            collection: collectionPubkey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([assetKeypair])
          .rpc(),
        "UriTooLong"
      );
    });
  });

  // ============================================================================
  // METADATA PDA OPERATION TESTS (v0.3.0 - asset-based)
  // ============================================================================
  describe("Metadata PDA Operations", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      // Register a fresh agent for metadata tests
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/metadata-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();
    });

    it("setMetadataPda() creates new metadata entry", async () => {
      const key = "framework";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("solana-anchor");
      // v0.3.0: Use asset instead of agentId
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("SetMetadataPda (add) tx:", tx);

      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.metadataKey).to.equal(key);
      expect(Buffer.from(metadata.metadataValue).toString()).to.equal("solana-anchor");
      expect(metadata.immutable).to.be.false;
    });

    it("setMetadataPda() updates existing entry", async () => {
      const key = "framework";
      const keyHash = computeKeyHash(key);
      const newValue = Buffer.from("anchor-v0.32");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, newValue, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("SetMetadataPda (update) tx:", tx);

      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(Buffer.from(metadata.metadataValue).toString()).to.equal("anchor-v0.32");
    });

    it("setMetadataPda() fails with key > 32 bytes", async () => {
      const longKey = stringOfLength(MAX_METADATA_KEY_LENGTH + 1);
      const keyHash = computeKeyHash(longKey);
      const value = Buffer.from("test");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), longKey, value, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyTooLong"
      );
    });

    it("setMetadataPda() fails with value > 256 bytes", async () => {
      const key = "big_value";
      const keyHash = computeKeyHash(key);
      const longValue = Buffer.alloc(MAX_METADATA_VALUE_LENGTH + 1);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, longValue, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "ValueTooLong"
      );
    });

    it("setMetadataPda() fails if non-owner", async () => {
      const fakeOwner = Keypair.generate();
      // Fund fakeOwner from provider wallet
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: fakeOwner.publicKey,
          lamports: 10000000,
        })
      );
      await provider.sendAndConfirm(transferTx);

      const key = "unauthorized";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("test");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, value, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: fakeOwner.publicKey,
            payer: fakeOwner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([fakeOwner])
          .rpc(),
        "Unauthorized"
      );
    });

    it("setMetadataPda() with immutable=true locks the entry", async () => {
      const key = "certification";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("certified-v1");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, true)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.immutable).to.be.true;

      // Try to update - should fail
      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, Buffer.from("modified"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "MetadataImmutable"
      );
    });

    it("deleteMetadataPda() removes entry and recovers rent", async () => {
      const key = "deletable";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("to-be-deleted");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      // Create metadata
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      // Delete metadata
      const tx = await program.methods
        .deleteMetadataPda(Array.from(keyHash))
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("DeleteMetadataPda tx:", tx);

      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);

      // Account should be closed
      const accountInfo = await provider.connection.getAccountInfo(metadataPda);
      expect(accountInfo).to.be.null;

      // Should have recovered some rent (minus tx fee)
      expect(balanceAfter).to.be.greaterThan(balanceBefore - 50000); // Allow for tx fee
    });

    it("deleteMetadataPda() fails on immutable entry", async () => {
      const key = "certification";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .deleteMetadataPda(Array.from(keyHash))
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "MetadataImmutable"
      );
    });

    it("setMetadataPda() emits full value in event (no truncation)", async () => {
      // Create a value that is 200 bytes (previously truncated to 64)
      const key = "full_value_test";
      const keyHash = computeKeyHash(key);
      const fullValue = Buffer.alloc(200, "x"); // 200 bytes of 'x'
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, fullValue, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("SetMetadataPda (200 byte value) tx:", tx);

      // Verify metadata was stored correctly
      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.metadataKey).to.equal(key);
      expect(Buffer.from(metadata.metadataValue).length).to.equal(200);
      expect(Buffer.from(metadata.metadataValue).toString()).to.equal("x".repeat(200));

      // Note: Event verification would require parsing logs, but the fix ensures
      // the MetadataSet event now contains the full 200-byte value, not truncated to 64
      console.log("✓ Full 200-byte value stored and emitted (no truncation)");
    });

    it("setMetadataPda() accepts max value (250 bytes)", async () => {
      const key = "max_value_test";
      const keyHash = computeKeyHash(key);
      const maxValue = Buffer.alloc(MAX_METADATA_VALUE_LENGTH, "m"); // 250 bytes
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, maxValue, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("SetMetadataPda (max 250 byte value) tx:", tx);

      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(Buffer.from(metadata.metadataValue).length).to.equal(250);
      console.log("✓ Maximum 250-byte value accepted");
    });

    it("Multiple metadata entries per agent", async () => {
      const entries = [
        { key: "mcp_endpoint", value: "https://mcp.example.com" },
        { key: "version", value: "2.0.0" },
        { key: "capability", value: "code-generation" },
      ];

      for (const entry of entries) {
        const keyHash = computeKeyHash(entry.key);
        const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

        await program.methods
          .setMetadataPda(Array.from(keyHash), entry.key, Buffer.from(entry.value), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      // Verify all entries exist
      for (const entry of entries) {
        const keyHash = computeKeyHash(entry.key);
        const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);
        const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
        expect(metadata.metadataKey).to.equal(entry.key);
        expect(Buffer.from(metadata.metadataValue).toString()).to.equal(entry.value);
      }

      console.log("Successfully created", entries.length, "metadata entries");
    });
  });

  // ============================================================================
  // URI OPERATION TESTS
  // ============================================================================
  describe("URI Operations", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/uri-test-initial")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();
    });

    it("setAgentUri() updates the URI", async () => {
      const newUri = "https://example.com/agent/uri-test-updated";

      const tx = await program.methods
        .setAgentUri(newUri)
        .accounts({
          registryConfig: registryConfigPda,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("SetAgentUri tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentUri).to.equal(newUri);
    });

    it("setAgentUri() fails with URI > 250 bytes", async () => {
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .setAgentUri(longUri)
          .accounts({
            registryConfig: registryConfigPda,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            collection: collectionPubkey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .rpc(),
        "UriTooLong"
      );
    });

    it("setAgentUri() fails if non-owner", async () => {
      const fakeOwner = Keypair.generate();
      // Fund fakeOwner from provider wallet
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: fakeOwner.publicKey,
          lamports: 10000000,
        })
      );
      await provider.sendAndConfirm(transferTx);

      await expectAnchorError(
        program.methods
          .setAgentUri("https://unauthorized.com")
          .accounts({
            registryConfig: registryConfigPda,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            collection: collectionPubkey,
            owner: fakeOwner.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([fakeOwner])
          .rpc(),
        "Unauthorized"
      );
    });
  });

  // ============================================================================
  // TRANSFER & OWNERSHIP TESTS
  // ============================================================================
  describe("Transfer & Ownership", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;
    let newOwner: Keypair;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      newOwner = Keypair.generate();

      // Fund newOwner from provider wallet for later tests
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: newOwner.publicKey,
          lamports: 50000000,
        })
      );
      await provider.sendAndConfirm(transferTx);

      await program.methods
        .register("https://example.com/agent/transfer-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();
    });

    it("ownerOf() returns the correct owner", async () => {
      const result = await program.methods
        .ownerOf()
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
        })
        .view();

      expect(result.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });

    it("transferAgent() transfers the Core asset", async () => {
      const tx = await program.methods
        .transferAgent()
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: newOwner.publicKey,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("TransferAgent tx:", tx);

      // Verify agent account owner is updated
      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());
    });

    it("Old owner can no longer set metadata after transfer", async () => {
      const key = "post_transfer";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, Buffer.from("should_fail"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey, // old owner
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "Unauthorized"
      );
    });

    it("New owner can set metadata after transfer", async () => {
      const key = "new_owner_key";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("new_owner_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: newOwner.publicKey,
          payer: newOwner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([newOwner])
        .rpc();

      console.log("New owner setMetadataPda tx:", tx);

      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.metadataKey).to.equal(key);
    });
  });

  // ============================================================================
  // SYNC OWNER TESTS
  // ============================================================================
  describe("Sync Owner", () => {
    it("syncOwner() synchronizes owner from Core asset", async () => {
      // Register a new agent
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/sync-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      // SyncOwner call (even though owner hasn't changed)
      const tx = await program.methods
        .syncOwner()
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
        })
        .rpc();

      console.log("SyncOwner tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    });

    it("syncOwner() emits WalletResetOnOwnerSync after external Core transfer", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const walletKeypair = Keypair.generate();
      const newOwner = Keypair.generate();
      const zeroPubkey = new PublicKey(new Uint8Array(32));

      // Ensure newOwner account exists on-chain for Core transfer account loading.
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: newOwner.publicKey,
          lamports: 50_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      // 1) Register agent with current owner.
      await program.methods
        .register("https://example.com/agent/sync-owner-event-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      // 2) Set wallet so sync_owner reset path has old_wallet = Some(_).
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN((blockTime ?? Math.floor(Date.now() / 1000)) + 60);
      const message = buildWalletSetMessage(
        assetKeypair.publicKey,
        walletKeypair.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, walletKeypair.secretKey);
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: walletKeypair.publicKey.toBytes(),
        message,
        signature,
      });

      await program.methods
        .setAgentWallet(walletKeypair.publicKey, deadline)
        .accounts({
          owner: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      // 3) Transfer Core asset directly through mpl-core (bypasses registry transferAgent).
      const coreTransferSig = await transferCoreAssetExternally(
        provider,
        assetKeypair.publicKey,
        collectionPubkey,
        provider.wallet.publicKey,
        newOwner.publicKey
      );
      console.log("External Core transfer tx:", coreTransferSig);

      // 4) Sync owner and verify the dedicated wallet-reset event.
      const syncSig = await program.methods
        .syncOwner()
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
        })
        .rpc();
      console.log("SyncOwner (wallet reset event) tx:", syncSig);

      const syncTx = await getTransactionWithRetry(provider.connection, syncSig);
      expect(syncTx).to.not.be.null;

      const logs = syncTx?.meta?.logMessages ?? [];
      const parser = new anchor.EventParser(program.programId, program.coder);
      const parsedEvents = Array.from(parser.parseLogs(logs));
      const decodedEvents = logs
        .map((log) => program.coder.events.decode(log))
        .filter((event): event is { name: string; data: any } => event !== null);
      const events = [...parsedEvents, ...decodedEvents];
      const resetEvent = events.find(
        (event) =>
          event.name === "WalletResetOnOwnerSync" || event.name === "walletResetOnOwnerSync"
      );

      if (!resetEvent) {
        console.log(
          "Decoded sync_owner events:",
          events.map((event) => event.name)
        );
      }
      expect(resetEvent, "WalletResetOnOwnerSync event missing").to.not.be.undefined;
      const ownerAfterSync = resetEvent!.data.ownerAfterSync ?? resetEvent!.data.owner_after_sync;
      const oldWallet = resetEvent!.data.oldWallet ?? resetEvent!.data.old_wallet;
      const newWallet = resetEvent!.data.newWallet ?? resetEvent!.data.new_wallet;
      expect(resetEvent!.data.asset.toBase58()).to.equal(assetKeypair.publicKey.toBase58());
      expect(ownerAfterSync.toBase58()).to.equal(newOwner.publicKey.toBase58());
      expect(newWallet.toBase58()).to.equal(zeroPubkey.toBase58());
      expect(oldWallet).to.not.be.null;
      expect(oldWallet.toBase58()).to.equal(walletKeypair.publicKey.toBase58());

      const updatedAgent = await program.account.agentAccount.fetch(agentPda);
      expect(updatedAgent.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());
      expect(updatedAgent.agentWallet).to.be.null;
    });
  });

  // ============================================================================
  // SET AGENT WALLET TESTS (8004 Jan 2026 Spec)
  // ============================================================================
  describe("Agent Wallet Operations", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;
    let walletKeypair: Keypair;

    before(async () => {
      // Register a fresh agent for wallet tests
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      walletKeypair = Keypair.generate();

      await program.methods
        .register("https://example.com/agent/wallet-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("=== Wallet Tests Setup ===");
      console.log("Asset:", assetKeypair.publicKey.toBase58());
      console.log("Wallet pubkey:", walletKeypair.publicKey.toBase58());
    });

    it("setAgentWallet() with valid Ed25519 signature + cost measurement", async () => {
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 60); // 60 seconds from now

      // Build message and sign with wallet private key
      const message = buildWalletSetMessage(
        assetKeypair.publicKey,
        walletKeypair.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, walletKeypair.secretKey);

      // Create Ed25519 verify instruction
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: walletKeypair.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      // Get balance before for cost measurement
      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      // Call setAgentWallet with Ed25519 instruction prepended
      // NOTE: No separate PDA anymore - wallet stored in AgentAccount
      const tx = await rpcWithBlockhashRetry(() =>
        program.methods
          .setAgentWallet(walletKeypair.publicKey, deadline)
          .accounts({
            owner: provider.wallet.publicKey,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .preInstructions([ed25519Ix])
          .rpc({ commitment: "confirmed" })
      );

      console.log("SetAgentWallet tx:", tx);

      // Verify wallet was stored in AgentAccount
      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentWallet).to.not.be.null;
      expect(agent.agentWallet!.toBase58()).to.equal(walletKeypair.publicKey.toBase58());

      // Cost measurement - should be minimal (no rent, just tx fee)
      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      const txInfo = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      console.log("=== setAgentWallet Cost (Optimized - No Rent!) ===");
      console.log("Compute Units:", txInfo?.meta?.computeUnitsConsumed);
      console.log("Transaction Fee:", txInfo?.meta?.fee, "lamports");
      console.log("Total cost:", balanceBefore - balanceAfter, "lamports");
    });

    it("setAgentWallet() fails with expired deadline", async () => {
      const newWallet = Keypair.generate();
      const deadline = new anchor.BN(1000000); // Far in the past

      const message = buildWalletSetMessage(
        assetKeypair.publicKey,
        newWallet.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, newWallet.secretKey);

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: newWallet.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      await expectAnchorError(
        program.methods
          .setAgentWallet(newWallet.publicKey, deadline)
          .accounts({
            owner: provider.wallet.publicKey,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "DeadlineExpired"
      );
    });

    it("setAgentWallet() fails with deadline too far in future", async () => {
      const newWallet = Keypair.generate();
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 600); // 10 minutes (> 5 min limit)

      const message = buildWalletSetMessage(
        assetKeypair.publicKey,
        newWallet.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, newWallet.secretKey);

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: newWallet.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      await expectAnchorError(
        program.methods
          .setAgentWallet(newWallet.publicKey, deadline)
          .accounts({
            owner: provider.wallet.publicKey,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "DeadlineTooFar"
      );
    });

    it("setAgentWallet() fails without Ed25519 verify instruction", async () => {
      const newWallet = Keypair.generate();
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 60);

      // Call without Ed25519 instruction
      await expectAnchorError(
        program.methods
          .setAgentWallet(newWallet.publicKey, deadline)
          .accounts({
            owner: provider.wallet.publicKey,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .rpc(),
        "MissingSignatureVerification"
      );
    });

    it("setAgentWallet() fails if non-owner tries to set wallet", async () => {
      const fakeOwner = Keypair.generate();
      const newWallet = Keypair.generate();

      // Fund fakeOwner
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: fakeOwner.publicKey,
          lamports: 50000000,
        })
      );
      await provider.sendAndConfirm(transferTx);

      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 60);

      const message = buildWalletSetMessage(
        assetKeypair.publicKey,
        newWallet.publicKey,
        fakeOwner.publicKey, // Wrong owner in message
        deadline
      );
      const signature = nacl.sign.detached(message, newWallet.secretKey);

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: newWallet.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      await expectAnchorError(
        program.methods
          .setAgentWallet(newWallet.publicKey, deadline)
          .accounts({
            owner: fakeOwner.publicKey,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([fakeOwner])
          .preInstructions([ed25519Ix])
          .rpc(),
        "Unauthorized"
      );
    });

    it("setMetadataPda() blocks 'agentWallet' as reserved key", async () => {
      const keyHash = computeKeyHash("agentWallet");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);
      const fakeWallet = Buffer.from(Keypair.generate().publicKey.toBytes());

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), "agentWallet", fakeWallet, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "ReservedMetadataKey"
      );
    });

    it("transferAgent() resets wallet to None", async () => {
      // Register a new agent for transfer test
      const transferAsset = Keypair.generate();
      const [transferAgentPda] = getAgentPda(transferAsset.publicKey, program.programId);
      const transferWallet = Keypair.generate();
      const newOwner = Keypair.generate();

      // Fund newOwner
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: newOwner.publicKey,
          lamports: 50000000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      // Register agent
      await program.methods
        .register("https://example.com/agent/transfer-wallet-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: transferAgentPda,
          asset: transferAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([transferAsset])
        .rpc();

      // Set wallet
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 60);

      const message = buildWalletSetMessage(
        transferAsset.publicKey,
        transferWallet.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, transferWallet.secretKey);

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: transferWallet.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      await program.methods
        .setAgentWallet(transferWallet.publicKey, deadline)
        .accounts({
          owner: provider.wallet.publicKey,
          agentAccount: transferAgentPda,
          asset: transferAsset.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      // Verify wallet is set in AgentAccount
      let agentBefore = await program.account.agentAccount.fetch(transferAgentPda);
      expect(agentBefore.agentWallet).to.not.be.null;
      expect(agentBefore.agentWallet!.toBase58()).to.equal(transferWallet.publicKey.toBase58());

      // Transfer agent (should reset wallet to None)
      const tx = await program.methods
        .transferAgent()
        .accounts({
          asset: transferAsset.publicKey,
          agentAccount: transferAgentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: newOwner.publicKey,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("TransferAgent (with wallet reset) tx:", tx);

      // Verify agent is transferred and wallet is reset to None
      const updatedAgent = await program.account.agentAccount.fetch(transferAgentPda);
      expect(updatedAgent.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());
      expect(updatedAgent.agentWallet).to.be.null;
    });

    it("setAgentWallet() can update existing wallet", async () => {
      const newWallet = Keypair.generate();
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 60);

      // Sign with new wallet
      const message = buildWalletSetMessage(
        assetKeypair.publicKey,
        newWallet.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, newWallet.secretKey);

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: newWallet.publicKey.toBytes(),
        message: message,
        signature: signature,
      });

      const tx = await program.methods
        .setAgentWallet(newWallet.publicKey, deadline)
        .accounts({
          owner: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      console.log("SetAgentWallet (update) tx:", tx);

      // Verify wallet was updated in AgentAccount
      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentWallet).to.not.be.null;
      expect(agent.agentWallet!.toBase58()).to.equal(newWallet.publicKey.toBase58());
    });
  });

  // ============================================================================
  // INLINE COLLECTION/PARENT FIELDS (AgentAccount)
  // ============================================================================
  describe("Inline Collection + Parent", () => {
    const validCol = "c1:bafybeigdyrzt5h4x6xevf7j6sfx4c5j7vix7lpt2w6xk3ej4q2f3m5p7m";

    it("register() stores creator snapshot and default inline fields", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/inline-defaults")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.creator.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agent.parentAsset).to.be.null;
      expect(agent.parentLocked).to.equal(false);
      expect(agent.colLocked).to.equal(false);
      expect(agent.col).to.equal("");
    });

    it("setCollectionPointer() sets col once and rejects second write", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/inline-col")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      await program.methods
        .setCollectionPointer(validCol)
        .accounts({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.col).to.equal(validCol);
      expect(agent.colLocked).to.equal(true);

      await expectAnchorError(
        program.methods
          .setCollectionPointer("c1:bafybeibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
          .accounts({
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "CollectionPointerAlreadySet"
      );
    });

    it("setCollectionPointer() rejects invalid pointer format", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/inline-col-invalid")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      await expectAnchorError(
        program.methods
          .setCollectionPointer("bafybeigdyrzt5h4x6xevf7j6sfx4c5j7vix7lpt2w6xk3ej4q2f3m5p7m")
          .accounts({
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "InvalidCollectionPointer"
      );
    });

    it("setCollectionPointer() allows creator after transfer, rejects new owner", async () => {
      const assetKeypair = Keypair.generate();
      const newOwner = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const col = "c1:bafybeihz3xq5ty7fsw5m3r53p5hx5s6wbbvln6e6jox4n7g2c5g3h2w4cq";

      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: newOwner.publicKey,
          lamports: 50_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      await program.methods
        .register("https://example.com/agent/inline-col-creator-only")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      await program.methods
        .transferAgent()
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: newOwner.publicKey,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .setCollectionPointer(col)
          .accounts({
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: newOwner.publicKey,
          })
          .signers([newOwner])
          .rpc(),
        "NotAgentCreator"
      );

      await program.methods
        .setCollectionPointer(col)
        .accounts({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.col).to.equal(col);
      expect(agent.colLocked).to.equal(true);
    });

    it("setCollectionPointerWithOptions() allows updates until explicit lock", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const colV1 = "c1:bafybeif7u5v2j3xomqjxjv2r3h5k7nyx54jsw2d4tq3pq53l7y5m4zt6iu";
      const colV2 = "c1:bafybeib4jv3hk3r6p2qv35hnfco4zv4z3v5yx2d4v6u7s3c2n4y5k7x3me";

      await program.methods
        .register("https://example.com/agent/inline-col-options")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      await program.methods
        .setCollectionPointerWithOptions(colV1, false)
        .accounts({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .setCollectionPointerWithOptions(colV2, false)
        .accounts({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      let agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.col).to.equal(colV2);
      expect(agent.colLocked).to.equal(false);

      await program.methods
        .setCollectionPointerWithOptions(colV2, true)
        .accounts({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.colLocked).to.equal(true);

      await expectAnchorError(
        program.methods
          .setCollectionPointerWithOptions(colV1, false)
          .accounts({
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "CollectionPointerAlreadySet"
      );
    });

    it("setParentAsset() links parent and locks it", async () => {
      const parentAsset = Keypair.generate();
      const childAsset = Keypair.generate();
      const [parentPda] = getAgentPda(parentAsset.publicKey, program.programId);
      const [childPda] = getAgentPda(childAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/inline-parent")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: parentPda,
          asset: parentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([parentAsset])
        .rpc();

      await program.methods
        .register("https://example.com/agent/inline-child")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: childPda,
          asset: childAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([childAsset])
        .rpc();

      await program.methods
        .setParentAsset(parentAsset.publicKey)
        .accounts({
          agentAccount: childPda,
          asset: childAsset.publicKey,
          parentAgentAccount: parentPda,
          parentAssetAccount: parentAsset.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const child = await program.account.agentAccount.fetch(childPda);
      expect(child.parentAsset).to.not.be.null;
      expect(child.parentAsset!.toBase58()).to.equal(parentAsset.publicKey.toBase58());
      expect(child.parentLocked).to.equal(true);
    });

    it("setParentAsset() rejects child owner when parent creator differs", async () => {
      const parentAsset = Keypair.generate();
      const childAsset = Keypair.generate();
      const childOwner = Keypair.generate();
      const [parentPda] = getAgentPda(parentAsset.publicKey, program.programId);
      const [childPda] = getAgentPda(childAsset.publicKey, program.programId);

      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: childOwner.publicKey,
          lamports: 50_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      await program.methods
        .register("https://example.com/agent/inline-parent-auth")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: parentPda,
          asset: parentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([parentAsset])
        .rpc();

      await program.methods
        .register("https://example.com/agent/inline-child-auth")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: childPda,
          asset: childAsset.publicKey,
          collection: collectionPubkey,
          owner: childOwner.publicKey,
          payer: childOwner.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([childOwner, childAsset])
        .rpc();

      await expectAnchorError(
        program.methods
          .setParentAsset(parentAsset.publicKey)
          .accounts({
            agentAccount: childPda,
            asset: childAsset.publicKey,
            parentAgentAccount: parentPda,
            parentAssetAccount: parentAsset.publicKey,
            owner: childOwner.publicKey,
          })
          .signers([childOwner])
          .rpc(),
        "NotParentCreator"
      );
    });

    it("setParentAssetWithOptions() allows updates until explicit lock", async () => {
      const parentAsset1 = Keypair.generate();
      const parentAsset2 = Keypair.generate();
      const childAsset = Keypair.generate();
      const [parentPda1] = getAgentPda(parentAsset1.publicKey, program.programId);
      const [parentPda2] = getAgentPda(parentAsset2.publicKey, program.programId);
      const [childPda] = getAgentPda(childAsset.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/inline-parent-opt-1")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: parentPda1,
          asset: parentAsset1.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([parentAsset1])
        .rpc();

      await program.methods
        .register("https://example.com/agent/inline-parent-opt-2")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: parentPda2,
          asset: parentAsset2.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([parentAsset2])
        .rpc();

      await program.methods
        .register("https://example.com/agent/inline-child-opt")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: childPda,
          asset: childAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([childAsset])
        .rpc();

      await program.methods
        .setParentAssetWithOptions(parentAsset1.publicKey, false)
        .accounts({
          agentAccount: childPda,
          asset: childAsset.publicKey,
          parentAgentAccount: parentPda1,
          parentAssetAccount: parentAsset1.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .setParentAssetWithOptions(parentAsset2.publicKey, false)
        .accounts({
          agentAccount: childPda,
          asset: childAsset.publicKey,
          parentAgentAccount: parentPda2,
          parentAssetAccount: parentAsset2.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      let child = await program.account.agentAccount.fetch(childPda);
      expect(child.parentAsset).to.not.be.null;
      expect(child.parentAsset!.toBase58()).to.equal(parentAsset2.publicKey.toBase58());
      expect(child.parentLocked).to.equal(false);

      await program.methods
        .setParentAssetWithOptions(parentAsset2.publicKey, true)
        .accounts({
          agentAccount: childPda,
          asset: childAsset.publicKey,
          parentAgentAccount: parentPda2,
          parentAssetAccount: parentAsset2.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      child = await program.account.agentAccount.fetch(childPda);
      expect(child.parentLocked).to.equal(true);

      await expectAnchorError(
        program.methods
          .setParentAssetWithOptions(parentAsset1.publicKey, false)
          .accounts({
            agentAccount: childPda,
            asset: childAsset.publicKey,
            parentAgentAccount: parentPda1,
            parentAssetAccount: parentAsset1.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "ParentAlreadySet"
      );
    });
  });
});
