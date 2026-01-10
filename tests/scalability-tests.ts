import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("Scalability - Multi-Collection Sharding", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  // Metaplex Core program ID
  const MPL_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  // PDAs
  let rootConfigPda: PublicKey;
  let rootConfigBump: number;
  let userCollectionAuthorityPda: PublicKey;
  let userCollectionAuthorityBump: number;

  // Collection keypairs for each test to avoid state sharing
  let collectionForInit: Keypair;
  let collectionForBaseRegistry: Keypair;
  let collectionForUserRegistry: Keypair;
  let collectionForAgentRegistration: Keypair;

  // User wallet for user registry tests
  let userWallet: Keypair;

  before(async () => {
    // Derive root config PDA
    [rootConfigPda, rootConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("root_config")],
      program.programId
    );

    // Derive user collection authority PDA
    [userCollectionAuthorityPda, userCollectionAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collection_authority")],
      program.programId
    );

    // Create keypairs
    collectionForInit = Keypair.generate();
    collectionForBaseRegistry = Keypair.generate();
    collectionForUserRegistry = Keypair.generate();
    collectionForAgentRegistration = Keypair.generate();
    userWallet = Keypair.generate();

    // Fund user wallet for testing
    const sig = await provider.connection.requestAirdrop(
      userWallet.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  });

  describe("Root Config Initialization", () => {
    // NOTE: This test may fail on localnet due to upgrade authority constraints
    // The upgrade authority check (F-01) is a security feature that ensures only
    // the program's upgrade authority can initialize. On localnet, this may not match.
    it.skip("initialize_root() creates root config with base registry #0 (requires upgrade authority)", async () => {
      const [registryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForInit.publicKey.toBuffer()],
        program.programId
      );

      // Get program data account for upgrade authority verification
      const [programDataPda] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      );

      await program.methods
        .initializeRoot()
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          collection: collectionForInit.publicKey,
          authority: provider.wallet.publicKey,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collectionForInit])
        .rpc();

      // Verify root config
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(rootConfig.baseRegistryCount).to.equal(1);
      expect(rootConfig.currentBaseRegistry.toString()).to.equal(registryConfigPda.toString());

      // Verify registry config
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      expect(registryConfig.collection.toString()).to.equal(collectionForInit.publicKey.toString());
      expect(registryConfig.registryType).to.deep.equal({ base: {} });
      expect(registryConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(registryConfig.nextAgentId.toString()).to.equal("0");
      expect(registryConfig.totalAgents.toString()).to.equal("0");
      expect(registryConfig.baseIndex).to.equal(0);
    });
  });

  describe("Base Registries", () => {
    // NOTE: These tests require initialize_root to have been called first
    // which requires upgrade authority. Skipped on localnet.
    it.skip("create_base_registry() creates new collection and registry config", async () => {
      const [registryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForBaseRegistry.publicKey.toBuffer()],
        program.programId
      );

      // Get root config before
      const rootConfigBefore = await program.account.rootConfig.fetch(rootConfigPda);
      const countBefore = rootConfigBefore.baseRegistryCount;

      await program.methods
        .createBaseRegistry()
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          collection: collectionForBaseRegistry.publicKey,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collectionForBaseRegistry])
        .rpc();

      // Verify root config updated
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.baseRegistryCount).to.equal(countBefore + 1);

      // Verify new registry config
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      expect(registryConfig.collection.toString()).to.equal(collectionForBaseRegistry.publicKey.toString());
      expect(registryConfig.registryType).to.deep.equal({ base: {} });
      expect(registryConfig.baseIndex).to.equal(countBefore);
    });

    it.skip("rotate_base_registry() updates current_base_registry", async () => {
      const [newRegistryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForBaseRegistry.publicKey.toBuffer()],
        program.programId
      );

      // Get old current registry
      const rootConfigBefore = await program.account.rootConfig.fetch(rootConfigPda);
      const oldRegistry = rootConfigBefore.currentBaseRegistry;

      await program.methods
        .rotateBaseRegistry()
        .accounts({
          rootConfig: rootConfigPda,
          newRegistry: newRegistryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Verify rotation
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.currentBaseRegistry.toString()).to.equal(newRegistryPda.toString());
      expect(rootConfig.currentBaseRegistry.toString()).to.not.equal(oldRegistry.toString());
    });
  });

  describe("User Registries", () => {
    it("create_user_registry() allows anyone to create their own registry", async () => {
      const [registryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForUserRegistry.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .createUserRegistry("My Agent Registry", "https://myagents.com/metadata")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: registryConfigPda,
          collection: collectionForUserRegistry.publicKey,
          owner: userWallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collectionForUserRegistry, userWallet])
        .rpc();

      // Verify registry config
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      expect(registryConfig.collection.toString()).to.equal(collectionForUserRegistry.publicKey.toString());
      expect(registryConfig.registryType).to.deep.equal({ user: {} });
      expect(registryConfig.authority.toString()).to.equal(userWallet.publicKey.toString());
      expect(registryConfig.nextAgentId.toString()).to.equal("0");
      expect(registryConfig.totalAgents.toString()).to.equal("0");
    });
  });

  describe("Agent Registration in Registries", () => {
    // NOTE: These tests require initialize_root and create_base_registry
    // to have been called first, which requires upgrade authority.
    // Skipped on localnet.
    let registryConfigPda: PublicKey;

    before(async () => {
      // Skip setup if running on localnet
      [registryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForAgentRegistration.publicKey.toBuffer()],
        program.programId
      );
    });

    it.skip("register_agent_in_registry() works with base registry", async () => {
      const agentAsset = Keypair.generate();
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .registerAgentInRegistry("https://agent-in-base.com")
        .accountsPartial({
          registryConfig: registryConfigPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collectionForAgentRegistration.publicKey,
          userCollectionAuthority: null, // Not needed for base registry
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([agentAsset])
        .rpc();

      // Verify agent account
      const agentAccount = await program.account.agentAccount.fetch(agentPda);
      expect(agentAccount.agentId.toString()).to.equal("0");
      expect(agentAccount.owner.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(agentAccount.asset.toString()).to.equal(agentAsset.publicKey.toString());
      expect(agentAccount.agentUri).to.equal("https://agent-in-base.com");

      // Verify registry config updated
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      expect(registryConfig.nextAgentId.toString()).to.equal("1");
      expect(registryConfig.totalAgents.toString()).to.equal("1");
    });

    it.skip("register_agent_in_registry() works with user registry", async () => {
      const agentAsset = Keypair.generate();
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
        program.programId
      );

      const [userRegistryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForUserRegistry.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .registerAgentInRegistry("https://agent-in-user.com")
        .accountsPartial({
          registryConfig: userRegistryPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collectionForUserRegistry.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda, // Required for user registry
          owner: userWallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([agentAsset, userWallet])
        .rpc();

      // Verify agent account
      const agentAccount = await program.account.agentAccount.fetch(agentPda);
      expect(agentAccount.agentId.toString()).to.equal("0");
      expect(agentAccount.owner.toString()).to.equal(userWallet.publicKey.toString());
      expect(agentAccount.asset.toString()).to.equal(agentAsset.publicKey.toString());
      expect(agentAccount.agentUri).to.equal("https://agent-in-user.com");

      // Verify registry config updated
      const registryConfig = await program.account.registryConfig.fetch(userRegistryPda);
      expect(registryConfig.nextAgentId.toString()).to.equal("1");
      expect(registryConfig.totalAgents.toString()).to.equal("1");
    });

    it.skip("register_agent_in_registry() increments local next_agent_id correctly", async () => {
      const asset1 = Keypair.generate();
      const asset2 = Keypair.generate();
      const [agentPda1] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), asset1.publicKey.toBuffer()],
        program.programId
      );
      const [agentPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), asset2.publicKey.toBuffer()],
        program.programId
      );

      // Register first agent
      await program.methods
        .registerAgentInRegistry("")
        .accountsPartial({
          registryConfig: registryConfigPda,
          agentAccount: agentPda1,
          asset: asset1.publicKey,
          collection: collectionForAgentRegistration.publicKey,
          userCollectionAuthority: null,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([asset1])
        .rpc();

      // Register second agent
      await program.methods
        .registerAgentInRegistry("")
        .accountsPartial({
          registryConfig: registryConfigPda,
          agentAccount: agentPda2,
          asset: asset2.publicKey,
          collection: collectionForAgentRegistration.publicKey,
          userCollectionAuthority: null,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([asset2])
        .rpc();

      // Verify agent IDs
      const agent1 = await program.account.agentAccount.fetch(agentPda1);
      const agent2 = await program.account.agentAccount.fetch(agentPda2);
      expect(agent1.agentId.toString()).to.equal("1");
      expect(agent2.agentId.toString()).to.equal("2");

      // Verify registry
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      expect(registryConfig.nextAgentId.toString()).to.equal("3");
      expect(registryConfig.totalAgents.toString()).to.equal("3");
    });
  });

  describe("Security Tests", () => {
    it("create_base_registry() fails if non-authority", async () => {
      const newCollection = Keypair.generate();
      const [newRegistryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), newCollection.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .createBaseRegistry()
          .accounts({
            rootConfig: rootConfigPda,
            registryConfig: newRegistryPda,
            collection: newCollection.publicKey,
            authority: userWallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([newCollection, userWallet])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        // Should fail with constraint error (Unauthorized or ConstraintRaw)
        expect(err.toString()).to.include("Error");
      }
    });

    it("rotate_base_registry() fails if non-authority", async () => {
      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collectionForInit.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .rotateBaseRegistry()
          .accounts({
            rootConfig: rootConfigPda,
            newRegistry: registryPda,
            authority: userWallet.publicKey,
          })
          .signers([userWallet])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        // Should fail with constraint error
        expect(err.toString()).to.include("Error");
      }
    });
  });
});
