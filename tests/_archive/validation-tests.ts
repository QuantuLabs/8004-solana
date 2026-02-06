/**
 * Validation Module Tests for Agent Registry 8004 v3.0.0
 * Tests validation request and response with on-chain state
 * v3.0.0: On-chain ValidationRequest PDAs (109 bytes, permanent)
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey, Transaction } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  MAX_URI_LENGTH,
  MAX_TAG_LENGTH,
  getRootConfigPda,
  getAgentPda,
  getValidationConfigPda,
  getValidationRequestPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

// Helper to fund a keypair from the provider wallet
async function fundKeypair(
  provider: anchor.AnchorProvider,
  keypair: Keypair,
  lamports: number
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: keypair.publicKey,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx);
}

describe("Validation Module Tests (On-Chain v3.0.0)", () => {
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
    [validationConfigPda] = getValidationConfigPda(program.programId);

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    registryConfigPda = rootConfig.baseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    validatorKeypair = Keypair.generate();
    // Fund validator for paying validation request rent
    await fundKeypair(provider, validatorKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

    await program.methods
      .register("https://example.com/agent/validation-test")
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        rootConfig: rootConfigPda,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("=== Validation Tests Setup (v3.0.0 On-Chain) ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent Asset:", agentAsset.publicKey.toBase58());
    console.log("Validation Config:", validationConfigPda.toBase58());
    console.log("Validator (separate from owner):", validatorKeypair.publicKey.toBase58());
  });

  // ============================================================================
  // VALIDATION REQUEST TESTS (On-Chain State)
  // ============================================================================
  describe("Validation Request (On-Chain)", () => {
    it("requestValidation() creates ValidationRequest PDA and emits event", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          agentAsset.publicKey,
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("RequestValidation tx:", tx);

      // Verify the PDA was created
      const validationRequest = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validationRequest.asset.toBase58()).to.equal(agentAsset.publicKey.toBase58());
      expect(validationRequest.validatorAddress.toBase58()).to.equal(validatorKeypair.publicKey.toBase58());
      expect(validationRequest.nonce).to.equal(nonce);
      expect(validationRequest.response).to.equal(0); // No response yet
      expect(validationRequest.respondedAt.toNumber()).to.equal(0);
    });

    it("requestValidation() with empty URI (allowed)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          "",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Request with empty URI tx:", tx);
    });

    it("requestValidation() fails with URI > 250 bytes", async () => {
      const nonce = uniqueNonce();
      const longUri = uriOfLength(MAX_URI_LENGTH + 1); // MAX_URI_LENGTH is 250
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await expectAnchorError(
        program.methods
          .requestValidation(
            agentAsset.publicKey,
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
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "RequestUriTooLong"
      );
    });

    it("Multiple validations same agent, different validators", async () => {
      const validator2 = Keypair.generate();
      await fundKeypair(provider, validator2, 0.05 * anchor.web3.LAMPORTS_PER_SOL);

      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validator2.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          agentAsset.publicKey,
          validator2.publicKey,
          nonce,
          "https://example.com/validation/multi-validator",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Multi-validator request tx:", tx);
    });

    it("Multiple validations same validator, different nonces", async () => {
      const nonce1 = uniqueNonce();
      const nonce2 = uniqueNonce() + 1;

      const [validationRequestPda1] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce1,
        program.programId
      );

      const [validationRequestPda2] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce2,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
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
          validationRequest: validationRequestPda1,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
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
          validationRequest: validationRequestPda2,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
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
            agentAsset.publicKey,
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
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "SelfValidationNotAllowed"
      );
    });

    it("respondToValidation() fails if validator == agent owner", async () => {
      // First create a request with a different validator
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Owner tries to respond (should fail due to constraint on validationRequest PDA)
      // The PDA seeds include the validator address, so owner can't respond to this PDA
      // But if they tried to use their own validator address, self-validation check would fail
      const [ownerValidationPda] = getValidationRequestPda(
        agentAsset.publicKey,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await expectAnchorError(
        program.methods
          .respondToValidation(
            agentAsset.publicKey,
            provider.wallet.publicKey, // Owner as validator
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
            validationRequest: ownerValidationPda,
          })
          .rpc(),
        "AccountNotInitialized" // PDA doesn't exist for owner as validator
      );
    });
  });

  // ============================================================================
  // VALIDATION RESPONSE TESTS (On-Chain State)
  // ============================================================================
  describe("Validation Response (On-Chain)", () => {
    it("respondToValidation() updates ValidationRequest and emits event", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      // First create request
      await program.methods
        .requestValidation(
          agentAsset.publicKey,
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          agentAsset.publicKey,
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

      console.log("RespondToValidation tx:", tx);

      // Verify the response was recorded
      const validationRequest = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validationRequest.response).to.equal(85);
      expect(validationRequest.respondedAt.toNumber()).to.be.greaterThan(0);
    });

    it("respondToValidation() with response=0 (valid score)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/will-fail",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          0,
          "https://example.com/validation/failed-response",
          Array.from(randomHash()),
          "rejected"
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

      console.log("Response with 0 tx:", tx);

      // Response=0 is a valid score (means lowest rating), check respondedAt was set
      const validationRequest = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validationRequest.response).to.equal(0);
      expect(validationRequest.respondedAt.toNumber()).to.be.greaterThan(0);
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
          agentAsset.publicKey,
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          agentAsset.publicKey,
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

      console.log("Response with 100 tx:", tx);
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
          agentAsset.publicKey,
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            agentAsset.publicKey,
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

    it("respondToValidation() fails with URI > 250 bytes", async () => {
      const nonce = uniqueNonce();
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/long-uri",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            agentAsset.publicKey,
            validatorKeypair.publicKey,
            nonce,
            85,
            longUri,
            Array.from(randomHash()),
            "test"
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
        "ResponseUriTooLong"
      );
    });

    it("respondToValidation() fails with tag > 32 bytes", async () => {
      const nonce = uniqueNonce();
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1);
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/long-tag",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            agentAsset.publicKey,
            validatorKeypair.publicKey,
            nonce,
            85,
            "https://example.com/validation/response",
            Array.from(randomHash()),
            longTag
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
        "TagTooLong"
      );
    });

    it("respondToValidation() can update existing response (progressive validation)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // First response
      await program.methods
        .respondToValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          50,
          "https://example.com/validation/response1",
          Array.from(randomHash()),
          "initial"
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

      let validation = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validation.response).to.equal(50);

      // Second response (update)
      await program.methods
        .respondToValidation(
          agentAsset.publicKey,
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

      validation = await program.account.validationRequest.fetch(validationRequestPda);
      expect(validation.response).to.equal(75);
      console.log("Progressive validation: updated from 50 to 75");
    });
  });

  // ============================================================================
  // VALIDATION CONFIG COUNTERS
  // ============================================================================
  describe("ValidationConfig Counters", () => {
    it("ValidationConfig tracks total requests and responses", async () => {
      const configBefore = await program.account.validationConfig.fetch(validationConfigPda);
      const requestsBefore = configBefore.totalRequests.toNumber();
      const responsesBefore = configBefore.totalResponses.toNumber();

      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/counter-test",
          Array.from(randomHash())
        )
        .accounts({
          config: validationConfigPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      let configAfter = await program.account.validationConfig.fetch(validationConfigPda);
      expect(configAfter.totalRequests.toNumber()).to.equal(requestsBefore + 1);
      expect(configAfter.totalResponses.toNumber()).to.equal(responsesBefore);

      await program.methods
        .respondToValidation(
          agentAsset.publicKey,
          validatorKeypair.publicKey,
          nonce,
          90,
          "https://example.com/validation/counter-response",
          Array.from(randomHash()),
          "counted"
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

      configAfter = await program.account.validationConfig.fetch(validationConfigPda);
      expect(configAfter.totalRequests.toNumber()).to.equal(requestsBefore + 1);
      expect(configAfter.totalResponses.toNumber()).to.equal(responsesBefore + 1);
      console.log("Counters: requests +1, responses +1");
    });
  });
});
