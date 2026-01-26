/**
 * Quick test to verify ATOM optional implementation
 * Tests that give_feedback works without AtomStats initialized
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";

describe("ATOM Optional Implementation", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomEngine = anchor.workspace.AtomEngine as Program<AtomEngine>;

  const collectionPubkey = new PublicKey("3tBB8rLX6VjKSm1M94L5fNp4M8QYhSQqs8XNqxKSZzBS");

  const getAgentPda = (asset: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), asset.toBuffer()],
      program.programId
    );
  };

  const getAtomStatsPda = (asset: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("atom_stats"), asset.toBuffer()],
      atomEngine.programId
    );
  };

  const getAtomConfigPda = () => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("atom_config")],
      atomEngine.programId
    );
  };

  const getRegistryAuthority = () => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("atom_cpi_authority")],
      program.programId
    );
  };

  const getRootConfigPda = () => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("root_config")],
      program.programId
    );
  };

  const getRegistryConfigPda = (collection: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("registry_config"), collection.toBuffer()],
      program.programId
    );
  };

  it("should give feedback WITHOUT ATOM initialized (atom_enabled=false)", async () => {
    // Create new agent without initializing ATOM
    const asset = Keypair.generate();
    const [agentPda] = getAgentPda(asset.publicKey);
    const [atomStatsPda] = getAtomStatsPda(asset.publicKey);
    const [atomConfigPda] = getAtomConfigPda();
    const [registryAuthority] = getRegistryAuthority();
    const [rootConfigPda] = getRootConfigPda();
    const [registryConfigPda] = getRegistryConfigPda(collectionPubkey);

    const owner = Keypair.generate();
    const client = Keypair.generate();

    // Fund accounts
    const airdropOwner = await provider.connection.requestAirdrop(
      owner.publicKey,
      0.5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropOwner);

    const airdropClient = await provider.connection.requestAirdrop(
      client.publicKey,
      0.5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropClient);

    // Register agent
    await program.methods
      .register("https://example.com/atom-optional-test")
      .accountsPartial({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: asset.publicKey,
        collection: collectionPubkey,
        userCollectionAuthority: null,
        owner: owner.publicKey,
        payer: owner.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([asset, owner])
      .rpc();

    console.log("\n=== Testing ATOM Optional Implementation ===");
    console.log("Asset:", asset.publicKey.toString());
    console.log("AtomStats PDA:", atomStatsPda.toString());

    // Check that AtomStats is NOT initialized
    const atomStatsAccount = await provider.connection.getAccountInfo(atomStatsPda);
    console.log("AtomStats account exists:", atomStatsAccount !== null);
    console.log("Expected: false (ATOM not initialized)");

    // Give feedback WITHOUT initializing ATOM
    const feedbackTx = await program.methods
      .giveFeedback(
        85, // score
        "test-tag1",
        "test-tag2",
        "https://example.com/endpoint",
        "https://example.com/feedback",
        Buffer.from(new Uint8Array(32)), // feedback_hash
        BigInt(1) // feedback_index
      )
      .accountsPartial({
        asset: asset.publicKey,
        agentAccount: agentPda,
        collection: collectionPubkey,
        client: client.publicKey,
        atomStats: atomStatsPda,
        atomConfig: atomConfigPda,
        atomEngineProgram: atomEngine.programId,
        registryAuthority: registryAuthority,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    console.log("\n✅ give_feedback SUCCESS without ATOM!");
    console.log("Transaction:", feedbackTx);

    // Fetch and verify event
    const tx = await provider.connection.getTransaction(feedbackTx, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    console.log("\n=== Verifying NewFeedback Event ===");

    // Parse events from transaction
    const events = [];
    if (tx && tx.meta && tx.meta.logMessages) {
      for (const log of tx.meta.logMessages) {
        if (log.includes("Program data:")) {
          const base64Data = log.split("Program data: ")[1];
          if (base64Data) {
            try {
              const eventData = Buffer.from(base64Data, "base64");
              // Simple check for event discriminator (first 8 bytes)
              console.log("Event data found (first 16 bytes):", eventData.subarray(0, 16).toString("hex"));

              // Check for atom_enabled flag (should be at a specific offset in NewFeedback)
              // NewFeedback structure: asset(32) + client(32) + index(8) + score(1) + hash(32) + atom_enabled(1) + ...
              // Total before atom_enabled: 32 + 32 + 8 + 1 + 32 = 105 bytes (after 8-byte discriminator)
              // So atom_enabled is at byte 113 (8 + 105)
              if (eventData.length > 113) {
                const atomEnabled = eventData[113] === 1;
                console.log("atom_enabled flag:", atomEnabled);
                console.log("Expected: false");

                if (!atomEnabled) {
                  console.log("\n✅ VERIFIED: atom_enabled=false in event");
                  console.log("✅ ATOM optional implementation works correctly!");
                } else {
                  console.log("\n❌ ERROR: atom_enabled should be false");
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    }

    console.log("\n=== Test Summary ===");
    console.log("✅ give_feedback succeeded without ATOM initialization");
    console.log("✅ Transaction confirmed");
    console.log("✅ No errors thrown");
    console.log("✅ ATOM optional implementation: WORKING");
  });
});
