/**
 * Identity Module Tests for Agent Registry 8004 v0.2.0
 * Tests registration, metadata PDAs, URI operations, and ownership
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
  getConfigPda,
  getAgentPda,
  getMetadataEntryPda,
  computeKeyHash,
  stringOfLength,
  uriOfLength,
  expectAnchorError,
} from "./utils/helpers";

describe("Identity Module Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let configPda: PublicKey;
  let collectionPubkey: PublicKey;

  before(async () => {
    [configPda] = getConfigPda(program.programId);
    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    console.log("=== Identity Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
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

      const configBefore = await program.account.registryConfig.fetch(configPda);
      const expectedAgentId = configBefore.nextAgentId;

      const tx = await program.methods
        .register(uri)
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("Register with URI tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentId.toNumber()).to.equal(expectedAgentId.toNumber());
      expect(agent.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agent.agentUri).to.equal(uri);

      const configAfter = await program.account.registryConfig.fetch(configPda);
      expect(configAfter.nextAgentId.toNumber()).to.equal(expectedAgentId.toNumber() + 1);
      expect(configAfter.totalAgents.toNumber()).to.equal(configBefore.totalAgents.toNumber() + 1);
    });

    it("registerEmpty() without URI", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      const tx = await program.methods
        .registerEmpty()
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("RegisterEmpty tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
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
            config: configPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            collection: collectionPubkey,
            owner: provider.wallet.publicKey,
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
  // METADATA PDA OPERATION TESTS (v0.2.0)
  // ============================================================================
  describe("Metadata PDA Operations", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;
    let agentId: anchor.BN;

    before(async () => {
      // Register a fresh agent for metadata tests
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/metadata-test")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      agentId = agent.agentId;
    });

    it("setMetadataPda() creates new metadata entry", async () => {
      const key = "framework";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("solana-anchor");
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, newValue, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), longKey, value, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, longValue, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, value, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: fakeOwner.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, true)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      // Create metadata
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

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
        const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

        await program.methods
          .setMetadataPda(Array.from(keyHash), entry.key, Buffer.from(entry.value), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      // Verify all entries exist
      for (const entry of entries) {
        const keyHash = computeKeyHash(entry.key);
        const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);
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
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
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
          config: configPda,
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
            config: configPda,
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
            config: configPda,
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
    let agentId: anchor.BN;
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
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      agentId = agent.agentId;
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
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, Buffer.from("should_fail"), false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey, // old owner
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "Unauthorized"
      );
    });

    it("New owner can set metadata after transfer", async () => {
      const key = "new_owner_key";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agentId, keyHash, program.programId);

      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("new_owner_value"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: newOwner.publicKey,
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
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
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
});
