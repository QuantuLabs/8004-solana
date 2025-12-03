import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import { SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { getValidationConfigPda, initializeIdentityRegistry } from "./validation-helpers";

describe("Validation Registry - Initialization", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const authority = provider.wallet as anchor.Wallet;

  const [validationConfig] = getValidationConfigPda(validationProgram.programId);

  before(async () => {
    // Initialize Identity Registry first
    await initializeIdentityRegistry(identityProgram, provider);
  });

  it("✅ Initialize Validation Registry with Identity Registry reference", async () => {
    await validationProgram.methods
      .initialize(identityProgram.programId)
      .accounts({
        config: validationConfig,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );

    assert.equal(
      config.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.equal(
      config.identityRegistry.toBase58(),
      identityProgram.programId.toBase58()
    );
    assert.equal(config.totalRequests.toNumber(), 0);
    assert.equal(config.totalResponses.toNumber(), 0);

    console.log("✅ Validation Registry initialized");
    console.log("   Identity Registry:", config.identityRegistry.toBase58());
  });

  it("❌ Fail to reinitialize", async () => {
    try {
      await validationProgram.methods
        .initialize(identityProgram.programId)
        .accounts({
          config: validationConfig,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have failed to reinitialize");
    } catch (err) {
      assert.include(err.toString(), "already in use");
      console.log("✅ Correctly prevented reinitialization");
    }
  });

  it("✅ Verify config state after initialization", async () => {
    const config = await validationProgram.account.validationConfig.fetch(
      validationConfig
    );

    assert.equal(config.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(
      config.identityRegistry.toBase58(),
      identityProgram.programId.toBase58()
    );
    assert.equal(config.totalRequests.toNumber(), 0);
    assert.equal(config.totalResponses.toNumber(), 0);

    console.log("✅ Config state verified");
  });
});
