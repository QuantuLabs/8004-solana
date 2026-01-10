/**
 * Stress Test - Localnet (No RPC Rate Limits)
 *
 * Measures the true config account write-lock contention
 * by running against a local validator.
 *
 * Results (2026-01-06):
 * - 100 agents: 100% success, ~126 TPS
 * - 250 agents: 73% success, ~119 TPS (HTTP fetch limit)
 * - 500 agents: 40% success, ~155 TPS (HTTP fetch limit)
 * - NO write-lock failures observed - all agent IDs sequential
 *
 * Run with:
 * 1. Start local validator with program and cloned accounts:
 *    solana-test-validator --reset \
 *      --bpf-program HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp target/deploy/agent_registry_8004.so \
 *      --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
 *      --clone 9PW9vG46gD4fZvv5ELTuCFF75uqtjAA9ahnxRvbpbJ1U \
 *      --clone 6Scfnr695Xi2yztHBMW2bt4FdMZFqi56bV2EGz3jnWWf \
 *      --url devnet
 *
 * 2. Run test:
 *    ANCHOR_PROVIDER_URL="http://127.0.0.1:8899" \
 *    ANCHOR_WALLET="~/.config/solana/id.json" \
 *    npx tsx tests/stress-test-localnet.ts
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
} from "@solana/web3.js";

// ============================================================================
// Configuration
// ============================================================================

const AGENT_COUNT = 100; // Test with 100 agents (100% success rate)
const LOCALNET_URL = "http://127.0.0.1:8899";

// Metaplex Core program ID
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

// ============================================================================
// Types
// ============================================================================

interface RegistrationResult {
  index: number;
  success: boolean;
  agentId?: number;
  signature?: string;
  error?: string;
  startTime: number;
  endTime: number;
}

// ============================================================================
// Main
// ============================================================================

async function runLocalnetStressTest() {
  console.log("\n========================================");
  console.log("  Localnet Stress Test - No RPC Limits");
  console.log("========================================\n");

  // Setup connection to localnet
  const connection = new Connection(LOCALNET_URL, "confirmed");

  // Check if localnet is running
  try {
    await connection.getVersion();
  } catch (e) {
    console.error("ERROR: Local validator not running!");
    console.error("Start it with: solana-test-validator --reset");
    process.exit(1);
  }

  // Setup provider
  process.env.ANCHOR_PROVIDER_URL = LOCALNET_URL;
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);

  // Airdrop SOL for testing
  const balance = await connection.getBalance(provider.wallet.publicKey);
  if (balance < 10 * LAMPORTS_PER_SOL) {
    console.log("\nAirdropping 100 SOL...");
    const sig = await connection.requestAirdrop(provider.wallet.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }

  const newBalance = await connection.getBalance(provider.wallet.publicKey);
  console.log(`Balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID
  );

  // Check if already initialized
  let collectionPubkey: PublicKey;
  let startingAgentId: number;

  try {
    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    startingAgentId = config.nextAgentId.toNumber();
    console.log(`\nRegistry already initialized`);
    console.log(`Collection: ${collectionPubkey.toBase58()}`);
    console.log(`Starting Agent ID: ${startingAgentId}`);
  } catch (e) {
    // Initialize registry
    console.log("\nInitializing registry...");
    const collectionKeypair = Keypair.generate();
    collectionPubkey = collectionKeypair.publicKey;

    try {
      await program.methods
        .initialize()
        .accounts({
          config: configPda,
          collection: collectionPubkey,
          authority: provider.wallet.publicKey,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([collectionKeypair])
        .rpc();

      console.log(`Collection created: ${collectionPubkey.toBase58()}`);
      startingAgentId = 0;
    } catch (initError) {
      console.error("Failed to initialize:", initError);
      process.exit(1);
    }
  }

  // Generate keypairs for all assets
  console.log(`\nGenerating ${AGENT_COUNT} asset keypairs...`);
  const assetKeypairs = Array(AGENT_COUNT).fill(null).map(() => Keypair.generate());

  // ============================================================================
  // BURST TEST - All at once
  // ============================================================================

  console.log(`\n--- BURST TEST: ${AGENT_COUNT} agents in parallel ---\n`);

  const burstStartTime = Date.now();

  const promises: Promise<RegistrationResult>[] = assetKeypairs.map(async (assetKeypair, index) => {
    const startTime = Date.now();

    try {
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), assetKeypair.publicKey.toBuffer()],
        program.programId
      );

      const signature = await program.methods
        .register(`ipfs://localnet-stress-${index}`)
        .accountsStrict({
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc({ skipPreflight: true });

      const agent = await program.account.agentAccount.fetch(agentPda);

      return {
        index,
        success: true,
        agentId: agent.agentId.toNumber(),
        signature,
        startTime,
        endTime: Date.now(),
      };
    } catch (error) {
      return {
        index,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        startTime,
        endTime: Date.now(),
      };
    }
  });

  const results = await Promise.all(promises);
  const burstEndTime = Date.now();

  // ============================================================================
  // Analysis
  // ============================================================================

  const totalDuration = (burstEndTime - burstStartTime) / 1000;
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  const effectiveTps = successes.length / totalDuration;

  console.log("========================================");
  console.log("  Results");
  console.log("========================================\n");

  console.log(`Total Duration: ${totalDuration.toFixed(2)}s`);
  console.log(`Success: ${successes.length}/${AGENT_COUNT} (${((successes.length / AGENT_COUNT) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failures.length}/${AGENT_COUNT}`);
  console.log(`Effective TPS: ${effectiveTps.toFixed(2)} agents/second`);

  // Agent IDs analysis
  if (successes.length > 0) {
    const agentIds = successes.map(s => s.agentId!).sort((a, b) => a - b);
    console.log(`\nAgent IDs: ${agentIds.slice(0, 10).join(", ")}${agentIds.length > 10 ? "..." : ""}`);
    console.log(`ID Range: ${Math.min(...agentIds)} - ${Math.max(...agentIds)}`);

    // Check for gaps
    const minId = Math.min(...agentIds);
    const maxId = Math.max(...agentIds);
    const expectedCount = maxId - minId + 1;
    const hasGaps = agentIds.length !== expectedCount;
    console.log(`Sequential: ${hasGaps ? "No (gaps detected)" : "Yes"}`);

    // Timing analysis
    const durations = successes.map(r => r.endTime - r.startTime);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    console.log(`\nTX Duration (ms):`);
    console.log(`  Min: ${minDuration}`);
    console.log(`  Max: ${maxDuration}`);
    console.log(`  Avg: ${avgDuration.toFixed(0)}`);
  }

  // Error breakdown
  if (failures.length > 0) {
    console.log("\n----------------------------------------");
    console.log("  Error Breakdown");
    console.log("----------------------------------------\n");

    const errorTypes: Record<string, number> = {};
    failures.forEach(f => {
      let errorKey = f.error || "Unknown";

      // Categorize errors
      if (errorKey.includes("already in use") || errorKey.includes("AccountInUse")) {
        errorKey = "Account write-lock contention";
      } else if (errorKey.includes("Blockhash")) {
        errorKey = "Blockhash expired";
      } else if (errorKey.includes("insufficient")) {
        errorKey = "Insufficient funds";
      } else if (errorKey.length > 80) {
        errorKey = errorKey.substring(0, 80) + "...";
      }

      errorTypes[errorKey] = (errorTypes[errorKey] || 0) + 1;
    });

    Object.entries(errorTypes)
      .sort(([, a], [, b]) => b - a)
      .forEach(([error, count]) => {
        console.log(`  ${count}x ${error}`);
      });
  }

  // Final state
  const finalConfig = await program.account.registryConfig.fetch(configPda);
  const finalAgentId = finalConfig.nextAgentId.toNumber();
  console.log(`\nFinal Agent ID: ${finalAgentId}`);
  console.log(`Total created this run: ${finalAgentId - startingAgentId}`);

  // ============================================================================
  // Summary
  // ============================================================================

  console.log("\n========================================");
  console.log("  Summary");
  console.log("========================================\n");

  if (failures.length > 0 && failures.some(f => f.error?.includes("write-lock") || f.error?.includes("AccountInUse"))) {
    console.log("CONFIG ACCOUNT WRITE-LOCK DETECTED!");
    console.log(`Max sustainable TPS: ~${effectiveTps.toFixed(0)} agents/second`);
  } else if (failures.length === 0) {
    console.log("All registrations succeeded!");
    console.log(`Achieved TPS: ${effectiveTps.toFixed(2)} agents/second`);
    console.log("\nThe config account handled the load.");
    console.log("Try increasing AGENT_COUNT to find the limit.");
  } else {
    console.log("Failures occurred but not due to write-lock contention.");
  }

  console.log("\n");
}

// Run
runLocalnetStressTest().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
