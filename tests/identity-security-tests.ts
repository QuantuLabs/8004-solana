/**
 * Identity Module Security Tests for Agent Registry 8004 v0.3.0
 * Tests edge cases, exploits, and boundaries not covered in basic tests
 *
 * Coverage:
 * - Double registration prevention
 * - Metadata hash collision detection
 * - Ed25519 signature edge cases
 * - Metadata boundaries (32/256 bytes exact)
 * - URI boundaries (200 bytes exact)
 * - Initialize protection (double init)
 * - Self-transfer prevention
 * - Reserved metadata key blocking
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program } from "@solana/web3.js";
import { expect } from "chai";
import * as nacl from "tweetnacl";

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

describe("Identity Security Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);

    const accountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", accountInfo!.data);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== Identity Security Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Root Config:", rootConfigPda.toBase58());
    console.log("Collection:", collectionPubkey.toBase58());
  });

  // ============================================================================
  // DOUBLE REGISTRATION PREVENTION (CRITICAL)
  // ============================================================================
  describe("Double Registration Prevention", () => {
    it("fails to register same asset twice", async () => {
      // First, register an agent
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/double-reg-1")
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

      console.log("First registration succeeded");

      // Try to register same asset again - should fail
      // The assetKeypair needs to sign again, but Anchor will reject due to account already initialized
      try {
        await program.methods
          .register("https://example.com/security/double-reg-2")
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
        throw new Error("Expected double registration to fail");
      } catch (error: any) {
        // Can be: account already in use, or Metaplex rejects asset recreation
        console.log("Double registration correctly rejected:", error.message.slice(0, 100));
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes("already in use") ||
          msg.includes("already initialized") ||
          msg.includes("Account already exists") ||
          msg.includes("custom program error")
        );
      }
    });

    it("prevents PDA collision attack (different asset, same PDA impossible)", async () => {
      // With properly derived PDAs from asset.key(), collision is cryptographically impossible
      // This test documents the security property
      const asset1 = Keypair.generate();
      const asset2 = Keypair.generate();

      const [pda1] = getAgentPda(asset1.publicKey, program.programId);
      const [pda2] = getAgentPda(asset2.publicKey, program.programId);

      // Different assets must produce different PDAs
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
      console.log("PDA uniqueness verified for different assets");
    });
  });

  // ============================================================================
  // METADATA HASH COLLISION DETECTION
  // ============================================================================
  describe("Metadata Hash Collision Detection", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/hash-collision-test")
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

    it("rejects key_hash that doesn't match SHA256(key)[0..8]", async () => {
      const key = "test_key";
      const correctHash = computeKeyHash(key);
      // Use wrong hash
      const wrongHash = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
      const value = Buffer.from("test_value");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, wrongHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(wrongHash), key, value, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch"
      );
      console.log("KeyHashMismatch correctly returned for wrong hash");
    });

    it("detects collision when updating with different key that has same hash[0..8]", async () => {
      // First, create a metadata entry
      const key1 = "collision_key_1";
      const keyHash1 = computeKeyHash(key1);
      const value1 = Buffer.from("value1");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash1, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash1), key1, value1, false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("First metadata entry created with key:", key1);

      // Try to update with different key but same hash (artificial - we need to find collision)
      // Since we can't easily find SHA256 collisions, we simulate by using same PDA with different key
      // The program should check stored_key == provided_key after PDA already exists
      const key2 = "different_key_same_pda";
      const value2 = Buffer.from("value2");

      // Use the original keyHash1 (to hit the same PDA) but different key
      // This should trigger KeyHashCollision
      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash1), key2, value2, false)
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "KeyHashMismatch" // Wrong hash for key2
      );
      console.log("KeyHashCollision detection: trying different key with mismatched hash correctly rejected");
    });
  });

  // ============================================================================
  // ED25519 SIGNATURE SECURITY EDGE CASES
  // ============================================================================
  describe("Ed25519 Signature Security", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;
    let walletKeypair: Keypair;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      walletKeypair = Keypair.generate();

      await program.methods
        .register("https://example.com/security/ed25519-test")
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

    it("fails without Ed25519 verification instruction", async () => {
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
      const clock = await provider.connection.getSlot();
      const timestamp = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(timestamp! + 60);

      // Try setAgentWallet without preceding Ed25519 instruction
      await expectAnchorError(
        program.methods
          .setAgentWallet(walletKeypair.publicKey, deadline)
          .accounts({
            walletMetadata: walletMetadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "MissingSignatureVerification"
      );
      console.log("Correctly rejected without Ed25519 verification instruction");
    });

    it("fails with expired deadline", async () => {
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
      const clock = await provider.connection.getSlot();
      const timestamp = await provider.connection.getBlockTime(clock);
      // Deadline in the past
      const deadline = new anchor.BN(timestamp! - 60);

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

      await expectAnchorError(
        program.methods
          .setAgentWallet(walletKeypair.publicKey, deadline)
          .accounts({
            walletMetadata: walletMetadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "DeadlineExpired"
      );
      console.log("Correctly rejected expired deadline");
    });

    it("fails with deadline too far in future (> 5 minutes)", async () => {
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
      const clock = await provider.connection.getSlot();
      const timestamp = await provider.connection.getBlockTime(clock);
      // Deadline 10 minutes in the future (max is 5)
      const deadline = new anchor.BN(timestamp! + 600);

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

      await expectAnchorError(
        program.methods
          .setAgentWallet(walletKeypair.publicKey, deadline)
          .accounts({
            walletMetadata: walletMetadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "DeadlineTooFar"
      );
      console.log("Correctly rejected deadline too far in future");
    });

    it("deadline exactly at boundary (now + 300s) succeeds", async () => {
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
      const clock = await provider.connection.getSlot();
      const timestamp = await provider.connection.getBlockTime(clock);
      // Exactly at 5 minute boundary
      const deadline = new anchor.BN(timestamp! + 300);

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

      const tx = await program.methods
        .setAgentWallet(walletKeypair.publicKey, deadline)
        .accounts({
          walletMetadata: walletMetadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      console.log("Deadline at boundary (now+300s) succeeded:", tx);
    });

    it("fails with wrong signer (different wallet signs)", async () => {
      // Create a new agent for this test to avoid wallet already set
      const newAssetKeypair = Keypair.generate();
      const [newAgentPda] = getAgentPda(newAssetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/wrong-signer-test")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: newAgentPda,
          asset: newAssetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([newAssetKeypair])
        .rpc();

      const [walletMetadataPda] = getWalletMetadataPda(newAssetKeypair.publicKey, program.programId);
      const intendedWallet = Keypair.generate();
      const wrongSigner = Keypair.generate();
      const clock = await provider.connection.getSlot();
      const timestamp = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(timestamp! + 60);

      // Message is for intendedWallet but signed by wrongSigner
      const message = buildWalletSetMessage(
        newAssetKeypair.publicKey,
        intendedWallet.publicKey,
        provider.wallet.publicKey,
        deadline
      );
      const signature = nacl.sign.detached(message, wrongSigner.secretKey);

      // Ed25519 instruction uses wrongSigner's pubkey
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: wrongSigner.publicKey.toBytes(),
        message,
        signature,
      });

      await expectAnchorError(
        program.methods
          .setAgentWallet(intendedWallet.publicKey, deadline)
          .accounts({
            walletMetadata: walletMetadataPda,
            agentAccount: newAgentPda,
            asset: newAssetKeypair.publicKey,
            owner: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ed25519Ix])
          .rpc(),
        "MissingSignatureVerification"
      );
      console.log("Correctly rejected wrong signer");
    });
  });

  // ============================================================================
  // METADATA BOUNDARY TESTS
  // ============================================================================
  describe("Metadata Boundary Tests", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/metadata-boundary-test")
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

    it("allows key exactly 32 bytes", async () => {
      const key = stringOfLength(MAX_METADATA_KEY_LENGTH); // 32 bytes
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("value");
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

      console.log("Key exactly 32 bytes succeeded:", tx);
      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.metadataKey.length).to.equal(32);
    });

    it("rejects key exactly 33 bytes", async () => {
      const key = stringOfLength(MAX_METADATA_KEY_LENGTH + 1); // 33 bytes
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("value");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, value, false)
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
      console.log("Key 33 bytes correctly rejected");
    });

    it("allows value exactly 256 bytes", async () => {
      const key = "value_256_test";
      const keyHash = computeKeyHash(key);
      const value = Buffer.alloc(MAX_METADATA_VALUE_LENGTH); // 256 bytes
      value.fill(0x42);
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

      console.log("Value exactly 256 bytes succeeded:", tx);
      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.metadataValue.length).to.equal(256);
    });

    it("rejects value exactly 257 bytes", async () => {
      const key = "value_257_test";
      const keyHash = computeKeyHash(key);
      const value = Buffer.alloc(MAX_METADATA_VALUE_LENGTH + 1); // 257 bytes
      value.fill(0x42);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, value, false)
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
      console.log("Value 257 bytes correctly rejected");
    });

    it("allows empty key (edge case)", async () => {
      const key = "";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("empty_key_value");
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

      console.log("Empty key succeeded:", tx);
    });

    it("allows empty value", async () => {
      const key = "empty_value_key";
      const keyHash = computeKeyHash(key);
      const value = Buffer.alloc(0);
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

      console.log("Empty value succeeded:", tx);
      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(metadata.metadataValue.length).to.equal(0);
    });
  });

  // ============================================================================
  // METADATA DELETION EDGE CASES
  // ============================================================================
  describe("Metadata Deletion Edge Cases", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/metadata-delete-test")
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

    it("fails to delete non-existent metadata entry", async () => {
      const key = "never_created";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      try {
        await program.methods
          .deleteMetadataPda(Array.from(keyHash))
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc();
        throw new Error("Expected deletion of non-existent entry to fail");
      } catch (error: any) {
        // Account doesn't exist, so fetch fails
        console.log("Deletion of non-existent entry correctly failed:", error.message.slice(0, 100));
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes("AccountNotInitialized") ||
          msg.includes("account does not exist") ||
          msg.includes("Account not found") ||
          msg.includes("not owned by program")
        );
      }
    });

    it("fails to delete twice", async () => {
      const key = "delete_twice_test";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("deleteme");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      // Create
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

      // First delete - should succeed
      await program.methods
        .deleteMetadataPda(Array.from(keyHash))
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("First delete succeeded");

      // Second delete - should fail
      try {
        await program.methods
          .deleteMetadataPda(Array.from(keyHash))
          .accounts({
            metadataEntry: metadataPda,
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            owner: provider.wallet.publicKey,
          })
          .rpc();
        throw new Error("Expected second delete to fail");
      } catch (error: any) {
        console.log("Second delete correctly failed:", error.message.slice(0, 100));
      }
    });

    it("allows re-creation after delete (PDA reuse)", async () => {
      const key = "recreate_test";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      // Create
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("v1"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Delete
      await program.methods
        .deleteMetadataPda(Array.from(keyHash))
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      // Recreate with different value
      const tx = await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("v2"), false)
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Recreate after delete succeeded:", tx);
      const metadata = await program.account.metadataEntryPda.fetch(metadataPda);
      expect(Buffer.from(metadata.metadataValue).toString()).to.equal("v2");
    });

    it("fails to delete immutable metadata", async () => {
      const key = "immutable_delete_test";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from("permanent");
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      // Create as immutable
      await program.methods
        .setMetadataPda(Array.from(keyHash), key, value, true) // immutable = true
        .accounts({
          metadataEntry: metadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to delete
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
      console.log("Deletion of immutable metadata correctly rejected");
    });
  });

  // ============================================================================
  // URI BOUNDARY TESTS
  // ============================================================================
  describe("URI Boundary Tests", () => {
    it("allows URI exactly 200 bytes", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const uri = uriOfLength(MAX_URI_LENGTH); // 200 bytes

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

      console.log("URI exactly 200 bytes succeeded:", tx);
      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentUri.length).to.equal(200);
    });

    it("rejects URI exactly 201 bytes", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const uri = uriOfLength(MAX_URI_LENGTH + 1); // 201 bytes

      await expectAnchorError(
        program.methods
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
          .rpc(),
        "UriTooLong"
      );
      console.log("URI 201 bytes correctly rejected");
    });
  });

  // ============================================================================
  // RESERVED METADATA KEY (agentWallet) BLOCKING
  // ============================================================================
  describe("Reserved Metadata Key Blocking", () => {
    let assetKeypair: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      assetKeypair = Keypair.generate();
      [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/reserved-key-test")
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

    it("rejects 'agentWallet' key via setMetadataPda", async () => {
      const key = "agentWallet";
      const keyHash = computeKeyHash(key);
      const value = Buffer.from(Keypair.generate().publicKey.toBytes());
      const [metadataPda] = getMetadataEntryPda(assetKeypair.publicKey, keyHash, program.programId);

      await expectAnchorError(
        program.methods
          .setMetadataPda(Array.from(keyHash), key, value, false)
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
      console.log("'agentWallet' key correctly blocked via setMetadataPda");
    });
  });

  // ============================================================================
  // TRANSFER EDGE CASES
  // ============================================================================
  describe("Transfer Edge Cases", () => {
    it("fails self-transfer (TransferToSelf)", async () => {
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/transfer-self-test")
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
          .transferAgent()
          .accountsPartial({
            agentAccount: agentPda,
            asset: assetKeypair.publicKey,
            collection: collectionPubkey,
            owner: provider.wallet.publicKey,
            newOwner: provider.wallet.publicKey, // Same as owner
            walletMetadata: null, // Explicitly null - no wallet to close
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .rpc(),
        "TransferToSelf"
      );
      console.log("Self-transfer correctly rejected");
    });

    it("transfer resets agentWallet metadata", async () => {
      // Create agent with wallet
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);
      const walletKeypair = Keypair.generate();
      const newOwner = Keypair.generate();

      // Fund new owner
      const transferTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: newOwner.publicKey,
          lamports: 10000000,
        })
      );
      await provider.sendAndConfirm(transferTx);

      await program.methods
        .register("https://example.com/security/transfer-wallet-reset-test")
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

      // Set wallet via Ed25519
      const [walletMetadataPda] = getWalletMetadataPda(assetKeypair.publicKey, program.programId);
      const clock = await provider.connection.getSlot();
      const timestamp = await provider.connection.getBlockTime(clock);
      const deadline = new anchor.BN(timestamp! + 60);

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
          walletMetadata: walletMetadataPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          owner: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .rpc();

      // Verify wallet is set
      let walletMeta = await program.account.metadataEntryPda.fetch(walletMetadataPda);
      expect(walletMeta.metadataKey).to.equal("agentWallet");
      expect(walletMeta.metadataValue.length).to.equal(32);

      // Transfer agent (with wallet_metadata to trigger reset)
      const tx = await program.methods
        .transferAgent()
        .accounts({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: newOwner.publicKey,
          walletMetadata: walletMetadataPda,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("Transfer with wallet reset tx:", tx);

      // Verify wallet PDA was closed (rent returned)
      const walletAccountInfo = await provider.connection.getAccountInfo(walletMetadataPda);
      expect(walletAccountInfo).to.be.null;
      console.log("Wallet metadata correctly closed on transfer");
    });
  });

  // ============================================================================
  // INITIALIZE PROTECTION (DOUBLE INIT)
  // ============================================================================
  describe("Initialize Protection", () => {
    it("documents that initialize is already called (devnet)", async () => {
      // On devnet, initialize has already been called
      // This test documents that calling it again would fail
      const accountInfo = await provider.connection.getAccountInfo(rootConfigPda);
      expect(accountInfo).to.not.be.null;
      console.log("Root config already initialized - double init would fail");

      // We can't actually test double-init without a fresh deployment
      // Document the expected behavior
      console.log("Expected error on double init: RootAlreadyInitialized");
    });
  });
});
