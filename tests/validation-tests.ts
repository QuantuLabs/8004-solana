/**
 * Validation Module Tests for Agent Registry 8004
 * Tests validation request, response, update, and closure
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
  getConfigPda,
  getAgentPda,
  getValidationStatsPda,
  getValidationRequestPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  uniqueNonce,
  expectAnchorError,
  getBalanceSOL,
} from "./utils/helpers";

describe("Validation Module Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let configPda: PublicKey;
  let collectionPubkey: PublicKey;
  let validationStatsPda: PublicKey;

  // Agent for validation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let agentId: anchor.BN;

  before(async () => {
    [configPda] = getConfigPda(program.programId);
    [validationStatsPda] = getValidationStatsPda(program.programId);

    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    agentId = config.nextAgentId;

    // Register agent for validation tests
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

    await program.methods
      .register("https://example.com/agent/validation-test")
      .accounts({
        config: configPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("=== Validation Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent ID:", agentId.toNumber());
  });

  // ============================================================================
  // VALIDATION REQUEST TESTS
  // ============================================================================
  describe("Validation Request", () => {
    it("requestValidation() creates request with nonce", async () => {
      const nonce = uniqueNonce();
      const validator = provider.wallet.publicKey;
      const [validationRequestPda] = getValidationRequestPda(
        agentId,
        validator,
        nonce,
        program.programId
      );

      const statsBefore = await program.account.validationStats.fetch(validationStatsPda);

      const tx = await program.methods
        .requestValidation(
          agentId,
          validator,
          nonce,
          "https://example.com/validation/request",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
      expect(request.agentId.toNumber()).to.equal(agentId.toNumber());
      expect(request.validatorAddress.toBase58()).to.equal(validator.toBase58());
      expect(request.nonce).to.equal(nonce);
      expect(request.response).to.equal(0); // Not responded yet
      expect(request.respondedAt.toNumber()).to.equal(0);

      const statsAfter = await program.account.validationStats.fetch(validationStatsPda);
      expect(statsAfter.totalRequests.toNumber()).to.equal(
        statsBefore.totalRequests.toNumber() + 1
      );
    });

    it("requestValidation() with empty URI (allowed)", async () => {
      const nonce = uniqueNonce();
      const validator = provider.wallet.publicKey;
      const [validationRequestPda] = getValidationRequestPda(
        agentId,
        validator,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          agentId,
          validator,
          nonce,
          "", // Empty URI
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
      expect(request.agentId.toNumber()).to.equal(agentId.toNumber());
    });

    it("requestValidation() fails with URI > 200 bytes", async () => {
      const nonce = uniqueNonce();
      const validator = provider.wallet.publicKey;
      const [validationRequestPda] = getValidationRequestPda(
        agentId,
        validator,
        nonce,
        program.programId
      );
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .requestValidation(
            agentId,
            validator,
            nonce,
            longUri,
            Array.from(randomHash())
          )
          .accounts({
            validationStats: validationStatsPda,
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
        agentId,
        validator2.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          agentId,
          validator2.publicKey,
          nonce,
          "https://example.com/validation/multi-validator",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
      const validator = provider.wallet.publicKey;
      const nonce1 = uniqueNonce();
      const nonce2 = uniqueNonce() + 1;

      const [pda1] = getValidationRequestPda(agentId, validator, nonce1, program.programId);
      const [pda2] = getValidationRequestPda(agentId, validator, nonce2, program.programId);

      await program.methods
        .requestValidation(
          agentId,
          validator,
          nonce1,
          "https://example.com/validation/nonce1",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          agentId,
          validator,
          nonce2,
          "https://example.com/validation/nonce2",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
      // Create a validation request to respond to
      responseNonce = uniqueNonce();
      [responseRequestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        responseNonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          responseNonce,
          "https://example.com/validation/to-respond",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
      const statsBefore = await program.account.validationStats.fetch(validationStatsPda);

      const tx = await program.methods
        .respondToValidation(
          1, // Passed
          "https://example.com/validation/response",
          Array.from(randomHash()),
          "verified"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: responseRequestPda,
        })
        .rpc();

      console.log("RespondToValidation tx:", tx);

      const request = await program.account.validationRequest.fetch(responseRequestPda);
      expect(request.response).to.equal(1);
      expect(request.respondedAt.toNumber()).to.be.greaterThan(0);
      // Note: responseTag is stored in events only, not on-chain

      const statsAfter = await program.account.validationStats.fetch(validationStatsPda);
      expect(statsAfter.totalResponses.toNumber()).to.equal(
        statsBefore.totalResponses.toNumber() + 1
      );
    });

    it("respondToValidation() with response=0 (failed)", async () => {
      // Create a new request for this test
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/will-fail",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      console.log("Response with 0 tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(0);
    });

    it("respondToValidation() with response=100 (max)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/max-response",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      console.log("Response with 100 tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(100);
    });

    it("respondToValidation() with partial response (50)", async () => {
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/partial",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      console.log("Partial response tx:", tx);

      const request = await program.account.validationRequest.fetch(requestPda);
      expect(request.response).to.equal(50);
    });

    it("respondToValidation() fails if non-validator", async () => {
      const fakeValidator = Keypair.generate();
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey, // Real validator
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey, // Real validator
          nonce,
          "https://example.com/validation/fake-validator",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
            validationStats: validationStatsPda,
            validator: fakeValidator.publicKey, // Wrong validator
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: responseRequestPda,
        })
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
      // Create and respond to a validation request
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/to-close",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      const tx = await program.methods
        .closeValidation()
        .accounts({
          config: configPda,
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

    it("closeValidation() to different rent receiver", async () => {
      const rentReceiver = Keypair.generate();
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/close-to-other",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      const tx = await program.methods
        .closeValidation()
        .accounts({
          config: configPda,
          closer: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validationRequest: requestPda,
          rentReceiver: rentReceiver.publicKey, // Different receiver
        })
        .rpc();

      console.log("Close to different receiver tx:", tx);

      // Verify rent receiver got the SOL
      const receiverBalance = await provider.connection.getBalance(rentReceiver.publicKey);
      expect(receiverBalance).to.be.greaterThan(0);
      console.log("Rent receiver got:", receiverBalance / 1e9, "SOL");
    });

    it("closeValidation() fails if non-owner/non-authority", async () => {
      const nonOwner = Keypair.generate();
      const nonce = uniqueNonce();
      const [requestPda] = getValidationRequestPda(
        agentId,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          agentId,
          provider.wallet.publicKey,
          nonce,
          "https://example.com/validation/no-close",
          Array.from(randomHash())
        )
        .accounts({
          validationStats: validationStatsPda,
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
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: requestPda,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            config: configPda,
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
