use anchor_lang::prelude::*;

use crate::params::*;

// ============================================================================
// AtomStats v1.0 - Raw Metrics Struct
// ============================================================================
//
// This struct stores ONLY raw metrics. Risk/quality/tier calculations are
// performed in compute.rs using parameters from params.rs or AtomConfig.
//
// Size: 96 bytes exactly (~0.00089 SOL rent per agent)
// Update: O(1), ~4500 CU per feedback

/// Raw reputation metrics for an agent
/// Seeds: ["atom_stats", asset.key()]
#[account]
#[derive(Default)]
pub struct AtomStats {
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

impl AtomStats {
    /// Current schema version
    pub const SCHEMA_VERSION: u8 = 1;

    /// Account size in bytes (discriminator + fields)
    pub const SIZE: usize = 8 + 96;

    /// Initialize a new AtomStats with first feedback
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
// AtomConfig - Singleton Configuration PDA
// ============================================================================
//
// Stores tunable parameters that can be updated without program upgrade.
// Seeds: ["atom_config"]

/// Configuration account for ATOM engine
#[account]
pub struct AtomConfig {
    /// Authority that can update config
    pub authority: Pubkey,
    /// Agent registry program (authorized CPI caller)
    pub agent_registry_program: Pubkey,

    // === EMA Parameters (scaled by 100) ===
    pub alpha_fast: u16,
    pub alpha_slow: u16,
    pub alpha_volatility: u16,
    pub alpha_arrival: u16,
    pub alpha_quality: u16,
    pub alpha_burst_up: u16,
    pub alpha_burst_down: u16,

    // === Risk Weights ===
    pub weight_sybil: u8,
    pub weight_burst: u8,
    pub weight_stagnation: u8,
    pub weight_shock: u8,
    pub weight_volatility: u8,
    pub weight_arrival: u8,

    // === Thresholds ===
    pub diversity_threshold: u8,
    pub burst_threshold: u8,
    pub shock_threshold: u16,
    pub volatility_threshold: u16,
    pub arrival_fast_threshold: u16,

    // === Tier Thresholds (quality_min, risk_max, confidence_min) ===
    pub tier_platinum_quality: u16,
    pub tier_platinum_risk: u8,
    pub tier_platinum_confidence: u16,
    pub tier_gold_quality: u16,
    pub tier_gold_risk: u8,
    pub tier_gold_confidence: u16,
    pub tier_silver_quality: u16,
    pub tier_silver_risk: u8,
    pub tier_silver_confidence: u16,
    pub tier_bronze_quality: u16,
    pub tier_bronze_risk: u8,
    pub tier_bronze_confidence: u16,

    // === Cold Start ===
    pub cold_start_min: u16,
    pub cold_start_max: u16,
    pub cold_start_penalty_heavy: u16,
    pub cold_start_penalty_per_feedback: u16,

    // === Bonus/Loyalty ===
    pub uniqueness_bonus: u16,
    pub loyalty_bonus: u16,
    pub loyalty_min_slot_delta: u32,
    pub bonus_max_burst_pressure: u8,

    // === Decay ===
    pub inactive_decay_per_epoch: u16,

    // === Meta ===
    pub bump: u8,
    pub version: u8,
    pub paused: bool,
    pub _padding: [u8; 5],
}

impl AtomConfig {
    /// Account size in bytes
    pub const SIZE: usize = 8 + 32 + 32 + // discriminator + authority + registry_program
        14 + // EMA params (7 * u16)
        6 + // Risk weights (6 * u8)
        8 + // Thresholds (2 * u8 + 3 * u16)
        20 + // Tier thresholds (4 * (u16 + u8 + u16))
        8 + // Cold start (4 * u16)
        10 + // Bonus/Loyalty (2 * u16 + u32 + u8)
        2 + // Decay (u16)
        8; // Meta (bump, version, paused, padding)

    /// Initialize config with defaults from params.rs
    pub fn init_defaults(&mut self, authority: Pubkey, agent_registry_program: Pubkey, bump: u8) {
        self.authority = authority;
        self.agent_registry_program = agent_registry_program;
        self.bump = bump;
        self.version = 1;
        self.paused = false;

        // EMA Parameters
        self.alpha_fast = ALPHA_FAST as u16;
        self.alpha_slow = ALPHA_SLOW as u16;
        self.alpha_volatility = ALPHA_VOLATILITY as u16;
        self.alpha_arrival = ALPHA_ARRIVAL as u16;
        self.alpha_quality = ALPHA_QUALITY as u16;
        self.alpha_burst_up = ALPHA_BURST_UP as u16;
        self.alpha_burst_down = ALPHA_BURST_DOWN as u16;

        // Risk Weights
        self.weight_sybil = WEIGHT_SYBIL as u8;
        self.weight_burst = WEIGHT_BURST as u8;
        self.weight_stagnation = WEIGHT_STAGNATION as u8;
        self.weight_shock = WEIGHT_SHOCK as u8;
        self.weight_volatility = WEIGHT_VOLATILITY as u8;
        self.weight_arrival = WEIGHT_ARRIVAL as u8;

        // Thresholds
        self.diversity_threshold = DIVERSITY_THRESHOLD;
        self.burst_threshold = BURST_THRESHOLD;
        self.shock_threshold = SHOCK_THRESHOLD;
        self.volatility_threshold = VOLATILITY_THRESHOLD;
        self.arrival_fast_threshold = ARRIVAL_FAST_THRESHOLD;

        // Tier Thresholds
        self.tier_platinum_quality = TIER_PLATINUM.0;
        self.tier_platinum_risk = TIER_PLATINUM.1;
        self.tier_platinum_confidence = TIER_PLATINUM.2;
        self.tier_gold_quality = TIER_GOLD.0;
        self.tier_gold_risk = TIER_GOLD.1;
        self.tier_gold_confidence = TIER_GOLD.2;
        self.tier_silver_quality = TIER_SILVER.0;
        self.tier_silver_risk = TIER_SILVER.1;
        self.tier_silver_confidence = TIER_SILVER.2;
        self.tier_bronze_quality = TIER_BRONZE.0;
        self.tier_bronze_risk = TIER_BRONZE.1;
        self.tier_bronze_confidence = TIER_BRONZE.2;

        // Cold Start
        self.cold_start_min = COLD_START_MIN as u16;
        self.cold_start_max = COLD_START_MAX as u16;
        self.cold_start_penalty_heavy = COLD_START_PENALTY_HEAVY as u16;
        self.cold_start_penalty_per_feedback = COLD_START_PENALTY_PER_FEEDBACK as u16;

        // Bonus/Loyalty
        self.uniqueness_bonus = UNIQUENESS_BONUS;
        self.loyalty_bonus = LOYALTY_BONUS;
        self.loyalty_min_slot_delta = LOYALTY_MIN_SLOT_DELTA as u32;
        self.bonus_max_burst_pressure = BONUS_MAX_BURST_PRESSURE;

        // Decay
        self.inactive_decay_per_epoch = INACTIVE_DECAY_PER_EPOCH;
    }
}

// ============================================================================
// AtomCheckpoint - Recovery Checkpoint PDA
// ============================================================================
//
// Stores periodic snapshots for recovery/reindexation.
// Seeds: ["atom_checkpoint", asset.key(), checkpoint_index.to_le_bytes()]

/// Checkpoint for recovery/reindexation
#[account]
pub struct AtomCheckpoint {
    /// Asset this checkpoint belongs to
    pub asset: Pubkey,
    /// Checkpoint index (sequential)
    pub checkpoint_index: u64,
    /// Hash of the feedback that created this checkpoint
    pub checkpoint_hash: [u8; 32],
    /// Feedback index at checkpoint time
    pub feedback_index: u64,
    /// Snapshot of AtomStats at checkpoint time
    pub stats_snapshot: [u8; 96],
    /// Timestamp of checkpoint creation
    pub created_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl AtomCheckpoint {
    /// Account size in bytes
    pub const SIZE: usize = 8 + 32 + 8 + 32 + 8 + 96 + 8 + 1;
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
