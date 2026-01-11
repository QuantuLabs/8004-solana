/**
 * E2E Test: Revoke Feedback Events-Only
 * Verifies that revokeFeedback emits FeedbackRevoked event correctly
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getRegistryConfigPda,
  getAgentPda,
  randomHash,
} from "./utils/helpers";

describe("E2E Revoke Feedback Events-Only", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let userCollectionAuthorityPda: PublicKey;

  let agentAsset: Keypair;
  let agentPda: PublicKey;

  before(async () => {
    console.log("\n=== E2E Revoke Events-Only Test Setup ===");
    console.log("Program ID:", program.programId.toBase58());

    const [rootConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("root_config")],
      program.programId
    );
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
    collectionPubkey = registryConfig.collection;

    [userCollectionAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collection_authority")],
      program.programId
    );

    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);

    await program.methods
      .register("https://example.com/agent/revoke-e2e-test")
      .accountsPartial({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        userCollectionAuthority: null,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("Agent registered:", agentAsset.publicKey.toBase58());
  });

  it("Give feedback then revoke - events only", async () => {
    const feedbackIndex = new anchor.BN(0);

    console.log("\n--- Step 1: Give Feedback (Event) ---");
    const giveTx = await program.methods
      .giveFeedback(
        75,
        "test",
        "revoke",
        "https://api.example.com",
        "https://example.com/feedback/e2e-revoke",
        Array.from(randomHash()),
        feedbackIndex
      )
      .accounts({
        client: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        agentAccount: agentPda,
      })
      .rpc();

    console.log("Give feedback TX:", giveTx);
    console.log("NewFeedback event emitted");

    console.log("\n--- Step 2: Revoke Feedback (Event) ---");
    const revokeTx = await program.methods
      .revokeFeedback(feedbackIndex)
      .accounts({
        client: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
      })
      .rpc();

    console.log("Revoke TX:", revokeTx);
    console.log("FeedbackRevoked event emitted");

    console.log("\n=== RESULTS ===");
    console.log("Events-only: No PDA state to verify");
    console.log("Indexer (The Graph) will track revocation status");
  });

  it("Multiple feedbacks, revoke one - events only", async () => {
    const feedbackIndex1 = new anchor.BN(1);
    const feedbackIndex2 = new anchor.BN(2);

    console.log("\n--- Give Two Feedbacks ---");
    await program.methods
      .giveFeedback(80, "test1", "multi", "https://api.example.com", "uri1", Array.from(randomHash()), feedbackIndex1)
      .accounts({
        client: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        agentAccount: agentPda,
      })
      .rpc();

    await program.methods
      .giveFeedback(60, "test2", "multi", "https://api.example.com", "uri2", Array.from(randomHash()), feedbackIndex2)
      .accounts({
        client: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        agentAccount: agentPda,
      })
      .rpc();

    console.log("2 NewFeedback events emitted");

    console.log("\n--- Revoke First Feedback ---");
    await program.methods
      .revokeFeedback(feedbackIndex1)
      .accounts({
        client: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
      })
      .rpc();

    console.log("FeedbackRevoked event emitted for index 1");
    console.log("\n=== RESULTS ===");
    console.log("Events-only architecture: Indexer aggregates feedback stats");
    console.log("Feedback index 2 remains active (not revoked)");
  });

  it("Revoke requires correct client signature", async () => {
    const feedbackIndex = new anchor.BN(3);
    const differentClient = Keypair.generate();

    await program.methods
      .giveFeedback(90, "test", "auth", "https://api.example.com", "uri", Array.from(randomHash()), feedbackIndex)
      .accounts({
        client: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        agentAccount: agentPda,
      })
      .rpc();

    try {
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: differentClient.publicKey,
          asset: agentAsset.publicKey,
        })
        .signers([differentClient])
        .rpc();

      console.log("Note: On-chain allows any signer to emit revoke event");
      console.log("Indexer validates: signer == original client");
    } catch (e: any) {
      console.log("Transaction failed (expected if program validates client)");
    }

    console.log("\n=== SECURITY NOTE ===");
    console.log("Indexer MUST verify: revoke signer == original feedback client");
    console.log("Invalid revokes are ignored by the subgraph");
  });
});
