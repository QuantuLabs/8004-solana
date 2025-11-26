/**
 * Emergency Recovery Script for Test Wallets
 *
 * Run this script if tests crash before the after() hook can recover funds.
 * Usage: npx ts-node scripts/recover-test-wallets.ts
 *
 * Or with custom RPC: ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" npx ts-node scripts/recover-test-wallets.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const WALLETS_FILE = path.join(__dirname, "../.test-wallets.json");

interface WalletData {
  name: string;
  secretKey: number[];
  publicKey: string;
  createdAt: string;
}

interface WalletsFile {
  version: 1;
  createdAt: string;
  wallets: WalletData[];
}

async function main() {
  console.log("\n🔄 Emergency Test Wallet Recovery\n");

  // Check if wallets file exists
  if (!fs.existsSync(WALLETS_FILE)) {
    console.log("No .test-wallets.json found. Nothing to recover.");
    console.log("This is normal if tests completed successfully.\n");
    return;
  }

  // Load wallets
  const content = fs.readFileSync(WALLETS_FILE, "utf8");
  const data: WalletsFile = JSON.parse(content);

  console.log(`Found wallets file created: ${data.createdAt}`);
  console.log(`Number of wallets: ${data.wallets.length}\n`);

  // Setup connection
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  console.log(`Using RPC: ${rpcUrl}\n`);

  // Load destination wallet (provider wallet)
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, ".config/solana/id.json");
  const destinationKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const destinationPubkey = destinationKeypair.publicKey;

  console.log(`Destination wallet: ${destinationPubkey.toBase58()}`);
  const destBalance = await connection.getBalance(destinationPubkey);
  console.log(`Destination balance: ${(destBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);

  // Check and recover from each wallet
  let totalRecovered = 0;
  const MIN_BALANCE = 5000; // Leave 5000 lamports for fees

  console.log("Wallet balances:");
  for (const w of data.wallets) {
    const keypair = Keypair.fromSecretKey(Uint8Array.from(w.secretKey));
    const balance = await connection.getBalance(keypair.publicKey);
    console.log(`  ${w.name}: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL (${w.publicKey.slice(0, 8)}...)`);

    if (balance > MIN_BALANCE) {
      try {
        const transferAmount = balance - MIN_BALANCE;
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: destinationPubkey,
            lamports: transferAmount,
          })
        );

        const sig = await connection.sendTransaction(tx, [keypair]);
        await connection.confirmTransaction(sig, "confirmed");
        totalRecovered += transferAmount;
        console.log(`    ✓ Recovered ${(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      } catch (err) {
        console.log(`    ✗ Failed to recover: ${(err as Error).message}`);
      }
    }
  }

  console.log(`\n💰 Total recovered: ${(totalRecovered / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  // Ask about deleting the file
  if (totalRecovered > 0) {
    console.log("\n✅ Recovery complete!");

    // Check final destination balance
    const finalBalance = await connection.getBalance(destinationPubkey);
    console.log(`Final destination balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Delete the wallets file
    fs.unlinkSync(WALLETS_FILE);
    console.log("\n🗑️  Deleted .test-wallets.json\n");
  } else {
    console.log("\n⚠️  No funds to recover. Wallets might be empty.");
    console.log("Keeping .test-wallets.json for investigation.\n");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
