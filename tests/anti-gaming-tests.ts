import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
  getRegistryAuthorityPda,
  ATOM_ENGINE_PROGRAM_ID,
  randomHash,
  getAtomProgram,
} from "./utils/helpers";

/**
 * Anti-Gaming Security Tests v2.0.0
 *
 * Tests the self-feedback and self-validation prevention mechanisms.
 * v2.0.0: Events-only architecture for Reputation and Validation
 */
describe("Anti-Gaming Security (Events-Only v2.0.0)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let atomStatsPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  // Test wallets
  let otherUser: Keypair;

  // Test data
  let testAgentAsset: Keypair;
  let testAgentPda: PublicKey;

  before(async () => {
    console.log("\n Anti-Gaming Test Setup (v2.0.0 Events-Only)");
    console.log(`   Program ID: ${program.programId.toString()}`);

    // Get root config
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    collectionPubkey = rootConfig.baseCollection;
    [registryConfigPda] = getRegistryConfigPda(collectionPubkey, program.programId);

    // Get ATOM config
    [atomConfigPda] = getAtomConfigPda();
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    // Generate other user for non-owner operations
    otherUser = Keypair.generate();
    // Fund otherUser for transaction fees
    const sig = await provider.connection.requestAirdrop(otherUser.publicKey, 0.5 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
    console.log(`   Agent Owner: ${provider.wallet.publicKey.toString().slice(0, 16)}...`);
    console.log(`   Other User: ${otherUser.publicKey.toString().slice(0, 16)}...`);

    // Create an agent owned by provider.wallet
    testAgentAsset = Keypair.generate();
    [testAgentPda] = getAgentPda(testAgentAsset.publicKey, program.programId);
    [atomStatsPda] = getAtomStatsPda(testAgentAsset.publicKey);

    await program.methods
      .register("https://test.com/anti-gaming-agent")
      .accountsPartial({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: testAgentPda,
        asset: testAgentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([testAgentAsset])
      .rpc();

    // Enable ATOM
    await program.methods
      .enableAtom()
      .accountsPartial({
        owner: provider.wallet.publicKey,
        asset: testAgentAsset.publicKey,
        agentAccount: testAgentPda,
      })
      .rpc();

    // Initialize AtomStats
    const atomProgram = getAtomProgram(provider);
    await atomProgram.methods
      .initializeStats()
      .accountsPartial({
        owner: provider.wallet.publicKey,
        asset: testAgentAsset.publicKey,
        collection: collectionPubkey,
        config: atomConfigPda,
        stats: atomStatsPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify agent created
    const agent = await program.account.agentAccount.fetch(testAgentPda);
    console.log(`   Test Agent Asset: ${testAgentAsset.publicKey.toString().slice(0, 16)}...`);
    console.log(`   Test Agent Owner: ${agent.owner.toString().slice(0, 16)}...`);
  });

  describe("Self-Feedback Prevention", () => {
    it("giveFeedback() FAILS when client is agent owner (self-feedback)", async () => {
      try {
        await program.methods
          .giveFeedback(
            new BN(10000),                // value (scaled by decimals)
            2,                            // value_decimals
            100,                          // score
            Array.from(randomHash()),     // feedback_hash
            "great",                      // tag1
            "service",                    // tag2
            "/api/test",                  // endpoint
            "https://feedback.uri"        // feedback_uri
          )
          .accountsPartial({
            client: provider.wallet.publicKey, // SAME as agent owner - should fail
            asset: testAgentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: testAgentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        expect.fail("Should have failed with SelfFeedbackNotAllowed");
      } catch (err: any) {
        const errStr = err.toString();
        const hasSelfFeedbackError = errStr.includes("SelfFeedbackNotAllowed") || errStr.includes("6300");
        expect(hasSelfFeedbackError, `Expected SelfFeedbackNotAllowed error, got: ${errStr.slice(0, 200)}`).to.be.true;
        console.log("   Correctly rejected self-feedback");
      }
    });

    it("giveFeedback() SUCCEEDS when client is different from owner", async () => {
      const sig = await program.methods
        .giveFeedback(
          new BN(8500),                 // value (scaled by decimals)
          2,                            // value_decimals
          85,                           // score
          Array.from(randomHash()),     // feedback_hash
          "helpful",                    // tag1
          "fast",                       // tag2
          "/api/test",                  // endpoint
          "https://feedback.uri"        // feedback_uri
        )
        .accountsPartial({
          client: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: testAgentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log(`   Feedback from different user succeeded: ${sig.slice(0, 16)}...`);
      // Events-only: no account to fetch, event was emitted
    });
  });

  // NOTE: Self-Validation Prevention tests removed in v0.5.0
  // Validation module archived for future upgrade

  describe("Edge Cases", () => {
    it("Different user can give multiple feedbacks", async () => {
      await program.methods
        .giveFeedback(
          new BN(9000),                 // value (scaled by decimals)
          2,                            // value_decimals
          90,                           // score
          Array.from(randomHash()),     // feedback_hash
          "excellent",                  // tag1
          "reliable",                   // tag2
          "/api/v2",                    // endpoint
          "https://feedback2.uri"       // feedback_uri
        )
        .accountsPartial({
          client: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: testAgentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log("   Multiple feedbacks from same user allowed");
    });

    it("Feedback with different hash works (no duplicate index concept)", async () => {
      // Each feedback gets auto-incremented index, no duplicate index concept
      await program.methods
        .giveFeedback(
          new BN(7500),                 // value (scaled by decimals)
          2,                            // value_decimals
          75,                           // score
          Array.from(randomHash()),     // feedback_hash
          "good",                       // tag1
          "consistent",                 // tag2
          "/api/v3",                    // endpoint
          "https://feedback3.uri"       // feedback_uri
        )
        .accountsPartial({
          client: otherUser.publicKey,
          asset: testAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: testAgentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc();

      console.log("   Multiple feedbacks with auto-incremented index work");
    });
  });
});
