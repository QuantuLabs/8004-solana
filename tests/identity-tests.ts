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
  AGENT_WALLET_KEY_HASH,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getMetadataEntryPda,
  getWalletMetadataPda,
  computeKeyHash,
  buildWalletSetMessage,
  stringOfLength,
  uriOfLength,
  expectAnchorError,
} from "./utils/helpers";
import { Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import * as nacl from "tweetnacl";

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

    // currentBaseRegistry IS the registryConfigPda (not the collection)
    registryConfigPda = rootConfig.currentBaseRegistry;
    console.log("DEBUG: Registry Config PDA =", registryConfigPda.toBase58());
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

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

    it("register() fails with URI > 200 bytes", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1); // 201 bytes

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

    it("setAgentUri() fails with URI > 200 bytes", async () => {
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
        .accountsPartial({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: newOwner.publicKey,
          walletMetadata: null, // No wallet set for this agent
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
      // v0.3.0: Use asset instead of agentId
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
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

      // Get balance before for rent measurement
      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      // Call setAgentWallet with Ed25519 instruction prepended
      const tx = await program.methods
        .setAgentWallet(walletKeypair.publicKey, deadline)
        .accounts({
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          walletMetadata: walletMetadataPda,
          asset: assetKeypair.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .rpc({ commitment: "confirmed" });

      console.log("SetAgentWallet tx:", tx);

      // Verify wallet was stored
      const metadata = await program.account.metadataEntryPda.fetch(walletMetadataPda);
      expect(metadata.metadataKey).to.equal("agentWallet");
      const storedWallet = new PublicKey(metadata.metadataValue);
      expect(storedWallet.toBase58()).to.equal(walletKeypair.publicKey.toBase58());
      expect(metadata.immutable).to.be.false;

      // Cost measurement
      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      const txInfo = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      console.log("=== setAgentWallet Cost ===");
      console.log("Compute Units:", txInfo?.meta?.computeUnitsConsumed);
      console.log("Transaction Fee:", txInfo?.meta?.fee, "lamports");
      console.log("Rent paid (first time):", balanceBefore - balanceAfter - (txInfo?.meta?.fee || 0), "lamports");
      console.log("Total cost:", balanceBefore - balanceAfter, "lamports");
    });

    it("setAgentWallet() fails with expired deadline", async () => {
      const newWallet = Keypair.generate();
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
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
            payer: provider.wallet.publicKey,
            agentAccount: agentPda,
            walletMetadata: walletMetadataPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "DeadlineExpired"
      );
    });

    it("setAgentWallet() fails with deadline too far in future", async () => {
      const newWallet = Keypair.generate();
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
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
            payer: provider.wallet.publicKey,
            agentAccount: agentPda,
            walletMetadata: walletMetadataPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "DeadlineTooFar"
      );
    });

    it("setAgentWallet() fails without Ed25519 verify instruction", async () => {
      const newWallet = Keypair.generate();
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
      const clock = await provider.connection.getSlot();
      const blockTime = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(blockTime! + 60);

      // Call without Ed25519 instruction
      await expectAnchorError(
        program.methods
          .setAgentWallet(newWallet.publicKey, deadline)
          .accounts({
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            agentAccount: agentPda,
            walletMetadata: walletMetadataPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "MissingSignatureVerification"
      );
    });

    it("setAgentWallet() fails if non-owner tries to set wallet", async () => {
      const fakeOwner = Keypair.generate();
      const newWallet = Keypair.generate();
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);

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
            payer: fakeOwner.publicKey,
            agentAccount: agentPda,
            walletMetadata: walletMetadataPda,
            asset: assetKeypair.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
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

    it("transferAgent() resets wallet PDA (closes it)", async () => {
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

      // v0.3.0: Use asset instead of agentId
      const [transferWalletPda] = getWalletMetadataPda(transferAsset.publicKey, program.programId);

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
          payer: provider.wallet.publicKey,
          agentAccount: transferAgentPda,
          walletMetadata: transferWalletPda,
          asset: transferAsset.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      // Verify wallet is set
      let walletAccount = await provider.connection.getAccountInfo(transferWalletPda);
      expect(walletAccount).to.not.be.null;

      // Transfer agent (should close wallet PDA)
      const tx = await program.methods
        .transferAgent()
        .accounts({
          asset: transferAsset.publicKey,
          agentAccount: transferAgentPda,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: newOwner.publicKey,
          walletMetadata: transferWalletPda,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("TransferAgent (with wallet reset) tx:", tx);

      // Verify wallet PDA is closed
      walletAccount = await provider.connection.getAccountInfo(transferWalletPda);
      expect(walletAccount).to.be.null;

      // Verify agent is transferred
      const updatedAgent = await program.account.agentAccount.fetch(transferAgentPda);
      expect(updatedAgent.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());
    });

    it("setAgentWallet() can update existing wallet", async () => {
      const newWallet = Keypair.generate();
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
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
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          walletMetadata: walletMetadataPda,
          asset: assetKeypair.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      console.log("SetAgentWallet (update) tx:", tx);

      // Verify wallet was updated
      const metadata = await program.account.metadataEntryPda.fetch(walletMetadataPda);
      const storedWallet = new PublicKey(metadata.metadataValue);
      expect(storedWallet.toBase58()).to.equal(newWallet.publicKey.toBase58());
    });
  });
});
