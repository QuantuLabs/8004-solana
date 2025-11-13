import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
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

  describe("Register", () => {
    let nftMint: PublicKey;
    let agentPda: PublicKey;

    beforeEach(async () => {
      // Create a new NFT mint for each test (supply=1, decimals=0)
      const mintKeypair = Keypair.generate();
      nftMint = await createMint(
        provider.connection,
        provider.wallet.payer,
        provider.wallet.publicKey,
        null,
        0, // decimals = 0 (NFT)
        mintKeypair
      );

      // Mint exactly 1 token (supply=1)
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        nftMint,
        provider.wallet.publicKey
      );

      await mintTo(
        provider.connection,
        provider.wallet.payer,
        nftMint,
        tokenAccount.address,
        provider.wallet.publicKey,
        1 // supply = 1 (NFT)
      );

      // Derive agent PDA
      [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), nftMint.toBuffer()],
        program.programId
      );
    });

    it("Registers an agent with tokenURI", async () => {
      const tokenUri = "ipfs://QmTest123456789abcdefg";

      await program.methods
        .register(tokenUri)
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          agentMint: nftMint,
          owner: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      // Verify agent account
      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.agentId.toNumber(), 0, "First agent should have ID 0");
      assert.equal(agent.owner.toBase58(), provider.wallet.publicKey.toBase58());
      assert.equal(agent.agentMint.toBase58(), nftMint.toBase58());
      assert.equal(agent.tokenUri, tokenUri);
      assert.equal(agent.metadata.length, 0, "Should have no initial metadata");

      // Verify config updated
      const config = await program.account.registryConfig.fetch(configPda);
      assert.equal(config.nextAgentId.toNumber(), 1, "Next ID should be 1");
      assert.equal(config.totalAgents.toNumber(), 1, "Total should be 1");
    });

    it("Registers agent with empty tokenURI (ERC-8004 spec)", async () => {
      const tokenUri = "";

      await program.methods
        .register(tokenUri)
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          agentMint: nftMint,
          owner: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, "", "Empty URI should be allowed");
    });

    it("Assigns sequential agent IDs", async () => {
      // Register first agent
      await program.methods
        .register("ipfs://first")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          agentMint: nftMint,
          owner: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const firstAgent = await program.account.agentAccount.fetch(agentPda);
      const firstId = firstAgent.agentId.toNumber();

      // Create second NFT and register
      const mintKeypair2 = Keypair.generate();
      const nftMint2 = await createMint(
        provider.connection,
        provider.wallet.payer,
        provider.wallet.publicKey,
        null,
        0,
        mintKeypair2
      );

      const tokenAccount2 = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        nftMint2,
        provider.wallet.publicKey
      );

      await mintTo(
        provider.connection,
        provider.wallet.payer,
        nftMint2,
        tokenAccount2.address,
        provider.wallet.publicKey,
        1
      );

      const [agentPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), nftMint2.toBuffer()],
        program.programId
      );

      await program.methods
        .register("ipfs://second")
        .accounts({
          config: configPda,
          agentAccount: agentPda2,
          agentMint: nftMint2,
          owner: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const secondAgent = await program.account.agentAccount.fetch(agentPda2);
      assert.equal(
        secondAgent.agentId.toNumber(),
        firstId + 1,
        "IDs should be sequential"
      );
    });

    it("Fails with tokenURI > 200 bytes", async () => {
      const longUri = "ipfs://" + "a".repeat(200);

      try {
        await program.methods
          .register(longUri)
          .accounts({
            config: configPda,
            agentAccount: agentPda,
            agentMint: nftMint,
            owner: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        assert.fail("Should have failed with URI too long");
      } catch (error) {
        assert.include(error.message, "UriTooLong");
      }
    });

    it("Fails with invalid NFT (decimals != 0)", async () => {
      // Create mint with decimals = 9 (not an NFT)
      const invalidMintKeypair = Keypair.generate();
      const invalidMint = await createMint(
        provider.connection,
        provider.wallet.payer,
        provider.wallet.publicKey,
        null,
        9, // decimals = 9 (NOT an NFT!)
        invalidMintKeypair
      );

      const [invalidAgentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), invalidMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .register("ipfs://invalid")
          .accounts({
            config: configPda,
            agentAccount: invalidAgentPda,
            agentMint: invalidMint,
            owner: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        assert.fail("Should have failed with InvalidNFT");
      } catch (error) {
        assert.include(error.message, "InvalidNFT");
      }
    });
  });
});
