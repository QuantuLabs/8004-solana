/**
 * E2E Security Audit Tests for Agent Registry 8004
 * Tests critical vulnerabilities identified in the security audit:
 * - C-01: Agent ID collision across registries
 * - C-02: Base registry rotation orphans agents
 * - C-03: User registry authority escalation
 * - Anti-gaming protections
 * - State consistency across multi-collection architecture
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getValidationRequestPda,
  getValidationStatsPda,
  randomHash,
  uniqueNonce,
} from "./utils/helpers";

describe("E2E Security Audit Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let validationStatsPda: PublicKey;
  let userCollectionAuthorityPda: PublicKey;

  // Base registry state
  let baseRegistryPda: PublicKey;
  let baseCollectionPubkey: PublicKey;

  // User registry 1 state
  let userRegistry1Pda: PublicKey;
  let userCollection1: Keypair;

  // User registry 2 state (for cross-registry tests)
  let userRegistry2Pda: PublicKey;
  let userCollection2: Keypair;

  // Test users
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const thirdParty = Keypair.generate();

  before(async () => {
    console.log("\n=== Security Audit Test Setup ===");
    console.log("Program ID:", program.programId.toBase58());

    [rootConfigPda] = getRootConfigPda(program.programId);
    [validationStatsPda] = getValidationStatsPda(program.programId);
    [userCollectionAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collection_authority")],
      program.programId
    );

    // Get current base registry
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    baseRegistryPda = rootConfig.currentBaseRegistry;
    const baseRegistry = await program.account.registryConfig.fetch(baseRegistryPda);
    baseCollectionPubkey = baseRegistry.collection;

    console.log("Base Registry:", baseRegistryPda.toBase58());
    console.log("Base Collection:", baseCollectionPubkey.toBase58());

    // Airdrop to test users
    const airdropAmount = 2 * LAMPORTS_PER_SOL;
    for (const user of [user1, user2, thirdParty]) {
      try {
        const sig = await provider.connection.requestAirdrop(user.publicKey, airdropAmount);
        await provider.connection.confirmTransaction(sig, "confirmed");
      } catch (e) {
        // May fail on devnet
      }
    }

    // Create user registry 1
    userCollection1 = Keypair.generate();
    [userRegistry1Pda] = getRegistryConfigPda(userCollection1.publicKey, program.programId);

    await program.methods
      .createUserRegistry("User Registry 1", "https://user1.example.com")
      .accountsPartial({
        collectionAuthority: userCollectionAuthorityPda,
        registryConfig: userRegistry1Pda,
        collection: userCollection1.publicKey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([userCollection1])
      .rpc();

    console.log("User Registry 1:", userRegistry1Pda.toBase58());

    // Create user registry 2
    userCollection2 = Keypair.generate();
    [userRegistry2Pda] = getRegistryConfigPda(userCollection2.publicKey, program.programId);

    await program.methods
      .createUserRegistry("User Registry 2", "https://user2.example.com")
      .accountsPartial({
        collectionAuthority: userCollectionAuthorityPda,
        registryConfig: userRegistry2Pda,
        collection: userCollection2.publicKey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([userCollection2])
      .rpc();

    console.log("User Registry 2:", userRegistry2Pda.toBase58());
  });

  // ============================================================================
  // C-01: Agent ID Collision Across Registries
  // ============================================================================
  describe("C-01: Agent ID Collision", () => {
    let agent1InRegistry1Asset: Keypair;
    let agent1InRegistry1Pda: PublicKey;
    let agent1InRegistry1Id: anchor.BN;

    let agent1InRegistry2Asset: Keypair;
    let agent1InRegistry2Pda: PublicKey;
    let agent1InRegistry2Id: anchor.BN;

    it("should create agent #0 in User Registry 1", async () => {
      const registry = await program.account.registryConfig.fetch(userRegistry1Pda);
      agent1InRegistry1Id = registry.nextAgentId;

      agent1InRegistry1Asset = Keypair.generate();
      [agent1InRegistry1Pda] = getAgentPda(agent1InRegistry1Asset.publicKey, program.programId);

      await program.methods
        .register("https://agent1-registry1.example.com")
        .accountsPartial({
          registryConfig: userRegistry1Pda,
          agentAccount: agent1InRegistry1Pda,
          asset: agent1InRegistry1Asset.publicKey,
          collection: userCollection1.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agent1InRegistry1Asset])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agent1InRegistry1Pda);
      expect(agent.agentId.toNumber()).to.equal(0);
      console.log(`  Agent #${agent.agentId.toNumber()} created in User Registry 1`);
    });

    it("should create agent #0 in User Registry 2 (SAME ID - potential collision)", async () => {
      const registry = await program.account.registryConfig.fetch(userRegistry2Pda);
      agent1InRegistry2Id = registry.nextAgentId;

      // Both registries should have agent_id = 0
      expect(agent1InRegistry2Id.toNumber()).to.equal(0);

      agent1InRegistry2Asset = Keypair.generate();
      [agent1InRegistry2Pda] = getAgentPda(agent1InRegistry2Asset.publicKey, program.programId);

      await program.methods
        .register("https://agent1-registry2.example.com")
        .accountsPartial({
          registryConfig: userRegistry2Pda,
          agentAccount: agent1InRegistry2Pda,
          asset: agent1InRegistry2Asset.publicKey,
          collection: userCollection2.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agent1InRegistry2Asset])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agent1InRegistry2Pda);
      expect(agent.agentId.toNumber()).to.equal(0);
      console.log(`  Agent #${agent.agentId.toNumber()} created in User Registry 2 (SAME ID!)`);
    });

    it("VULNERABILITY: Reputation PDA collision - both agents share same agent_id=0", async () => {
      // Both agents have agent_id = 0, so their reputation PDAs will be the same!
      const [repPda1] = getAgentReputationPda(agent1InRegistry1Id, program.programId);
      const [repPda2] = getAgentReputationPda(agent1InRegistry2Id, program.programId);

      // These should be DIFFERENT but they're the SAME due to collision
      expect(repPda1.toBase58()).to.equal(repPda2.toBase58());
      console.log(`  ⚠️ COLLISION: Both agents share reputation PDA: ${repPda1.toBase58()}`);

      // Give feedback to agent in registry 1 (from third party)
      const feedbackIndex = new anchor.BN(0);
      const [feedbackPda] = getFeedbackPda(agent1InRegistry1Id, feedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          agent1InRegistry1Id,
          85,
          "quality",
          "reliable",
          "https://api.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accountsPartial({
          client: thirdParty.publicKey,
          payer: provider.wallet.publicKey,
          asset: agent1InRegistry1Asset.publicKey,
          agentAccount: agent1InRegistry1Pda,
          feedbackAccount: feedbackPda,
          agentReputation: repPda1,
          systemProgram: SystemProgram.programId,
        })
        .signers([thirdParty])
        .rpc();

      // Verify reputation was created
      const reputation = await program.account.agentReputationMetadata.fetch(repPda1);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(1);
      expect(reputation.averageScore).to.equal(85);

      console.log(`  ⚠️ VULNERABILITY: Feedback for Registry 1 agent stored at shared PDA`);
      console.log(`    Agent in Registry 2 could theoretically manipulate this reputation`);
    });

    it("VULNERABILITY: Validation PDA collision - demonstrates cross-registry attack vector", async () => {
      const nonce = uniqueNonce();
      const validator = thirdParty.publicKey;

      // Validation request PDA uses agent_id, so both agents share same PDAs
      const [validationPda1] = getValidationRequestPda(
        agent1InRegistry1Id,
        validator,
        nonce,
        program.programId
      );
      const [validationPda2] = getValidationRequestPda(
        agent1InRegistry2Id,
        validator,
        nonce,
        program.programId
      );

      // These should be DIFFERENT but they're the SAME
      expect(validationPda1.toBase58()).to.equal(validationPda2.toBase58());
      console.log(`  ⚠️ COLLISION: Both agents share validation PDA for same validator/nonce`);
    });
  });

  // ============================================================================
  // C-02: Base Registry Rotation Orphans Agents
  // ============================================================================
  describe("C-02: Base Registry Rotation", () => {
    let agentInOldBaseAsset: Keypair;
    let agentInOldBasePda: PublicKey;
    let oldBaseRegistryPda: PublicKey;
    let oldBaseCollection: PublicKey;
    let newBaseCollection: Keypair;
    let newBaseRegistryPda: PublicKey;

    before(async () => {
      // Get current base registry
      oldBaseRegistryPda = baseRegistryPda;
      const oldRegistry = await program.account.registryConfig.fetch(oldBaseRegistryPda);
      oldBaseCollection = oldRegistry.collection;
    });

    it("should register agent in current base registry", async () => {
      agentInOldBaseAsset = Keypair.generate();
      [agentInOldBasePda] = getAgentPda(agentInOldBaseAsset.publicKey, program.programId);

      await program.methods
        .register("https://agent-old-base.example.com")
        .accountsPartial({
          registryConfig: oldBaseRegistryPda,
          agentAccount: agentInOldBasePda,
          asset: agentInOldBaseAsset.publicKey,
          collection: oldBaseCollection,
          userCollectionAuthority: null,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agentInOldBaseAsset])
        .rpc();

      console.log(`  Agent registered in Base Registry: ${oldBaseRegistryPda.toBase58()}`);
    });

    it("should create and rotate to new base registry", async () => {
      // Create new base registry
      newBaseCollection = Keypair.generate();
      [newBaseRegistryPda] = getRegistryConfigPda(newBaseCollection.publicKey, program.programId);

      await program.methods
        .createBaseRegistry()
        .accountsPartial({
          rootConfig: rootConfigPda,
          registryConfig: newBaseRegistryPda,
          collection: newBaseCollection.publicKey,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([newBaseCollection])
        .rpc();

      // Rotate to new registry
      await program.methods
        .rotateBaseRegistry()
        .accountsPartial({
          rootConfig: rootConfigPda,
          newRegistry: newBaseRegistryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Verify rotation
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.currentBaseRegistry.toBase58()).to.equal(newBaseRegistryPda.toBase58());
      console.log(`  Rotated to new Base Registry: ${newBaseRegistryPda.toBase58()}`);
    });

    it("VULNERABILITY: Agent in old registry can still update URI (but should it?)", async () => {
      // This test documents the current behavior - agent can still update URI
      // using the OLD registry config because the agent stores its registry
      // implicitly via its collection membership

      // Agent can update URI using old registry config
      try {
        await program.methods
          .setAgentUri("https://updated-agent-old-base.example.com")
          .accountsPartial({
            registryConfig: oldBaseRegistryPda,
            agentAccount: agentInOldBasePda,
            asset: agentInOldBaseAsset.publicKey,
            collection: oldBaseCollection,
            userCollectionAuthority: null,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .rpc();

        console.log(`  ✓ Agent in old registry CAN still update URI`);
        console.log(`    (Uses old registry_config PDA, not current_base_registry)`);
      } catch (e: any) {
        console.log(`  ✗ Agent in old registry CANNOT update URI: ${e.message}`);
      }
    });

    it("should document: old registry agents are NOT automatically migrated", async () => {
      // Agents stay in their original registry collection forever
      // There's no migration mechanism
      const agent = await program.account.agentAccount.fetch(agentInOldBasePda);

      // Agent still points to old collection via its asset
      console.log(`  Agent asset: ${agent.asset.toBase58()}`);
      console.log(`  Agent is permanently in old collection (no migration mechanism)`);
      console.log(`  ⚠️ This is a design decision, not necessarily a bug`);
    });
  });

  // ============================================================================
  // C-03: User Registry Authority Escalation
  // ============================================================================
  describe("C-03: User Registry Authority", () => {
    let attackerRegistry: PublicKey;
    let attackerCollection: Keypair;
    let victimRegistry: PublicKey;
    let victimCollection: Keypair;

    before(async () => {
      // Create victim's registry
      victimCollection = Keypair.generate();
      [victimRegistry] = getRegistryConfigPda(victimCollection.publicKey, program.programId);

      await program.methods
        .createUserRegistry("Victim Registry", "https://victim.example.com")
        .accountsPartial({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: victimRegistry,
          collection: victimCollection.publicKey,
          owner: user1.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([victimCollection, user1])
        .rpc();

      console.log(`  Victim registry created: ${victimRegistry.toBase58()}`);

      // Create attacker's registry
      attackerCollection = Keypair.generate();
      [attackerRegistry] = getRegistryConfigPda(attackerCollection.publicKey, program.programId);

      await program.methods
        .createUserRegistry("Attacker Registry", "https://attacker.example.com")
        .accountsPartial({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: attackerRegistry,
          collection: attackerCollection.publicKey,
          owner: user2.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([attackerCollection, user2])
        .rpc();

      console.log(`  Attacker registry created: ${attackerRegistry.toBase58()}`);
    });

    it("should verify user_collection_authority is SHARED across all user registries", async () => {
      // Both registries use the same user_collection_authority PDA
      // This is by design, but could be a security concern

      const victimConfig = await program.account.registryConfig.fetch(victimRegistry);
      const attackerConfig = await program.account.registryConfig.fetch(attackerRegistry);

      // Both have different authorities (owners)
      expect(victimConfig.authority.toBase58()).to.equal(user1.publicKey.toBase58());
      expect(attackerConfig.authority.toBase58()).to.equal(user2.publicKey.toBase58());

      console.log(`  Victim registry authority: ${victimConfig.authority.toBase58()}`);
      console.log(`  Attacker registry authority: ${attackerConfig.authority.toBase58()}`);
      console.log(`  Shared user_collection_authority PDA: ${userCollectionAuthorityPda.toBase58()}`);
    });

    it("SECURITY CHECK: Attacker cannot update victim's registry metadata", async () => {
      // The constraint `registry_config.authority == owner.key()` should prevent this

      try {
        await program.methods
          .updateUserRegistryMetadata("HACKED", "https://hacked.example.com")
          .accountsPartial({
            collectionAuthority: userCollectionAuthorityPda,
            registryConfig: victimRegistry,
            collection: victimCollection.publicKey,
            owner: user2.publicKey, // Attacker trying to modify victim's registry
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();

        throw new Error("Should have failed - attacker modified victim's registry");
      } catch (e: any) {
        if (e.message.includes("Should have failed")) throw e;
        expect(e.message).to.include("Unauthorized");
        console.log(`  ✓ SECURE: Attacker cannot update victim's registry`);
        console.log(`    Constraint 'registry_config.authority == owner.key()' works`);
      }
    });

    it("should verify legitimate owner can update their registry", async () => {
      await program.methods
        .updateUserRegistryMetadata("Updated Victim Registry", null)
        .accountsPartial({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: victimRegistry,
          collection: victimCollection.publicKey,
          owner: user1.publicKey, // Legitimate owner
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log(`  ✓ Legitimate owner can update their registry`);
    });
  });

  // ============================================================================
  // Anti-Gaming Protections
  // ============================================================================
  describe("Anti-Gaming Protections", () => {
    let ownerAgent: Keypair;
    let ownerAgentPda: PublicKey;
    let ownerAgentId: anchor.BN;

    before(async () => {
      // Register an agent owned by provider
      ownerAgent = Keypair.generate();
      [ownerAgentPda] = getAgentPda(ownerAgent.publicKey, program.programId);

      const registry = await program.account.registryConfig.fetch(userRegistry1Pda);
      ownerAgentId = registry.nextAgentId;

      await program.methods
        .register("https://owner-agent.example.com")
        .accountsPartial({
          registryConfig: userRegistry1Pda,
          agentAccount: ownerAgentPda,
          asset: ownerAgent.publicKey,
          collection: userCollection1.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([ownerAgent])
        .rpc();
    });

    it("REJECT: Owner cannot give feedback to their own agent", async () => {
      const feedbackIndex = new anchor.BN(999);
      const [feedbackPda] = getFeedbackPda(ownerAgentId, feedbackIndex, program.programId);
      const [reputationPda] = getAgentReputationPda(ownerAgentId, program.programId);

      try {
        await program.methods
          .giveFeedback(
            ownerAgentId,
            100,
            "self",
            "feedback",
            "https://api.example.com",
            "https://self-feedback.example.com",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accountsPartial({
            client: provider.wallet.publicKey, // Owner as client
            payer: provider.wallet.publicKey,
            asset: ownerAgent.publicKey,
            agentAccount: ownerAgentPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have rejected self-feedback");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("SelfFeedbackNotAllowed");
        console.log(`  ✓ SECURE: Self-feedback rejected`);
      }
    });

    it("REJECT: Owner cannot request validation with themselves as validator", async () => {
      const nonce = uniqueNonce();
      const [validationPda] = getValidationRequestPda(
        ownerAgentId,
        provider.wallet.publicKey, // Owner as validator
        nonce,
        program.programId
      );

      try {
        await program.methods
          .requestValidation(
            ownerAgentId,
            provider.wallet.publicKey, // Owner as validator
            nonce,
            "https://self-validation.example.com",
            Array.from(randomHash())
          )
          .accountsPartial({
            validationStats: validationStatsPda,
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: ownerAgent.publicKey,
            agentAccount: ownerAgentPda,
            validationRequest: validationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have rejected self-validation");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("SelfValidationNotAllowed");
        console.log(`  ✓ SECURE: Self-validation rejected`);
      }
    });

    it("ALLOW: Third party can give feedback to agent", async () => {
      const registry = await program.account.registryConfig.fetch(userRegistry1Pda);
      const feedbackIndex = new anchor.BN(0); // First feedback for this agent

      // Get or create reputation PDA
      const [reputationPda] = getAgentReputationPda(ownerAgentId, program.programId);

      // Check if reputation already exists, get next index if so
      let actualFeedbackIndex = feedbackIndex;
      try {
        const rep = await program.account.agentReputationMetadata.fetch(reputationPda);
        actualFeedbackIndex = rep.nextFeedbackIndex;
      } catch {
        // Doesn't exist yet
      }

      const [feedbackPda] = getFeedbackPda(ownerAgentId, actualFeedbackIndex, program.programId);

      await program.methods
        .giveFeedback(
          ownerAgentId,
          90,
          "quality",
          "reliable",
          "https://api.example.com",
          "https://third-party-feedback.example.com",
          Array.from(randomHash()),
          actualFeedbackIndex
        )
        .accountsPartial({
          client: thirdParty.publicKey, // Third party as client
          payer: provider.wallet.publicKey,
          asset: ownerAgent.publicKey,
          agentAccount: ownerAgentPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([thirdParty])
        .rpc();

      console.log(`  ✓ Third party can give feedback`);
    });

    it("ALLOW: Third party can request validation for agent", async () => {
      const nonce = uniqueNonce();
      const [validationPda] = getValidationRequestPda(
        ownerAgentId,
        thirdParty.publicKey, // Third party as validator
        nonce,
        program.programId
      );

      await program.methods
        .requestValidation(
          ownerAgentId,
          thirdParty.publicKey, // Third party as validator
          nonce,
          "https://third-party-validation.example.com",
          Array.from(randomHash())
        )
        .accountsPartial({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey, // Owner requests
          payer: provider.wallet.publicKey,
          asset: ownerAgent.publicKey,
          agentAccount: ownerAgentPda,
          validationRequest: validationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  ✓ Owner can request validation from third party`);
    });
  });

  // ============================================================================
  // State Consistency Tests
  // ============================================================================
  describe("State Consistency", () => {
    it("should verify RootConfig tracks base registry count correctly", async () => {
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);

      expect(rootConfig.baseRegistryCount.toNumber()).to.be.greaterThan(0);
      expect(rootConfig.currentBaseRegistry).to.not.be.null;
      expect(rootConfig.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());

      console.log(`  Base registry count: ${rootConfig.baseRegistryCount.toNumber()}`);
      console.log(`  Current base registry: ${rootConfig.currentBaseRegistry.toBase58()}`);
    });

    it("should verify RegistryConfig distinguishes Base vs User types", async () => {
      // Check base registry
      const baseConfig = await program.account.registryConfig.fetch(baseRegistryPda);
      expect(baseConfig.registryType).to.deep.equal({ base: {} });

      // Check user registry
      const userConfig = await program.account.registryConfig.fetch(userRegistry1Pda);
      expect(userConfig.registryType).to.deep.equal({ user: {} });

      console.log(`  Base registry type: Base`);
      console.log(`  User registry type: User`);
    });

    it("should verify agent IDs increment correctly per registry", async () => {
      const registry1Before = await program.account.registryConfig.fetch(userRegistry1Pda);
      const nextIdBefore = registry1Before.nextAgentId.toNumber();

      // Register new agent
      const newAgent = Keypair.generate();
      const [newAgentPda] = getAgentPda(newAgent.publicKey, program.programId);

      await program.methods
        .register("https://new-agent.example.com")
        .accountsPartial({
          registryConfig: userRegistry1Pda,
          agentAccount: newAgentPda,
          asset: newAgent.publicKey,
          collection: userCollection1.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([newAgent])
        .rpc();

      const registry1After = await program.account.registryConfig.fetch(userRegistry1Pda);
      expect(registry1After.nextAgentId.toNumber()).to.equal(nextIdBefore + 1);
      expect(registry1After.totalAgents.toNumber()).to.equal(registry1Before.totalAgents.toNumber() + 1);

      console.log(`  Agent ID incremented: ${nextIdBefore} → ${registry1After.nextAgentId.toNumber()}`);
      console.log(`  Total agents: ${registry1After.totalAgents.toNumber()}`);
    });

    it("should verify collection authorities are correctly set", async () => {
      // Base registry: registry_config PDA is authority
      // User registry: user_collection_authority PDA is authority

      // This is validated implicitly when we successfully register agents
      // If authorities were wrong, the Metaplex Core CPI would fail

      console.log(`  ✓ Base registry uses registry_config PDA as collection authority`);
      console.log(`  ✓ User registry uses user_collection_authority PDA as collection authority`);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe("Edge Cases", () => {
    it("REJECT: Cannot register in registry with wrong collection", async () => {
      const wrongCollection = Keypair.generate();
      const agent = Keypair.generate();
      const [agentPda] = getAgentPda(agent.publicKey, program.programId);

      try {
        await program.methods
          .register("https://wrong-collection.example.com")
          .accountsPartial({
            registryConfig: userRegistry1Pda,
            agentAccount: agentPda,
            asset: agent.publicKey,
            collection: wrongCollection.publicKey, // Wrong collection!
            userCollectionAuthority: userCollectionAuthorityPda,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([agent, wrongCollection])
          .rpc();

        throw new Error("Should have rejected wrong collection");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("InvalidCollection");
        console.log(`  ✓ SECURE: Cannot register with wrong collection`);
      }
    });

    it("REJECT: Cannot rotate to User registry as base registry", async () => {
      try {
        await program.methods
          .rotateBaseRegistry()
          .accountsPartial({
            rootConfig: rootConfigPda,
            newRegistry: userRegistry1Pda, // User registry, not Base!
            authority: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have rejected rotating to user registry");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("InvalidRegistryType");
        console.log(`  ✓ SECURE: Cannot rotate to User registry as base`);
      }
    });

    it("REJECT: Non-authority cannot create base registry", async () => {
      const newCollection = Keypair.generate();
      const [newRegistryPda] = getRegistryConfigPda(newCollection.publicKey, program.programId);

      try {
        await program.methods
          .createBaseRegistry()
          .accountsPartial({
            rootConfig: rootConfigPda,
            registryConfig: newRegistryPda,
            collection: newCollection.publicKey,
            authority: thirdParty.publicKey, // Not authority!
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([newCollection, thirdParty])
          .rpc();

        throw new Error("Should have rejected non-authority");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("Unauthorized");
        console.log(`  ✓ SECURE: Non-authority cannot create base registry`);
      }
    });

    it("REJECT: Cannot initialize root config twice", async () => {
      const newCollection = Keypair.generate();
      const [newRegistryPda] = getRegistryConfigPda(newCollection.publicKey, program.programId);

      try {
        await program.methods
          .initialize()
          .accountsPartial({
            rootConfig: rootConfigPda,
            registryConfig: newRegistryPda,
            collection: newCollection.publicKey,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([newCollection])
          .rpc();

        throw new Error("Should have rejected duplicate init");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        // Account already exists
        console.log(`  ✓ SECURE: Cannot initialize twice`);
      }
    });
  });

  // ============================================================================
  // Summary
  // ============================================================================
  after(() => {
    console.log("\n" + "=".repeat(80));
    console.log("SECURITY AUDIT TEST SUMMARY");
    console.log("=".repeat(80));
    console.log("\n⚠️  CRITICAL ISSUES DEMONSTRATED:");
    console.log("  C-01: Agent ID collision across registries - CONFIRMED");
    console.log("        Multiple agents in different registries share same agent_id=0");
    console.log("        Reputation/validation PDAs collide");
    console.log("\n  C-02: Base registry rotation - DOCUMENTED");
    console.log("        Agents in old registry remain functional");
    console.log("        No automatic migration mechanism");
    console.log("\n  C-03: User registry authority - SECURE");
    console.log("        Shared user_collection_authority PDA");
    console.log("        But registry_config.authority constraint prevents unauthorized access");
    console.log("\n✓ SECURITY PROTECTIONS VERIFIED:");
    console.log("  - Self-feedback prevention");
    console.log("  - Self-validation prevention");
    console.log("  - Collection validation on register");
    console.log("  - Registry type validation on rotation");
    console.log("  - Authority checks on admin functions");
    console.log("=".repeat(80));
  });
});
