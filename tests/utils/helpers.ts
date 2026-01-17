/**
 * Test Helpers for Agent Registry 8004 + ATOM Engine
 * Shared utilities, PDA derivation, and test data generators
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";

// ============================================================================
// Constants
// ============================================================================

export const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
);

export const ATOM_ENGINE_PROGRAM_ID = new PublicKey(
  "B8Q2nXG7FT89Uau3n41T2qcDLAWxcaQggGqwFWGCEpr7"
);

export const MAX_URI_LENGTH = 200;
export const MAX_TAG_LENGTH = 32;
export const MAX_METADATA_KEY_LENGTH = 32;
export const MAX_METADATA_VALUE_LENGTH = 256;
export const MAX_METADATA_ENTRIES = 1;

// Agent wallet key hash: sha256("agentWallet")[0..8]
export const AGENT_WALLET_KEY_HASH: Uint8Array = new Uint8Array([
  0x95, 0x54, 0xff, 0xa5, 0xcd, 0xc8, 0x74, 0x7a,
]);

// ============================================================================
// PDA Derivation Helpers
// ============================================================================

/**
 * Derive root config PDA: ["root_config"]
 */
export function getRootConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("root_config")],
    programId
  );
}

/**
 * Derive registry config PDA: ["registry_config", collection]
 */
export function getRegistryConfigPda(
  collection: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry_config"), collection.toBuffer()],
    programId
  );
}

/**
 * @deprecated Use getRootConfigPda and getRegistryConfigPda instead
 * Derive config PDA: ["config"]
 */
export function getConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
}

/**
 * Derive ValidationConfig PDA: ["validation_config"]
 * Required for request_validation and respond_to_validation instructions
 */
export function getValidationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("validation_config")],
    programId
  );
}

/**
 * @deprecated Use getValidationConfigPda instead
 */
export function getValidationStatsPda(programId: PublicKey): [PublicKey, number] {
  return getValidationConfigPda(programId);
}

/**
 * Derive agent PDA: ["agent", asset.key()]
 */
export function getAgentPda(
  asset: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), asset.toBuffer()],
    programId
  );
}

/**
 * Derive agent reputation PDA: ["agent_reputation", asset.key()]
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getAgentReputationPda(
  asset: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_reputation"), asset.toBuffer()],
    programId
  );
}

/**
 * Derive feedback PDA: ["feedback", asset.key(), feedback_index (u64 LE)]
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getFeedbackPda(
  asset: PublicKey,
  feedbackIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback"),
      asset.toBuffer(),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive feedback tags PDA: ["feedback_tags", asset.key(), feedback_index (u64 LE)]
 * Optional PDA created only when tags are set via setFeedbackTags
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getFeedbackTagsPda(
  asset: PublicKey,
  feedbackIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback_tags"),
      asset.toBuffer(),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive response index PDA: ["response_index", asset.key(), feedback_index]
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getResponseIndexPda(
  asset: PublicKey,
  feedbackIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("response_index"),
      asset.toBuffer(),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive response PDA: ["response", asset.key(), feedback_index, response_index]
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getResponsePda(
  asset: PublicKey,
  feedbackIndex: anchor.BN,
  responseIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("response"),
      asset.toBuffer(),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
      responseIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive validation request PDA: ["validation", asset.key(), validator, nonce (u32 LE)]
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getValidationRequestPda(
  asset: PublicKey,
  validator: PublicKey,
  nonce: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("validation"),
      asset.toBuffer(),
      validator.toBuffer(),
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 4),
    ],
    programId
  );
}

/**
 * Derive metadata entry PDA: ["agent_meta", asset.key(), key_hash (8 bytes)]
 * v0.3.0: Uses asset (Pubkey) instead of agent_id
 */
export function getMetadataEntryPda(
  asset: PublicKey,
  keyHash: Uint8Array,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("agent_meta"),
      asset.toBuffer(),
      Buffer.from(keyHash.slice(0, 8)),
    ],
    programId
  );
}

// NOTE: getWalletMetadataPda removed - wallet is now stored directly in AgentAccount

// ============================================================================
// ATOM Engine PDA Derivation Helpers
// ============================================================================

/**
 * Derive AtomConfig PDA: ["atom_config"]
 */
export function getAtomConfigPda(
  programId: PublicKey = ATOM_ENGINE_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("atom_config")],
    programId
  );
}

/**
 * Derive AtomStats PDA: ["atom_stats", asset.key()]
 */
export function getAtomStatsPda(
  asset: PublicKey,
  programId: PublicKey = ATOM_ENGINE_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("atom_stats"), asset.toBuffer()],
    programId
  );
}

// NOTE: getAtomCheckpointPda removed in v2.5c - checkpoints eliminated, events = source of truth

/**
 * Derive registry authority PDA for CPI signing to atom-engine: ["atom_cpi_authority"]
 * This PDA is derived from agent-registry and used to sign CPI calls
 */
export function getRegistryAuthorityPda(
  registryProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("atom_cpi_authority")],
    registryProgramId
  );
}

/**
 * Build the wallet set message for Ed25519 signature verification
 * Format: "8004_WALLET_SET:" || asset (32 bytes) || new_wallet (32 bytes) || owner (32 bytes) || deadline (8 bytes LE)
 * v0.3.0: Uses asset instead of agent_id
 */
export function buildWalletSetMessage(
  asset: PublicKey,
  newWallet: PublicKey,
  owner: PublicKey,
  deadline: anchor.BN
): Buffer {
  return Buffer.concat([
    Buffer.from("8004_WALLET_SET:"),
    asset.toBuffer(),
    newWallet.toBuffer(),
    owner.toBuffer(),
    deadline.toArrayLike(Buffer, "le", 8),
  ]);
}

/**
 * Compute key hash for metadata PDA derivation
 * Returns first 8 bytes of SHA256(key)
 */
export function computeKeyHash(key: string): Uint8Array {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(key).digest();
  return new Uint8Array(hash.slice(0, 8));
}

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate a random 32-byte hash
 */
export function randomHash(): Uint8Array {
  const hash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    hash[i] = Math.floor(Math.random() * 256);
  }
  return hash;
}

/**
 * Generate a random URI of specified length
 */
export function randomUri(length: number = 50): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const baseUri = "https://example.com/";
  let result = baseUri;
  const remainingLength = Math.max(0, length - baseUri.length);
  for (let i = 0; i < remainingLength; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random tag (max 32 chars)
 */
export function randomTag(length: number = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < Math.min(length, MAX_TAG_LENGTH); i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random metadata key (max 32 chars)
 */
export function randomMetadataKey(length: number = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyz_";
  let result = "";
  for (let i = 0; i < Math.min(length, MAX_METADATA_KEY_LENGTH); i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate random metadata value
 */
export function randomMetadataValue(length: number = 32): Buffer {
  const value = Buffer.alloc(Math.min(length, MAX_METADATA_VALUE_LENGTH));
  for (let i = 0; i < value.length; i++) {
    value[i] = Math.floor(Math.random() * 256);
  }
  return value;
}

/**
 * Generate a unique nonce based on timestamp
 */
export function uniqueNonce(): number {
  return Math.floor(Date.now() % 1000000) + Math.floor(Math.random() * 1000);
}

// ============================================================================
// Test Setup Helpers
// ============================================================================

/**
 * Create a string of exact length for boundary testing
 */
export function stringOfLength(length: number, char: string = "x"): string {
  return char.repeat(length);
}

/**
 * Create a URI of exact length for boundary testing
 */
export function uriOfLength(length: number): string {
  const prefix = "https://a.b/";
  if (length < prefix.length) {
    return "h".repeat(length);
  }
  return prefix + "x".repeat(length - prefix.length);
}

/**
 * Wait for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Airdrop SOL to a keypair (for testing on devnet/localnet)
 */
export async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  lamports: number = anchor.web3.LAMPORTS_PER_SOL
): Promise<void> {
  const signature = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(signature, "confirmed");
}

// ============================================================================
// Error Assertion Helpers
// ============================================================================

/**
 * Assert that a transaction throws an error with the expected code
 */
export async function expectError(
  promise: Promise<any>,
  expectedErrorCode: string
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected error ${expectedErrorCode} but transaction succeeded`);
  } catch (error: any) {
    const errorMessage = error.toString();
    if (!errorMessage.includes(expectedErrorCode)) {
      throw new Error(
        `Expected error ${expectedErrorCode} but got: ${errorMessage}`
      );
    }
  }
}

/**
 * Assert that a transaction throws an Anchor error with specific code
 */
export async function expectAnchorError(
  promise: Promise<any>,
  errorCode: number | string
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected Anchor error but transaction succeeded`);
  } catch (error: any) {
    if (error.error?.errorCode?.code) {
      if (error.error.errorCode.code !== errorCode) {
        throw new Error(
          `Expected error code ${errorCode} but got: ${error.error.errorCode.code}`
        );
      }
    } else if (error.message) {
      if (!error.message.includes(String(errorCode))) {
        throw new Error(
          `Expected error containing ${errorCode} but got: ${error.message}`
        );
      }
    } else {
      throw error;
    }
  }
}

// ============================================================================
// Account Fetch Helpers
// ============================================================================

/**
 * Check if an account exists
 */
export async function accountExists(
  connection: anchor.web3.Connection,
  pubkey: PublicKey
): Promise<boolean> {
  const account = await connection.getAccountInfo(pubkey);
  return account !== null;
}

/**
 * Get account balance in SOL
 */
export async function getBalanceSOL(
  connection: anchor.web3.Connection,
  pubkey: PublicKey
): Promise<number> {
  const balance = await connection.getBalance(pubkey);
  return balance / anchor.web3.LAMPORTS_PER_SOL;
}

// ============================================================================
// Funding Helpers (for stress tests)
// ============================================================================

/**
 * Fund a keypair with SOL via transfer from provider wallet
 * More reliable than airdrop for localnet stress testing
 */
export async function fundKeypair(
  provider: anchor.AnchorProvider,
  keypair: Keypair,
  lamports: number
): Promise<void> {
  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: keypair.publicKey,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx);
}

/**
 * Fund multiple keypairs in a single transaction (batched)
 * More efficient for stress tests with many wallets
 */
export async function fundKeypairs(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[],
  lamportsEach: number
): Promise<void> {
  // Ensure lamports is an integer for BigInt conversion
  const lamportsInt = Math.floor(lamportsEach);

  // Batch into transactions of max 10 transfers each (to avoid tx size limits)
  const BATCH_SIZE = 10;
  for (let i = 0; i < keypairs.length; i += BATCH_SIZE) {
    const batch = keypairs.slice(i, i + BATCH_SIZE);
    const tx = new anchor.web3.Transaction();
    for (const keypair of batch) {
      tx.add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: keypair.publicKey,
          lamports: lamportsInt,
        })
      );
    }
    await provider.sendAndConfirm(tx);
  }
}

/**
 * Return remaining SOL from keypairs back to provider wallet
 * Returns total lamports recovered
 */
export async function returnFunds(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[]
): Promise<number> {
  let totalRecovered = 0;
  const MIN_BALANCE = 5000; // Minimum to keep for rent exemption check

  for (const keypair of keypairs) {
    try {
      const balance = await provider.connection.getBalance(keypair.publicKey);
      if (balance > MIN_BALANCE) {
        // Leave some for transaction fee
        const transferAmount = balance - 5000;
        if (transferAmount > 0) {
          const tx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: provider.wallet.publicKey,
              lamports: transferAmount,
            })
          );
          await provider.sendAndConfirm(tx, [keypair]);
          totalRecovered += transferAmount;
        }
      }
    } catch (e) {
      // Ignore errors for keypairs that can't return funds
    }
  }
  return totalRecovered;
}
