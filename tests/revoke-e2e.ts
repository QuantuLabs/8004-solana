/**
 * E2E Test: Revoke Feedback v2.5
 * Verifies that revokeFeedback:
 * - Calls CPI to atom-engine revoke_stats
 * - Emits enriched FeedbackRevoked event with original_score, had_impact, new stats
 * - Handles soft fail cases (not found, already revoked)
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getAtomConfigPda,
  getAtomStatsPda,
  getAgentPda,
  getRootConfigPda,
  getRegistryAuthorityPda,
  randomHash,
  fundKeypair,
} from "./utils/helpers";

describe("E2E Revoke Feedback v2.5", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomEngine = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let atomStatsPda: PublicKey;

  // Separate client for giving feedback (not the agent owner)
  let client: Keypair;

  before(async () => {
    console.log("\n=== E2E Revoke v2.5 Test Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("ATOM Engine ID:", atomEngine.programId.toBase58());

    // Get registry config
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
    collectionPubkey = registryConfig.collection;

    // Get ATOM config
    [atomConfigPda] = getAtomConfigPda(atomEngine.programId);

    // Get registry authority PDA for CPI signing
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    // Create and fund a separate client
    client = Keypair.generate();
    await fundKeypair(provider, client, 0.5 * anchor.web3.LAMPORTS_PER_SOL);
    console.log("Client (separate from owner):", client.publicKey.toBase58());

    // Register a new agent for testing (owned by provider wallet)
    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    [atomStatsPda] = getAtomStatsPda(agentAsset.publicKey, atomEngine.programId);

    await program.methods
      .register("https://example.com/agent/revoke-v25-test")
      .accountsPartial({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        userCollectionAuthority: null,
        owner: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("Agent registered:", agentAsset.publicKey.toBase58());

    // Initialize AtomStats for the agent (owner pays)
    await atomEngine.methods
      .initializeStats()
      .accounts({
        owner: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        config: atomConfigPda,
        stats: atomStatsPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("AtomStats initialized:", atomStatsPda.toBase58());
  });

  it("Give feedback then revoke - should return had_impact=true", async () => {
    const feedbackIndex = new anchor.BN(0);
    const score = 75;

    console.log("\n--- Step 1: Give Feedback ---");
    await program.methods
      .giveFeedback(
        score,
        "test",
        "revoke",
        "https://api.example.com",
        "https://example.com/feedback/revoke-test",
        Array.from(randomHash()),
        feedbackIndex
      )
      .accountsPartial({
        client: client.publicKey,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    console.log("Feedback given: score =", score);

    // Check AtomStats before revoke
    const statsBefore = await atomEngine.account.atomStats.fetch(atomStatsPda);
    console.log("Stats before revoke:");
    console.log("  - quality_score:", statsBefore.qualityScore);
    console.log("  - confidence:", statsBefore.confidence);
    console.log("  - feedback_count:", statsBefore.feedbackCount.toString());

    console.log("\n--- Step 2: Revoke Feedback ---");
    const revokeTx = await program.methods
      .revokeFeedback(feedbackIndex)
      .accountsPartial({
        client: client.publicKey,
        asset: agentAsset.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    console.log("Revoke TX:", revokeTx);

    // Check AtomStats after revoke
    const statsAfter = await atomEngine.account.atomStats.fetch(atomStatsPda);
    console.log("\nStats after revoke:");
    console.log("  - quality_score:", statsAfter.qualityScore, "(was", statsBefore.qualityScore, ")");
    console.log("  - confidence:", statsAfter.confidence, "(was", statsBefore.confidence, ")");
    console.log("  - feedback_count:", statsAfter.feedbackCount.toString(), "(was", statsBefore.feedbackCount.toString(), ")");

    // Verify revoke had impact: quality_score should change
    // Note: revoke doesn't decrement feedback_count, but recalculates stats without the revoked feedback
    expect(statsAfter.qualityScore).to.not.equal(statsBefore.qualityScore);

    console.log("\n=== PASS: Revoke had impact on stats ===");
  });

  it("Double revoke - second should return had_impact=false", async () => {
    const feedbackIndex = new anchor.BN(1);
    const score = 80;

    console.log("\n--- Give Feedback ---");
    await program.methods
      .giveFeedback(
        score,
        "test",
        "double",
        "https://api.example.com",
        "https://example.com/feedback/double-revoke",
        Array.from(randomHash()),
        feedbackIndex
      )
      .accountsPartial({
        client: client.publicKey,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    console.log("Feedback given: score =", score);

    console.log("\n--- First Revoke ---");
    await program.methods
      .revokeFeedback(feedbackIndex)
      .accountsPartial({
        client: client.publicKey,
        asset: agentAsset.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    console.log("First revoke completed");

    // Record stats after first revoke
    const statsAfterFirst = await atomEngine.account.atomStats.fetch(atomStatsPda);

    console.log("\n--- Second Revoke (should soft fail) ---");
    await program.methods
      .revokeFeedback(feedbackIndex)
      .accountsPartial({
        client: client.publicKey,
        asset: agentAsset.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    console.log("Second revoke completed (soft fail)");

    // Stats should be unchanged
    const statsAfterSecond = await atomEngine.account.atomStats.fetch(atomStatsPda);
    expect(statsAfterSecond.qualityScore).to.equal(statsAfterFirst.qualityScore);
    expect(statsAfterSecond.confidence).to.equal(statsAfterFirst.confidence);

    console.log("\n=== PASS: Double revoke soft failed (no state change) ===");
  });

  it("Revoke non-existent feedback - should soft fail", async () => {
    // Use a different client that never gave feedback
    const otherClient = Keypair.generate();
    await fundKeypair(provider, otherClient, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

    const feedbackIndex = new anchor.BN(999);

    console.log("\n--- Revoke feedback that doesn't exist ---");
    const statsBefore = await atomEngine.account.atomStats.fetch(atomStatsPda);

    await program.methods
      .revokeFeedback(feedbackIndex)
      .accountsPartial({
        client: otherClient.publicKey,
        asset: agentAsset.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([otherClient])
      .rpc();

    console.log("Revoke completed (soft fail - not found)");

    // Stats should be unchanged
    const statsAfter = await atomEngine.account.atomStats.fetch(atomStatsPda);
    expect(statsAfter.qualityScore).to.equal(statsBefore.qualityScore);
    expect(statsAfter.confidence).to.equal(statsBefore.confidence);

    console.log("\n=== PASS: Not-found revoke soft failed (no state change) ===");
  });

  it("Revoke after 32 feedbacks - oldest should be ejected", async () => {
    console.log("\n--- Give 32 feedbacks to overflow ring buffer ---");

    // Create multiple clients
    const clients: Keypair[] = [];
    for (let i = 0; i < 35; i++) {
      clients.push(Keypair.generate());
    }

    // Fund all clients
    for (const c of clients) {
      await fundKeypair(provider, c, 0.05 * anchor.web3.LAMPORTS_PER_SOL);
    }

    // First client gives feedback at index 100
    const firstClient = clients[0];
    const firstIndex = new anchor.BN(100);

    await program.methods
      .giveFeedback(
        90,
        "first",
        "overflow",
        "https://api.example.com",
        "uri",
        Array.from(randomHash()),
        firstIndex
      )
      .accountsPartial({
        client: firstClient.publicKey,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([firstClient])
      .rpc();

    console.log("First feedback given by client 0");

    // Give 34 more feedbacks to push first one out of ring buffer
    for (let i = 1; i < 35; i++) {
      await program.methods
        .giveFeedback(
          50 + i,
          `tag${i}`,
          "overflow",
          "https://api.example.com",
          `uri${i}`,
          Array.from(randomHash()),
          new anchor.BN(100 + i)
        )
        .accountsPartial({
          client: clients[i].publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: atomEngine.programId,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clients[i]])
        .rpc();
    }

    console.log("34 more feedbacks given (ring buffer should overflow)");

    // Now try to revoke the first feedback - it should soft fail
    const statsBefore = await atomEngine.account.atomStats.fetch(atomStatsPda);

    console.log("\n--- Try to revoke first (overflowed) feedback ---");
    await program.methods
      .revokeFeedback(firstIndex)
      .accountsPartial({
        client: firstClient.publicKey,
        asset: agentAsset.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([firstClient])
      .rpc();

    const statsAfter = await atomEngine.account.atomStats.fetch(atomStatsPda);

    // Stats should be unchanged (feedback was ejected from ring buffer)
    expect(statsAfter.qualityScore).to.equal(statsBefore.qualityScore);
    expect(statsAfter.confidence).to.equal(statsBefore.confidence);

    console.log("\n=== PASS: Overflow revoke soft failed (feedback ejected) ===");
  });

  it("Recent feedback (within 32) - revoke should work", async () => {
    // Use one of the recent clients from the previous test
    const recentClient = Keypair.generate();
    await fundKeypair(provider, recentClient, 0.05 * anchor.web3.LAMPORTS_PER_SOL);

    const recentIndex = new anchor.BN(200);
    const score = 85;

    console.log("\n--- Give recent feedback ---");
    await program.methods
      .giveFeedback(
        score,
        "recent",
        "test",
        "https://api.example.com",
        "recent-uri",
        Array.from(randomHash()),
        recentIndex
      )
      .accountsPartial({
        client: recentClient.publicKey,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([recentClient])
      .rpc();

    const statsBefore = await atomEngine.account.atomStats.fetch(atomStatsPda);

    console.log("\n--- Revoke recent feedback ---");
    await program.methods
      .revokeFeedback(recentIndex)
      .accountsPartial({
        client: recentClient.publicKey,
        asset: agentAsset.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([recentClient])
      .rpc();

    const statsAfter = await atomEngine.account.atomStats.fetch(atomStatsPda);

    // Confidence should have decreased (revoke penalty)
    expect(statsAfter.confidence).to.be.lessThan(statsBefore.confidence);

    console.log("Stats change: confidence", statsBefore.confidence, "->", statsAfter.confidence);
    console.log("\n=== PASS: Recent revoke had impact ===");
  });
});
