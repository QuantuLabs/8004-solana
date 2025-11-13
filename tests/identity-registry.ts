import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { IdentityRegistry } from "../target/types/identity_registry";

describe("Identity Registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  let configPda: PublicKey;
  let configBump: number;

  before(async () => {
    // Derive config PDA
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  });

  describe("Initialize", () => {
    it("Initializes the registry config", async () => {
      await program.methods
        .initialize()
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.registryConfig.fetch(configPda);

      assert.equal(config.authority.toBase58(), provider.wallet.publicKey.toBase58());
      assert.equal(config.nextAgentId.toNumber(), 0);
      assert.equal(config.totalAgents.toNumber(), 0);
      assert.equal(config.bump, configBump);
    });

    it("Fails to reinitialize", async () => {
      try {
        await program.methods
          .initialize()
          .accounts({
            config: configPda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        assert.fail("Should have failed to reinitialize");
      } catch (error) {
        // Expected to fail - account already initialized
        assert.include(error.message, "already in use");
      }
    });
  });
});
