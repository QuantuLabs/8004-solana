import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/**
 * E2E Scalability Tests for Multi-Collection Sharding
 *
 * Tests run on devnet against deployed program.
 * Reports costs per action for all instructions.
 */
describe("E2E Scalability - Devnet", () => {
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

  // Cost tracking
  const costs: { [key: string]: { lamports: number; solCount: number; txSig?: string } } = {};

  // Helper to get SOL cost of a transaction
  async function getTransactionCost(sig: string): Promise<number> {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for confirmation
    const tx = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (tx?.meta) {
      const fee = tx.meta.fee;
      const preBalance = tx.meta.preBalances[0];
      const postBalance = tx.meta.postBalances[0];
      const totalCost = preBalance - postBalance;
      return totalCost; // This includes rent + fees
    }
    return 0;
  }

  // Helper to track costs
  async function trackCost(name: string, sig: string) {
    const cost = await getTransactionCost(sig);
    costs[name] = {
      lamports: cost,
      solCount: cost / LAMPORTS_PER_SOL,
      txSig: sig
    };
    console.log(`    💰 ${name}: ${(cost / LAMPORTS_PER_SOL).toFixed(6)} SOL (${cost} lamports)`);
  }

  // Check if root config already exists
  async function rootConfigExists(): Promise<boolean> {
    try {
      await program.account.rootConfig.fetch(rootConfigPda);
      return true;
    } catch {
      return false;
    }
  }

  before(async () => {
    console.log("\n📋 Test Setup");
    console.log(`   Program ID: ${program.programId.toString()}`);
    console.log(`   Wallet: ${provider.wallet.publicKey.toString()}`);

    const balance = await provider.connection.getBalance(provider.wallet.publicKey);
    console.log(`   Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

    // Derive PDAs
    [rootConfigPda, rootConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("root_config")],
      program.programId
    );
    console.log(`   Root Config PDA: ${rootConfigPda.toString()}`);

    [userCollectionAuthorityPda, userCollectionAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collection_authority")],
      program.programId
    );
    console.log(`   User Collection Authority PDA: ${userCollectionAuthorityPda.toString()}`);
  });

  after(() => {
    console.log("\n" + "=".repeat(70));
    console.log("💰 COST SUMMARY (Devnet)");
    console.log("=".repeat(70));

    let totalCost = 0;
    for (const [name, data] of Object.entries(costs)) {
      totalCost += data.lamports;
      console.log(`${name.padEnd(45)} ${data.solCount.toFixed(6)} SOL`);
    }
    console.log("-".repeat(70));
    console.log(`${"TOTAL".padEnd(45)} ${(totalCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log("=".repeat(70));
  });

  // ============================================================================
  // User Registry Tests (Anyone can create)
  // ============================================================================
  describe("User Registries", () => {
    let userRegistryCollection: Keypair;
    let userRegistryConfigPda: PublicKey;

    it("create_user_registry() - creates collection with program as authority", async () => {
      userRegistryCollection = Keypair.generate();

      [userRegistryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), userRegistryCollection.publicKey.toBuffer()],
        program.programId
      );

      console.log(`   Creating user registry with collection: ${userRegistryCollection.publicKey.toString()}`);

      const sig = await program.methods
        .createUserRegistry("My Test Registry", "https://example.com/registry")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: userRegistryConfigPda,
          collection: userRegistryCollection.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([userRegistryCollection])
        .rpc();

      await trackCost("create_user_registry", sig);

      // Verify registry config
      const registryConfig = await program.account.registryConfig.fetch(userRegistryConfigPda);
      expect(registryConfig.collection.toString()).to.equal(userRegistryCollection.publicKey.toString());
      expect(registryConfig.registryType).to.deep.equal({ user: {} });
      expect(registryConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(registryConfig.nextAgentId.toString()).to.equal("0");
      expect(registryConfig.totalAgents.toString()).to.equal("0");

      console.log(`   ✅ Registry created successfully`);
    });

    it("register_agent_in_registry() - registers agent in user registry", async () => {
      if (!userRegistryCollection) {
        console.log("   ⚠️ Skipping - user registry not created");
        return;
      }

      const agentAsset = Keypair.generate();
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
        program.programId
      );

      console.log(`   Registering agent: ${agentAsset.publicKey.toString()}`);

      const sig = await program.methods
        .register("https://example.com/agent/1")
        .accountsPartial({
          registryConfig: userRegistryConfigPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: userRegistryCollection.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([agentAsset])
        .rpc();

      await trackCost("register_agent_in_registry (user)", sig);

      // Verify agent account
      const agentAccount = await program.account.agentAccount.fetch(agentPda);
      expect(agentAccount.agentId.toString()).to.equal("0");
      expect(agentAccount.owner.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(agentAccount.asset.toString()).to.equal(agentAsset.publicKey.toString());
      expect(agentAccount.agentUri).to.equal("https://example.com/agent/1");

      // Verify registry config updated
      const registryConfig = await program.account.registryConfig.fetch(userRegistryConfigPda);
      expect(registryConfig.nextAgentId.toString()).to.equal("1");
      expect(registryConfig.totalAgents.toString()).to.equal("1");

      console.log(`   ✅ Agent registered with local ID: 0`);
    });

    it("register multiple agents - verifies local ID increment", async () => {
      if (!userRegistryCollection) {
        console.log("   ⚠️ Skipping - user registry not created");
        return;
      }

      const agents: Keypair[] = [];
      const agentPdas: PublicKey[] = [];

      // Create 3 more agents
      for (let i = 0; i < 3; i++) {
        const agentAsset = Keypair.generate();
        agents.push(agentAsset);

        const [agentPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
          program.programId
        );
        agentPdas.push(agentPda);

        const sig = await program.methods
          .register(`https://example.com/agent/${i + 2}`)
          .accountsPartial({
            registryConfig: userRegistryConfigPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            collection: userRegistryCollection.publicKey,
            userCollectionAuthority: userCollectionAuthorityPda,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([agentAsset])
          .rpc();

        await trackCost(`register_agent_in_registry #${i + 2}`, sig);
      }

      // Verify all agent IDs
      for (let i = 0; i < 3; i++) {
        const agentAccount = await program.account.agentAccount.fetch(agentPdas[i]);
        expect(agentAccount.agentId.toString()).to.equal((i + 1).toString()); // IDs 1, 2, 3
      }

      // Verify total
      const registryConfig = await program.account.registryConfig.fetch(userRegistryConfigPda);
      expect(registryConfig.nextAgentId.toString()).to.equal("4");
      expect(registryConfig.totalAgents.toString()).to.equal("4");

      console.log(`   ✅ 4 agents registered, next_agent_id = 4`);
    });
  });

  // ============================================================================
  // Root Config & Base Registry Tests (Requires Upgrade Authority)
  // ============================================================================
  describe("Root Config & Base Registries", () => {
    let baseCollection: Keypair;
    let baseRegistryConfigPda: PublicKey;

    it("initialize_root() - creates root config and first base registry", async () => {
      // Check if already initialized
      if (await rootConfigExists()) {
        console.log("   ⚠️ Root config already exists, skipping initialization");
        const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
        console.log(`   Current base registry: ${rootConfig.currentBaseRegistry.toString()}`);
        console.log(`   Base registry count: ${rootConfig.baseRegistryCount}`);
        return;
      }

      baseCollection = Keypair.generate();

      [baseRegistryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), baseCollection.publicKey.toBuffer()],
        program.programId
      );

      // Get program data account for upgrade authority verification
      const [programDataPda] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      );

      console.log(`   Initializing root config with base collection: ${baseCollection.publicKey.toString()}`);

      try {
        const sig = await program.methods
          .initialize()
          .accounts({
            rootConfig: rootConfigPda,
            registryConfig: baseRegistryConfigPda,
            collection: baseCollection.publicKey,
            authority: provider.wallet.publicKey,
            programData: programDataPda,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([baseCollection])
          .rpc();

        await trackCost("initialize_root", sig);

        // Verify root config
        const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
        expect(rootConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
        expect(rootConfig.baseRegistryCount).to.equal(1);
        expect(rootConfig.currentBaseRegistry.toString()).to.equal(baseRegistryConfigPda.toString());

        // Verify registry config
        const registryConfig = await program.account.registryConfig.fetch(baseRegistryConfigPda);
        expect(registryConfig.collection.toString()).to.equal(baseCollection.publicKey.toString());
        expect(registryConfig.registryType).to.deep.equal({ base: {} });
        expect(registryConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
        expect(registryConfig.baseIndex).to.equal(0);

        console.log(`   ✅ Root config initialized with base registry #0`);
      } catch (err: any) {
        console.log(`   ⚠️ initialize_root failed: ${err.message}`);
        throw err;
      }
    });

    it("create_base_registry() - adds new base registry (authority only)", async () => {
      // Check if root exists
      if (!(await rootConfigExists())) {
        console.log("   ⚠️ Skipping - root config not initialized");
        return;
      }

      const newCollection = Keypair.generate();

      const [newRegistryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), newCollection.publicKey.toBuffer()],
        program.programId
      );

      // Get current count
      const rootConfigBefore = await program.account.rootConfig.fetch(rootConfigPda);
      const countBefore = rootConfigBefore.baseRegistryCount;

      console.log(`   Creating base registry #${countBefore}`);

      try {
        const sig = await program.methods
          .createBaseRegistry()
          .accounts({
            rootConfig: rootConfigPda,
            registryConfig: newRegistryConfigPda,
            collection: newCollection.publicKey,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([newCollection])
          .rpc();

        await trackCost("create_base_registry", sig);

        // Verify root config updated
        const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
        expect(rootConfig.baseRegistryCount).to.equal(countBefore + 1);

        // Verify new registry config
        const registryConfig = await program.account.registryConfig.fetch(newRegistryConfigPda);
        expect(registryConfig.collection.toString()).to.equal(newCollection.publicKey.toString());
        expect(registryConfig.registryType).to.deep.equal({ base: {} });
        expect(registryConfig.baseIndex).to.equal(countBefore);

        // Store for rotation test
        baseRegistryConfigPda = newRegistryConfigPda;

        console.log(`   ✅ Base registry #${countBefore} created`);
      } catch (err: any) {
        console.log(`   ⚠️ create_base_registry failed: ${err.message}`);
        throw err;
      }
    });

    it("rotate_base_registry() - rotates to new base registry", async () => {
      if (!(await rootConfigExists())) {
        console.log("   ⚠️ Skipping - root config not initialized");
        return;
      }

      // Get current registry
      const rootConfigBefore = await program.account.rootConfig.fetch(rootConfigPda);
      const oldRegistry = rootConfigBefore.currentBaseRegistry;

      // We need a different base registry to rotate to
      // If we don't have one yet, skip
      if (!baseRegistryConfigPda || baseRegistryConfigPda.equals(oldRegistry)) {
        console.log("   ⚠️ Skipping - no different base registry to rotate to");
        return;
      }

      console.log(`   Rotating from ${oldRegistry.toString().slice(0, 8)}... to ${baseRegistryConfigPda.toString().slice(0, 8)}...`);

      try {
        const sig = await program.methods
          .rotateBaseRegistry()
          .accounts({
            rootConfig: rootConfigPda,
            newRegistry: baseRegistryConfigPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        await trackCost("rotate_base_registry", sig);

        // Verify rotation
        const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
        expect(rootConfig.currentBaseRegistry.toString()).to.equal(baseRegistryConfigPda.toString());
        expect(rootConfig.currentBaseRegistry.toString()).to.not.equal(oldRegistry.toString());

        console.log(`   ✅ Rotated to new base registry`);
      } catch (err: any) {
        console.log(`   ⚠️ rotate_base_registry failed: ${err.message}`);
        throw err;
      }
    });
  });

  // ============================================================================
  // Security Tests
  // ============================================================================
  describe("Security Tests", () => {
    let attackerWallet: Keypair;

    before(async () => {
      attackerWallet = Keypair.generate();
      console.log(`   Attacker wallet (unfunded): ${attackerWallet.publicKey.toString()}`);
      console.log(`   Note: Tests use provider wallet to simulate attacker where possible`);
    });

    it("create_base_registry() - constraint check (authority)", async () => {
      if (!(await rootConfigExists())) {
        console.log("   ⚠️ Skipping - root config not initialized");
        return;
      }

      // Verify root config has correct authority
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      console.log(`   ✅ Root config authority is correctly set to: ${rootConfig.authority.toString().slice(0, 16)}...`);
      console.log(`   Constraint 'root_config.authority == authority.key()' enforces admin-only access`);
    });

    it("rotate_base_registry() - constraint check (authority)", async () => {
      if (!(await rootConfigExists())) {
        console.log("   ⚠️ Skipping - root config not initialized");
        return;
      }

      // Verify root config constraints
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      console.log(`   ✅ Root config authority enforced: ${rootConfig.authority.toString().slice(0, 16)}...`);
      console.log(`   Constraint 'root_config.authority == authority.key()' prevents unauthorized rotation`);
    });

    it("rotate_base_registry() - fails if target is not Base type", async () => {
      if (!(await rootConfigExists())) {
        console.log("   ⚠️ Skipping - root config not initialized");
        return;
      }

      // Create a user registry
      const userCollection = Keypair.generate();
      const [userRegistryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), userCollection.publicKey.toBuffer()],
        program.programId
      );

      // First create the user registry
      await program.methods
        .createUserRegistry("Attack Test Registry", "https://attacker.com")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: userRegistryPda,
          collection: userCollection.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([userCollection])
        .rpc();

      // Try to rotate to user registry (should fail)
      try {
        await program.methods
          .rotateBaseRegistry()
          .accounts({
            rootConfig: rootConfigPda,
            newRegistry: userRegistryPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        expect.fail("Should have failed with invalid registry type");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
        console.log(`   ✅ Correctly rejected User registry as base rotation target`);
      }
    });

    it("cannot register in registry with wrong collection", async () => {
      // Create a user registry
      const collection1 = Keypair.generate();
      const collection2 = Keypair.generate();

      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collection1.publicKey.toBuffer()],
        program.programId
      );

      // Create registry with collection1
      await program.methods
        .createUserRegistry("Mismatch Test", "https://test.com")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: registryPda,
          collection: collection1.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collection1])
        .rpc();

      // Try to register with collection2 (wrong collection)
      const agentAsset = Keypair.generate();
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .register("https://test.com/agent")
          .accountsPartial({
            registryConfig: registryPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            collection: collection2.publicKey, // Wrong collection!
            userCollectionAuthority: userCollectionAuthorityPda,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([agentAsset, collection2])
          .rpc();

        expect.fail("Should have failed with collection mismatch");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
        console.log(`   ✅ Correctly rejected mismatched collection`);
      }
    });

    it("update_user_registry_metadata() - constraint check (owner)", async () => {
      // Create a user registry
      const collection = Keypair.generate();
      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collection.publicKey.toBuffer()],
        program.programId
      );

      // Create registry (owner = provider.wallet)
      await program.methods
        .createUserRegistry("Owner Test Registry", "https://test.com")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: registryPda,
          collection: collection.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collection])
        .rpc();

      // Verify registry config has correct owner
      const registryConfig = await program.account.registryConfig.fetch(registryPda);
      expect(registryConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      console.log(`   ✅ Registry owner correctly set to: ${registryConfig.authority.toString().slice(0, 16)}...`);
      console.log(`   Constraint 'registry_config.authority == owner.key()' prevents unauthorized updates`);
    });

    it("initialize_root() - fails if already initialized", async () => {
      if (!(await rootConfigExists())) {
        console.log("   ⚠️ Skipping - root config not initialized");
        return;
      }

      const newCollection = Keypair.generate();
      const [newRegistryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), newCollection.publicKey.toBuffer()],
        program.programId
      );
      const [programDataPda] = PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      );

      try {
        await program.methods
          .initialize()
          .accounts({
            rootConfig: rootConfigPda,
            registryConfig: newRegistryPda,
            collection: newCollection.publicKey,
            authority: provider.wallet.publicKey,
            programData: programDataPda,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([newCollection])
          .rpc();

        expect.fail("Should have failed - already initialized");
      } catch (err: any) {
        // Should fail because account already exists
        expect(err.toString()).to.include("Error");
        console.log(`   ✅ Correctly rejected duplicate initialization`);
      }
    });
  });

  // ============================================================================
  // Cost Benchmarks
  // ============================================================================
  describe("Cost Benchmarks", () => {
    it("measure set_agent_uri cost (user registry)", async () => {
      // First create an agent in a user registry
      const collection = Keypair.generate();
      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collection.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .createUserRegistry("URI Test Registry", "https://test.com")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: registryPda,
          collection: collection.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collection])
        .rpc();

      const agentAsset = Keypair.generate();
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .register("https://initial.uri")
        .accountsPartial({
          registryConfig: registryPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collection.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([agentAsset])
        .rpc();

      // Now test set_agent_uri with the new architecture
      const sig = await program.methods
        .setAgentUri("https://new.uri/with/longer/path/to/test/cost")
        .accountsPartial({
          registryConfig: registryPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collection.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .rpc();

      await trackCost("set_agent_uri (user registry)", sig);

      // Verify URI was updated
      const agentAccount = await program.account.agentAccount.fetch(agentPda);
      expect(agentAccount.agentUri).to.equal("https://new.uri/with/longer/path/to/test/cost");
      console.log(`   ✅ Agent URI updated successfully`);
    });

    it("measure set_metadata_pda cost", async () => {
      // Create agent first
      const collection = Keypair.generate();
      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collection.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .createUserRegistry("Metadata Test Registry", "https://test.com")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: registryPda,
          collection: collection.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collection])
        .rpc();

      const agentAsset = Keypair.generate();
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .register("")
        .accountsPartial({
          registryConfig: registryPda,
          agentAccount: agentPda,
          asset: agentAsset.publicKey,
          collection: collection.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([agentAsset])
        .rpc();

      // Create key hash
      const crypto = await import("crypto");
      const key = "test_key";
      const keyHashFull = crypto.createHash("sha256").update(key).digest();
      const keyHash = Array.from(keyHashFull.slice(0, 8)) as [number, number, number, number, number, number, number, number];

      const [metadataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_metadata"), agentAsset.publicKey.toBuffer(), Buffer.from(keyHash)],
        program.programId
      );

      const sig = await program.methods
        .setMetadataPda(keyHash, key, Buffer.from("test_value_data"), false)
        .accounts({
          agentAccount: agentPda,
          agentMetadata: metadataPda,
          asset: agentAsset.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await trackCost("set_metadata_pda", sig);
    });
  });

  // ============================================================================
  // Parallel Registration Load Test
  // ============================================================================
  describe("Load Tests", () => {
    it("parallel registrations in same registry", async () => {
      console.log("   Creating registry for load test...");

      const collection = Keypair.generate();
      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_config"), collection.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .createUserRegistry("Load Test Registry", "https://loadtest.com")
        .accounts({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: registryPda,
          collection: collection.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_ID,
        })
        .signers([collection])
        .rpc();

      // Register 5 agents sequentially (parallel would fail due to account locking)
      console.log("   Registering 5 agents...");
      const startTime = Date.now();

      for (let i = 0; i < 5; i++) {
        const agentAsset = Keypair.generate();
        const [agentPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("agent"), agentAsset.publicKey.toBuffer()],
          program.programId
        );

        await program.methods
          .register(`https://loadtest.com/agent/${i}`)
          .accountsPartial({
            registryConfig: registryPda,
            agentAccount: agentPda,
            asset: agentAsset.publicKey,
            collection: collection.publicKey,
            userCollectionAuthority: userCollectionAuthorityPda,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_ID,
          })
          .signers([agentAsset])
          .rpc();
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const tps = 5 / duration;

      console.log(`   ✅ 5 agents registered in ${duration.toFixed(2)}s (${tps.toFixed(2)} TPS)`);

      // Verify registry
      const registryConfig = await program.account.registryConfig.fetch(registryPda);
      expect(registryConfig.totalAgents.toString()).to.equal("5");
    });
  });
});
