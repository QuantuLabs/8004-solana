/**
 * Attack Helpers for ATOM Engine Security Testing
 * Utilities for generating crafted wallets and simulating attacks
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";

// HLL Constants (must match atom-engine/src/params.rs)
const HLL_REGISTERS = 256; // ATOM uses 256 registers (4-bit packed = 128 bytes)
const HLL_MAX_RHO = 15;

// ============================================================================
// HASH FUNCTIONS (matching Rust implementation)
// ============================================================================

/**
 * Keccak256 hash of pubkey bytes (matches Rust keccak256)
 */
export function keccak256(data: Uint8Array): Uint8Array {
  return new Uint8Array(
    crypto.createHash("sha3-256").update(data).digest()
  );
}

/**
 * SplitMix64 64-bit fingerprint (matches Rust splitmix64_fp64)
 * This is what the on-chain code actually uses for burst detection
 */
export function splitmix64Fp64(pubkeyBytes: Uint8Array): bigint {
  // Take first 8 bytes as u64 (little-endian)
  const bytes = pubkeyBytes.slice(0, 8);
  let z = BigInt(0);
  for (let i = 0; i < 8; i++) {
    z |= BigInt(bytes[i]) << BigInt(i * 8);
  }

  // SplitMix64 algorithm
  z = (z + BigInt("0x9e3779b97f4a7c15")) & BigInt("0xffffffffffffffff");
  z = ((z ^ (z >> BigInt(30))) * BigInt("0xbf58476d1ce4e5b9")) & BigInt("0xffffffffffffffff");
  z = ((z ^ (z >> BigInt(27))) * BigInt("0x94d049bb133111eb")) & BigInt("0xffffffffffffffff");
  z = (z ^ (z >> BigInt(31))) & BigInt("0xffffffffffffffff");

  return z;
}

/**
 * SplitMix64 16-bit fingerprint (DEPRECATED - on-chain uses fp64)
 * Kept for backward compatibility with existing tests
 */
export function splitmix64Fp16(pubkeyBytes: Uint8Array): number {
  return Number(splitmix64Fp64(pubkeyBytes) & BigInt(0xFFFF));
}

/**
 * Compute HLL register index and rho value for a client hash
 */
export function computeHllRegisterAndRho(clientHash: Uint8Array): { register: number; rho: number } {
  // Hash the client hash with keccak256
  const h = keccak256(clientHash);

  // Convert first 8 bytes to u64
  let hValue = BigInt(0);
  for (let i = 0; i < 8; i++) {
    hValue |= BigInt(h[i]) << BigInt(i * 8);
  }

  // Register index = h % HLL_REGISTERS
  const register = Number(hValue % BigInt(HLL_REGISTERS));

  // Rho calculation
  const remaining = hValue / BigInt(HLL_REGISTERS);
  let rho: number;
  if (remaining === BigInt(0)) {
    rho = HLL_MAX_RHO;
  } else {
    // Count leading zeros + 1, capped at HLL_MAX_RHO
    const leadingZeros = 64 - remaining.toString(2).length;
    rho = Math.min(leadingZeros + 1, HLL_MAX_RHO);
  }

  return { register, rho };
}

// ============================================================================
// WALLET GENERATION FOR ATTACKS
// ============================================================================

/**
 * Generate a keypair with a hash that falls into a specific HLL register
 * Returns null if no match found after maxAttempts
 */
export function generateKeypairForRegister(
  targetRegister: number,
  maxAttempts: number = 100000
): Keypair | null {
  for (let i = 0; i < maxAttempts; i++) {
    const keypair = Keypair.generate();
    const clientHash = crypto.createHash("sha256").update(keypair.publicKey.toBytes()).digest();
    const { register } = computeHllRegisterAndRho(new Uint8Array(clientHash));

    if (register === targetRegister) {
      return keypair;
    }
  }
  return null;
}

/**
 * Generate N keypairs that all fall into the same HLL register
 * For testing HLL collision attacks
 */
export function generateCollidingKeypairs(
  count: number,
  targetRegister?: number,
  maxAttemptsPerKey: number = 50000
): Keypair[] {
  const keypairs: Keypair[] = [];

  // If no target register specified, find the first one
  if (targetRegister === undefined) {
    const firstKey = Keypair.generate();
    const clientHash = crypto.createHash("sha256").update(firstKey.publicKey.toBytes()).digest();
    const { register } = computeHllRegisterAndRho(new Uint8Array(clientHash));
    targetRegister = register;
    keypairs.push(firstKey);
  }

  while (keypairs.length < count) {
    const key = generateKeypairForRegister(targetRegister, maxAttemptsPerKey);
    if (key) {
      keypairs.push(key);
    } else {
      console.warn(`Failed to find keypair for register ${targetRegister} after ${maxAttemptsPerKey} attempts`);
      break;
    }
  }

  return keypairs;
}

/**
 * Generate keypairs with zero-remainder hash (h < HLL_REGISTERS)
 * These will all have rho = HLL_MAX_RHO
 */
export function generateZeroRemainderKeypairs(
  count: number,
  maxAttemptsPerKey: number = 100000
): Keypair[] {
  const keypairs: Keypair[] = [];
  const usedRegisters = new Set<number>();

  while (keypairs.length < count && usedRegisters.size < HLL_REGISTERS) {
    for (let i = 0; i < maxAttemptsPerKey; i++) {
      const keypair = Keypair.generate();
      const clientHash = crypto.createHash("sha256").update(keypair.publicKey.toBytes()).digest();
      const { register, rho } = computeHllRegisterAndRho(new Uint8Array(clientHash));

      // We want keys that produce rho = HLL_MAX_RHO (zero remainder)
      // AND target different registers for maximum HLL inflation
      if (rho === HLL_MAX_RHO && !usedRegisters.has(register)) {
        keypairs.push(keypair);
        usedRegisters.add(register);
        break;
      }
    }

    if (keypairs.length === 0 && usedRegisters.size === 0) {
      console.warn("No zero-remainder keypairs found");
      break;
    }
  }

  return keypairs;
}

/**
 * Generate keypairs with matching 64-bit fingerprints (for burst detector bypass)
 *
 * NOTE: With 64-bit fingerprints, birthday attack requires ~2^32 attempts
 * for first collision - this is INFEASIBLE in practice.
 * This function is kept for completeness but will almost never find collisions.
 *
 * For 16-bit collision testing (deprecated), use generateFingerprintCollisionKeypairs16
 */
export function generateFingerprintCollisionKeypairs(
  count: number = 2,
  maxAttempts: number = 1000
): { keypairs: Keypair[]; fingerprint: bigint } | null {
  const fingerprintMap = new Map<string, Keypair[]>();

  for (let i = 0; i < maxAttempts; i++) {
    const keypair = Keypair.generate();
    const fp = splitmix64Fp64(keypair.publicKey.toBytes());
    const fpStr = fp.toString();  // Use string key for Map with BigInt

    if (!fingerprintMap.has(fpStr)) {
      fingerprintMap.set(fpStr, []);
    }
    fingerprintMap.get(fpStr)!.push(keypair);

    if (fingerprintMap.get(fpStr)!.length >= count) {
      return {
        keypairs: fingerprintMap.get(fpStr)!.slice(0, count),
        fingerprint: fp,
      };
    }
  }

  return null;
}

/**
 * Generate keypairs with matching 16-bit fingerprints (DEPRECATED)
 * Only for testing - on-chain uses 64-bit fingerprints
 */
export function generateFingerprintCollisionKeypairs16(
  count: number = 2,
  maxAttempts: number = 1000
): { keypairs: Keypair[]; fingerprint: number } | null {
  const fingerprintMap = new Map<number, Keypair[]>();

  for (let i = 0; i < maxAttempts; i++) {
    const keypair = Keypair.generate();
    const fp = splitmix64Fp16(keypair.publicKey.toBytes());

    if (!fingerprintMap.has(fp)) {
      fingerprintMap.set(fp, []);
    }
    fingerprintMap.get(fp)!.push(keypair);

    if (fingerprintMap.get(fp)!.length >= count) {
      return {
        keypairs: fingerprintMap.get(fp)!.slice(0, count),
        fingerprint: fp,
      };
    }
  }

  return null;
}

/**
 * Generate N unique keypairs with distinct fingerprints
 * For ring buffer bypass (need at least 4 unique fps)
 * Uses 64-bit fingerprints (matches on-chain code)
 */
export function generateDistinctFingerprintKeypairs(count: number): Keypair[] {
  const keypairs: Keypair[] = [];
  const usedFingerprints = new Set<string>();  // String for BigInt keys

  while (keypairs.length < count) {
    const keypair = Keypair.generate();
    const fp = splitmix64Fp64(keypair.publicKey.toBytes()).toString();

    if (!usedFingerprints.has(fp)) {
      keypairs.push(keypair);
      usedFingerprints.add(fp);
    }
  }

  return keypairs;
}

// ============================================================================
// CLIENT HASH GENERATION
// ============================================================================

/**
 * Generate a client hash from a keypair (matches give_feedback behavior)
 */
export function generateClientHash(keypair: Keypair): Uint8Array {
  return new Uint8Array(
    crypto.createHash("sha256").update(keypair.publicKey.toBytes()).digest()
  );
}

/**
 * Generate N random client hashes
 */
export function generateRandomClientHashes(count: number): Uint8Array[] {
  const hashes: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const keypair = Keypair.generate();
    hashes.push(generateClientHash(keypair));
  }
  return hashes;
}

// ============================================================================
// ATTACK SIMULATION HELPERS
// ============================================================================

/**
 * Calculate how many feedbacks needed to "whitewash" a bad score
 * Uses EMA formula: new_ema = alpha * new_score + (1-alpha) * old_ema
 */
export function calculateWhitewashFeedbacks(
  badScore: number,
  targetScore: number,
  washScore: number,
  alphaFast: number = 30,  // 0.30 as percentage
): number {
  let ema = badScore * 100;  // Scale to 0-10000
  const target = targetScore * 100;
  const wash = washScore * 100;
  let count = 0;

  while (ema < target && count < 1000) {
    ema = Math.floor((alphaFast * wash + (100 - alphaFast) * ema) / 100);
    count++;
  }

  return count;
}

/**
 * Calculate burst pressure decay
 * pressure = (alpha_down * pressure) / 100 per update
 */
export function calculateBurstDecay(
  startPressure: number,
  updates: number,
  alphaDown: number = 70,
): number {
  let pressure = startPressure;
  for (let i = 0; i < updates; i++) {
    pressure = Math.floor((alphaDown * pressure) / 100);
  }
  return pressure;
}

/**
 * Calculate how many non-repeat updates to reset burst pressure
 */
export function calculateBurstResetUpdates(
  threshold: number = 30,
  alphaDown: number = 70,
): number {
  let pressure = 255;  // Max
  let updates = 0;

  while (pressure >= threshold) {
    pressure = Math.floor((alphaDown * pressure) / 100);
    updates++;
  }

  return updates;
}

// ============================================================================
// TIMING HELPERS
// ============================================================================

/**
 * Create a pulsing attack schedule
 * Returns array of delays (in ms) between feedbacks
 */
export function createPulsingSchedule(
  totalFeedbacks: number,
  burstThreshold: number = 30,
  alphaDown: number = 70,
): number[] {
  const resetUpdates = calculateBurstResetUpdates(burstThreshold, alphaDown);
  const schedule: number[] = [];

  // Send in bursts of (resetUpdates - 1), then wait
  for (let i = 0; i < totalFeedbacks; i++) {
    if ((i + 1) % resetUpdates === 0) {
      schedule.push(1000);  // Wait 1 second after each burst
    } else {
      schedule.push(100);   // Fast within burst
    }
  }

  return schedule;
}

// ============================================================================
// ANALYSIS HELPERS
// ============================================================================

/**
 * Analyze a set of keypairs for HLL distribution
 */
export function analyzeHllDistribution(keypairs: Keypair[]): {
  registerCounts: Map<number, number>;
  rhoCounts: Map<number, number>;
  maxRhoCount: number;
} {
  const registerCounts = new Map<number, number>();
  const rhoCounts = new Map<number, number>();
  let maxRhoCount = 0;

  for (const keypair of keypairs) {
    const clientHash = generateClientHash(keypair);
    const { register, rho } = computeHllRegisterAndRho(clientHash);

    registerCounts.set(register, (registerCounts.get(register) || 0) + 1);
    rhoCounts.set(rho, (rhoCounts.get(rho) || 0) + 1);

    if (rho === HLL_MAX_RHO) {
      maxRhoCount++;
    }
  }

  return { registerCounts, rhoCounts, maxRhoCount };
}

/**
 * Analyze fingerprint distribution (uses 64-bit fingerprints)
 */
export function analyzeFingerprintDistribution(keypairs: Keypair[]): {
  uniqueFingerprints: number;
  collisions: Map<string, number>;  // String keys for BigInt
  maxCollisionCount: number;
} {
  const fpCounts = new Map<string, number>();

  for (const keypair of keypairs) {
    const fp = splitmix64Fp64(keypair.publicKey.toBytes()).toString();
    fpCounts.set(fp, (fpCounts.get(fp) || 0) + 1);
  }

  const collisions = new Map<string, number>();
  let maxCollisionCount = 0;

  for (const [fp, count] of fpCounts) {
    if (count > 1) {
      collisions.set(fp, count);
      maxCollisionCount = Math.max(maxCollisionCount, count);
    }
  }

  return {
    uniqueFingerprints: fpCounts.size,
    collisions,
    maxCollisionCount,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  HLL_REGISTERS,
  HLL_MAX_RHO,
};
