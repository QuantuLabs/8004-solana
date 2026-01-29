#!/usr/bin/env npx ts-node
/**
 * Deployment Script for 8004 Agent Registry + ATOM Engine
 *
 * Usage:
 *   npx ts-node scripts/deploy.ts --cluster localnet --full
 *   npx ts-node scripts/deploy.ts --cluster devnet --step init-atom
 *   npx ts-node scripts/deploy.ts --cluster devnet --step init-registry
 *   npx ts-node scripts/deploy.ts --cluster devnet --step init-validation
 *   npx ts-node scripts/deploy.ts --cluster devnet --step verify
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
  clusterApiUrl
} from "@solana/web3.js";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Constants
// ============================================================================

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

// ============================================================================
// PDA Helpers
// ============================================================================

function getRootConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("root_config")], programId);
}

function getRegistryConfigPda(collection: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry_config"), collection.toBuffer()],
    programId
  );
}

function getValidationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("validation_config")], programId);
}

function getAtomConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("atom_config")], programId);
}

function getProgramDataPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE);
}

// ============================================================================
// Config
// ============================================================================

interface DeployConfig {
  cluster: "localnet" | "devnet" | "mainnet";
  step?: "init-atom" | "init-registry" | "init-validation" | "verify" | "full";
  walletPath: string;
  skipDeploy?: boolean;
}

function parseArgs(): DeployConfig {
  const args = process.argv.slice(2);
  const config: DeployConfig = {
    cluster: "localnet",
    step: "full",
    walletPath: process.env.ANCHOR_WALLET ||
      path.join(process.env.HOME || "", ".config/solana/id.json"),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cluster" && args[i + 1]) {
      config.cluster = args[++i] as any;
    } else if (args[i] === "--step" && args[i + 1]) {
      config.step = args[++i] as any;
    } else if (args[i] === "--wallet" && args[i + 1]) {
      config.walletPath = args[++i];
    } else if (args[i] === "--skip-deploy") {
      config.skipDeploy = true;
    } else if (args[i] === "--full") {
      config.step = "full";
    }
  }

  return config;
}

function getClusterUrl(cluster: string): string {
  switch (cluster) {
    case "localnet":
      return "http://127.0.0.1:8899";
    case "devnet":
      return clusterApiUrl("devnet");
    case "mainnet":
      return clusterApiUrl("mainnet-beta");
    default:
      throw new Error(`Unknown cluster: ${cluster}`);
  }
}

// ============================================================================
// Deployment Steps
// ============================================================================

async function initializeAtomEngine(
  atomEngine: Program<AtomEngine>,
  registryProgramId: PublicKey,
  wallet: anchor.Wallet
): Promise<void> {
  const [atomConfigPda] = getAtomConfigPda(atomEngine.programId);
  const [programDataPda] = getProgramDataPda(atomEngine.programId);

  // Check if already initialized
  const accountInfo = await atomEngine.provider.connection.getAccountInfo(atomConfigPda);
  if (accountInfo !== null) {
    console.log("  ⚠️  AtomConfig already initialized - skipping");
    const config = await atomEngine.account.atomConfig.fetch(atomConfigPda);
    console.log("      Authority:", (config.authority as PublicKey).toBase58());
    console.log("      Registry:", (config.agentRegistryProgram as PublicKey).toBase58());
    return;
  }

  console.log("  📦 Initializing AtomConfig...");
  console.log("      PDA:", atomConfigPda.toBase58());
  console.log("      Registry Program:", registryProgramId.toBase58());
  console.log("      Program Data:", programDataPda.toBase58());

  const tx = await atomEngine.methods
    .initializeConfig(registryProgramId)
    .accountsStrict({
      config: atomConfigPda,
      authority: wallet.publicKey,
      programData: programDataPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("  ✅ AtomConfig initialized");
  console.log("      TX:", tx);
}

async function initializeRegistry(
  program: Program<AgentRegistry8004>,
  wallet: anchor.Wallet
): Promise<PublicKey> {
  const [rootConfigPda] = getRootConfigPda(program.programId);
  const [programDataPda] = getProgramDataPda(program.programId);

  // Check if already initialized
  const accountInfo = await program.provider.connection.getAccountInfo(rootConfigPda);
  if (accountInfo !== null) {
    console.log("  ⚠️  Registry already initialized - skipping");
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    console.log("      Authority:", (rootConfig.authority as PublicKey).toBase58());
    console.log("      Base Registry:", (rootConfig.baseRegistry as PublicKey).toBase58());

    // Return the collection from existing registry
    const registryConfig = await program.account.registryConfig.fetch(rootConfig.baseRegistry as PublicKey);
    return registryConfig.collection as PublicKey;
  }

  // Generate new collection keypair
  const collectionKeypair = Keypair.generate();
  const [registryConfigPda] = getRegistryConfigPda(collectionKeypair.publicKey, program.programId);

  console.log("  📦 Initializing Registry...");
  console.log("      Root Config PDA:", rootConfigPda.toBase58());
  console.log("      Registry Config PDA:", registryConfigPda.toBase58());
  console.log("      Collection:", collectionKeypair.publicKey.toBase58());
  console.log("      Program Data:", programDataPda.toBase58());

  const tx = await program.methods
    .initialize()
    .accountsStrict({
      rootConfig: rootConfigPda,
      registryConfig: registryConfigPda,
      collection: collectionKeypair.publicKey,
      authority: wallet.publicKey,
      programData: programDataPda,
      systemProgram: SystemProgram.programId,
      mplCoreProgram: MPL_CORE_PROGRAM_ID,
    })
    .signers([collectionKeypair])
    .rpc();

  console.log("  ✅ Registry initialized");
  console.log("      TX:", tx);

  // Save collection keypair for reference
  const collectionsDir = path.join(__dirname, "..", "collections");
  if (!fs.existsSync(collectionsDir)) {
    fs.mkdirSync(collectionsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(collectionsDir, `base-collection-${Date.now()}.json`),
    JSON.stringify(Array.from(collectionKeypair.secretKey))
  );
  console.log("  💾 Collection keypair saved to collections/");

  return collectionKeypair.publicKey;
}

async function initializeValidationConfig(
  program: Program<AgentRegistry8004>,
  wallet: anchor.Wallet
): Promise<void> {
  const [validationConfigPda] = getValidationConfigPda(program.programId);
  const [programDataPda] = getProgramDataPda(program.programId);

  // Check if already initialized
  const accountInfo = await program.provider.connection.getAccountInfo(validationConfigPda);
  if (accountInfo !== null) {
    console.log("  ⚠️  ValidationConfig already initialized - skipping");
    const config = await program.account.validationConfig.fetch(validationConfigPda);
    console.log("      Authority:", (config.authority as PublicKey).toBase58());
    console.log("      Total Requests:", config.totalRequests.toString());
    return;
  }

  console.log("  📦 Initializing ValidationConfig...");
  console.log("      PDA:", validationConfigPda.toBase58());
  console.log("      Program Data:", programDataPda.toBase58());

  const tx = await program.methods
    .initializeValidationConfig()
    .accountsStrict({
      config: validationConfigPda,
      authority: wallet.publicKey,
      programData: programDataPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("  ✅ ValidationConfig initialized");
  console.log("      TX:", tx);
}

async function verifyDeployment(
  program: Program<AgentRegistry8004>,
  atomEngine: Program<AtomEngine>
): Promise<boolean> {
  console.log("\n🔍 Verifying deployment...\n");

  let allGood = true;

  // Check AtomConfig
  const [atomConfigPda] = getAtomConfigPda(atomEngine.programId);
  try {
    const atomConfig = await atomEngine.account.atomConfig.fetch(atomConfigPda);
    console.log("✅ AtomConfig");
    console.log("   Authority:", (atomConfig.authority as PublicKey).toBase58());
    console.log("   Registry:", (atomConfig.agentRegistryProgram as PublicKey).toBase58());
  } catch (e) {
    console.log("❌ AtomConfig - NOT INITIALIZED");
    allGood = false;
  }

  // Check RootConfig
  const [rootConfigPda] = getRootConfigPda(program.programId);
  try {
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    console.log("✅ RootConfig");
    console.log("   Authority:", (rootConfig.authority as PublicKey).toBase58());
    console.log("   Base Registry:", (rootConfig.baseRegistry as PublicKey).toBase58());

    // Check RegistryConfig
    try {
      const registryConfig = await program.account.registryConfig.fetch(rootConfig.baseRegistry as PublicKey);
      console.log("✅ RegistryConfig");
      console.log("   Collection:", (registryConfig.collection as PublicKey).toBase58());
      console.log("   Type:", JSON.stringify(registryConfig.registryType));
    } catch (e) {
      console.log("❌ RegistryConfig - NOT FOUND");
      allGood = false;
    }
  } catch (e) {
    console.log("❌ RootConfig - NOT INITIALIZED");
    allGood = false;
  }

  // Check ValidationConfig
  const [validationConfigPda] = getValidationConfigPda(program.programId);
  try {
    const validationConfig = await program.account.validationConfig.fetch(validationConfigPda);
    console.log("✅ ValidationConfig");
    console.log("   Authority:", (validationConfig.authority as PublicKey).toBase58());
    console.log("   Total Requests:", validationConfig.totalRequests.toString());
    console.log("   Total Responses:", validationConfig.totalResponses.toString());
  } catch (e) {
    console.log("❌ ValidationConfig - NOT INITIALIZED");
    allGood = false;
  }

  return allGood;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║           8004 Agent Registry Deployment                   ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Cluster:  ${config.cluster}`);
  console.log(`Step:     ${config.step}`);
  console.log(`Wallet:   ${config.walletPath}\n`);

  // Load wallet
  if (!fs.existsSync(config.walletPath)) {
    throw new Error(`Wallet not found: ${config.walletPath}`);
  }
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(config.walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(walletKeypair);

  // Setup connection and provider
  const connection = new Connection(getClusterUrl(config.cluster), "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet:   ${wallet.publicKey.toBase58()}`);
  console.log(`Balance:  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("⚠️  Low balance! Consider adding more SOL.\n");
  }

  // Load programs
  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomEngine = anchor.workspace.AtomEngine as Program<AtomEngine>;

  console.log("Programs:");
  console.log(`  agent-registry-8004: ${program.programId.toBase58()}`);
  console.log(`  atom-engine:         ${atomEngine.programId.toBase58()}\n`);

  // Execute steps
  try {
    if (config.step === "full" || config.step === "init-atom") {
      console.log("━━━ Step 1: Initialize ATOM Engine ━━━");
      await initializeAtomEngine(atomEngine, program.programId, wallet);
      console.log();
    }

    if (config.step === "full" || config.step === "init-registry") {
      console.log("━━━ Step 2: Initialize Registry ━━━");
      await initializeRegistry(program, wallet);
      console.log();
    }

    if (config.step === "full" || config.step === "init-validation") {
      console.log("━━━ Step 3: Initialize ValidationConfig ━━━");
      await initializeValidationConfig(program, wallet);
      console.log();
    }

    if (config.step === "full" || config.step === "verify") {
      const verified = await verifyDeployment(program, atomEngine);
      console.log();
      if (verified) {
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("                    ✅ DEPLOYMENT COMPLETE                      ");
        console.log("═══════════════════════════════════════════════════════════════");
      } else {
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("              ⚠️  DEPLOYMENT INCOMPLETE                         ");
        console.log("      Run missing steps or check for errors above               ");
        console.log("═══════════════════════════════════════════════════════════════");
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
