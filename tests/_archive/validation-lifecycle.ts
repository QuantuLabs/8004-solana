import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import {
  getValidationConfigPda,
  getValidationRequestPda,
  registerAgent,
  computeHash,
  requestValidation,
  respondToValidation,
  initializeIdentityRegistry,
  initializeValidationRegistry,
} from "./validation-helpers";

describe("Validation Registry - E2E Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const authority = provider.wallet as anchor.Wallet;

  const [validationConfig] = getValidationConfigPda(validationProgram.programId);

  let agent1: { id: number; owner: PublicKey; mint: Keypair; account: PublicKey };
  let agent2: { id: number; owner: PublicKey; mint: Keypair; account: PublicKey };
  const validator1 = Keypair.generate();
  const validator2 = Keypair.generate();
  const validator3 = Keypair.generate();

  before(async () => {
    // Initialize Identity Registry first
    await initializeIdentityRegistry(identityProgram, provider);

    // Initialize Validation Registry
    await initializeValidationRegistry(validationProgram, identityProgram, provider);

    // Airdrop to validators
    for (const validator of [validator1, validator2, validator3]) {
      const sig = await provider.connection.requestAirdrop(
        validator.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Register test agents (using provider.wallet as owner)
    agent1 = await registerAgent(identityProgram, provider);
    agent2 = await registerAgent(identityProgram, provider);

    console.log(`Registered agent #${agent1.id} and #${agent2.id} for E2E testing`);
  });

  it("✅ Full flow: register → request → respond → query", async () => {
    const nonce = 0;
    const requestUri = "ipfs://QmE2ERequest";
    const requestHash = computeHash(requestUri);

    // Step 1: Request validation
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

    // Step 2: Verify request state (pending)
    let request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );
    assert.equal(request.response, 0);
    assert.equal(request.respondedAt.toNumber(), 0);

    // Step 3: Validator responds
    const responseUri = "ipfs://QmE2EResponse";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.from("e2e-test");
    const tagPadded = Buffer.concat([tag, Buffer.alloc(32 - tag.length)]);

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 85,
      responseUri,
      responseHash,
      tag: tagPadded,
    });

    // Step 4: Verify response state
    request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );
    assert.equal(request.response, 85);
    assert.isAbove(request.respondedAt.toNumber(), 0);
    assert.deepEqual(request.responseHash, Array.from(responseHash));

    // Step 5: Query using PDA
    const [queriedPda] = getValidationRequestPda(
      validationProgram.programId,
      agent1.id,
      validator1.publicKey,
      nonce
    );
    assert.equal(queriedPda.toBase58(), validationRequest.toBase58());

    console.log("✅ Complete E2E flow verified");
  });

  it("✅ Multiple validators for same agent", async () => {
    const nonce = 0;

    // Request from 3 different validators
    const requests = await Promise.all([
      requestValidation(validationProgram, identityProgram, {
        validationConfig,
        agentId: agent2.id,
        agentAccount: agent2.account,
        agentOwner: agent2.owner,
        validatorAddress: validator1.publicKey,
        nonce,
        requestUri: "ipfs://QmMultiVal1",
        requestHash: computeHash("ipfs://QmMultiVal1"),
      }),
      requestValidation(validationProgram, identityProgram, {
        validationConfig,
        agentId: agent2.id,
        agentAccount: agent2.account,
        agentOwner: agent2.owner,
        validatorAddress: validator2.publicKey,
        nonce,
        requestUri: "ipfs://QmMultiVal2",
        requestHash: computeHash("ipfs://QmMultiVal2"),
      }),
      requestValidation(validationProgram, identityProgram, {
        validationConfig,
        agentId: agent2.id,
        agentAccount: agent2.account,
        agentOwner: agent2.owner,
        validatorAddress: validator3.publicKey,
        nonce,
        requestUri: "ipfs://QmMultiVal3",
        requestHash: computeHash("ipfs://QmMultiVal3"),
      }),
    ]);

    // All validators respond with different scores
    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest: requests[0],
      validator: validator1,
      response: 90,
      responseUri: "ipfs://QmResp1",
      responseHash: computeHash("ipfs://QmResp1"),
      tag: Buffer.alloc(32),
    });

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest: requests[1],
      validator: validator2,
      response: 85,
      responseUri: "ipfs://QmResp2",
      responseHash: computeHash("ipfs://QmResp2"),
      tag: Buffer.alloc(32),
    });

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest: requests[2],
      validator: validator3,
      response: 95,
      responseUri: "ipfs://QmResp3",
      responseHash: computeHash("ipfs://QmResp3"),
      tag: Buffer.alloc(32),
    });

    // Verify all responses
    const req1 = await validationProgram.account.validationRequest.fetch(requests[0]);
    const req2 = await validationProgram.account.validationRequest.fetch(requests[1]);
    const req3 = await validationProgram.account.validationRequest.fetch(requests[2]);

    assert.equal(req1.response, 90);
    assert.equal(req2.response, 85);
    assert.equal(req3.response, 95);

    console.log("✅ Multiple validators (90, 85, 95) all verified");
  });

  it("✅ Re-validation (same validator, nonce++)", async () => {
    // First validation (nonce 0)
    const request1 = await requestValidation(validationProgram, identityProgram, {
      validationConfig,
      agentId: agent1.id,
      agentAccount: agent1.account,
      agentOwner: agent1.owner,
      validatorAddress: validator2.publicKey,
      nonce: 0,
      requestUri: "ipfs://QmRevalV1",
      requestHash: computeHash("ipfs://QmRevalV1"),
    });

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest: request1,
      validator: validator2,
      response: 60,
      responseUri: "ipfs://QmRespV1",
      responseHash: computeHash("ipfs://QmRespV1"),
      tag: Buffer.alloc(32),
    });

    // Re-validation after improvements (nonce 1)
    const request2 = await requestValidation(validationProgram, identityProgram, {
      validationConfig,
      agentId: agent1.id,
      agentAccount: agent1.account,
      agentOwner: agent1.owner,
      validatorAddress: validator2.publicKey,
      nonce: 1,
      requestUri: "ipfs://QmRevalV2",
      requestHash: computeHash("ipfs://QmRevalV2"),
    });

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest: request2,
      validator: validator2,
      response: 92,
      responseUri: "ipfs://QmRespV2",
      responseHash: computeHash("ipfs://QmRespV2"),
      tag: Buffer.alloc(32),
    });

    const req1 = await validationProgram.account.validationRequest.fetch(request1);
    const req2 = await validationProgram.account.validationRequest.fetch(request2);

    assert.equal(req1.nonce, 0);
    assert.equal(req1.response, 60);
    assert.equal(req2.nonce, 1);
    assert.equal(req2.response, 92);

    console.log("✅ Re-validation works (60 → 92 with nonce++)");
  });

  it("✅ Close validation and recover rent", async () => {
    const nonce = 10;
    const requestUri = "ipfs://QmCloseTest";

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
        requestHash: computeHash(requestUri),
      }
    );

    // Respond first
    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 100,
      responseUri: "ipfs://QmCloseResp",
      responseHash: computeHash("ipfs://QmCloseResp"),
      tag: Buffer.alloc(32),
    });

    // Get balance before closing
    const balanceBefore = await provider.connection.getBalance(agent1.owner);

    // Close validation account
    await validationProgram.methods
      .closeValidation()
      .accounts({
        authority: agent1.owner,
        validationRequest,
        rentReceiver: agent1.owner,
        identityRegistryProgram: null,
      })
      .rpc();

    // Verify rent was recovered
    const balanceAfter = await provider.connection.getBalance(agent1.owner);
    assert.isAbove(balanceAfter, balanceBefore);

    // Verify account is closed
    try {
      await validationProgram.account.validationRequest.fetch(validationRequest);
      assert.fail("Account should be closed");
    } catch (err) {
      assert.include(err.toString(), "Account does not exist");
    }

    console.log(`✅ Validation closed, rent recovered: ${(balanceAfter - balanceBefore) / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  });

  it("✅ Query validations using getProgramAccounts", async () => {
    // Create a few validation requests for agent1
    const testNonces = [20, 21, 22];
    for (const nonce of testNonces) {
      await requestValidation(validationProgram, identityProgram, {
        validationConfig,
        agentId: agent1.id,
        agentAccount: agent1.account,
        agentOwner: agent1.owner,
        validatorAddress: validator1.publicKey,
        nonce,
        requestUri: `ipfs://QmQuery${nonce}`,
        requestHash: computeHash(`ipfs://QmQuery${nonce}`),
      });
    }

    // Query all validations for agent1 using getProgramAccounts
    const allAccounts = await validationProgram.account.validationRequest.all();

    // Filter for agent1's validations
    const agent1Validations = allAccounts.filter(
      (acc) => acc.account.agentId.toNumber() === agent1.id
    );

    assert.isAtLeast(agent1Validations.length, testNonces.length);

    console.log(`✅ Found ${agent1Validations.length} validations for agent #${agent1.id}`);
  });
});
