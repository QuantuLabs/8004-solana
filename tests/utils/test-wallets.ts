/**
 * Test Wallet Persistence
 *
 * Saves keypairs to disk immediately after generation to prevent fund loss
 * if tests crash before the after() hook can recover SOL.
 */
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const WALLETS_FILE = path.join(__dirname, "../../.test-wallets.json");

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

/**
 * Save test wallets to disk immediately after generation.
 * This ensures funds can be recovered if tests crash.
 */
export function saveTestWallets(wallets: Record<string, Keypair>): void {
  const data: WalletsFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    wallets: Object.entries(wallets).map(([name, kp]) => ({
      name,
      secretKey: Array.from(kp.secretKey),
      publicKey: kp.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
    })),
  };
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
  console.log(`   Saved ${data.wallets.length} test wallets to .test-wallets.json`);
}

/**
 * Load previously saved test wallets.
 * Returns null if no wallets file exists.
 */
export function loadTestWallets(): Record<string, Keypair> | null {
  if (!fs.existsSync(WALLETS_FILE)) return null;

  try {
    const content = fs.readFileSync(WALLETS_FILE, "utf8");
    const data: WalletsFile = JSON.parse(content);

    if (data.version !== 1) {
      console.warn("   Unknown wallets file version, generating new wallets");
      return null;
    }

    const wallets: Record<string, Keypair> = {};
    for (const w of data.wallets) {
      wallets[w.name] = Keypair.fromSecretKey(Uint8Array.from(w.secretKey));
    }

    console.log(`   Loaded ${data.wallets.length} test wallets from .test-wallets.json (created: ${data.createdAt})`);
    return wallets;
  } catch (err) {
    console.warn("   Failed to load wallets file:", err);
    return null;
  }
}

/**
 * Delete the wallets file after successful fund recovery.
 */
export function deleteTestWallets(): void {
  if (fs.existsSync(WALLETS_FILE)) {
    fs.unlinkSync(WALLETS_FILE);
    console.log("   Deleted .test-wallets.json after successful recovery");
  }
}

/**
 * Check if a wallets file exists (for recovery script).
 */
export function walletsFileExists(): boolean {
  return fs.existsSync(WALLETS_FILE);
}

/**
 * Get the path to the wallets file (for recovery script).
 */
export function getWalletsFilePath(): string {
  return WALLETS_FILE;
}
