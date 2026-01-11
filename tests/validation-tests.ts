/**
 * Validation Module Tests for Agent Registry 8004 v2.0.0
 * Tests validation request and response
 * v2.0.0: 100% Events-only architecture - no ValidationRequest PDA
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

describe("Validation Module Tests (Events-Only v2.0.0)", () => {
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

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

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

    console.log("=== Validation Tests Setup (v2.0.0 Events-Only) ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Agent Asset:", agentAsset.publicKey.toBase58());
    console.log("Validator (separate from owner):", validatorKeypair.publicKey.toBase58());
  });

  // ============================================================================
  // VALIDATION REQUEST TESTS (Events-Only)
  // ============================================================================
  describe("Validation Request (Events-Only)", () => {
    it("requestValidation() emits ValidationRequested event", async () => {
      const nonce = uniqueNonce();

      const tx = await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/request",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      console.log("RequestValidation tx:", tx);
      // Events-only: no account to fetch, event is emitted
    });

    it("requestValidation() with empty URI (allowed)", async () => {
      const nonce = uniqueNonce();

      const tx = await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      console.log("Request with empty URI tx:", tx);
    });

    it("requestValidation() fails with URI > 200 bytes", async () => {
      const nonce = uniqueNonce();
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
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validator: validatorKeypair.publicKey,
          })
          .rpc(),
        "RequestUriTooLong"
      );
    });

    it("Multiple validations same agent, different validators", async () => {
      const validator2 = Keypair.generate();
      const nonce = uniqueNonce();

      const tx = await program.methods
        .requestValidation(
          validator2.publicKey,
          nonce,
          "https://example.com/validation/multi-validator",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validator2.publicKey,
        })
        .rpc();

      console.log("Multi-validator request tx:", tx);
    });

    it("Multiple validations same validator, different nonces", async () => {
      const nonce1 = uniqueNonce();
      const nonce2 = uniqueNonce() + 1;

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce1,
          "https://example.com/validation/nonce1",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
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
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
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

      await expectAnchorError(
        program.methods
          .requestValidation(
            provider.wallet.publicKey, // Owner as validator
            nonce,
            "https://example.com/validation/self",
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
            validator: provider.wallet.publicKey,
          })
          .rpc(),
        "SelfValidationNotAllowed"
      );
    });

    it("respondToValidation() fails if validator == agent owner", async () => {
      // First create a request with a different validator
      const nonce = uniqueNonce();

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/test",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      // Owner tries to respond (should fail)
      await expectAnchorError(
        program.methods
          .respondToValidation(
            nonce,
            85,
            "https://example.com/validation/self-response",
            Array.from(randomHash()),
            "self"
          )
          .accounts({
            validator: provider.wallet.publicKey, // Owner trying to validate
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
          })
          .rpc(),
        "SelfValidationNotAllowed"
      );
    });
  });

  // ============================================================================
  // VALIDATION RESPONSE TESTS (Events-Only)
  // ============================================================================
  describe("Validation Response (Events-Only)", () => {
    it("respondToValidation() emits ValidationResponded event", async () => {
      const nonce = uniqueNonce();

      // First create request
      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/to-respond",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          nonce,
          85,
          "https://example.com/validation/response",
          Array.from(randomHash()),
          "verified"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("RespondToValidation tx:", tx);
    });

    it("respondToValidation() with response=0 (failed)", async () => {
      const nonce = uniqueNonce();

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/will-fail",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          nonce,
          0,
          "https://example.com/validation/failed-response",
          Array.from(randomHash()),
          "rejected"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response with 0 tx:", tx);
    });

    it("respondToValidation() with response=100 (max)", async () => {
      const nonce = uniqueNonce();

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/max-response",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      const tx = await program.methods
        .respondToValidation(
          nonce,
          100,
          "https://example.com/validation/max-response-result",
          Array.from(randomHash()),
          "perfect"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response with 100 tx:", tx);
    });

    it("respondToValidation() fails with response > 100", async () => {
      const nonce = uniqueNonce();

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/invalid-response",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            nonce,
            101,
            "https://example.com/validation/response",
            Array.from(randomHash()),
            "invalid"
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "InvalidResponse"
      );
    });

    it("respondToValidation() fails with URI > 200 bytes", async () => {
      const nonce = uniqueNonce();
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/long-uri",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            nonce,
            85,
            longUri,
            Array.from(randomHash()),
            "test"
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "ResponseUriTooLong"
      );
    });

    it("respondToValidation() fails with tag > 32 bytes", async () => {
      const nonce = uniqueNonce();
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1);

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/long-tag",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      await expectAnchorError(
        program.methods
          .respondToValidation(
            nonce,
            85,
            "https://example.com/validation/response",
            Array.from(randomHash()),
            longTag
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: agentAsset.publicKey,
            agentAccount: agentPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "TagTooLong"
      );
    });

    it("respondToValidation() can be called multiple times for same nonce (events-only)", async () => {
      const nonce = uniqueNonce();

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://example.com/validation/multi-response",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      // Multiple responses allowed - events-only, indexer dedupes
      await program.methods
        .respondToValidation(
          nonce,
          50,
          "https://example.com/validation/response1",
          Array.from(randomHash()),
          "first"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();

      await program.methods
        .respondToValidation(
          nonce,
          75,
          "https://example.com/validation/response2",
          Array.from(randomHash()),
          "updated"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();
    });

    it("different validator can emit response for same agent (indexer validates)", async () => {
      // Events-only: program doesn't strictly enforce validator == request validator
      // The constraint is only self-validation (validator != owner)
      // Indexer is responsible for matching request -> response
      const anotherValidator = Keypair.generate();
      const nonce = uniqueNonce();

      // This should succeed - just emits event
      // Indexer will match/validate against original request
      await program.methods
        .respondToValidation(
          nonce,
          85,
          "https://example.com/validation/other-validator-response",
          Array.from(randomHash()),
          "different"
        )
        .accounts({
          validator: anotherValidator.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([anotherValidator])
        .rpc();
      // Success - indexer decides if this response matches any request
    });
  });

  // ============================================================================
  // EVENTS-ONLY BEHAVIOR TESTS
  // ============================================================================
  describe("Events-Only Behavior", () => {
    it("request and response without matching nonce (indexer handles)", async () => {
      const requestNonce = uniqueNonce();
      const responseNonce = uniqueNonce() + 999;

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          requestNonce,
          "https://example.com/validation/mismatch-request",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
          validator: validatorKeypair.publicKey,
        })
        .rpc();

      // Response with different nonce - both emit events
      // Indexer decides if they match
      await program.methods
        .respondToValidation(
          responseNonce,
          85,
          "https://example.com/validation/mismatch-response",
          Array.from(randomHash()),
          "mismatched"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();
    });

    it("response without prior request (events-only allows)", async () => {
      const nonce = uniqueNonce();

      // No request first - but response still emits event
      await program.methods
        .respondToValidation(
          nonce,
          75,
          "https://example.com/validation/no-request-response",
          Array.from(randomHash()),
          "orphan"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: agentAsset.publicKey,
          agentAccount: agentPda,
        })
        .signers([validatorKeypair])
        .rpc();
      // Indexer will handle orphan responses
    });
  });
});
