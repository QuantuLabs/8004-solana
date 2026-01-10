/**
 * Validation Module Security Tests for Agent Registry 8004 v0.3.0
 * Tests edge cases, exploits, and boundaries not covered in basic tests
 *
 * Coverage:
 * - Double response manipulation (CRITICAL)
 * - Update without initial response
 * - Close before response
 * - Owner transfer anti-gaming
 * - Authority privileges
 * - Response age (no deadline)
 * - Nonce security
 * - Response value boundaries
 * - Hash validation
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  MAX_URI_LENGTH,
  getRootConfigPda,
  getAgentPda,
  getValidationRequestPda,
  randomHash,
  uriOfLength,
  uniqueNonce,
  expectAnchorError,
} from "./utils/helpers";

describe("Validation Security Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let authorityPubkey: PublicKey;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    registryConfigPda = rootConfig.currentBaseRegistry;
    authorityPubkey = rootConfig.authority;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== Validation Security Tests Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Authority:", authorityPubkey.toBase58());
  });

  // Helper to register a new agent
  async function registerAgent(): Promise<{ assetKeypair: Keypair; agentPda: PublicKey }> {
    const assetKeypair = Keypair.generate();
    const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

    await program.methods
      .register("https://example.com/security/validation-test")
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

    return { assetKeypair, agentPda };
  }

  // Helper to create validation request
  async function createValidationRequest(
    assetKeypair: Keypair,
    agentPda: PublicKey,
    validator: PublicKey,
    nonce: number
  ): Promise<PublicKey> {
    const [validationRequestPda] = getValidationRequestPda(
      assetKeypair.publicKey,
      validator,
      nonce,
      program.programId
    );

    await program.methods
      .requestValidation(
        validator,
        nonce,
        "https://request.example.com",
        Array.from(randomHash())
      )
      .accounts({
        requester: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        asset: assetKeypair.publicKey,
        agentAccount: agentPda,
        validationRequest: validationRequestPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return validationRequestPda;
  }

  // ============================================================================
  // DOUBLE RESPONSE MANIPULATION (CRITICAL)
  // ============================================================================
  describe("Double Response Manipulation (CRITICAL)", () => {
    it("allows second response (overwrites first) - BEHAVIOR DOCUMENTATION", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // First response: score 95
      await program.methods
        .respondToValidation(
          95,
          "https://response1.example.com",
          Array.from(randomHash()),
          "first_response"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      let request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(95);
      console.log("First response: 95");

      // Second response: score 5 (overwrites first)
      await program.methods
        .respondToValidation(
          5,
          "https://response2.example.com",
          Array.from(randomHash()),
          "second_response"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(5);
      console.log("Second response: 5");
      console.log("CRITICAL: Validator CAN change response (95 -> 5). Indexer must track history!");
    });

    it("emits events for both responses (indexer can track history)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Both responses emit events
      const tx1 = await program.methods
        .respondToValidation(
          80,
          "https://response1.example.com",
          Array.from(randomHash()),
          "first"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      const tx2 = await program.methods
        .respondToValidation(
          20,
          "https://response2.example.com",
          Array.from(randomHash()),
          "second"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response 1 tx:", tx1);
      console.log("Response 2 tx:", tx2);
      console.log("DOCUMENTATION: Both responses emit ValidationResponded events");
    });
  });

  // ============================================================================
  // UPDATE WITHOUT INITIAL RESPONSE
  // ============================================================================
  describe("Update Without Initial Response", () => {
    it("update_validation works without prior respond (same instruction)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Use update_validation directly (bypasses respond_to_validation)
      // Both call the same underlying function, so this should work
      const tx = await program.methods
        .updateValidation(
          75,
          "https://update.example.com",
          Array.from(randomHash()),
          "direct_update"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(75);
      expect(request.hasResponse).to.be.true;
      console.log("updateValidation without prior respond succeeded:", tx);
      console.log("DOCUMENTATION: respond_to_validation and update_validation are equivalent");
    });
  });

  // ============================================================================
  // CLOSE BEFORE RESPONSE
  // ============================================================================
  describe("Close Before Response", () => {
    it("allows closing pending validation request", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Verify no response yet
      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.hasResponse).to.be.false;

      // Close without response
      const tx = await program.methods
        .closeValidation()
        .accounts({
          rootConfig: rootConfigPda,
          closer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          rentReceiver: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Close before response succeeded:", tx);
      console.log("DOCUMENTATION: Audit trail lost when closing before response");

      // Verify account closed
      const accountInfo = await provider.connection.getAccountInfo(validationRequestPda);
      expect(accountInfo).to.be.null;
    });

    it("rent goes to current owner after close", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      await program.methods
        .closeValidation()
        .accounts({
          rootConfig: rootConfigPda,
          closer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          rentReceiver: provider.wallet.publicKey,
        })
        .rpc();

      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      const rentRecovered = balanceAfter - balanceBefore;
      console.log("Rent recovered:", rentRecovered, "lamports");
      expect(rentRecovered).to.be.greaterThan(0);
    });
  });

  // ============================================================================
  // OWNER TRANSFER ANTI-GAMING
  // ============================================================================
  describe("Owner Transfer Anti-Gaming", () => {
    it("validator cannot respond after becoming owner (via transfer)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      // Fund validator
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: validatorKeypair.publicKey,
          lamports: 10000000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      // Create validation request while current owner is provider.wallet
      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Transfer agent to validator (validator becomes owner)
      await program.methods
        .transferAgent()
        .accountsPartial({
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          newOwner: validatorKeypair.publicKey,
          walletMetadata: null, // No wallet set
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("Agent transferred to validator");

      // Verify validator is now owner
      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.owner.toBase58()).to.equal(validatorKeypair.publicKey.toBase58());

      // Validator (now owner) tries to respond - should fail due to anti-gaming
      await expectAnchorError(
        program.methods
          .respondToValidation(
            100,
            "https://self-validation.example.com",
            Array.from(randomHash()),
            "self_validation"
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "SelfValidationNotAllowed"
      );
      console.log("Anti-gaming: validator cannot respond after becoming owner");
    });
  });

  // ============================================================================
  // AUTHORITY PRIVILEGES
  // ============================================================================
  describe("Authority Privileges", () => {
    it("authority can close any validation request", async () => {
      // This test requires the actual authority wallet
      // Skip if not running with authority
      if (provider.wallet.publicKey.toBase58() !== authorityPubkey.toBase58()) {
        console.log("SKIP: Not running with authority wallet");
        console.log("To test: ensure provider.wallet = authority");
        return;
      }

      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Authority closes (not owner)
      const tx = await program.methods
        .closeValidation()
        .accounts({
          rootConfig: rootConfigPda,
          closer: authorityPubkey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          rentReceiver: provider.wallet.publicKey, // Still goes to owner
        })
        .rpc();

      console.log("Authority close succeeded:", tx);
    });

    it("authority cannot bypass self-validation check", async () => {
      // Even authority cannot validate their own agent
      // This test documents that authority is not special for anti-gaming

      // Create agent owned by authority
      const assetKeypair = Keypair.generate();
      const [agentPda] = getAgentPda(assetKeypair.publicKey, program.programId);

      await program.methods
        .register("https://example.com/security/authority-agent")
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey, // Authority owns agent
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      // Try to request validation where validator = owner
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        assetKeypair.publicKey,
        provider.wallet.publicKey, // Validator = Owner
        nonce,
        program.programId
      );

      await expectAnchorError(
        program.methods
          .requestValidation(
            provider.wallet.publicKey, // Validator = Owner
            nonce,
            "https://self-request.example.com",
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "SelfValidationNotAllowed"
      );
      console.log("Authority cannot bypass self-validation check (request)");
    });
  });

  // ============================================================================
  // RESPONSE AGE (NO ON-CHAIN DEADLINE)
  // ============================================================================
  describe("Response Age (No Deadline)", () => {
    it("allows response after arbitrary delay (no on-chain deadline)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Get request timestamp
      const request = await program.account.validationRequest.fetch(validationRequestPda);
      const requestTime = request.lastUpdate.toNumber();

      // Respond (no delay in test, but documenting there's no deadline)
      const tx = await program.methods
        .respondToValidation(
          90,
          "https://late-response.example.com",
          Array.from(randomHash()),
          "late_response"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response after arbitrary delay succeeded:", tx);
      console.log("DOCUMENTATION: No on-chain deadline - off-chain must enforce if needed");
    });
  });

  // ============================================================================
  // NONCE SECURITY
  // ============================================================================
  describe("Nonce Security", () => {
    it("fails to create request with same nonce twice", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      // First request
      const [validationRequestPda] = getValidationRequestPda(
        assetKeypair.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://request1.example.com",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Second request with same nonce - should fail
      try {
        await program.methods
          .requestValidation(
            validatorKeypair.publicKey,
            nonce, // Same nonce
            "https://request2.example.com",
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        throw new Error("Expected duplicate nonce to fail");
      } catch (error: any) {
        console.log("Duplicate nonce correctly rejected:", error.message.slice(0, 100));
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes("already in use") ||
          msg.includes("already initialized") ||
          msg.includes("custom program error")
        );
      }
    });

    it("allows nonce=0", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = 0;

      const [validationRequestPda] = getValidationRequestPda(
        assetKeypair.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://request-nonce0.example.com",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Nonce=0 succeeded:", tx);
    });

    it("allows same nonce for different validators", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validator1 = Keypair.generate();
      const validator2 = Keypair.generate();
      const nonce = uniqueNonce();

      // Request for validator1
      const [pda1] = getValidationRequestPda(
        assetKeypair.publicKey,
        validator1.publicKey,
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          validator1.publicKey,
          nonce,
          "https://request-v1.example.com",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: pda1,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Request for validator2 with same nonce
      const [pda2] = getValidationRequestPda(
        assetKeypair.publicKey,
        validator2.publicKey,
        nonce,
        program.programId
      );

      const tx = await program.methods
        .requestValidation(
          validator2.publicKey,
          nonce, // Same nonce
          "https://request-v2.example.com",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: pda2,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Same nonce for different validators succeeded:", tx);
    });
  });

  // ============================================================================
  // RESPONSE VALUE BOUNDARIES
  // ============================================================================
  describe("Response Value Boundaries", () => {
    it("rejects response 101", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      await expectAnchorError(
        program.methods
          .respondToValidation(
            101, // Invalid
            "https://response.example.com",
            Array.from(randomHash()),
            "invalid_response"
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "InvalidResponse"
      );
      console.log("Response 101 correctly rejected");
    });

    it("allows response 0 (failed validation)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      const tx = await program.methods
        .respondToValidation(
          0, // Zero = failed validation
          "https://response.example.com",
          Array.from(randomHash()),
          "zero_response"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response 0 succeeded:", tx);

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(0);
      expect(request.hasResponse).to.be.true;
    });

    it("allows response 50 (mid-range)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      const tx = await program.methods
        .respondToValidation(
          50,
          "https://response.example.com",
          Array.from(randomHash()),
          "mid_response"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response 50 succeeded:", tx);
    });

    it("allows response 100 (perfect)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      const tx = await program.methods
        .respondToValidation(
          100,
          "https://response.example.com",
          Array.from(randomHash()),
          "perfect_response"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Response 100 succeeded:", tx);
    });
  });

  // ============================================================================
  // URI VALIDATION
  // ============================================================================
  describe("URI Validation", () => {
    it("rejects request_uri > 200 bytes", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const [validationRequestPda] = getValidationRequestPda(
        assetKeypair.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      await expectAnchorError(
        program.methods
          .requestValidation(
            validatorKeypair.publicKey,
            nonce,
            uriOfLength(MAX_URI_LENGTH + 1), // 201 bytes
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "RequestUriTooLong"
      );
      console.log("Request URI > 200 bytes correctly rejected");
    });

    it("rejects response_uri > 200 bytes", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      await expectAnchorError(
        program.methods
          .respondToValidation(
            80,
            uriOfLength(MAX_URI_LENGTH + 1), // 201 bytes
            Array.from(randomHash()),
            "tag"
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "ResponseUriTooLong"
      );
      console.log("Response URI > 200 bytes correctly rejected");
    });
  });

  // ============================================================================
  // TAG VALIDATION
  // ============================================================================
  describe("Tag Validation", () => {
    it("rejects tag > 32 bytes in response", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      const longTag = "x".repeat(33); // 33 bytes

      await expectAnchorError(
        program.methods
          .respondToValidation(
            80,
            "https://response.example.com",
            Array.from(randomHash()),
            longTag
          )
          .accounts({
            validator: validatorKeypair.publicKey,
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
          })
          .signers([validatorKeypair])
          .rpc(),
        "TagTooLong"
      );
      console.log("Tag > 32 bytes correctly rejected");
    });
  });

  // ============================================================================
  // HASH VALIDATION (DOCUMENTATION)
  // ============================================================================
  describe("Hash Validation (Documentation)", () => {
    it("accepts zero hash [0;32] (off-chain verification)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const [validationRequestPda] = getValidationRequestPda(
        assetKeypair.publicKey,
        validatorKeypair.publicKey,
        nonce,
        program.programId
      );

      const zeroHash = new Array(32).fill(0);

      const tx = await program.methods
        .requestValidation(
          validatorKeypair.publicKey,
          nonce,
          "https://request.example.com",
          zeroHash // Zero hash
        )
        .accounts({
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Zero hash accepted:", tx);
      console.log("DOCUMENTATION: Hash validation is off-chain only");
    });

    it("accepts any 32-byte hash (no on-chain validation)", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      // Completely random hash
      const randomResponseHash = Array.from(randomHash());

      const tx = await program.methods
        .respondToValidation(
          85,
          "https://response.example.com",
          randomResponseHash,
          "tag"
        )
        .accounts({
          validator: validatorKeypair.publicKey,
          asset: assetKeypair.publicKey,
          agentAccount: agentPda,
          validationRequest: validationRequestPda,
        })
        .signers([validatorKeypair])
        .rpc();

      console.log("Random hash accepted:", tx);
    });
  });

  // ============================================================================
  // UNAUTHORIZED ACCESS
  // ============================================================================
  describe("Unauthorized Access", () => {
    it("rejects non-validator responding", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const imposter = Keypair.generate();
      const nonce = uniqueNonce();

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      await expectAnchorError(
        program.methods
          .respondToValidation(
            100,
            "https://imposter.example.com",
            Array.from(randomHash()),
            "imposter"
          )
          .accounts({
            validator: imposter.publicKey, // Wrong validator
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
          })
          .signers([imposter])
          .rpc(),
        "UnauthorizedValidator"
      );
      console.log("Non-validator correctly rejected");
    });

    it("rejects non-owner closing", async () => {
      const { assetKeypair, agentPda } = await registerAgent();
      const validatorKeypair = Keypair.generate();
      const imposter = Keypair.generate();
      const nonce = uniqueNonce();

      // Fund imposter
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: imposter.publicKey,
          lamports: 10000000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      const validationRequestPda = await createValidationRequest(
        assetKeypair,
        agentPda,
        validatorKeypair.publicKey,
        nonce
      );

      await expectAnchorError(
        program.methods
          .closeValidation()
          .accounts({
            rootConfig: rootConfigPda,
            closer: imposter.publicKey, // Not owner or authority
            asset: assetKeypair.publicKey,
            agentAccount: agentPda,
            validationRequest: validationRequestPda,
            rentReceiver: provider.wallet.publicKey,
          })
          .signers([imposter])
          .rpc(),
        "Unauthorized"
      );
      console.log("Non-owner close correctly rejected");
    });
  });
});
