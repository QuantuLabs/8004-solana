/**
 * Test Helpers for Agent Registry 8004
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

export const MAX_URI_LENGTH = 200;
export const MAX_TAG_LENGTH = 32;
export const MAX_METADATA_KEY_LENGTH = 32;
export const MAX_METADATA_VALUE_LENGTH = 256;
export const MAX_METADATA_ENTRIES = 1;

// ============================================================================
// PDA Derivation Helpers
// ============================================================================

/**
 * Derive config PDA: ["config"]
 */
export function getConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
}

/**
 * Derive validation stats PDA: ["validation_config"]
 */
export function getValidationStatsPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("validation_config")],
    programId
  );
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
 * Derive agent reputation PDA: ["agent_reputation", agent_id (u64 LE)]
 */
export function getAgentReputationPda(
  agentId: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("agent_reputation"),
      agentId.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive feedback PDA: ["feedback", agent_id (u64 LE), feedback_index (u64 LE)]
 */
export function getFeedbackPda(
  agentId: anchor.BN,
  feedbackIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback"),
      agentId.toArrayLike(Buffer, "le", 8),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive response index PDA: ["response_index", agent_id, feedback_index]
 */
export function getResponseIndexPda(
  agentId: anchor.BN,
  feedbackIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("response_index"),
      agentId.toArrayLike(Buffer, "le", 8),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive response PDA: ["response", agent_id, feedback_index, response_index]
 */
export function getResponsePda(
  agentId: anchor.BN,
  feedbackIndex: anchor.BN,
  responseIndex: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("response"),
      agentId.toArrayLike(Buffer, "le", 8),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
      responseIndex.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive validation request PDA: ["validation", agent_id, validator, nonce (u32 LE)]
 */
export function getValidationRequestPda(
  agentId: anchor.BN,
  validator: PublicKey,
  nonce: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("validation"),
      agentId.toArrayLike(Buffer, "le", 8),
      validator.toBuffer(),
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 4),
    ],
    programId
  );
}

/**
 * Derive metadata extension PDA: ["metadata_ext", asset, extension_index (u8)]
 */
export function getMetadataExtensionPda(
  asset: PublicKey,
  extensionIndex: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata_ext"),
      asset.toBuffer(),
      Buffer.from([extensionIndex]),
    ],
    programId
  );
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
