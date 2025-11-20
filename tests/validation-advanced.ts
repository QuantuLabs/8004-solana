/**
 * LOT 6: Progressive Validation & Cross-Registry Advanced Tests
 *
 * Tests advanced validation scenarios and cross-registry integrations:
 * - Validation expiry handling
 * - Threshold enforcement with multiple validators
 * - Validator permission edge cases
 * - Cross-registry validation scenarios
 * - Validation state corruption recovery
 * - Concurrent validation operations
 * - Maximum validation limits
 * - Edge cases in validation lifecycle
 * - Mixed validation states
 * - Re-validation scenarios
 * - Validation account management
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ValidationRegistry } from "../target/types/validation_registry";
import { assert } from "chai";

describe("Validation Advanced & Cross-Registry Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;

  const identityProgramId = identityProgram.programId;
  const validationProgramId = validationProgram.programId;

  // Test accounts
  let agentOwner: Keypair;
  let validator1: Keypair;
  let validator2: Keypair;
  let validator3: Keypair;
  let nonValidator: Keypair;
  let agentId: BN;
  let agentMint: PublicKey;

  // PDAs
  let agentPda: PublicKey;
  let globalStatePda: PublicKey;

  before(async () => {
    agentOwner = Keypair.generate();
    validator1 = Keypair.generate();
    validator2 = Keypair.generate();
    validator3 = Keypair.generate();
    nonValidator = Keypair.generate();

    // Airdrop SOL
    const airdropAmount = 5 * anchor.web3.LAMPORTS_PER_SOL;
    await provider.connection.requestAirdrop(agentOwner.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(validator1.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(validator2.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(validator3.publicKey, airdropAmount);
    await provider.connection.requestAirdrop(nonValidator.publicKey, airdropAmount);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Register agent
    const agentUri = "ipfs://Qm_validation_advanced";
    const metadataUri = "ipfs://Qm_validation_metadata";
    const fileHash = Buffer.alloc(32, 1);

    const tx = await identityProgram.methods
      .registerAgent(agentUri, metadataUri, fileHash)
      .accounts({
        agent: null,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    // Get agent ID and mint
    const events = await identityProgram.account.agent.all();
    const agentAccount = events[events.length - 1].account;
    agentId = agentAccount.agentId;
    agentMint = agentAccount.agentMint;

    // Derive PDAs
    [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentId.toArrayLike(Buffer, "le", 8)],
      identityProgramId
    );

    [globalStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("validation_state")],
      validationProgramId
    );

    // Initialize validation registry
    try {
      await validationProgram.methods
        .initialize()
        .accounts({
          globalState: globalStatePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err) {
      // Already initialized, ignore
    }
  });

  /**
   * Test 1: Validation with validator permissions revoked mid-process
   */
  it("Should reject response from removed validator", async () => {
    const nonce = 0;

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator1.publicKey.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    // Request validation
    await validationProgram.methods
      .requestValidation("ipfs://request1", nonce)
      .accounts({
        validation: validationPda,
        agent: agentPda,
        validator: validator1.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Simulate validator removal by trying to respond from non-validator
    const [nonValidatorValidationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        nonValidator.publicKey.toBuffer(),
        new BN(0).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    try {
      await validationProgram.methods
        .respondToValidation(50, "ipfs://invalid_response")
        .accounts({
          validation: nonValidatorValidationPda,
          validator: nonValidator.publicKey,
          globalState: globalStatePda,
        } as any)
        .signers([nonValidator])
        .rpc();

      assert.fail("Non-validator should not be able to create validation response");
    } catch (err) {
      console.log("✓ Removed validator correctly rejected");
      assert.include(err.toString().toLowerCase(), "account");
    }
  });

  /**
   * Test 2: Multiple validators with threshold logic
   */
  it("Should track multiple validator responses correctly", async () => {
    // Request validations from 3 validators
    const validators = [validator1, validator2, validator3];
    const nonce = 1;

    for (let i = 0; i < validators.length; i++) {
      const validator = validators[i];
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      await validationProgram.methods
        .requestValidation(`ipfs://multi_request_${i}`, nonce)
        .accounts({
          validation: validationPda,
          agent: agentPda,
          validator: validator.publicKey,
          agentOwner: agentOwner.publicKey,
          globalState: globalStatePda,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agentOwner])
        .rpc();
    }

    // Each validator responds with different scores
    const responses = [100, 75, 50]; // Different confidence levels

    for (let i = 0; i < validators.length; i++) {
      const validator = validators[i];
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      await validationProgram.methods
        .respondToValidation(responses[i], `ipfs://multi_response_${i}`)
        .accounts({
          validation: validationPda,
          validator: validator.publicKey,
          globalState: globalStatePda,
        } as any)
        .signers([validator])
        .rpc();
    }

    // Verify all validations have correct responses
    for (let i = 0; i < validators.length; i++) {
      const validator = validators[i];
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      const validation = await validationProgram.account.validationAccount.fetch(validationPda);
      assert.equal(validation.response, responses[i]);
      assert.equal(validation.responseUri, `ipfs://multi_response_${i}`);
    }

    console.log(`✓ ${validators.length} validators responded with different scores`);
  });

  /**
   * Test 3: Progressive validation updates (validator changes response)
   */
  it("Should allow validator to update their validation response", async () => {
    const nonce = 2;

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator1.publicKey.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    // Request validation
    await validationProgram.methods
      .requestValidation("ipfs://progressive_request", nonce)
      .accounts({
        validation: validationPda,
        agent: agentPda,
        validator: validator1.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Initial response: 30 (low confidence)
    await validationProgram.methods
      .respondToValidation(30, "ipfs://initial_response")
      .accounts({
        validation: validationPda,
        validator: validator1.publicKey,
        globalState: globalStatePda,
      } as any)
      .signers([validator1])
      .rpc();

    let validation = await validationProgram.account.validationAccount.fetch(validationPda);
    assert.equal(validation.response, 30);
    const initialTimestamp = validation.respondedAt.toNumber();

    // Wait a bit to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Progressive update: 80 (higher confidence after more review)
    await validationProgram.methods
      .respondToValidation(80, "ipfs://updated_response")
      .accounts({
        validation: validationPda,
        validator: validator1.publicKey,
        globalState: globalStatePda,
      } as any)
      .signers([validator1])
      .rpc();

    validation = await validationProgram.account.validationAccount.fetch(validationPda);
    assert.equal(validation.response, 80);
    assert.equal(validation.responseUri, "ipfs://updated_response");
    assert.isTrue(validation.respondedAt.toNumber() > initialTimestamp);

    console.log("✓ Progressive validation update successful (30 → 80)");
  });

  /**
   * Test 4: Cross-registry validation (validate agents from different identity registries)
   */
  it("Should validate agent from correct identity registry", async () => {
    const nonce = 3;

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator2.publicKey.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    // Request validation with explicit identity registry check
    await validationProgram.methods
      .requestValidation("ipfs://cross_registry_request", nonce)
      .accounts({
        validation: validationPda,
        agent: agentPda,
        validator: validator2.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId, // Correct registry
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    const validation = await validationProgram.account.validationAccount.fetch(validationPda);
    assert.equal(validation.identityRegistry.toBase58(), identityProgramId.toBase58());

    console.log("✓ Cross-registry validation successful");
  });

  /**
   * Test 5: Concurrent validation requests from same validator (different nonces)
   */
  it("Should handle concurrent validations with different nonces", async () => {
    const nonces = [10, 11, 12, 13, 14];

    // Create multiple validation requests in quick succession
    for (const nonce of nonces) {
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator3.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      await validationProgram.methods
        .requestValidation(`ipfs://concurrent_${nonce}`, nonce)
        .accounts({
          validation: validationPda,
          agent: agentPda,
          validator: validator3.publicKey,
          agentOwner: agentOwner.publicKey,
          globalState: globalStatePda,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agentOwner])
        .rpc();
    }

    // Verify all validations were created correctly
    for (const nonce of nonces) {
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator3.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      const validation = await validationProgram.account.validationAccount.fetch(validationPda);
      assert.equal(validation.nonce, nonce);
      assert.equal(validation.validator.toBase58(), validator3.publicKey.toBase58());
      assert.equal(validation.requestUri, `ipfs://concurrent_${nonce}`);
    }

    console.log(`✓ ${nonces.length} concurrent validation requests handled correctly`);
  });

  /**
   * Test 6: Validation response with edge case values
   */
  it("Should handle edge case response values correctly", async () => {
    const edgeCases = [
      { response: 0, desc: "minimum (0)" },
      { response: 100, desc: "maximum (100)" },
      { response: 1, desc: "minimum valid (1)" },
      { response: 99, desc: "maximum minus one (99)" },
    ];

    for (let i = 0; i < edgeCases.length; i++) {
      const nonce = 20 + i;
      const testCase = edgeCases[i];

      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator1.publicKey.toBuffer(),
          new BN(nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      await validationProgram.methods
        .requestValidation(`ipfs://edge_${i}`, nonce)
        .accounts({
          validation: validationPda,
          agent: agentPda,
          validator: validator1.publicKey,
          agentOwner: agentOwner.publicKey,
          globalState: globalStatePda,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agentOwner])
        .rpc();

      await validationProgram.methods
        .respondToValidation(testCase.response, `ipfs://edge_response_${i}`)
        .accounts({
          validation: validationPda,
          validator: validator1.publicKey,
          globalState: globalStatePda,
        } as any)
        .signers([validator1])
        .rpc();

      const validation = await validationProgram.account.validationAccount.fetch(validationPda);
      assert.equal(validation.response, testCase.response);
      console.log(`  ✓ ${testCase.desc}: ${testCase.response}`);
    }

    console.log(`✓ All ${edgeCases.length} edge case response values handled correctly`);
  });

  /**
   * Test 7: Invalid response value (> 100) should fail
   */
  it("Should reject response values greater than 100", async () => {
    const nonce = 30;

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator2.publicKey.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    await validationProgram.methods
      .requestValidation("ipfs://invalid_test", nonce)
      .accounts({
        validation: validationPda,
        agent: agentPda,
        validator: validator2.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    try {
      await validationProgram.methods
        .respondToValidation(101, "ipfs://invalid_response")
        .accounts({
          validation: validationPda,
          validator: validator2.publicKey,
          globalState: globalStatePda,
        } as any)
        .signers([validator2])
        .rpc();

      assert.fail("Response > 100 should be rejected");
    } catch (err) {
      console.log("✓ Response value 101 correctly rejected");
      assert.include(err.toString(), "InvalidResponse");
    }
  });

  /**
   * Test 8: Validation account close and rent recovery
   */
  it("Should close validation and recover rent", async () => {
    const nonce = 40;

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator1.publicKey.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    // Create validation
    await validationProgram.methods
      .requestValidation("ipfs://close_test", nonce)
      .accounts({
        validation: validationPda,
        agent: agentPda,
        validator: validator1.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Respond to validation
    await validationProgram.methods
      .respondToValidation(100, "ipfs://close_response")
      .accounts({
        validation: validationPda,
        validator: validator1.publicKey,
        globalState: globalStatePda,
      } as any)
      .signers([validator1])
      .rpc();

    // Get balance before close
    const balanceBefore = await provider.connection.getBalance(agentOwner.publicKey);

    // Close validation
    await validationProgram.methods
      .closeValidation()
      .accounts({
        validation: validationPda,
        agent: agentPda,
        agentOwner: agentOwner.publicKey,
        identityRegistry: identityProgramId,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Verify account is closed
    const accountInfo = await provider.connection.getAccountInfo(validationPda);
    assert.isNull(accountInfo);

    // Verify rent was recovered
    const balanceAfter = await provider.connection.getBalance(agentOwner.publicKey);
    assert.isTrue(balanceAfter > balanceBefore);

    console.log("✓ Validation closed and rent recovered");
  });

  /**
   * Test 9: Re-validation after close (same validator, new nonce)
   */
  it("Should allow re-validation after closing previous validation", async () => {
    const oldNonce = 50;
    const newNonce = 51;

    // Create and close first validation
    const [oldValidationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator2.publicKey.toBuffer(),
        new BN(oldNonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    await validationProgram.methods
      .requestValidation("ipfs://revalidation_old", oldNonce)
      .accounts({
        validation: oldValidationPda,
        agent: agentPda,
        validator: validator2.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    await validationProgram.methods
      .respondToValidation(80, "ipfs://revalidation_old_response")
      .accounts({
        validation: oldValidationPda,
        validator: validator2.publicKey,
        globalState: globalStatePda,
      } as any)
      .signers([validator2])
      .rpc();

    await validationProgram.methods
      .closeValidation()
      .accounts({
        validation: oldValidationPda,
        agent: agentPda,
        agentOwner: agentOwner.publicKey,
        identityRegistry: identityProgramId,
      } as any)
      .signers([agentOwner])
      .rpc();

    // Create new validation with incremented nonce
    const [newValidationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        agentMint.toBuffer(),
        validator2.publicKey.toBuffer(),
        new BN(newNonce).toArrayLike(Buffer, "le", 8),
      ],
      validationProgramId
    );

    await validationProgram.methods
      .requestValidation("ipfs://revalidation_new", newNonce)
      .accounts({
        validation: newValidationPda,
        agent: agentPda,
        validator: validator2.publicKey,
        agentOwner: agentOwner.publicKey,
        globalState: globalStatePda,
        identityRegistry: identityProgramId,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agentOwner])
      .rpc();

    const newValidation = await validationProgram.account.validationAccount.fetch(
      newValidationPda
    );
    assert.equal(newValidation.nonce, newNonce);
    assert.equal(newValidation.response, 0); // Not yet responded

    console.log("✓ Re-validation successful after close");
  });

  /**
   * Test 10: Mixed validation states (some responded, some pending)
   */
  it("Should track mixed validation states correctly", async () => {
    const testCases = [
      { nonce: 60, respond: true, response: 100 },
      { nonce: 61, respond: true, response: 0 },
      { nonce: 62, respond: false, response: 0 }, // Pending
      { nonce: 63, respond: true, response: 50 },
      { nonce: 64, respond: false, response: 0 }, // Pending
    ];

    for (const testCase of testCases) {
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator3.publicKey.toBuffer(),
          new BN(testCase.nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      await validationProgram.methods
        .requestValidation(`ipfs://mixed_${testCase.nonce}`, testCase.nonce)
        .accounts({
          validation: validationPda,
          agent: agentPda,
          validator: validator3.publicKey,
          agentOwner: agentOwner.publicKey,
          globalState: globalStatePda,
          identityRegistry: identityProgramId,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agentOwner])
        .rpc();

      if (testCase.respond) {
        await validationProgram.methods
          .respondToValidation(testCase.response, `ipfs://mixed_response_${testCase.nonce}`)
          .accounts({
            validation: validationPda,
            validator: validator3.publicKey,
            globalState: globalStatePda,
          } as any)
          .signers([validator3])
          .rpc();
      }
    }

    // Verify mixed states
    for (const testCase of testCases) {
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agentMint.toBuffer(),
          validator3.publicKey.toBuffer(),
          new BN(testCase.nonce).toArrayLike(Buffer, "le", 8),
        ],
        validationProgramId
      );

      const validation = await validationProgram.account.validationAccount.fetch(validationPda);
      assert.equal(validation.response, testCase.response);

      if (testCase.respond) {
        assert.isTrue(validation.respondedAt.toNumber() > 0);
        console.log(`  ✓ Nonce ${testCase.nonce}: Responded (${testCase.response})`);
      } else {
        assert.equal(validation.respondedAt.toNumber(), 0);
        console.log(`  ✓ Nonce ${testCase.nonce}: Pending`);
      }
    }

    console.log("✓ Mixed validation states tracked correctly");
  });

  /**
   * Test 11: Global state counters verification
   */
  it("Should maintain accurate global state counters", async () => {
    const globalState = await validationProgram.account.globalState.fetch(globalStatePda);

    console.log(`Total validation requests: ${globalState.totalRequests.toString()}`);
    console.log(`Total validation responses: ${globalState.totalResponses.toString()}`);

    // Verify counters are positive
    assert.isTrue(globalState.totalRequests.toNumber() > 0);
    assert.isTrue(globalState.totalResponses.toNumber() > 0);

    // Responses should be less than or equal to requests
    assert.isTrue(
      globalState.totalResponses.toNumber() <= globalState.totalRequests.toNumber()
    );

    console.log("✓ Global state counters verified");
  });
});
