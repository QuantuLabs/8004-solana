/**
 * Stress Test TPS - Simulation Mint Collection
 *
 * Tests the write-lock contention on the config account
 * by registering multiple agents in parallel.
 *
 * Run with:
 * ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
 * ANCHOR_WALLET="/Users/true/.config/solana/id.json" \
 * npx tsx tests/stress-test-tps.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Connection,
  sendAndConfirmTransaction,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";

// ============================================================================
// Configuration
// ============================================================================

const AGENT_COUNT = 30; // Number of agents to register
const BATCH_SIZE = 10; // Agents per batch (to avoid RPC rate limits)
const BATCH_DELAY_MS = 1000; // Delay between batches
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

// Metaplex Core program ID
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// ============================================================================
// Types
// ============================================================================

interface RegistrationResult {
  index: number;
  success: boolean;
  agentId?: number;
  asset?: string;
  signature?: string;
  error?: string;
  duration?: number;
}

// ============================================================================
// Main
// ============================================================================

async function runStressTest() {
  console.log("\n========================================");
  console.log("  TPS Stress Test - Agent Registration");
  console.log("========================================\n");

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const connection = provider.connection;

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // Get current state
  const config = await program.account.registryConfig.fetch(configPda);
  const startingAgentId = config.nextAgentId.toNumber();
  const collectionPubkey = config.collection;

  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Collection: ${collectionPubkey.toBase58()}`);
  console.log(`Starting Agent ID: ${startingAgentId}`);
  console.log(`Agents to create: ${AGENT_COUNT}`);

  // Check balance
  const balance = await connection.getBalance(provider.wallet.publicKey);
  const requiredSol = AGENT_COUNT * 0.007;
  console.log(`\nWallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Required: ~${requiredSol.toFixed(3)} SOL`);

  if (balance < requiredSol * LAMPORTS_PER_SOL) {
    console.error("\nInsufficient balance! Aborting.");
    process.exit(1);
  }

  // Generate keypairs for all assets
  console.log(`\nGenerating ${AGENT_COUNT} asset keypairs...`);
  const assetKeypairs = Array(AGENT_COUNT).fill(null).map(() => Keypair.generate());

  // Build promises for parallel execution
  console.log(`\nSending ${AGENT_COUNT} registration transactions in parallel...`);
  console.log("This will test config account write-lock contention.\n");

  const startTime = Date.now();

  const promises: Promise<RegistrationResult>[] = assetKeypairs.map(async (assetKeypair, index) => {
    const txStartTime = Date.now();

    try {
      // Derive agent PDA
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), assetKeypair.publicKey.toBuffer()],
        program.programId
      );

      const agentUri = `ipfs://stress-test-${Date.now()}-${index}`;

      // Register with retry
      const signature = await program.methods
        .register(agentUri)
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc({ skipPreflight: true }); // Skip preflight for faster submission

      // Fetch agent to get assigned ID
      const agent = await program.account.agentAccount.fetch(agentPda);

      return {
        index,
        success: true,
        agentId: agent.agentId.toNumber(),
        asset: assetKeypair.publicKey.toBase58(),
        signature,
        duration: Date.now() - txStartTime,
      };
    } catch (error) {
      return {
        index,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - txStartTime,
      };
    }
  });

  // Execute all in parallel
  const results = await Promise.all(promises);
  const endTime = Date.now();

  // ============================================================================
  // Analysis
  // ============================================================================

  const totalDuration = (endTime - startTime) / 1000;
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  const tps = successes.length / totalDuration;

  console.log("\n========================================");
  console.log("  Results");
  console.log("========================================\n");

  console.log(`Total Duration: ${totalDuration.toFixed(2)}s`);
  console.log(`Success: ${successes.length}/${AGENT_COUNT} (${((successes.length / AGENT_COUNT) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failures.length}/${AGENT_COUNT}`);
  console.log(`Effective TPS: ${tps.toFixed(2)} agents/second`);

  // Agent IDs analysis
  if (successes.length > 0) {
    const agentIds = successes
      .map(s => s.agentId!)
      .sort((a, b) => a - b);

    console.log(`\nAgent IDs assigned: ${agentIds.slice(0, 5).join(", ")}${agentIds.length > 5 ? "..." : ""}`);
    console.log(`ID Range: ${Math.min(...agentIds)} - ${Math.max(...agentIds)}`);

    // Check for gaps (non-sequential)
    const expectedIds = Array.from({ length: successes.length }, (_, i) => startingAgentId + i);
    const hasGaps = !agentIds.every((id, i) => agentIds.includes(startingAgentId + i));
    console.log(`Sequential: ${hasGaps ? "No (gaps detected)" : "Yes"}`);
  }

  // Average duration per successful tx
  if (successes.length > 0) {
    const avgDuration = successes.reduce((sum, r) => sum + (r.duration || 0), 0) / successes.length;
    console.log(`\nAvg TX Duration: ${(avgDuration / 1000).toFixed(2)}s`);
  }

  // Error breakdown
  if (failures.length > 0) {
    console.log("\n----------------------------------------");
    console.log("  Error Breakdown");
    console.log("----------------------------------------\n");

    const errorTypes: Record<string, number> = {};
    failures.forEach(f => {
      // Extract key error type
      let errorKey = f.error || "Unknown";

      // Categorize common errors
      if (errorKey.includes("account in use")) {
        errorKey = "account in use (write-lock)";
      } else if (errorKey.includes("Blockhash not found")) {
        errorKey = "Blockhash expired";
      } else if (errorKey.includes("Transaction simulation failed")) {
        errorKey = "Simulation failed";
      } else if (errorKey.includes("insufficient funds")) {
        errorKey = "Insufficient funds";
      } else if (errorKey.length > 60) {
        errorKey = errorKey.substring(0, 60) + "...";
      }

      errorTypes[errorKey] = (errorTypes[errorKey] || 0) + 1;
    });

    Object.entries(errorTypes)
      .sort(([, a], [, b]) => b - a)
      .forEach(([error, count]) => {
        console.log(`  ${count}x ${error}`);
      });
  }

  // Summary
  console.log("\n========================================");
  console.log("  Summary");
  console.log("========================================\n");

  if (failures.length > 0) {
    console.log("The config account write-lock contention is visible.");
    console.log("When multiple transactions try to increment next_agent_id");
    console.log("simultaneously, some will fail due to account locks.\n");

    console.log("To improve throughput, consider:");
    console.log("  1. Sequential registration (reliable but slow)");
    console.log("  2. Batching with delays between batches");
    console.log("  3. Sharding (future architecture change)");
  } else {
    console.log("All registrations succeeded!");
    console.log("Either the burst wasn't large enough to trigger");
    console.log("significant contention, or the network handled it well.");
  }

  // Verify final state
  const finalConfig = await program.account.registryConfig.fetch(configPda);
  const finalAgentId = finalConfig.nextAgentId.toNumber();
  console.log(`\nFinal Agent ID: ${finalAgentId} (created ${finalAgentId - startingAgentId} agents)`);

  // Cost analysis
  const endBalance = await connection.getBalance(provider.wallet.publicKey);
  const costSol = (balance - endBalance) / LAMPORTS_PER_SOL;
  console.log(`Total Cost: ${costSol.toFixed(4)} SOL`);
  console.log(`Cost per Success: ${(costSol / Math.max(successes.length, 1)).toFixed(4)} SOL`);

  console.log("\n");
}

// Run
runStressTest().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
