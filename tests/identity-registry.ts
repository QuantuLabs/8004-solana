import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  transfer,
} from "@solana/spl-token";
import { IdentityRegistry } from "../target/types/identity_registry";

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

describe("Identity Registry (ERC-8004 Spec Compliant)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  let configPda: PublicKey;
  let configBump: number;
  let collectionMint: Keypair;
  let collectionMetadata: PublicKey;
  let collectionMasterEdition: PublicKey;
  let collectionTokenAccount: PublicKey;

  // Helper function to derive Metaplex metadata PDA
  function getMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  // Helper function to derive Metaplex master edition PDA
  function getMasterEditionPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  // Helper function to derive agent account PDA
  function getAgentPda(agentMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      program.programId
    );
  }

  before(async () => {
    // Derive config PDA
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  });

  describe("Initialize", () => {
    it("Initializes the registry with Metaplex Collection NFT", async () => {
      collectionMint = Keypair.generate();
      collectionMetadata = getMetadataPda(collectionMint.publicKey);
      collectionMasterEdition = getMasterEditionPda(collectionMint.publicKey);
      collectionTokenAccount = getAssociatedTokenAddressSync(
        collectionMint.publicKey,
        provider.wallet.publicKey
      );

      await program.methods
        .initialize()
        .accounts({
          config: configPda,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          collectionTokenAccount,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([collectionMint])
        .rpc();

      const config = await program.account.registryConfig.fetch(configPda);

      assert.equal(config.authority.toBase58(), provider.wallet.publicKey.toBase58());
      assert.equal(config.nextAgentId.toNumber(), 0, "Agent ID should start at 0");
      assert.equal(config.totalAgents.toNumber(), 0);
      assert.equal(config.collectionMint.toBase58(), collectionMint.publicKey.toBase58());
      assert.equal(config.bump, configBump);

      // Verify collection token account was created and holds 1 NFT
      const collectionTokenAcct = await getAccount(provider.connection, collectionTokenAccount);
      assert.equal(collectionTokenAcct.amount.toString(), "1", "Collection should have supply of 1");
    });

    it("Fails to reinitialize", async () => {
      const newCollectionMint = Keypair.generate();
      const newCollectionMetadata = getMetadataPda(newCollectionMint.publicKey);
      const newCollectionMasterEdition = getMasterEditionPda(newCollectionMint.publicKey);
      const newCollectionTokenAccount = getAssociatedTokenAddressSync(
        newCollectionMint.publicKey,
        provider.wallet.publicKey
      );

      try {
        await program.methods
          .initialize()
          .accounts({
            config: configPda,
            collectionMint: newCollectionMint.publicKey,
            collectionMetadata: newCollectionMetadata,
            collectionMasterEdition: newCollectionMasterEdition,
            collectionTokenAccount: newCollectionTokenAccount,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([newCollectionMint])
          .rpc();

        assert.fail("Should have failed to reinitialize");
      } catch (error) {
        // Expected to fail - config account already initialized
        assert.include(error.message, "already in use");
      }
    });
  });

  describe("Register (ERC-8004: register(tokenURI))", () => {
    let agentMint: Keypair;
    let agentMetadata: PublicKey;
    let agentMasterEdition: PublicKey;
    let agentTokenAccount: PublicKey;
    let agentPda: PublicKey;
    let agentBump: number;

    beforeEach(async () => {
      // Generate new keypairs for each agent NFT
      agentMint = Keypair.generate();
      agentMetadata = getMetadataPda(agentMint.publicKey);
      agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        provider.wallet.publicKey
      );
      [agentPda, agentBump] = getAgentPda(agentMint.publicKey);
    });

    it("Registers agent with tokenURI (contract creates NFT)", async () => {
      const tokenUri = "https://example.com/agent/1.json";

      const configBefore = await program.account.registryConfig.fetch(configPda);
      const expectedAgentId = configBefore.nextAgentId.toNumber();

      await program.methods
        .register(tokenUri)
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      // Verify agent account was created
      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.agentId.toNumber(), expectedAgentId);
      assert.equal(agent.owner.toBase58(), provider.wallet.publicKey.toBase58());
      assert.equal(agent.agentMint.toBase58(), agentMint.publicKey.toBase58());
      assert.equal(agent.tokenUri, tokenUri);
      assert.equal(agent.metadata.length, 0, "Should have no metadata initially");
      assert.equal(agent.bump, agentBump);

      // Verify config was updated
      const configAfter = await program.account.registryConfig.fetch(configPda);
      assert.equal(configAfter.nextAgentId.toNumber(), expectedAgentId + 1);
      assert.equal(configAfter.totalAgents.toNumber(), 1);

      // Verify NFT was minted to owner
      const tokenAcct = await getAccount(provider.connection, agentTokenAccount);
      assert.equal(tokenAcct.amount.toString(), "1", "Owner should have 1 NFT");
      assert.equal(tokenAcct.mint.toBase58(), agentMint.publicKey.toBase58());
    });

    it("Registers agent with empty tokenURI (ERC-8004 spec)", async () => {
      await program.methods
        .register("")
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, "");
    });

    it("Assigns sequential agent IDs starting from 0", async () => {
      const agentMints = [];
      const agentPdas = [];

      // Register 3 agents
      for (let i = 0; i < 3; i++) {
        const mint = Keypair.generate();
        const metadata = getMetadataPda(mint.publicKey);
        const masterEdition = getMasterEditionPda(mint.publicKey);
        const tokenAccount = getAssociatedTokenAddressSync(mint.publicKey, provider.wallet.publicKey);
        const [pda] = getAgentPda(mint.publicKey);

        await program.methods
          .register(`https://example.com/agent/${i}.json`)
          .accounts({
            config: configPda,
            authority: provider.wallet.publicKey,
            agentAccount: pda,
            agentMint: mint.publicKey,
            agentMetadata: metadata,
            agentMasterEdition: masterEdition,
            agentTokenAccount: tokenAccount,
            collectionMint: collectionMint.publicKey,
            collectionMetadata,
            collectionMasterEdition,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([mint])
          .rpc();

        agentMints.push(mint);
        agentPdas.push(pda);
      }

      // Verify agent IDs are sequential
      for (let i = 0; i < 3; i++) {
        const agent = await program.account.agentAccount.fetch(agentPdas[i]);
        // First test registered agent ID 0, so these should be 1, 2, 3
        assert.equal(agent.agentId.toNumber(), 1 + i);
      }

      const config = await program.account.registryConfig.fetch(configPda);
      assert.equal(config.totalAgents.toNumber(), 4, "Should have 4 total agents (1 from previous test + 3 new)");
    });

    it("Fails with tokenURI > 200 bytes", async () => {
      const longUri = "x".repeat(201);

      try {
        await program.methods
          .register(longUri)
          .accounts({
            config: configPda,
            authority: provider.wallet.publicKey,
            agentAccount: agentPda,
            agentMint: agentMint.publicKey,
            agentMetadata,
            agentMasterEdition,
            agentTokenAccount,
            collectionMint: collectionMint.publicKey,
            collectionMetadata,
            collectionMasterEdition,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([agentMint])
          .rpc();

        assert.fail("Should have failed with UriTooLong error");
      } catch (error) {
        assert.include(error.message, "UriTooLong");
      }
    });

    it("Accepts tokenURI with exactly 200 bytes", async () => {
      const exactUri = "x".repeat(200);

      await program.methods
        .register(exactUri)
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri.length, 200);
    });
  });

  describe("Register Empty (ERC-8004: register())", () => {
    it("Registers agent without parameters", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      await program.methods
        .registerEmpty()
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, "", "Token URI should be empty");
      assert.equal(agent.metadata.length, 0, "Metadata should be empty");
    });
  });

  describe("Register With Metadata (ERC-8004: register(tokenURI, metadata[]))", () => {
    it("Registers agent with URI and batch metadata", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      const tokenUri = "https://example.com/agent.json";
      const metadata = [
        { key: "name", value: Buffer.from("Alice") },
        { key: "type", value: Buffer.from("assistant") },
        { key: "version", value: Buffer.from("1.0.0") },
      ];

      await program.methods
        .registerWithMetadata(tokenUri, metadata)
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, tokenUri);
      assert.equal(agent.metadata.length, 3);
      assert.equal(agent.metadata[0].key, "name");
      assert.equal(Buffer.from(agent.metadata[0].value).toString(), "Alice");
      assert.equal(agent.metadata[1].key, "type");
      assert.equal(Buffer.from(agent.metadata[1].value).toString(), "assistant");
    });

    it("Registers agent with empty URI and metadata", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      const metadata = [
        { key: "status", value: Buffer.from("active") },
      ];

      await program.methods
        .registerWithMetadata("", metadata)
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, "");
      assert.equal(agent.metadata.length, 1);
    });

    it("Fails with more than 10 metadata entries", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      const metadata = [];
      for (let i = 0; i < 11; i++) {
        metadata.push({ key: `key${i}`, value: Buffer.from(`value${i}`) });
      }

      try {
        await program.methods
          .registerWithMetadata("https://example.com", metadata)
          .accounts({
            config: configPda,
            authority: provider.wallet.publicKey,
            agentAccount: agentPda,
            agentMint: agentMint.publicKey,
            agentMetadata,
            agentMasterEdition,
            agentTokenAccount,
            collectionMint: collectionMint.publicKey,
            collectionMetadata,
            collectionMasterEdition,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([agentMint])
          .rpc();

        assert.fail("Should have failed with MetadataLimitReached error");
      } catch (error) {
        assert.include(error.message, "MetadataLimitReached");
      }
    });

    it("Accepts exactly 10 metadata entries", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      const metadata = [];
      for (let i = 0; i < 10; i++) {
        metadata.push({ key: `key${i}`, value: Buffer.from(`value${i}`) });
      }

      await program.methods
        .registerWithMetadata("https://example.com", metadata)
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.metadata.length, 10);
    });

    it("Fails with key > 32 bytes", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      const metadata = [
        { key: "x".repeat(33), value: Buffer.from("value") },
      ];

      try {
        await program.methods
          .registerWithMetadata("https://example.com", metadata)
          .accounts({
            config: configPda,
            authority: provider.wallet.publicKey,
            agentAccount: agentPda,
            agentMint: agentMint.publicKey,
            agentMetadata,
            agentMasterEdition,
            agentTokenAccount,
            collectionMint: collectionMint.publicKey,
            collectionMetadata,
            collectionMasterEdition,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([agentMint])
          .rpc();

        assert.fail("Should have failed with KeyTooLong error");
      } catch (error) {
        assert.include(error.message, "KeyTooLong");
      }
    });

    it("Fails with value > 256 bytes", async () => {
      const agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      const [agentPda] = getAgentPda(agentMint.publicKey);

      const metadata = [
        { key: "data", value: Buffer.alloc(257, "x") },
      ];

      try {
        await program.methods
          .registerWithMetadata("https://example.com", metadata)
          .accounts({
            config: configPda,
            authority: provider.wallet.publicKey,
            agentAccount: agentPda,
            agentMint: agentMint.publicKey,
            agentMetadata,
            agentMasterEdition,
            agentTokenAccount,
            collectionMint: collectionMint.publicKey,
            collectionMetadata,
            collectionMasterEdition,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .signers([agentMint])
          .rpc();

        assert.fail("Should have failed with ValueTooLong error");
      } catch (error) {
        assert.include(error.message, "ValueTooLong");
      }
    });
  });

  describe("Get Metadata (ERC-8004: getMetadata(agentId, key))", () => {
    let agentMint: Keypair;
    let agentPda: PublicKey;

    before(async () => {
      // Register an agent with metadata
      agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      [agentPda] = getAgentPda(agentMint.publicKey);

      const metadata = [
        { key: "name", value: Buffer.from("Test Agent") },
        { key: "type", value: Buffer.from("assistant") },
      ];

      await program.methods
        .registerWithMetadata("https://test.com", metadata)
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();
    });

    it("Returns metadata value for existing key", async () => {
      const result = await program.methods
        .getMetadata("name")
        .accounts({
          agentAccount: agentPda,
        })
        .view();

      assert.equal(Buffer.from(result).toString(), "Test Agent");
    });

    it("Returns empty bytes for non-existent key", async () => {
      const result = await program.methods
        .getMetadata("nonexistent")
        .accounts({
          agentAccount: agentPda,
        })
        .view();

      assert.equal(result.length, 0, "Should return empty array");
    });
  });

  describe("Set Metadata (ERC-8004: setMetadata(agentId, key, value))", () => {
    let agentMint: Keypair;
    let agentPda: PublicKey;

    beforeEach(async () => {
      // Register a fresh agent for each test
      agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      [agentPda] = getAgentPda(agentMint.publicKey);

      await program.methods
        .register("https://example.com")
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();
    });

    it("Sets new metadata entry", async () => {
      await program.methods
        .setMetadata("name", Buffer.from("Alice"))
        .accounts({
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.metadata.length, 1);
      assert.equal(agent.metadata[0].key, "name");
      assert.equal(Buffer.from(agent.metadata[0].value).toString(), "Alice");
    });

    it("Updates existing metadata entry", async () => {
      // Set initial value
      await program.methods
        .setMetadata("status", Buffer.from("active"))
        .accounts({
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      // Update same key
      await program.methods
        .setMetadata("status", Buffer.from("inactive"))
        .accounts({
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.metadata.length, 1, "Should still have 1 entry");
      assert.equal(Buffer.from(agent.metadata[0].value).toString(), "inactive");
    });

    it("Adds multiple metadata entries", async () => {
      const entries = [
        { key: "name", value: "Alice" },
        { key: "type", value: "assistant" },
        { key: "version", value: "1.0" },
      ];

      for (const entry of entries) {
        await program.methods
          .setMetadata(entry.key, Buffer.from(entry.value))
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();
      }

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.metadata.length, 3);
    });

    it("Enforces 10 metadata entry limit", async () => {
      // Add 10 entries
      for (let i = 0; i < 10; i++) {
        await program.methods
          .setMetadata(`key${i}`, Buffer.from(`value${i}`))
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();
      }

      // Try to add 11th entry
      try {
        await program.methods
          .setMetadata("key11", Buffer.from("value11"))
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();

        assert.fail("Should have failed with MetadataLimitReached error");
      } catch (error) {
        assert.include(error.message, "MetadataLimitReached");
      }
    });

    it("Fails with key > 32 bytes", async () => {
      const longKey = "x".repeat(33);

      try {
        await program.methods
          .setMetadata(longKey, Buffer.from("value"))
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();

        assert.fail("Should have failed with KeyTooLong error");
      } catch (error) {
        assert.include(error.message, "KeyTooLong");
      }
    });

    it("Fails with value > 256 bytes", async () => {
      const longValue = Buffer.alloc(257, "x");

      try {
        await program.methods
          .setMetadata("data", longValue)
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();

        assert.fail("Should have failed with ValueTooLong error");
      } catch (error) {
        assert.include(error.message, "ValueTooLong");
      }
    });

    it("Fails when non-owner tries to set metadata", async () => {
      const otherUser = Keypair.generate();

      // Airdrop to other user
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(otherUser.publicKey, 1000000000)
      );

      try {
        await program.methods
          .setMetadata("name", Buffer.from("Hacker"))
          .accounts({
            agentAccount: agentPda,
            owner: otherUser.publicKey,
          })
          .signers([otherUser])
          .rpc();

        assert.fail("Should have failed with Unauthorized error");
      } catch (error) {
        assert.include(error.message, "Unauthorized");
      }
    });
  });

  describe("Set Agent URI (ERC-8004: setAgentUri(agentId, newUri))", () => {
    let agentMint: Keypair;
    let agentPda: PublicKey;

    beforeEach(async () => {
      agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      [agentPda] = getAgentPda(agentMint.publicKey);

      await program.methods
        .register("https://original.com")
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();
    });

    it("Updates agent URI", async () => {
      const newUri = "https://updated.com";

      await program.methods
        .setAgentUri(newUri)
        .accounts({
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, newUri);
    });

    it("Updates agent URI to empty string (ERC-8004 spec)", async () => {
      await program.methods
        .setAgentUri("")
        .accounts({
          agentAccount: agentPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.tokenUri, "");
    });

    it("Updates agent URI multiple times", async () => {
      const uris = ["https://v1.com", "https://v2.com", "https://v3.com"];

      for (const uri of uris) {
        await program.methods
          .setAgentUri(uri)
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();

        const agent = await program.account.agentAccount.fetch(agentPda);
        assert.equal(agent.tokenUri, uri);
      }
    });

    it("Fails with URI > 200 bytes", async () => {
      const longUri = "x".repeat(201);

      try {
        await program.methods
          .setAgentUri(longUri)
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();

        assert.fail("Should have failed with UriTooLong error");
      } catch (error) {
        assert.include(error.message, "UriTooLong");
      }
    });

    it("Fails when non-owner tries to set URI", async () => {
      const otherUser = Keypair.generate();

      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(otherUser.publicKey, 1000000000)
      );

      try {
        await program.methods
          .setAgentUri("https://hacker.com")
          .accounts({
            agentAccount: agentPda,
            owner: otherUser.publicKey,
          })
          .signers([otherUser])
          .rpc();

        assert.fail("Should have failed with Unauthorized error");
      } catch (error) {
        assert.include(error.message, "Unauthorized");
      }
    });
  });

  describe("Sync Owner (NFT Transfer Support)", () => {
    let agentMint: Keypair;
    let agentPda: PublicKey;
    let originalOwnerTokenAccount: PublicKey;
    let newOwner: Keypair;
    let newOwnerTokenAccount: PublicKey;

    beforeEach(async () => {
      agentMint = Keypair.generate();
      const agentMetadata = getMetadataPda(agentMint.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMint.publicKey);
      originalOwnerTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, provider.wallet.publicKey);
      [agentPda] = getAgentPda(agentMint.publicKey);

      await program.methods
        .register("https://example.com")
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          agentAccount: agentPda,
          agentMint: agentMint.publicKey,
          agentMetadata,
          agentMasterEdition,
          agentTokenAccount: originalOwnerTokenAccount,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentMint])
        .rpc();

      // Prepare new owner
      newOwner = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(newOwner.publicKey, 1000000000)
      );
      newOwnerTokenAccount = getAssociatedTokenAddressSync(agentMint.publicKey, newOwner.publicKey);
    });

    it("Syncs owner after SPL Token transfer", async () => {
      // Create new owner's token account first
      const { AssociatedTokenProgramInstruction, createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");

      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          newOwnerTokenAccount,
          newOwner.publicKey,
          agentMint.publicKey
        )
      );
      await provider.sendAndConfirm(createAtaTx);

      // Transfer NFT via SPL Token
      await transfer(
        provider.connection,
        provider.wallet.payer,
        originalOwnerTokenAccount,
        newOwnerTokenAccount,
        provider.wallet.publicKey,
        1
      );

      // Sync owner in AgentAccount
      await program.methods
        .syncOwner()
        .accounts({
          agentAccount: agentPda,
          tokenAccount: newOwnerTokenAccount,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.owner.toBase58(), newOwner.publicKey.toBase58());
    });

    it("Allows new owner to update metadata after transfer", async () => {
      // Create ATA and transfer
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");

      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          newOwnerTokenAccount,
          newOwner.publicKey,
          agentMint.publicKey
        )
      );
      await provider.sendAndConfirm(createAtaTx);

      await transfer(
        provider.connection,
        provider.wallet.payer,
        originalOwnerTokenAccount,
        newOwnerTokenAccount,
        provider.wallet.publicKey,
        1
      );

      // Sync owner
      await program.methods
        .syncOwner()
        .accounts({
          agentAccount: agentPda,
          tokenAccount: newOwnerTokenAccount,
        })
        .rpc();

      // New owner sets metadata
      await program.methods
        .setMetadata("newKey", Buffer.from("newValue"))
        .accounts({
          agentAccount: agentPda,
          owner: newOwner.publicKey,
        })
        .signers([newOwner])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      assert.equal(agent.metadata.length, 1);
      assert.equal(agent.metadata[0].key, "newKey");
    });

    it("Prevents old owner from updating metadata after transfer", async () => {
      // Create ATA and transfer
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");

      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          newOwnerTokenAccount,
          newOwner.publicKey,
          agentMint.publicKey
        )
      );
      await provider.sendAndConfirm(createAtaTx);

      await transfer(
        provider.connection,
        provider.wallet.payer,
        originalOwnerTokenAccount,
        newOwnerTokenAccount,
        provider.wallet.publicKey,
        1
      );

      // Sync owner
      await program.methods
        .syncOwner()
        .accounts({
          agentAccount: agentPda,
          tokenAccount: newOwnerTokenAccount,
        })
        .rpc();

      // Old owner tries to set metadata
      try {
        await program.methods
          .setMetadata("hack", Buffer.from("value"))
          .accounts({
            agentAccount: agentPda,
            owner: provider.wallet.publicKey,
          })
          .rpc();

        assert.fail("Should have failed with Unauthorized error");
      } catch (error) {
        assert.include(error.message, "Unauthorized");
      }
    });

    it("Fails to sync with invalid token account (amount = 0)", async () => {
      // Create empty token account
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");

      const emptyAccount = getAssociatedTokenAddressSync(agentMint.publicKey, newOwner.publicKey);
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          emptyAccount,
          newOwner.publicKey,
          agentMint.publicKey
        )
      );
      await provider.sendAndConfirm(createAtaTx);

      try {
        await program.methods
          .syncOwner()
          .accounts({
            agentAccount: agentPda,
            tokenAccount: emptyAccount,
          })
          .rpc();

        assert.fail("Should have failed with InvalidTokenAccount error");
      } catch (error) {
        assert.include(error.message, "InvalidTokenAccount");
      }
    });
  });
});
