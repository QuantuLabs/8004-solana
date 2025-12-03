/**
 * Identity Module Tests for Agent Registry 8004
 * Tests registration, metadata, URI operations, extensions, and ownership
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
  getMetadataExtensionPda,
  randomUri,
  randomMetadataKey,
  randomMetadataValue,
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
      expect(agent.metadata).to.have.length(0);

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

    it("registerWithMetadata() with URI and initial metadata", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const uri = "https://example.com/agent/with-metadata";
      const metadata = [
        { metadataKey: "version", metadataValue: Buffer.from("1.0.0") },
      ];

      const tx = await program.methods
        .registerWithMetadata(uri, metadata)
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

      console.log("RegisterWithMetadata tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentUri).to.equal(uri);
      expect(agent.metadata).to.have.length(1);
      expect(agent.metadata[0].metadataKey).to.equal("version");
      expect(Buffer.from(agent.metadata[0].metadataValue).toString()).to.equal("1.0.0");
    });

    it("registerWithMetadata() fails with > MAX_METADATA_ENTRIES", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const uri = "https://example.com/agent/too-much-metadata";
      const metadata = [
        { metadataKey: "key1", metadataValue: Buffer.from("value1") },
        { metadataKey: "key2", metadataValue: Buffer.from("value2") },
      ];

      await expectAnchorError(
        program.methods
          .registerWithMetadata(uri, metadata)
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
        "MetadataLimitReached"
      );
    });
  });

  // ============================================================================
  // METADATA OPERATION TESTS
  // ============================================================================
  describe("Metadata Operations", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

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
    });

    it("setMetadata() adds new entry", async () => {
      const key = "framework";
      const value = Buffer.from("solana-anchor");

      const tx = await program.methods
        .setMetadata(key, value)
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("SetMetadata (add) tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      const entry = agent.metadata.find((m) => m.metadataKey === key);
      expect(entry).to.exist;
      expect(Buffer.from(entry!.metadataValue).toString()).to.equal("solana-anchor");
    });

    it("setMetadata() updates existing entry", async () => {
      const key = "framework";
      const newValue = Buffer.from("anchor-v0.31");

      const tx = await program.methods
        .setMetadata(key, newValue)
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("SetMetadata (update) tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      const entry = agent.metadata.find((m) => m.metadataKey === key);
      expect(Buffer.from(entry!.metadataValue).toString()).to.equal("anchor-v0.31");
      // Still only 1 entry
      expect(agent.metadata).to.have.length(1);
    });

    it("setMetadata() fails with key > 32 bytes", async () => {
      const longKey = stringOfLength(MAX_METADATA_KEY_LENGTH + 1);
      const value = Buffer.from("test");

      await expectAnchorError(
        program.methods
          .setMetadata(longKey, value)
          .accounts({
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "KeyTooLong"
      );
    });

    it("setMetadata() fails with value > 256 bytes", async () => {
      const key = "big_value";
      const longValue = Buffer.alloc(MAX_METADATA_VALUE_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .setMetadata(key, longValue)
          .accounts({
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc(),
        "ValueTooLong"
      );
    });

    it("setMetadata() fails if non-owner", async () => {
      const fakeOwner = Keypair.generate();
      const key = "unauthorized";
      const value = Buffer.from("test");

      await expectAnchorError(
        program.methods
          .setMetadata(key, value)
          .accounts({
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            owner: fakeOwner.publicKey,
          })
          .signers([fakeOwner])
          .rpc(),
        "Unauthorized"
      );
    });

    it("getMetadata() returns existing value", async () => {
      const key = "framework";

      // Note: getMetadata is a view function, we can call it via simulate
      const result = await program.methods
        .getMetadata(key)
        .accounts({
          agentAccount: agentPda,
        })
        .view();

      expect(Buffer.from(result).toString()).to.equal("anchor-v0.31");
    });

    it("getMetadata() returns empty for non-existent key", async () => {
      const result = await program.methods
        .getMetadata("nonexistent_key")
        .accounts({
          agentAccount: agentPda,
        })
        .view();

      expect(result).to.have.length(0);
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
  // METADATA EXTENSION TESTS
  // ============================================================================
  describe("Metadata Extensions", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;
    const extensionIndex = 0;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/agent/extension-test")
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

    it("createMetadataExtension() creates extension PDA", async () => {
      const [extensionPda] = getMetadataExtensionPda(
        assetKeypair.publicKey,
        extensionIndex,
        program.programId
      );

      const tx = await program.methods
        .createMetadataExtension(extensionIndex)
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          metadataExtension: extensionPda,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("CreateMetadataExtension tx:", tx);

      const extension = await program.account.metadataExtension.fetch(extensionPda);
      expect(extension.extensionIndex).to.equal(extensionIndex);
      expect(extension.metadata).to.have.length(0);
    });

    it("setMetadataExtended() adds metadata in extension", async () => {
      const [extensionPda] = getMetadataExtensionPda(
        assetKeypair.publicKey,
        extensionIndex,
        program.programId
      );

      const key = "extended_key1";
      const value = Buffer.from("extended_value1");

      const tx = await program.methods
        .setMetadataExtended(extensionIndex, key, value)
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          metadataExtension: extensionPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("SetMetadataExtended tx:", tx);

      const extension = await program.account.metadataExtension.fetch(extensionPda);
      expect(extension.metadata).to.have.length(1);
      expect(extension.metadata[0].metadataKey).to.equal(key);
    });

    it("getMetadataExtended() reads metadata from extension", async () => {
      const [extensionPda] = getMetadataExtensionPda(
        assetKeypair.publicKey,
        extensionIndex,
        program.programId
      );

      const result = await program.methods
        .getMetadataExtended(extensionIndex, "extended_key1")
        .accounts({
          asset: assetKeypair.publicKey,
          metadataExtension: extensionPda,
        })
        .view();

      expect(Buffer.from(result).toString()).to.equal("extended_value1");
    });

    it("Extension allows multiple entries (more than base account)", async () => {
      const [extensionPda] = getMetadataExtensionPda(
        assetKeypair.publicKey,
        extensionIndex,
        program.programId
      );

      // Add more entries to extension
      for (let i = 2; i <= 5; i++) {
        await program.methods
          .setMetadataExtended(extensionIndex, `extended_key${i}`, Buffer.from(`value${i}`))
          .accounts({
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            metadataExtension: extensionPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();
      }

      const extension = await program.account.metadataExtension.fetch(extensionPda);
      expect(extension.metadata.length).to.be.greaterThan(1);
      console.log("Extension now has", extension.metadata.length, "entries");
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

    it("Old owner can no longer update metadata after transfer", async () => {
      await expectAnchorError(
        program.methods
          .setMetadata("post_transfer", Buffer.from("should_fail"))
          .accounts({
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            owner: provider.wallet.publicKey, // old owner
          })
          .rpc(),
        "Unauthorized"
      );
    });

    it("New owner can update metadata after transfer", async () => {
      const tx = await program.methods
        .setMetadata("new_owner_key", Buffer.from("new_owner_value"))
        .accounts({
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          owner: newOwner.publicKey,
        })
        .signers([newOwner])
        .rpc();

      console.log("New owner setMetadata tx:", tx);

      const agent = await program.account.agentAccount.fetch(agentPda);
      const entry = agent.metadata.find((m) => m.metadataKey === "new_owner_key");
      expect(entry).to.exist;
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
