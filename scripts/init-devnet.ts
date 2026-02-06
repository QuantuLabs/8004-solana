import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as anchor.Program<AgentRegistry8004>;
  const programId = program.programId;

  // Generate collection keypair
  const collection = Keypair.generate();

  // Derive PDAs (v0.6.0 single-collection architecture)
  const [rootConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("root_config")],
    programId
  );

  const [registryConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry_config"), collection.publicKey.toBuffer()],
    programId
  );

  // Derive program data PDA for upgrade authority verification
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  );

  console.log("=== Initializing Registry (v0.6.0 Single-Collection) ===");
  console.log("Program ID:", programId.toBase58());
  console.log("Root Config PDA:", rootConfigPda.toBase58());
  console.log("Registry Config PDA:", registryConfigPda.toBase58());
  console.log("Collection:", collection.publicKey.toBase58());
  console.log("Program Data PDA:", programDataPda.toBase58());
  console.log("Authority:", provider.wallet.publicKey.toBase58());

  try {
    const tx = await program.methods
      .initialize()
      .accountsPartial({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        collection: collection.publicKey,
        authority: provider.wallet.publicKey,
        programData: programDataPda,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([collection])
      .rpc();

    console.log("\nInitialize tx:", tx);

    // Fetch and display root config
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    console.log("\n=== Root Config ===");
    console.log("Authority:", rootConfig.authority.toBase58());
    console.log("Base Collection:", rootConfig.baseCollection.toBase58());
    console.log("Bump:", rootConfig.bump);

    // Fetch and display registry config
    const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
    console.log("\n=== Registry Config ===");
    console.log("Collection:", registryConfig.collection.toBase58());
    console.log("Authority:", registryConfig.authority.toBase58());
    console.log("Bump:", registryConfig.bump);

  } catch (e: any) {
    console.error("Error:", e.message);
    if (e.logs) console.error("Logs:", e.logs.join("\n"));
    throw e;
  }
}

main().then(() => {
  console.log("\nDone");
  process.exit(0);
}).catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
