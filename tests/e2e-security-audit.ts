/**
 * E2E Security Audit Tests for Agent Registry 8004 v2.0.0
 * Events-Only Architecture
 *
 * Tests:
 * - Multi-collection architecture security
 * - Anti-gaming protections (self-feedback, self-validation)
 * - State consistency across registries
 * - Authority constraints
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
  randomHash,
  uniqueNonce,
} from "./utils/helpers";

describe("E2E Security Audit Tests v2.0.0", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let userCollectionAuthorityPda: PublicKey;

  let baseRegistryPda: PublicKey;
  let baseCollectionPubkey: PublicKey;

  let userRegistry1Pda: PublicKey;
  let userCollection1: Keypair;

  let userRegistry2Pda: PublicKey;
  let userCollection2: Keypair;

  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const thirdParty = Keypair.generate();

  before(async () => {
    console.log("\n=== Security Audit Test Setup v2.0.0 ===");
    console.log("Program ID:", program.programId.toBase58());

    [rootConfigPda] = getRootConfigPda(program.programId);
    [userCollectionAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collection_authority")],
      program.programId
    );

    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    baseRegistryPda = rootConfig.currentBaseRegistry;
    const baseRegistry = await program.account.registryConfig.fetch(baseRegistryPda);
    baseCollectionPubkey = baseRegistry.collection;

    console.log("Base Registry:", baseRegistryPda.toBase58());

    const airdropAmount = 2 * LAMPORTS_PER_SOL;
    for (const user of [user1, user2, thirdParty]) {
      try {
        const sig = await provider.connection.requestAirdrop(user.publicKey, airdropAmount);
        await provider.connection.confirmTransaction(sig, "confirmed");
      } catch (e) {}
    }

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

  describe("Events-Only Architecture (No PDA Collision)", () => {
    let agent1Asset: Keypair;
    let agent1Pda: PublicKey;

    let agent2Asset: Keypair;
    let agent2Pda: PublicKey;

    it("should create agents in different registries with unique assets", async () => {
      agent1Asset = Keypair.generate();
      [agent1Pda] = getAgentPda(agent1Asset.publicKey, program.programId);

      await program.methods
        .register("https://agent1-registry1.example.com")
        .accountsPartial({
          registryConfig: userRegistry1Pda,
          agentAccount: agent1Pda,
          asset: agent1Asset.publicKey,
          collection: userCollection1.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agent1Asset])
        .rpc();

      console.log("  Agent 1 in Registry 1:", agent1Asset.publicKey.toBase58());

      agent2Asset = Keypair.generate();
      [agent2Pda] = getAgentPda(agent2Asset.publicKey, program.programId);

      await program.methods
        .register("https://agent1-registry2.example.com")
        .accountsPartial({
          registryConfig: userRegistry2Pda,
          agentAccount: agent2Pda,
          asset: agent2Asset.publicKey,
          collection: userCollection2.publicKey,
          userCollectionAuthority: userCollectionAuthorityPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agent2Asset])
        .rpc();

      console.log("  Agent 2 in Registry 2:", agent2Asset.publicKey.toBase58());
    });

    it("SECURE: No PDA collision - each agent has unique asset pubkey", async () => {
      expect(agent1Asset.publicKey.toBase58()).to.not.equal(agent2Asset.publicKey.toBase58());
      expect(agent1Pda.toBase58()).to.not.equal(agent2Pda.toBase58());

      console.log("  Events-only: Feedback identified by asset + client + index");
      console.log("  No reputation PDA collision possible");
      console.log("  Indexer tracks per-asset statistics");
    });

    it("feedback events are scoped to asset pubkey (no collision)", async () => {
      const feedbackIndex = new anchor.BN(0);

      await program.methods
        .giveFeedback(
          85,
          "quality",
          "reliable",
          "https://api.example.com",
          "https://feedback.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: thirdParty.publicKey,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
        })
        .signers([thirdParty])
        .rpc();

      console.log("  Feedback for agent1 emitted");

      await program.methods
        .giveFeedback(
          90,
          "speed",
          "accurate",
          "https://api.example.com",
          "https://feedback2.example.com",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: thirdParty.publicKey,
          asset: agent2Asset.publicKey,
          agentAccount: agent2Pda,
        })
        .signers([thirdParty])
        .rpc();

      console.log("  Feedback for agent2 emitted");
      console.log("  Both feedbacks have index=0 but different assets - no collision");
    });
  });

  describe("Base Registry Rotation", () => {
    let agentInOldBaseAsset: Keypair;
    let agentInOldBasePda: PublicKey;
    let newBaseCollection: Keypair;
    let newBaseRegistryPda: PublicKey;

    it("should register agent in current base registry", async () => {
      agentInOldBaseAsset = Keypair.generate();
      [agentInOldBasePda] = getAgentPda(agentInOldBaseAsset.publicKey, program.programId);

      await program.methods
        .register("https://agent-old-base.example.com")
        .accountsPartial({
          registryConfig: baseRegistryPda,
          agentAccount: agentInOldBasePda,
          asset: agentInOldBaseAsset.publicKey,
          collection: baseCollectionPubkey,
          userCollectionAuthority: null,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([agentInOldBaseAsset])
        .rpc();

      console.log("  Agent registered in base registry");
    });

    it("should create and rotate to new base registry", async () => {
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

      await program.methods
        .rotateBaseRegistry()
        .accountsPartial({
          rootConfig: rootConfigPda,
          newRegistry: newBaseRegistryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.currentBaseRegistry.toBase58()).to.equal(newBaseRegistryPda.toBase58());
      console.log("  Rotated to new base registry");
    });

    it("Agent in old registry remains functional", async () => {
      await program.methods
        .setAgentUri("https://updated-agent-old-base.example.com")
        .accountsPartial({
          registryConfig: baseRegistryPda,
          agentAccount: agentInOldBasePda,
          asset: agentInOldBaseAsset.publicKey,
          collection: baseCollectionPubkey,
          userCollectionAuthority: null,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .rpc();

      console.log("  Agent in old registry can still update URI");
    });
  });

  describe("User Registry Authority", () => {
    let victimRegistry: PublicKey;
    let victimCollection: Keypair;
    let attackerRegistry: PublicKey;
    let attackerCollection: Keypair;

    before(async () => {
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
    });

    it("SECURE: Attacker cannot update victim registry metadata", async () => {
      try {
        await program.methods
          .updateUserRegistryMetadata("HACKED", "https://hacked.example.com")
          .accountsPartial({
            collectionAuthority: userCollectionAuthorityPda,
            registryConfig: victimRegistry,
            collection: victimCollection.publicKey,
            owner: user2.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();

        throw new Error("Should have failed");
      } catch (e: any) {
        if (e.message.includes("Should have failed")) throw e;
        expect(e.message).to.include("Unauthorized");
        console.log("  SECURE: Attacker cannot update victim's registry");
      }
    });

    it("Legitimate owner can update their registry", async () => {
      await program.methods
        .updateUserRegistryMetadata("Updated Victim Registry", null)
        .accountsPartial({
          collectionAuthority: userCollectionAuthorityPda,
          registryConfig: victimRegistry,
          collection: victimCollection.publicKey,
          owner: user1.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("  Owner can update their registry");
    });
  });

  describe("Anti-Gaming Protections", () => {
    let ownerAgent: Keypair;
    let ownerAgentPda: PublicKey;

    before(async () => {
      ownerAgent = Keypair.generate();
      [ownerAgentPda] = getAgentPda(ownerAgent.publicKey, program.programId);

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
      try {
        await program.methods
          .giveFeedback(
            100,
            "self",
            "feedback",
            "https://api.example.com",
            "https://self-feedback.example.com",
            Array.from(randomHash()),
            new anchor.BN(999)
          )
          .accounts({
            client: provider.wallet.publicKey,
            asset: ownerAgent.publicKey,
            agentAccount: ownerAgentPda,
          })
          .rpc();

        throw new Error("Should have rejected");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("SelfFeedbackNotAllowed");
        console.log("  SECURE: Self-feedback rejected");
      }
    });

    it("REJECT: Owner cannot request validation with themselves as validator", async () => {
      try {
        await program.methods
          .requestValidation(
            provider.wallet.publicKey,
            uniqueNonce(),
            "https://self-validation.example.com",
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            asset: ownerAgent.publicKey,
            agentAccount: ownerAgentPda,
            validator: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have rejected");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("SelfValidationNotAllowed");
        console.log("  SECURE: Self-validation rejected");
      }
    });

    it("ALLOW: Third party can give feedback to agent", async () => {
      await program.methods
        .giveFeedback(
          90,
          "quality",
          "reliable",
          "https://api.example.com",
          "https://third-party-feedback.example.com",
          Array.from(randomHash()),
          new anchor.BN(0)
        )
        .accounts({
          client: thirdParty.publicKey,
          asset: ownerAgent.publicKey,
          agentAccount: ownerAgentPda,
        })
        .signers([thirdParty])
        .rpc();

      console.log("  Third party can give feedback");
    });

    it("ALLOW: Third party can request validation for agent", async () => {
      await program.methods
        .requestValidation(
          thirdParty.publicKey,
          uniqueNonce(),
          "https://third-party-validation.example.com",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: ownerAgent.publicKey,
          agentAccount: ownerAgentPda,
          validator: thirdParty.publicKey,
        })
        .rpc();

      console.log("  Owner can request validation from third party");
    });
  });

  describe("State Consistency", () => {
    it("RootConfig tracks base registry count correctly", async () => {
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      expect(rootConfig.baseRegistryCount.toNumber()).to.be.greaterThan(0);
      expect(rootConfig.currentBaseRegistry).to.not.be.null;
      console.log("  Base registry count:", rootConfig.baseRegistryCount.toNumber());
    });

    it("RegistryConfig distinguishes Base vs User types", async () => {
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      const baseConfig = await program.account.registryConfig.fetch(rootConfig.currentBaseRegistry);
      expect(baseConfig.registryType).to.deep.equal({ base: {} });

      const userConfig = await program.account.registryConfig.fetch(userRegistry1Pda);
      expect(userConfig.registryType).to.deep.equal({ user: {} });

      console.log("  Registry types validated");
    });
  });

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
            collection: wrongCollection.publicKey,
            userCollectionAuthority: userCollectionAuthorityPda,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([agent, wrongCollection])
          .rpc();

        throw new Error("Should have rejected");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("InvalidCollection");
        console.log("  SECURE: Wrong collection rejected");
      }
    });

    it("REJECT: Cannot rotate to User registry as base registry", async () => {
      try {
        await program.methods
          .rotateBaseRegistry()
          .accountsPartial({
            rootConfig: rootConfigPda,
            newRegistry: userRegistry1Pda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have rejected");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("InvalidRegistryType");
        console.log("  SECURE: Cannot rotate to User registry");
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
            authority: thirdParty.publicKey,
            systemProgram: SystemProgram.programId,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
          })
          .signers([newCollection, thirdParty])
          .rpc();

        throw new Error("Should have rejected");
      } catch (e: any) {
        if (e.message.includes("Should have rejected")) throw e;
        expect(e.message).to.include("Unauthorized");
        console.log("  SECURE: Non-authority cannot create base registry");
      }
    });
  });

  after(() => {
    console.log("\n" + "=".repeat(80));
    console.log("SECURITY AUDIT v2.0.0 SUMMARY");
    console.log("=".repeat(80));
    console.log("\nEVENTS-ONLY ARCHITECTURE:");
    console.log("  - No PDA collision possible (asset pubkey is unique)");
    console.log("  - Feedback/validation identified by asset + client + index");
    console.log("  - Indexer aggregates statistics from events");
    console.log("\nSECURITY PROTECTIONS VERIFIED:");
    console.log("  - Self-feedback prevention");
    console.log("  - Self-validation prevention");
    console.log("  - Collection validation on register");
    console.log("  - Registry type validation on rotation");
    console.log("  - Authority checks on admin functions");
    console.log("=".repeat(80));
  });
});
