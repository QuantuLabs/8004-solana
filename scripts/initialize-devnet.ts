/**
 * Initialize Identity Registry on Devnet
 * Creates the RegistryConfig account and Collection NFT
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import { homedir } from "os";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const IDENTITY_PROGRAM_ID = new PublicKey(
  "5euA2SjKFduF6FvXJuJdyqEo6ViAHMrw54CJB5PLaEJn"
);

async function main() {
  console.log("\n🚀 Initializing Identity Registry on Devnet\n");

  // Load wallet
  const keypairPath = `${homedir()}/.config/solana/id.json`;
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log(`🔑 Authority: ${wallet.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: "confirmed" }
  );

  // Load IDL
  const idlPath = "./target/idl/identity_registry.json";
  const idl = JSON.parse(readFileSync(idlPath, "utf-8"));
  const program = new Program(idl as any, provider);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error("Insufficient balance. Need at least 0.1 SOL");
  }

  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log(`📋 Config PDA: ${configPda.toBase58()}`);

  // Check if already initialized
  try {
    const configAccount = await connection.getAccountInfo(configPda);
    if (configAccount && configAccount.data.length === 97) { // 8 discriminator + 89 data
      console.log("✅ Registry already initialized!");
      const configData: any = await (program.account as any).registryConfig.fetch(configPda);
      console.log(`   Collection Mint: ${configData.collectionMint.toBase58()}`);
      console.log(`   Next Agent ID: ${configData.nextAgentId.toString()}`);
      console.log(`   Total Agents: ${configData.totalAgents.toString()}`);
      return;
    } else if (configAccount) {
      console.log(`⚠️  Old config found with ${configAccount.data.length} bytes (expected 97)`);
      console.log("   Proceeding with initialization...");
    }
  } catch (err) {
    console.log("   Config not found, proceeding with initialization...");
  }

  // Create collection NFT keypair
  const collectionMint = Keypair.generate();
  console.log(`🎨 Collection Mint: ${collectionMint.publicKey.toBase58()}`);

  // Derive Metaplex metadata PDAs
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.publicKey.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  // Get associated token account for collection
  const [collectionTokenAccount] = PublicKey.findProgramAddressSync(
    [
      wallet.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      collectionMint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("\n📝 Sending initialize transaction...");

  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        authority: wallet.publicKey,
        config: configPda,
        collectionMint: collectionMint.publicKey,
        collectionMetadata: collectionMetadata,
        collectionMasterEdition: collectionMasterEdition,
        collectionTokenAccount: collectionTokenAccount,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([collectionMint])
      .rpc();

    console.log(`\n✅ Registry initialized successfully!`);
    console.log(`📋 Transaction: ${tx}`);
    console.log(`🎨 Collection Mint: ${collectionMint.publicKey.toBase58()}`);

    // Wait for confirmation
    await connection.confirmTransaction(tx, "confirmed");

    // Fetch and display config
    const configData: any = await (program.account as any).registryConfig.fetch(configPda);
    console.log(`\n📊 Registry Config:`);
    console.log(`   Authority: ${configData.authority.toBase58()}`);
    console.log(`   Collection Mint: ${configData.collectionMint.toBase58()}`);
    console.log(`   Next Agent ID: ${configData.nextAgentId.toString()}`);
    console.log(`   Total Agents: ${configData.totalAgents.toString()}`);
    console.log(`   Bump: ${configData.bump}`);

    console.log("\n🎉 Devnet registry ready for agent registration!");
  } catch (error: any) {
    console.error("\n❌ Initialization failed:");
    if (error.logs) {
      console.error("Program logs:");
      error.logs.forEach((log: string) => console.error(`  ${log}`));
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
