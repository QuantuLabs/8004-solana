use anchor_lang::prelude::*;

use super::params::*;

// ============================================================================
// ReputationStats v3.11 - Raw Metrics Struct
// ============================================================================
//
// This struct stores ONLY raw metrics. Risk/quality/tier calculations are
// performed in compute.rs using parameters from params.rs.
//
// Size: 96 bytes exactly (~0.00089 SOL rent per agent)
// Update: O(1), ~4500 CU per feedback
//
// Validated by Hivemind: 96/100 (OpenAI 94, Gemini 98)

/// Raw reputation metrics for an agent
/// Seeds: ["rep_stats", asset.key()]
#[account]
#[derive(Default)]
pub struct ReputationStats {
    // ========== BLOC 1: CORE (24 bytes) ==========
    /// Slot of first feedback received (anchor for age calculation)
    pub first_feedback_slot: u64,
    /// Slot of most recent feedback (recency, burst detection)
    pub last_feedback_slot: u64,
    /// Total number of feedbacks received
    pub feedback_count: u64,

    // ========== BLOC 2: DUAL-EMA (12 bytes) ==========
    /// Fast EMA of scores (α=0.30), scale 0-10000 (represents 0.00-100.00)
    pub ema_score_fast: u16,
    /// Slow EMA of scores (α=0.05), scale 0-10000
    pub ema_score_slow: u16,
    /// Smoothed absolute deviation |fast - slow|, scale 0-10000
    pub ema_volatility: u16,
    /// EMA of ilog2(slot_delta), scale 0-1500 (0=instant, 1500=very slow)
    pub ema_arrival_log: u16,
    /// Historical peak of ema_score_slow
    pub peak_ema: u16,
    /// Maximum drawdown (peak - current), scale 0-10000
    pub max_drawdown: u16,

    // ========== BLOC 3: EPOCH & BOUNDS (8 bytes) ==========
    /// Number of distinct epochs with activity
    pub epoch_count: u16,
    /// Current epoch number (slot / EPOCH_SLOTS)
    pub current_epoch: u16,
    /// Minimum score ever received (0-100)
    pub min_score: u8,
    /// Maximum score ever received (0-100)
    pub max_score: u8,
    /// First score received (0-100)
    pub first_score: u8,
    /// Most recent score received (0-100)
    pub last_score: u8,

    // ========== BLOC 4: HLL (24 bytes = 48 regs × 4 bits) ==========
    /// HyperLogLog registers for unique client estimation
    /// 48 registers × 4 bits each, ~15% error at high cardinalities
    pub hll_packed: [u8; 24],

    // ========== BLOC 5: BURST DETECTION (8 bytes) ==========
    /// Ring buffer of 3 recent caller fingerprints (16-bit each)
    pub recent_callers: [u16; 3],
    /// EMA of repeat caller pressure (0-255, higher = more repeats)
    pub burst_pressure: u8,
    /// Updates since last HLL register change (detects wallet rotation)
    pub updates_since_hll_change: u8,

    // ========== BLOC 6: OUTPUT CACHE (12 bytes) ==========
    /// Cached loyalty score (accumulated from slow repeats)
    pub loyalty_score: u16,
    /// Cached quality score (score × consistency bonus)
    pub quality_score: u16,
    /// Last computed risk score (0-100)
    pub risk_score: u8,
    /// Last computed diversity ratio (hll_est * 255 / count)
    pub diversity_ratio: u8,
    /// Last computed trust tier (0-4: Unrated/Bronze/Silver/Gold/Platinum)
    pub trust_tier: u8,
    /// Bit flags for edge cases
    pub flags: u8,
    /// Confidence in metrics (0-10000), based on sample size + diversity
    pub confidence: u16,
    /// PDA bump seed
    pub bump: u8,
    /// Schema version for future migrations
    pub schema_version: u8,
}

impl ReputationStats {
    /// Current schema version
    pub const SCHEMA_VERSION: u8 = 1;

    /// Account size in bytes (discriminator + fields)
    pub const SIZE: usize = 8 + 96;

    /// Initialize a new ReputationStats with first feedback
    pub fn initialize(&mut self, bump: u8, score: u8, current_slot: u64) {
        self.bump = bump;
        self.schema_version = Self::SCHEMA_VERSION;
        self.first_feedback_slot = current_slot;
        self.last_feedback_slot = current_slot;
        self.feedback_count = 1;
        self.first_score = score;
        self.last_score = score;
        self.min_score = score;
        self.max_score = score;
        self.ema_score_fast = (score as u16) * 100;
        self.ema_score_slow = (score as u16) * 100;
        self.peak_ema = (score as u16) * 100;
        self.current_epoch = (current_slot / EPOCH_SLOTS) as u16;
        self.epoch_count = 1;
    }
}

// ============================================================================
// HyperLogLog Implementation (Integer-Only)
// ============================================================================

/// Add a client hash to the HLL, returns true if a register was updated (likely new unique)
pub fn hll_add(hll: &mut [u8; 24], client_hash: &[u8; 32]) -> bool {
    let h = u64::from_le_bytes(client_hash[0..8].try_into().unwrap());

    // Unbiased modulo mapping to 48 registers
    let idx = (h % HLL_REGISTERS as u64) as usize;

    // Count leading zeros after dividing out the index bits
    let remaining = h / HLL_REGISTERS as u64;
    let rho = if remaining == 0 {
        HLL_MAX_RHO
    } else {
        (remaining.leading_zeros() as u8 + 1).min(HLL_MAX_RHO)
    };

    let byte_idx = idx / 2;
    let is_high = idx % 2 == 1;
    let old = if is_high { hll[byte_idx] >> 4 } else { hll[byte_idx] & 0x0F };

    if rho > old {
        if is_high {
            hll[byte_idx] = (hll[byte_idx] & 0x0F) | (rho << 4);
        } else {
            hll[byte_idx] = (hll[byte_idx] & 0xF0) | rho;
        }
        return true;
    }
    false
}

/// Estimate unique client count from HLL (integer-only approximation)
/// Uses lookup table for 2^-k to avoid floats
pub fn hll_estimate(hll: &[u8; 24]) -> u64 {
    // LUT: 65536 / 2^k (scaled inverse powers of 2)
    const INV_TAB: [u16; 16] = [
        65535, 32768, 16384, 8192, 4096, 2048, 1024, 512,
        256, 128, 64, 32, 16, 8, 4, 2
    ];

    let mut inv_sum: u32 = 0;
    let mut zeros: u32 = 0;

    for byte in hll.iter() {
        let lo = (byte & 0x0F) as usize;
        let hi = (byte >> 4) as usize;

        inv_sum += INV_TAB[lo] as u32;
        inv_sum += INV_TAB[hi] as u32;

        if lo == 0 { zeros += 1; }
        if hi == 0 { zeros += 1; }
    }

    // α * m² ≈ 0.709 * 48² = 1633.5 → scaled by 65536 = 107_055_104
    let raw = HLL_ALPHA_M2_SCALED / (inv_sum.max(1) as u64);

    // Linear counting for small cardinalities (when many zeros)
    if raw < HLL_LINEAR_COUNTING_THRESHOLD && zeros > 0 {
        // Approximation of 48 * ln(48/zeros)
        (HLL_REGISTERS as u64 * HLL_REGISTERS as u64) / zeros.max(1) as u64
    } else {
        raw
    }
}

// ============================================================================
// Fingerprint for Burst Detection
// ============================================================================

/// Compute 16-bit fingerprint using Splitmix64 (fast, good distribution)
pub fn splitmix64_fp16(pubkey_bytes: &[u8]) -> u16 {
    let bytes: [u8; 8] = pubkey_bytes[0..8].try_into().unwrap_or([0u8; 8]);
    let mut z = u64::from_le_bytes(bytes);
    z = z.wrapping_add(0x9e3779b97f4a7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    ((z ^ (z >> 31)) & 0xFFFF) as u16
}

/// Check if fingerprint is in recent callers ring buffer
pub fn check_recent_caller(recent: &[u16; 3], fp: u16) -> bool {
    recent[0] == fp || recent[1] == fp || recent[2] == fp
}

/// Push new fingerprint to ring buffer (shifts old ones out)
pub fn push_caller(recent: &mut [u16; 3], fp: u16) {
    recent[2] = recent[1];
    recent[1] = recent[0];
    recent[0] = fp;
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Safe integer log2 (returns 0 for input 0)
#[inline]
pub fn ilog2_safe(x: u64) -> u8 {
    if x == 0 { 0 } else { (63 - x.leading_zeros()) as u8 }
}

/// Safe division (returns 0 if divisor is 0)
#[inline]
pub fn safe_div(a: u64, b: u64) -> u64 {
    if b == 0 { 0 } else { a / b }
}

/// Safe u32 division (returns 0 if divisor is 0)
#[inline]
pub fn safe_div_u32(a: u32, b: u32) -> u32 {
    if b == 0 { 0 } else { a / b }
}
