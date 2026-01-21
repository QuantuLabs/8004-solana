/**
 * Initialize ATOM Engine Config on devnet
 * SECURITY: Only the program upgrade authority can call this
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const ATOM_PROGRAM_ID = new PublicKey("6Mu7qj6tRDrqchxJJPjr9V1H2XQjCerVKixFEEMwC1Tf");
const AGENT_REGISTRY_PROGRAM_ID = new PublicKey("6MuHv4dY4p9E4hSCEPr9dgbCSpMhq8x1vrUexbMVjfw1");
const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Derive ATOM Config PDA
  const [atomConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("atom_config")],
    ATOM_PROGRAM_ID
  );

  // Derive Program Data PDA (for upgrade authority verification)
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [ATOM_PROGRAM_ID.toBytes()],
    BPF_LOADER_UPGRADEABLE_ID
  );

  console.log("=== Initializing ATOM Engine Config ===");
  console.log("ATOM Program ID:", ATOM_PROGRAM_ID.toBase58());
  console.log("Agent Registry ID:", AGENT_REGISTRY_PROGRAM_ID.toBase58());
  console.log("ATOM Config PDA:", atomConfigPda.toBase58());
  console.log("Program Data PDA:", programDataPda.toBase58());
  console.log("Authority:", provider.wallet.publicKey.toBase58());

  // Check if already initialized
  const existingAccount = await provider.connection.getAccountInfo(atomConfigPda);
  if (existingAccount) {
    console.log("\nATOM Config already initialized!");
    console.log("Size:", existingAccount.data.length, "bytes");
    return;
  }

  // Load ATOM Engine IDL from file
  const idlPath = path.join(__dirname, "../target/idl/atom_engine.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const program = new anchor.Program(idl, provider);

  // Initialize config with agent registry program ID
  const tx = await program.methods
    .initializeConfig(AGENT_REGISTRY_PROGRAM_ID)
    .accounts({
      authority: provider.wallet.publicKey,
      config: atomConfigPda,
      programData: programDataPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nInitialize tx:", tx);
  console.log("\nATOM Config initialized successfully!");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
