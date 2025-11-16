import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import {
  getValidationConfigPda,
  getValidationRequestPda,
  registerAgent,
  computeHash,
  requestValidation,
  respondToValidation,
} from "./validation-helpers";

describe("Validation Registry - Respond to Validation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  const [validationConfig] = getValidationConfigPda(validationProgram.programId);

  let agent1: { id: number; owner: PublicKey; mint: Keypair; account: PublicKey };
  const validator1 = Keypair.generate();
  const validator2 = Keypair.generate();

  before(async () => {
    // Airdrop to validators
    for (const validator of [validator1, validator2]) {
      const sig = await provider.connection.requestAirdrop(
        validator.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Register test agent (using provider.wallet as owner)
    agent1 = await registerAgent(identityProgram, provider);

    console.log(`Registered agent #${agent1.id} for response testing`);
  });

  it("✅ Validator responds with response=100 (passed)", async () => {
    const nonce = 0;
    const requestUri = "ipfs://QmRequest100";
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

    const responseUri = "ipfs://QmResponse100Pass";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.from("oasf-v0.8.0");
    const tagPadded = Buffer.concat([tag, Buffer.alloc(32 - tag.length)]);

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 100,
      responseUri,
      responseHash,
      tag: tagPadded,
    });

    const request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );

    assert.equal(request.response, 100);
    assert.deepEqual(request.responseHash, Array.from(responseHash));
    assert.isAbove(request.respondedAt.toNumber(), 0);

    console.log("✅ Response=100 (passed) recorded");
  });

  it("✅ Validator responds with response=0 (failed)", async () => {
    const nonce = 1;
    const requestUri = "ipfs://QmRequest0";

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

    const responseUri = "ipfs://QmResponse0Fail";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.alloc(32);

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 0,
      responseUri,
      responseHash,
      tag,
    });

    const request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );

    assert.equal(request.response, 0);

    console.log("✅ Response=0 (failed) recorded");
  });

  it("✅ Validator responds with response=50 (partial)", async () => {
    const nonce = 2;
    const requestUri = "ipfs://QmRequest50";

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

    const responseUri = "ipfs://QmResponse50Partial";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.alloc(32);

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 50,
      responseUri,
      responseHash,
      tag,
    });

    const request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );

    assert.equal(request.response, 50);

    console.log("✅ Response=50 (partial) recorded");
  });

  it("❌ Fail: non-validator responds", async () => {
    const nonce = 3;
    const requestUri = "ipfs://QmRequestWrongValidator";

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

    const responseUri = "ipfs://QmFakeResponse";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.alloc(32);

    try {
      await respondToValidation(validationProgram, {
        validationConfig,
        validationRequest,
        validator: validator2, // Wrong validator!
        response: 100,
        responseUri,
        responseHash,
        tag,
      });
      assert.fail("Should have failed with UnauthorizedValidator");
    } catch (err) {
      assert.include(err.toString(), "UnauthorizedValidator");
      console.log("✅ Non-validator correctly rejected");
    }
  });

  it("❌ Fail: response > 100", async () => {
    const nonce = 4;
    const requestUri = "ipfs://QmRequestInvalidScore";

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

    const responseUri = "ipfs://QmResponse101";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.alloc(32);

    try {
      await respondToValidation(validationProgram, {
        validationConfig,
        validationRequest,
        validator: validator1,
        response: 101, // Invalid!
        responseUri,
        responseHash,
        tag,
      });
      assert.fail("Should have failed with InvalidResponse");
    } catch (err) {
      assert.include(err.toString(), "InvalidResponse");
      console.log("✅ Response > 100 correctly rejected");
    }
  });

  it("❌ Fail: response_uri > 200 bytes", async () => {
    const nonce = 5;
    const requestUri = "ipfs://QmRequestLongUri";

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

    const responseUri = "a".repeat(201); // Too long!
    const responseHash = computeHash(responseUri);
    const tag = Buffer.alloc(32);

    try {
      await respondToValidation(validationProgram, {
        validationConfig,
        validationRequest,
        validator: validator1,
        response: 100,
        responseUri,
        responseHash,
        tag,
      });
      assert.fail("Should have failed with ResponseUriTooLong");
    } catch (err) {
      assert.include(err.toString(), "ResponseUriTooLong");
      console.log("✅ Response URI > 200 bytes correctly rejected");
    }
  });

  it("✅ Verify total_responses incremented", async () => {
    const configBefore = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );
    const totalBefore = configBefore.totalResponses.toNumber();

    const nonce = 6;
    const requestUri = "ipfs://QmCounterTest";

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

    const responseUri = "ipfs://QmCounterResponse";
    const responseHash = computeHash(responseUri);
    const tag = Buffer.alloc(32);

    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 75,
      responseUri,
      responseHash,
      tag,
    });

    const configAfter = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );
    const totalAfter = configAfter.totalResponses.toNumber();

    assert.equal(totalAfter, totalBefore + 1);

    console.log(`✅ Response counter incremented: ${totalBefore} → ${totalAfter}`);
  });

  it("✅ Update existing validation (progressive validation)", async () => {
    const nonce = 7;
    const requestUri = "ipfs://QmProgressiveValidation";

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

    // First response: 70
    await respondToValidation(validationProgram, {
      validationConfig,
      validationRequest,
      validator: validator1,
      response: 70,
      responseUri: "ipfs://QmResponse70",
      responseHash: computeHash("ipfs://QmResponse70"),
      tag: Buffer.alloc(32),
    });

    let request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );
    assert.equal(request.response, 70);

    // Update to 95 (agent improved)
    await validationProgram.methods
      .updateValidation(
        95,
        "ipfs://QmResponse95",
        Array.from(computeHash("ipfs://QmResponse95")),
        Array.from(Buffer.alloc(32))
      )
      .accounts({
        config: validationConfig,
        validator: validator1.publicKey,
        validationRequest,
      })
      .signers([validator1])
      .rpc();

    request = await validationProgram.account.validationRequest.fetch(
      validationRequest
    );
    assert.equal(request.response, 95);

    console.log("✅ Progressive validation works (70 → 95)");
  });
});
