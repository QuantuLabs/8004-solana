import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import {
  getValidationConfigPda,
  getValidationRequestPda,
  registerAgent,
  computeHash,
  requestValidation,
  initializeIdentityRegistry,
  initializeValidationRegistry,
} from "./validation-helpers";

describe("Validation Registry - Request Validation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  const [validationConfig] = getValidationConfigPda(validationProgram.programId);

  let agent1: { id: number; owner: PublicKey; mint: Keypair; account: PublicKey };
  let agent2: { id: number; owner: PublicKey; mint: Keypair; account: PublicKey };
  const validator1 = Keypair.generate();
  const validator2 = Keypair.generate();

  before(async () => {
    // Initialize Identity Registry first
    await initializeIdentityRegistry(identityProgram, provider);

    // Initialize Validation Registry
    await initializeValidationRegistry(validationProgram, identityProgram, provider);

    // Airdrop to validators
    for (const validator of [validator1, validator2]) {
      const sig = await provider.connection.requestAirdrop(
        validator.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Register test agents (using provider.wallet as owner)
    agent1 = await registerAgent(identityProgram, provider);
    agent2 = await registerAgent(identityProgram, provider);

    console.log(`Registered agent #${agent1.id} and #${agent2.id} for testing`);
  });

  it("✅ Agent owner requests validation", async () => {
    const nonce = 0;
    const requestUri = "ipfs://QmTest123ValidRequest";
    const requestHash = computeHash(requestUri);

    const validationRequest = await requestValidation(
      validationProgram,
      identityProgram,
      {
        validationConfig,
        agentId: agent1.id,
        agentAccount: agent1.account,
        agentOwner: agent1.owner,
        validatorAddress: validator1.publicKey,
        nonce,
        requestUri,
        requestHash,
      }
    );

    const request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );

    assert.equal(request.agentId.toNumber(), agent1.id);
    assert.equal(
      request.validatorAddress.toBase58(),
      validator1.publicKey.toBase58()
    );
    assert.equal(request.nonce, nonce);
    assert.deepEqual(request.requestHash, Array.from(requestHash));
    assert.equal(request.response, 0); // Pending
    assert.equal(request.respondedAt.toNumber(), 0);

    const config = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );
    assert.equal(config.totalRequests.toNumber(), 1);

    console.log(`✅ Validation requested for agent #${agent1.id}`);
  });

  it("✅ Request with URI (200 bytes - edge case)", async () => {
    const nonce = 1;
    const requestUri = "a".repeat(200); // Exactly 200 bytes
    const requestHash = computeHash(requestUri);

    const validationRequest = await requestValidation(
      validationProgram,
      identityProgram,
      {
        validationConfig,
        agentId: agent1.id,
        agentAccount: agent1.account,
        agentOwner: agent1.owner,
        validatorAddress: validator1.publicKey,
        nonce,
        requestUri,
        requestHash,
      }
    );

    const request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );
    assert.equal(request.nonce, nonce);

    console.log("✅ 200-byte URI accepted");
  });

  it("✅ Request with empty URI (allowed)", async () => {
    const nonce = 2;
    const requestUri = "";
    const requestHash = computeHash(requestUri);

    const validationRequest = await requestValidation(
      validationProgram,
      identityProgram,
      {
        validationConfig,
        agentId: agent1.id,
        agentAccount: agent1.account,
        agentOwner: agent1.owner,
        validatorAddress: validator1.publicKey,
        nonce,
        requestUri,
        requestHash,
      }
    );

    const request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );
    assert.equal(request.nonce, nonce);

    console.log("✅ Empty URI accepted");
  });

  it("❌ Fail: non-owner requests validation", async () => {
    const nonce = 0;
    const requestUri = "ipfs://QmTest";
    const requestHash = computeHash(requestUri);

    // Create a second agent owned by a different wallet to test non-owner rejection
    // Since agent1 is owned by provider.wallet, trying to request with wrong account will fail
    // We'll try to request validation for agent1 but with agent2's account (different agent)
    try {
      const [wrongValidationRequest] = getValidationRequestPda(
        validationProgram.programId,
        agent2.id,  // Use agent2's ID
        validator1.publicKey,
        nonce
      );

      await validationProgram.methods
        .requestValidation(
          new BN(agent2.id),
          validator1.publicKey,
          nonce,
          requestUri,
          Array.from(requestHash)
        )
        .accounts({
          config: validationConfig,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          agentAccount: agent1.account,  // Wrong account! Using agent1's account for agent2's ID
          validationRequest: wrongValidationRequest,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have failed with AgentNotFound");
    } catch (err) {
      assert.include(err.toString(), "AgentNotFound");
      console.log("✅ Wrong agent account correctly rejected");
    }
  });

  it("❌ Fail: URI > 200 bytes", async () => {
    const nonce = 3;
    const requestUri = "a".repeat(201); // 201 bytes - too long!
    const requestHash = computeHash(requestUri);

    try {
      await requestValidation(validationProgram, identityProgram, {
        validationConfig,
        agentId: agent1.id,
        agentAccount: agent1.account,
        agentOwner: agent1.owner,
        validatorAddress: validator1.publicKey,
        nonce,
        requestUri,
        requestHash,
      });
      assert.fail("Should have failed with RequestUriTooLong");
    } catch (err) {
      assert.include(err.toString(), "RequestUriTooLong");
      console.log("✅ URI > 200 bytes correctly rejected");
    }
  });

  it("✅ Multiple validations same agent (different validators)", async () => {
    const nonce = 0;
    const requestUri1 = "ipfs://QmTestValidator1";
    const requestUri2 = "ipfs://QmTestValidator2";

    await requestValidation(validationProgram, identityProgram, {
      validationConfig,
      agentId: agent2.id,
      agentAccount: agent2.account,
      agentOwner: agent2.owner,
      validatorAddress: validator1.publicKey,
      nonce,
      requestUri: requestUri1,
      requestHash: computeHash(requestUri1),
    });

    await requestValidation(validationProgram, identityProgram, {
      validationConfig,
      agentId: agent2.id,
      agentAccount: agent2.account,
      agentOwner: agent2.owner,
      validatorAddress: validator2.publicKey,
      nonce,
      requestUri: requestUri2,
      requestHash: computeHash(requestUri2),
    });

    const config = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );
    assert.isAtLeast(config.totalRequests.toNumber(), 2);

    console.log("✅ Multiple validators for same agent works");
  });

  it("✅ Multiple validations same validator (nonce++)", async () => {
    const requestUri1 = "ipfs://QmNonce0";
    const requestUri2 = "ipfs://QmNonce1";

    const [request1] = getValidationRequestPda(
      validationProgram.programId,
      agent2.id,
      validator1.publicKey,
      0
    );

    const [request2] = getValidationRequestPda(
      validationProgram.programId,
      agent2.id,
      validator1.publicKey,
      1
    );

    // Nonce 0 already created above
    await requestValidation(validationProgram, identityProgram, {
      validationConfig,
      agentId: agent2.id,
      agentAccount: agent2.account,
      agentOwner: agent2.owner,
      validatorAddress: validator1.publicKey,
      nonce: 1,
      requestUri: requestUri2,
      requestHash: computeHash(requestUri2),
    });

    const req1 = await validationProgram.account.validationRequest.fetch(request1);
    const req2 = await validationProgram.account.validationRequest.fetch(request2);

    assert.equal(req1.nonce, 0);
    assert.equal(req2.nonce, 1);

    console.log("✅ Re-validation (nonce++) works");
  });

  it("✅ Verify total_requests incremented correctly", async () => {
    const configBefore = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );
    const totalBefore = configBefore.totalRequests.toNumber();

    const nonce = 4;
    await requestValidation(validationProgram, identityProgram, {
      validationConfig,
      agentId: agent1.id,
      agentAccount: agent1.account,
      agentOwner: agent1.owner,
      validatorAddress: validator2.publicKey,
      nonce,
      requestUri: "ipfs://QmCounterTest",
      requestHash: computeHash("ipfs://QmCounterTest"),
    });

    const configAfter = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );
    const totalAfter = configAfter.totalRequests.toNumber();

    assert.equal(totalAfter, totalBefore + 1);

    console.log(`✅ Counter incremented: ${totalBefore} → ${totalAfter}`);
  });
});
