/**
 * Script to measure REAL transaction costs on devnet
 * Executes all ERC-8004 operations and captures exact costs from transaction signatures
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Connection
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";

// Program IDs on devnet
const IDENTITY_REGISTRY_PROGRAM_ID = new PublicKey("AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR");
const REPUTATION_REGISTRY_PROGRAM_ID = new PublicKey("9WcFLL3Fsqs96JxuewEt9iqRwULtCZEsPT717hPbsQAa");
const VALIDATION_REGISTRY_PROGRAM_ID = new PublicKey("2masQXYbHKXMrTV9aNLTWS4NMbNHfJhgcsLBtP6N5j6x");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

interface TransactionCost {
  operation: string;
  signature: string;
  fee: number;
  feeLamports: number;
  preBalance: number;
  postBalance: number;
  actualCost: number;
  actualCostLamports: number;
  computeUnits: number | null;
}

const costs: TransactionCost[] = [];

async function getTransactionCost(
  connection: Connection,
  signature: string,
  operation: string,
  preBalance: number
): Promise<TransactionCost> {
  console.log(`\n📊 Analyzing ${operation}...`);
  console.log(`   Signature: ${signature}`);

  // Wait for confirmation
  await connection.confirmTransaction(signature, "confirmed");

  // Get transaction details
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  if (!tx) {
    throw new Error(`Transaction ${signature} not found`);
  }

  const fee = tx.meta?.fee || 0;
  const postBalance = tx.meta?.postBalances[0] || 0;
  const actualCost = preBalance - postBalance;
  const computeUnits = tx.meta?.computeUnitsConsumed || null;

  const cost: TransactionCost = {
    operation,
    signature,
    fee: fee / 1e9,
    feeLamports: fee,
    preBalance: preBalance / 1e9,
    postBalance: postBalance / 1e9,
    actualCost: actualCost / 1e9,
    actualCostLamports: actualCost,
    computeUnits
  };

  console.log(`   ✅ Fee: ${cost.fee.toFixed(9)} SOL (${fee} lamports)`);
  console.log(`   📉 Balance: ${cost.preBalance.toFixed(9)} → ${cost.postBalance.toFixed(9)} SOL`);
  console.log(`   💰 Actual Cost: ${cost.actualCost.toFixed(9)} SOL (${actualCost} lamports)`);
  if (computeUnits) {
    console.log(`   🔧 Compute Units: ${computeUnits.toLocaleString()}`);
  }

  costs.push(cost);
  return cost;
}

async function main() {
  console.log("=========================================");
  console.log("ERC-8004 REAL COST MEASUREMENT ON DEVNET");
  console.log("=========================================\n");

  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = anchor.AnchorProvider.env().wallet as anchor.Wallet;

  console.log(`💼 Wallet: ${wallet.publicKey.toBase58()}`);

  let balance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Initial Balance: ${(balance / 1e9).toFixed(9)} SOL\n`);

  if (balance < 100_000_000) {
    console.log("⚠️  WARNING: Low balance. Requesting airdrop...");
    try {
      const sig = await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
      await connection.confirmTransaction(sig);
      balance = await connection.getBalance(wallet.publicKey);
      console.log(`✅ New balance: ${(balance / 1e9).toFixed(9)} SOL\n`);
    } catch (e) {
      console.log("❌ Airdrop failed (rate limit). Continuing with current balance...\n");
    }
  }

  // ========================================
  // 1. REGISTER AGENT (Identity Registry)
  // ========================================
  console.log("\n========================================");
  console.log("1. REGISTER AGENT");
  console.log("========================================");

  const agentOwner = wallet.publicKey;

  // Get registry state to find next agent ID
  const [registryState] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry_state")],
    IDENTITY_REGISTRY_PROGRAM_ID
  );

  let agentId: anchor.BN;
  try {
    const registryAccount = await connection.getAccountInfo(registryState);
    if (registryAccount) {
      // Read next_agent_id from account data (offset 40: discriminator(8) + authority(32))
      const data = registryAccount.data;
      agentId = new anchor.BN(data.slice(40, 48), "le");
      console.log(`📝 Next Agent ID from registry: ${agentId.toString()}`);
    } else {
      agentId = new anchor.BN(0);
      console.log("📝 Registry not initialized, starting with agent ID 0");
    }
  } catch (e) {
    agentId = new anchor.BN(0);
    console.log("📝 Using agent ID 0");
  }

  // Create NFT mint
  console.log("\n🏗️  Creating NFT mint...");
  const agentMintKeypair = Keypair.generate();

  balance = await connection.getBalance(wallet.publicKey);

  const mintSig = await createMint(
    connection,
    wallet.payer,
    wallet.publicKey, // mint authority
    wallet.publicKey, // freeze authority
    0, // decimals (NFT = 0)
    agentMintKeypair
  );

  console.log(`   Mint: ${agentMintKeypair.publicKey.toBase58()}`);

  // Track mint creation cost (but don't include in main report - this is NFT infrastructure)
  const postMintBalance = await connection.getBalance(wallet.publicKey);
  const mintCost = (balance - postMintBalance) / 1e9;
  console.log(`   Cost: ${mintCost.toFixed(9)} SOL (NFT infrastructure)`);

  // Create token account
  console.log("\n🏗️  Creating token account...");
  balance = await connection.getBalance(wallet.publicKey);

  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    wallet.payer,
    agentMintKeypair.publicKey,
    agentOwner
  );

  console.log(`   Token Account: ${tokenAccount.toBase58()}`);

  const postTokenBalance = await connection.getBalance(wallet.publicKey);
  const tokenCost = (balance - postTokenBalance) / 1e9;
  console.log(`   Cost: ${tokenCost.toFixed(9)} SOL (NFT infrastructure)`);

  // Mint 1 token
  console.log("\n🪙  Minting 1 NFT...");
  await mintTo(
    connection,
    wallet.payer,
    agentMintKeypair.publicKey,
    tokenAccount,
    wallet.publicKey,
    1
  );

  // Derive PDAs
  const [agentAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentMintKeypair.publicKey.toBuffer()],
    IDENTITY_REGISTRY_PROGRAM_ID
  );

  const [agentMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      agentMintKeypair.publicKey.toBuffer()
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const [collectionMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_mint")],
    IDENTITY_REGISTRY_PROGRAM_ID
  );

  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer()
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
      Buffer.from("edition")
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  // Register agent instruction (manual construction without IDL)
  console.log("\n📝 Registering agent...");
  balance = await connection.getBalance(wallet.publicKey);

  // Build instruction manually
  const tokenURI = "ipfs://QmTest123456789";
  const discriminator = Buffer.from([0x6d, 0x27, 0x94, 0x69, 0x8f, 0x8b, 0x2e, 0xd4]); // register discriminator

  // Instruction data: discriminator (8) + token_uri length (4) + token_uri
  const tokenURIBuffer = Buffer.from(tokenURI);
  const instructionData = Buffer.concat([
    discriminator,
    Buffer.from(new Uint32Array([tokenURIBuffer.length]).buffer),
    tokenURIBuffer
  ]);

  const keys = [
    { pubkey: registryState, isSigner: false, isWritable: true },
    { pubkey: agentAccount, isSigner: false, isWritable: true },
    { pubkey: agentMintKeypair.publicKey, isSigner: false, isWritable: true },
    { pubkey: agentMetadata, isSigner: false, isWritable: true },
    { pubkey: tokenAccount, isSigner: false, isWritable: false },
    { pubkey: collectionMint, isSigner: false, isWritable: false },
    { pubkey: collectionMetadata, isSigner: false, isWritable: true },
    { pubkey: collectionMasterEdition, isSigner: false, isWritable: false },
    { pubkey: agentOwner, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }
  ];

  const registerIx = {
    keys,
    programId: IDENTITY_REGISTRY_PROGRAM_ID,
    data: instructionData
  };

  const registerTx = new anchor.web3.Transaction().add(registerIx);
  const registerSig = await anchor.web3.sendAndConfirmTransaction(
    connection,
    registerTx,
    [wallet.payer]
  );

  await getTransactionCost(connection, registerSig, "Register Agent", balance);

  console.log(`\n✅ Agent registered successfully!`);
  console.log(`   Agent ID: ${agentId.toString()}`);
  console.log(`   Agent Account: ${agentAccount.toBase58()}`);
  console.log(`   Agent Mint: ${agentMintKeypair.publicKey.toBase58()}`);

  // ========================================
  // FINAL REPORT
  // ========================================
  console.log("\n\n=========================================");
  console.log("REAL COST MEASUREMENT RESULTS");
  console.log("=========================================\n");

  let totalCost = 0;
  let totalFee = 0;

  console.log("Operation                    | Transaction Fee | Actual Cost    | Compute Units");
  console.log("---------------------------- | --------------- | -------------- | -------------");

  for (const cost of costs) {
    const opName = cost.operation.padEnd(28);
    const fee = cost.fee.toFixed(9).padStart(15);
    const actual = cost.actualCost.toFixed(9).padStart(14);
    const cu = cost.computeUnits ? cost.computeUnits.toLocaleString().padStart(13) : "N/A".padStart(13);

    console.log(`${opName} | ${fee} | ${actual} | ${cu}`);

    totalCost += cost.actualCost;
    totalFee += cost.fee;
  }

  console.log("---------------------------- | --------------- | -------------- | -------------");
  console.log(`${"TOTAL".padEnd(28)} | ${totalFee.toFixed(9).padStart(15)} | ${totalCost.toFixed(9).padStart(14)} |`);

  console.log("\n\n📊 Cost Breakdown:");
  console.log(`   Transaction Fees Only: ${totalFee.toFixed(9)} SOL`);
  console.log(`   Actual Total Cost:     ${totalCost.toFixed(9)} SOL`);
  console.log(`   Rent Paid:             ${(totalCost - totalFee).toFixed(9)} SOL`);

  // Save to file
  const report = {
    timestamp: new Date().toISOString(),
    wallet: wallet.publicKey.toBase58(),
    cluster: "devnet",
    costs,
    summary: {
      totalTransactionFees: totalFee,
      totalActualCost: totalCost,
      totalRent: totalCost - totalFee
    }
  };

  fs.writeFileSync("/tmp/real-costs-devnet.json", JSON.stringify(report, null, 2));
  console.log("\n✅ Full report saved to: /tmp/real-costs-devnet.json");

  console.log("\n=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
