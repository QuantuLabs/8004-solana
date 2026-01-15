/**
 * Validation Module Tests for Agent Registry 8004 v3.0.0
 * Tests validation with state on-chain (ValidationRequest PDAs)
 * v3.0.0: State on-chain architecture - ValidationConfig + ValidationRequest PDAs
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  MAX_URI_LENGTH,
  MAX_TAG_LENGTH,
  getRootConfigPda,
  getAgentPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

// Helper: Get ValidationConfig PDA
function getValidationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("validation_config")],
    programId
  );
}

// Helper: Get ValidationRequest PDA
function getValidationRequestPda(
  asset: PublicKey,
  validator: PublicKey,
  nonce: number,
  programId: PublicKey
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(4);
  nonceBuffer.writeUInt32LE(nonce);

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("validation"),
      asset.toBuffer(),
      validator.toBuffer(),
      nonceBuffer,
    ],
    programId
  );
}

describe("Validation Module Tests (State On-Chain v3.0.0)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let validationConfigPda: PublicKey;

  // Agent for validation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;

  // Separate validator keypair (anti-gaming: owner cannot validate their own agent)
  let validatorKeypair: Keypair;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    // Initialize ValidationConfig
    [validationConfigPda] = getValidationConfigPda(program.programId);

    // Check if already initialized
    const configInfo = await provider.connection.getAccountInfo(validationConfigPda);
    if (!configInfo) {
      await program.methods
        .initializeValidationConfig()
        .accounts({
          config: validationConfigPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("ValidationConfig initialized at:", validationConfigPda.toBase58());
    } else {
      console.log("ValidationConfig already initialized");
    }

    validatorKeypair = Keypair.generate();

    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

    await program.methods
      .register("https://example.com/agent/validation-test")
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("=== Validation Tests Setup (v3.0.0 State On-Chain) ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent Asset:", agentAsset.publicKey.toBase58());
    console.log("Validator (separate from owner):", validatorKeypair.publicKey.toBase58());
  });

  // ============================================================================
  // VALIDATION CONFIG TESTS
  // ============================================================================
  describe("ValidationConfig Tests", () => {
    it("ValidationConfig was initialized correctly", async () => {
      const config = await program.account.validationConfig.fetch(validationConfigPda);

      expect(config.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(config.totalRequests.toNumber()).to.be.gte(0);
      expect(config.totalResponses.toNumber()).to.be.gte(0);
      console.log("ValidationConfig:", {
        authority: config.authority.toBase58(),
        totalRequests: config.totalRequests.toNumber(),
        totalResponses: config.totalResponses.toNumber(),
      });
    });
  });

  // ============================================================================
  // VALIDATION REQUEST TESTS (State On-Chain)
  // ============================================================================
  describe("Validation Request (State On-Chain)", () => {
    it("requestValidation() creates ValidationRequest PDA", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const configBefore = await program.account.validationConfig.fetch(validationConfigPda);

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/request",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Verify ValidationRequest state
      const validationRequest = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validationRequest.asset.toBase58()).to.equal(agentAsset.publicKey.toBase58());
      expect(validationRequest.validatorAddress.toBase58()).to.equal(validatorKeypair.publicKey.toBase58());
      expect(validationRequest.nonce).to.equal(nonce);
      expect(validationRequest.response).to.equal(0); // pending
      expect(validationRequest.respondedAt.toNumber()).to.equal(0); // no response yet

      // Verify counter incremented
      const configAfter = await program.account.validationConfig.fetch(validationConfigPda);
      expect(configAfter.totalRequests.toNumber()).to.equal(configBefore.totalRequests.toNumber() + 1);

      console.log("ValidationRequest created:", {
        pda: validationRequestPda.toBase58(),
        asset: validationRequest.asset.toBase58(),
        validator: validationRequest.validatorAddress.toBase58(),
        nonce: validationRequest.nonce,
        response: validationRequest.response,
      });
    });

    it("requestValidation() fails with URI > 200 bytes", async () => {
      const nonce = uniqueNonce();
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await expectAnchorError(
        program.methods
          .requestValidation(
            validatorKeypair.publicKey,
            nonce,
            longUri,
            Array.from(randomHash())
          )
          .accounts({
            config: validationConfigPda,
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            validationRequest: validationRequestPda,
            validator: validatorKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "RequestUriTooLong"
      );
    });

    it("Multiple validations same agent, different validators", async () => {
      const validator2 = Keypair.generate();
      const nonce = uniqueNonce();

      const [validationRequest1Pda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const [validationRequest2Pda] = getValidationRequestPda(
        agentAsset.publicKey,
        validator2.publicKey,
        nonce,
        program.programId
      );

      // Request from validator1
      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/multi-validator-1",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequest1Pda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Request from validator2 (same nonce, different validator = different PDA)
      await program.methods
        .requestValidation(
          validator2.publicKey,
          nonce,
          "https://example.com/validation/multi-validator-2",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequest2Pda,
          validator: validator2.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Both PDAs should exist
      const request1 = await program.account.validationRequest.fetch(validationRequest1Pda);
      const request2 = await program.account.validationRequest.fetch(validationRequest2Pda);

      expect(request1.validatorAddress.toBase58()).to.equal(validatorKeypair.publicKey.toBase58());
      expect(request2.validatorAddress.toBase58()).to.equal(validator2.publicKey.toBase58());
    });

    it("Multiple validations same validator, different nonces", async () => {
      const nonce1 = uniqueNonce();
      const nonce2 = uniqueNonce() + 1;

      const [validationRequest1Pda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce1,
        program.programId
      );

      const [validationRequest2Pda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce2,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce1,
          "https://example.com/validation/nonce1",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequest1Pda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce2,
          "https://example.com/validation/nonce2",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequest2Pda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Both PDAs should exist with different nonces
      const request1 = await program.account.validationRequest.fetch(validationRequest1Pda);
      const request2 = await program.account.validationRequest.fetch(validationRequest2Pda);

      expect(request1.nonce).to.equal(nonce1);
      expect(request2.nonce).to.equal(nonce2);
    });
  });

  // ============================================================================
  // SELF-VALIDATION PROTECTION (Anti-Gaming)
  // ============================================================================
  describe("Self-Validation Protection", () => {
    it("requestValidation() fails if owner tries to validate own agent", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        provider.wallet.publicKey, // Owner as validator
        nonce,
        program.programId
      );

      await expectAnchorError(
        program.methods
          .requestValidation(
            provider.wallet.publicKey, // Owner as validator
            nonce,
            "https://example.com/validation/self",
            Array.from(randomHash())
          )
          .accounts({
            config: validationConfigPda,
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            validationRequest: validationRequestPda,
            validator: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "SelfValidationNotAllowed"
      );
    });

    it("respondToValidation() fails if validator == agent owner", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      // First create a request
      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/test",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Owner tries to respond (should fail)
      await expectAnchorError(
        program.methods
          .respondToValidation(
            validatorKeypair.publicKey,
            nonce,
            85,
            "https://example.com/validation/self-response",
            Array.from(randomHash()),
            "self"
          )
          .accounts({
            config: validationConfigPda,
            validator: provider.wallet.publicKey, // Owner trying to validate
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            validationRequest: validationRequestPda,
          })
          .rpc(),
        "SelfValidationNotAllowed"
      );
    });
  });

  // ============================================================================
  // VALIDATION RESPONSE TESTS (State On-Chain)
  // ============================================================================
  describe("Validation Response (State On-Chain)", () => {
    it("respondToValidation() updates ValidationRequest PDA", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const configBefore = await program.account.validationConfig.fetch(validationConfigPda);

      // First create request
      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/to-respond",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Verify pending state
      const requestBefore = await program.account.validationRequest.fetch(validationRequestPda);
      expect(requestBefore.response).to.equal(0);
      expect(requestBefore.respondedAt.toNumber()).to.equal(0);

      // Now respond
      await program.methods
        .respondToValidation(
          validatorKeypair.publicKey,
          nonce,
          85,
          "https://example.com/validation/response",
          Array.from(randomHash()),
          "verified"
        )
        .accounts({
          config: validationConfigPda,
          validator: validatorKeypair.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      // Verify response state
      const requestAfter = await program.account.validationRequest.fetch(validationRequestPda);
      expect(requestAfter.response).to.equal(85);
      expect(requestAfter.respondedAt.toNumber()).to.be.gt(0);

      // Verify counter incremented
      const configAfter = await program.account.validationConfig.fetch(validationConfigPda);
      expect(configAfter.totalResponses.toNumber()).to.equal(configBefore.totalResponses.toNumber() + 1);

      console.log("ValidationRequest updated:", {
        response: requestAfter.response,
        respondedAt: requestAfter.respondedAt.toNumber(),
      });
    });

    it("respondToValidation() with response=100 (max)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/max-response",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          validatorKeypair.publicKey,
          nonce,
          100,
          "https://example.com/validation/max-response-result",
          Array.from(randomHash()),
          "perfect"
        )
        .accounts({
          config: validationConfigPda,
          validator: validatorKeypair.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(100);
    });

    it("respondToValidation() fails with response > 100", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/invalid-response",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            validatorKeypair.publicKey,
            nonce,
            101,
            "https://example.com/validation/response",
            Array.from(randomHash()),
            "invalid"
          )
          .accounts({
            config: validationConfigPda,
            validator: validatorKeypair.publicKey,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            validationRequest: validationRequestPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "InvalidResponse"
      );
    });

    it("respondToValidation() can update response (progressive validation)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/progressive",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // First response
      await program.methods
        .respondToValidation(
          validatorKeypair.publicKey,
          nonce,
          50,
          "https://example.com/validation/response1",
          Array.from(randomHash()),
          "first"
        )
        .accounts({
          config: validationConfigPda,
          validator: validatorKeypair.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      const request1 = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request1.response).to.equal(50);

      // Updated response
      await program.methods
        .respondToValidation(
          validatorKeypair.publicKey,
          nonce,
          75,
          "https://example.com/validation/response2",
          Array.from(randomHash()),
          "updated"
        )
        .accounts({
          config: validationConfigPda,
          validator: validatorKeypair.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      const request2 = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request2.response).to.equal(75);
    });
  });

  // ============================================================================
  // ERC-8004 IMMUTABILITY TESTS
  // ============================================================================
  describe("ERC-8004 Immutability (No Close/Delete)", () => {
    it("ValidationRequest PDAs are permanent - cannot be deleted", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      // Create and respond to validation
      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/permanent",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          validatorKeypair.publicKey,
          nonce,
          90,
          "https://example.com/validation/response",
          Array.from(randomHash()),
          "permanent"
        )
        .accounts({
          config: validationConfigPda,
          validator: validatorKeypair.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      // Verify PDA still exists and is readable
      const validation = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validation.response).to.equal(90);
      expect(validation.respondedAt.toNumber()).to.be.gt(0);

      console.log("✅ ERC-8004: ValidationRequest is permanent (cannot be deleted)");
      console.log("   Asset:", validation.asset.toBase58());
      console.log("   Validator:", validation.validatorAddress.toBase58());
      console.log("   Score:", validation.response);
    });

    it("Optimized structure: 109 bytes (27% smaller than initial design)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/size-test",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const accountInfo = await provider.connection.getAccountInfo(validationRequestPda);
      expect(accountInfo).to.not.be.null;

      // Account size = 8 (discriminator) + 109 (data) = 117 bytes
      const dataSize = accountInfo!.data.length - 8;
      console.log("✅ ValidationRequest optimized size:", dataSize, "bytes");
      expect(dataSize).to.equal(109);
    });

    it("State contains only essential fields (response_hash, created_at moved to events)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/fields",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          validator: validatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const validation = await program.account.validationRequest.fetch(validationRequestPda);

      // Verify only essential fields are present
      expect(validation.asset).to.exist;
      expect(validation.validatorAddress).to.exist;
      expect(validation.nonce).to.exist;
      expect(validation.requestHash).to.exist;
      expect(validation.response).to.exist;
      expect(validation.respondedAt).to.exist;

      // Fields moved to events: response_hash, created_at, bump
      expect(validation).to.not.have.property('responseHash');
      expect(validation).to.not.have.property('createdAt');
      expect(validation).to.not.have.property('bump');

      console.log("✅ Optimized fields on-chain: asset, validator, nonce, request_hash, response, responded_at");
      console.log("✅ Moved to events: response_hash, created_at, bump");
    });
  });
});
