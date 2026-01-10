/**
 * Validation Module Tests for Agent Registry 8004 v0.3.0
 * Tests validation request, response, update, and closure
 * v0.3.0: Uses asset (Pubkey) instead of agent_id as identifier
 * ValidationStats removed - counters are now off-chain via indexer
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
  getRegistryConfigPda,
  getAgentPda,
  getValidationRequestPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

describe("Validation Module Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  // Agent for validation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;

  // Separate validator keypair (anti-gaming: owner cannot validate their own agent)
  let validatorKeypair: Keypair;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    // currentBaseRegistry IS the registryConfigPda (not the collection)
    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    // Create a separate validator keypair (different from agent owner)
    // Anti-gaming rule: agent owner cannot validate their own agent
    validatorKeypair = Keypair.generate();

    // Register agent for validation tests (owner = provider.wallet)
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

    await program.methods
      .register("https://example.com/agent/validation-test")
      .accounts({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("=== Validation Tests Setup (v0.3.0) ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent Asset:", agentAsset.publicKey.toBase58());
    console.log("Validator (separate from owner):", validatorKeypair.publicKey.toBase58());
  });

  // ============================================================================
  // VALIDATION REQUEST TESTS
  // ============================================================================
  describe("Validation Request", () => {
    it("requestValidation() creates request with nonce", async () => {
      const nonce = uniqueNonce();
      // v0.3.0: Use separate validator (anti-gaming: owner cannot validate own agent)
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/request",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("RequestValidation tx:", tx);

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      // v0.3.0: asset instead of agentId
      expect(request.asset.toBase58()).to.equal(agentAsset.publicKey.toBase58());
      expect(request.validatorAddress.toBase58()).to.equal(validatorKeypair.publicKey.toBase58());
      expect(request.nonce).to.equal(nonce);
      expect(request.response).to.equal(0); // Not responded yet
      // v0.3.0: hasResponse instead of respondedAt
      expect(request.hasResponse).to.equal(false);
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
          validatorKeypair.publicKey,
          nonce,
          "", // Empty URI
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Request with empty URI tx:", tx);

      // Note: URI is not stored on-chain, only in events
      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.asset.toBase58()).to.equal(agentAsset.publicKey.toBase58());
    });

    it("requestValidation() fails with URI > 200 bytes", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .requestValidation(
            validatorKeypair.publicKey,
            nonce,
            longUri,
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "RequestUriTooLong"
      );
    });

    it("Multiple validations same agent, different validators", async () => {
      const validator2 = Keypair.generate();
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validator2.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          validator2.publicKey,
          nonce,
          "https://example.com/validation/multi-validator",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Multi-validator request tx:", tx);

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.validatorAddress.toBase58()).to.equal(validator2.publicKey.toBase58());
    });

    it("Multiple validations same validator, different nonces", async () => {
      const nonce1 = uniqueNonce();
      const nonce2 = uniqueNonce() + 1;

      const [pda1] = getValidationRequestPda(agentAsset.publicKey, validatorKeypair.publicKey, nonce1, program.programId);
      const [pda2] = getValidationRequestPda(agentAsset.publicKey, validatorKeypair.publicKey, nonce2, program.programId);

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce1,
          "https://example.com/validation/nonce1",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: pda1,
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
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: pda2,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const request1 = await program.account.validationRequest.fetch(pda1);
      const request2 = await program.account.validationRequest.fetch(pda2);
      expect(request1.nonce).to.equal(nonce1);
      expect(request2.nonce).to.equal(nonce2);
    });
  });

  // ============================================================================
  // VALIDATION RESPONSE TESTS
  // ============================================================================
  describe("Validation Response", () => {
    let responseNonce: number;
    let responseRequestPda: PublicKey;

    before(async () => {
      // Create a validation request to respond to (using separate validator)
      responseNonce = uniqueNonce();
      [responseRequestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        responseNonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          responseNonce,
          "https://example.com/validation/to-respond",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: responseRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("respondToValidation() with response=1 (passed)", async () => {
      const tx = await program.methods
        .respondToValidation(
          1, // Passed
          "https://example.com/validation/response",
          Array.from(randomHash()),
          "verified"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: responseRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("RespondToValidation tx:", tx);

      const request = await program.account.validationRequest.fetch(responseRequestPda);
      expect(request.response).to.equal(1);
      // v0.3.0: hasResponse + lastUpdate instead of respondedAt
      expect(request.hasResponse).to.equal(true);
      expect(request.lastUpdate.toNumber()).to.be.greaterThan(0);
    });

    it("respondToValidation() with response=0 (failed)", async () => {
      // Create a new request for this test
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/will-fail",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          0, // Failed
          "https://example.com/validation/failed-response",
          Array.from(randomHash()),
          "rejected"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response with 0 tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(0);
      expect(request.hasResponse).to.equal(true);
    });

    it("respondToValidation() with response=100 (max)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
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
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          100, // Max value
          "https://example.com/validation/max-response-result",
          Array.from(randomHash()),
          "perfect"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response with 100 tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(100);
    });

    it("respondToValidation() with partial response (50)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/partial",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          50, // Partial
          "https://example.com/validation/partial-response",
          Array.from(randomHash()),
          "partial"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Partial response tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(50);
    });

    it("respondToValidation() fails if non-validator", async () => {
      const fakeValidator = Keypair.generate();
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey, // Real validator
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey, // Real validator
          nonce,
          "https://example.com/validation/fake-validator",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            1,
            "https://example.com/validation/fake-response",
            Array.from(randomHash()),
            "fake"
          )
          .accounts({
            validator: fakeValidator.publicKey, // Wrong validator
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validationRequest: requestPda,
          })
          .signers([fakeValidator])
          .rpc(),
        "UnauthorizedValidator"
      );
    });

    it("updateValidation() updates existing response", async () => {
      // Use the already responded request from earlier
      const tx = await program.methods
        .updateValidation(
          2, // Updated response
          "https://example.com/validation/updated-response",
          Array.from(randomHash()),
          "updated"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: responseRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("UpdateValidation tx:", tx);

      const request = await program.account.validationRequest.fetch(responseRequestPda);
      expect(request.response).to.equal(2);
      // Note: responseTag is stored in events only, not on-chain
    });
  });

  // ============================================================================
  // VALIDATION CLOSURE TESTS
  // ============================================================================
  describe("Validation Closure", () => {
    it("closeValidation() recovers rent (by owner)", async () => {
      // Create and respond to a validation request (using separate validator)
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/to-close",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          1,
          "https://example.com/validation/close-response",
          Array.from(randomHash()),
          "done"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      const tx = await program.methods
        .closeValidation()
        .accounts({
          rootConfig: rootConfigPda,
          closer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          rentReceiver: provider.wallet.publicKey,
        })
        .rpc();

      console.log("CloseValidation tx:", tx);

      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      // Balance should increase (rent recovered minus tx fee ~5000 lamports)
      console.log("Balance change:", (balanceAfter - balanceBefore) / 1e9, "SOL");

      // Verify account is closed
      const accountInfo = await provider.connection.getAccountInfo(requestPda);
      expect(accountInfo).to.be.null;
    });

    it("closeValidation() fails with different rent receiver", async () => {
      // Program requires rentReceiver = agent owner (security constraint)
      const otherReceiver = Keypair.generate();
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/close-to-other",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          1,
          "https://example.com/validation/other-close-response",
          Array.from(randomHash()),
          "done"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      // Should fail because rentReceiver must be agent owner
      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            rootConfig: rootConfigPda,
            closer: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validationRequest: requestPda,
            rentReceiver: otherReceiver.publicKey, // Not owner - should fail
          })
          .rpc(),
        "InvalidRentReceiver"
      );
    });

    it("closeValidation() fails if non-owner/non-authority", async () => {
      const nonOwner = Keypair.generate();
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentAsset.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/no-close",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .respondToValidation(
          1,
          "https://example.com/validation/no-close-response",
          Array.from(randomHash()),
          "done"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            rootConfig: rootConfigPda,
            closer: nonOwner.publicKey, // Not owner
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validationRequest: requestPda,
            rentReceiver: nonOwner.publicKey,
          })
          .signers([nonOwner])
          .rpc(),
        "Unauthorized"
      );
    });
  });
});
