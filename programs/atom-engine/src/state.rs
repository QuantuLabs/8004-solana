use anchor_lang::prelude::*;

use crate::params::*;

// ============================================================================
// AtomStats - Raw Metrics Struct
// ============================================================================
//
// Stores raw metrics. Risk/quality/tier calculations performed in compute.rs.
// Size: 460 bytes (~0.0040 SOL rent per agent)
// Update: O(1), ~4500 CU per feedback

/// Raw reputation metrics for an agent
/// Seeds: ["atom_stats", asset.key()]
#[account]
pub struct AtomStats {
    // ========== IDENTITY (64 bytes) ==========
    /// Collection this agent belongs to (offset 8 - primary filter)
    pub collection: Pubkey,
    /// Asset (agent NFT) this stats belongs to
    pub asset: Pubkey,

    // ========== CORE (24 bytes) ==========
    /// Slot of first feedback received
    pub first_feedback_slot: u64,
    /// Slot of most recent feedback
    pub last_feedback_slot: u64,
    /// Total number of feedbacks received
    pub feedback_count: u64,

    // ========== DUAL-EMA (12 bytes) ==========
    /// Fast EMA of scores (α=0.30), scale 0-10000
    pub ema_score_fast: u16,
    /// Slow EMA of scores (α=0.05), scale 0-10000
    pub ema_score_slow: u16,
    /// Smoothed absolute deviation |fast - slow|, scale 0-10000
    pub ema_volatility: u16,
    /// EMA of ilog2(slot_delta), scale 0-1500
    pub ema_arrival_log: u16,
    /// Historical peak of ema_score_slow
    pub peak_ema: u16,
    /// Maximum drawdown (peak - current), scale 0-10000
    pub max_drawdown: u16,

    // ========== EPOCH & BOUNDS (8 bytes) ==========
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

    // ========== HLL (128 bytes = 256 regs × 4 bits) ==========
    /// HyperLogLog registers for unique client estimation (~6.5% error)
    pub hll_packed: [u8; 128],

    // ========== HLL SALT (8 bytes) ==========
    /// Random salt for HLL to prevent cross-agent grinding attacks
    pub hll_salt: u64,

    // ========== BURST DETECTION (196 bytes) ==========
    /// Ring buffer of recent caller fingerprints (requires 25+ wallets for bypass)
    pub recent_callers: [u64; 24],
    /// EMA of repeat caller pressure (0-255)
    pub burst_pressure: u8,
    /// Updates since last HLL register change
    pub updates_since_hll_change: u8,
    /// Negative momentum pressure (0-255)
    pub neg_pressure: u8,
    /// Round Robin eviction cursor for ring buffer
    pub eviction_cursor: u8,

    // ========== OUTPUT CACHE (12 bytes) ==========
    /// Cached loyalty score
    pub loyalty_score: u16,
    /// Cached quality score (0-10000)
    pub quality_score: u16,
    /// Last computed risk score (0-100)
    pub risk_score: u8,
    /// Last computed diversity ratio (0-255)
    pub diversity_ratio: u8,
    /// Last computed trust tier (0-4: Unrated/Bronze/Silver/Gold/Platinum)
    pub trust_tier: u8,
    /// Bit flags for edge cases
    pub flags: u8,
    /// Confidence in metrics (0-10000)
    pub confidence: u16,
    /// PDA bump seed
    pub bump: u8,
    /// Schema version for future migrations
    pub schema_version: u8,
}

impl Default for AtomStats {
    fn default() -> Self {
        Self {
            collection: Pubkey::default(),
            asset: Pubkey::default(),
            first_feedback_slot: 0,
            last_feedback_slot: 0,
            feedback_count: 0,
            ema_score_fast: 0,
            ema_score_slow: 0,
            ema_volatility: 0,
            ema_arrival_log: 0,
            peak_ema: 0,
            max_drawdown: 0,
            epoch_count: 0,
            current_epoch: 0,
            min_score: 0,
            max_score: 0,
            first_score: 0,
            last_score: 0,
            hll_packed: [0u8; 128],
            hll_salt: 0,
            recent_callers: [0u64; 24],
            burst_pressure: 0,
            updates_since_hll_change: 0,
            neg_pressure: 0,
            eviction_cursor: 0,
            loyalty_score: 0,
            quality_score: 0,
            risk_score: 0,
            diversity_ratio: 0,
            trust_tier: 0,
            flags: 0,
            confidence: 0,
            bump: 0,
            schema_version: 0,
        }
    }
}

impl AtomStats {
    pub const SCHEMA_VERSION: u8 = 1;

    /// Account size: 8 + 64 + 24 + 12 + 8 + 128 + 8 + 196 + 12 = 460 bytes
    pub const SIZE: usize = 460;

    /// Initialize with first feedback
    pub fn initialize(&mut self, bump: u8, collection: Pubkey, score: u8, current_slot: u64) {
        self.bump = bump;
        self.schema_version = Self::SCHEMA_VERSION;
        self.collection = collection;
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

    // EMA Parameters (scaled by 100)
    pub alpha_fast: u16,
    pub alpha_slow: u16,
    pub alpha_volatility: u16,
    pub alpha_arrival: u16,
    pub alpha_quality: u16,
    pub alpha_quality_up: u16,
    pub alpha_quality_down: u16,
    pub alpha_burst_up: u16,
    pub alpha_burst_down: u16,

    // Risk Weights
    pub weight_sybil: u8,
    pub weight_burst: u8,
    pub weight_stagnation: u8,
    pub weight_shock: u8,
    pub weight_volatility: u8,
    pub weight_arrival: u8,

    // Thresholds
    pub diversity_threshold: u8,
    pub burst_threshold: u8,
    pub shock_threshold: u16,
    pub volatility_threshold: u16,
    pub arrival_fast_threshold: u16,

    // Tier Thresholds (quality_min, risk_max, confidence_min)
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

    // Cold Start
    pub cold_start_min: u16,
    pub cold_start_max: u16,
    pub cold_start_penalty_heavy: u16,
    pub cold_start_penalty_per_feedback: u16,

    // Bonus/Loyalty
    pub uniqueness_bonus: u16,
    pub loyalty_bonus: u16,
    pub loyalty_min_slot_delta: u32,
    pub bonus_max_burst_pressure: u8,

    // Decay
    pub inactive_decay_per_epoch: u16,

    // Meta
    pub bump: u8,
    pub version: u8,
    pub paused: bool,
    pub _padding: [u8; 5],
}

impl AtomConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 18 + 6 + 8 + 20 + 8 + 10 + 2 + 8;

    /// Initialize config with defaults from params.rs
    pub fn init_defaults(&mut self, authority: Pubkey, agent_registry_program: Pubkey, bump: u8) {
        self.authority = authority;
        self.agent_registry_program = agent_registry_program;
        self.bump = bump;
        self.version = 1;
        self.paused = false;

        self.alpha_fast = ALPHA_FAST as u16;
        self.alpha_slow = ALPHA_SLOW as u16;
        self.alpha_volatility = ALPHA_VOLATILITY as u16;
        self.alpha_arrival = ALPHA_ARRIVAL as u16;
        self.alpha_quality = ALPHA_QUALITY as u16;
        self.alpha_quality_up = ALPHA_QUALITY_UP as u16;
        self.alpha_quality_down = ALPHA_QUALITY_DOWN as u16;
        self.alpha_burst_up = ALPHA_BURST_UP as u16;
        self.alpha_burst_down = ALPHA_BURST_DOWN as u16;

        self.weight_sybil = WEIGHT_SYBIL as u8;
        self.weight_burst = WEIGHT_BURST as u8;
        self.weight_stagnation = WEIGHT_STAGNATION as u8;
        self.weight_shock = WEIGHT_SHOCK as u8;
        self.weight_volatility = WEIGHT_VOLATILITY as u8;
        self.weight_arrival = WEIGHT_ARRIVAL as u8;

        self.diversity_threshold = DIVERSITY_THRESHOLD;
        self.burst_threshold = BURST_THRESHOLD;
        self.shock_threshold = SHOCK_THRESHOLD;
        self.volatility_threshold = VOLATILITY_THRESHOLD;
        self.arrival_fast_threshold = ARRIVAL_FAST_THRESHOLD;

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

        self.cold_start_min = COLD_START_MIN as u16;
        self.cold_start_max = COLD_START_MAX as u16;
        self.cold_start_penalty_heavy = COLD_START_PENALTY_HEAVY as u16;
        self.cold_start_penalty_per_feedback = COLD_START_PENALTY_PER_FEEDBACK as u16;

        self.uniqueness_bonus = UNIQUENESS_BONUS;
        self.loyalty_bonus = LOYALTY_BONUS;
        self.loyalty_min_slot_delta = LOYALTY_MIN_SLOT_DELTA as u32;
        self.bonus_max_burst_pressure = BONUS_MAX_BURST_PRESSURE;

        self.inactive_decay_per_epoch = INACTIVE_DECAY_PER_EPOCH;
    }
}

// ============================================================================
// HyperLogLog Implementation (Integer-Only)
// ============================================================================

/// Add a client hash to the HLL, returns true if register was updated
pub fn hll_add(hll: &mut [u8; 128], client_hash: &[u8; 32], salt: u64) -> bool {
    let h_raw = u64::from_le_bytes(client_hash[0..8].try_into().unwrap());
    let h = h_raw ^ salt;

    let idx = (h % HLL_REGISTERS as u64) as usize;
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

/// Estimate unique client count from HLL (integer-only)
pub fn hll_estimate(hll: &[u8; 128]) -> u64 {
    const INV_TAB: [u16; 16] = [
        65535, 32768, 16384, 8192, 4096, 2048, 1024, 512,
        256, 128, 64, 32, 16, 8, 4, 2
    ];

    let mut inv_sum: u64 = 0;
    let mut zeros: u32 = 0;

    for byte in hll.iter() {
        let lo = (byte & 0x0F) as usize;
        let hi = (byte >> 4) as usize;

        inv_sum += INV_TAB[lo] as u64;
        inv_sum += INV_TAB[hi] as u64;

        if lo == 0 { zeros += 1; }
        if hi == 0 { zeros += 1; }
    }

    let raw = HLL_ALPHA_M2_SCALED / inv_sum.max(1);

    // Linear counting for small cardinalities
    if raw < HLL_LINEAR_COUNTING_THRESHOLD && zeros > 0 {
        if zeros >= 256 {
            0
        } else if zeros == 0 {
            raw
        } else {
            let estimate = match zeros {
                1 => 1417,
                2 => 1240,
                4 => 1063,
                8 => 886,
                16 => 709,
                32 => 532,
                64 => 355,
                128 => 177,
                _ => {
                    let log_v = ilog2_safe(zeros as u64) as u32;
                    let log_256 = 8u32;
                    if log_v >= log_256 { 0 } else { ((log_256 - log_v) * 177) as u64 }
                }
            };
            estimate.min(raw)
        }
    } else {
        raw
    }
}

// ============================================================================
// Fingerprint for Burst Detection
// ============================================================================

/// Compute 64-bit fingerprint using Splitmix64 - DEPRECATED, use secure_fp56
pub fn splitmix64_fp64(pubkey_bytes: &[u8]) -> u64 {
    let bytes: [u8; 8] = pubkey_bytes[0..8].try_into().unwrap_or([0u8; 8]);
    let mut z = u64::from_le_bytes(bytes);
    z = z.wrapping_add(0x9e3779b97f4a7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}

// ============================================================================
// Bit-Packed Ring Buffer for Revoke Support
// ============================================================================
//
// Layout: bits 0-55 = fingerprint, bits 56-62 = score, bit 63 = revoked flag

pub const FP_MASK: u64 = 0x00FF_FFFF_FFFF_FFFF;
pub const SCORE_SHIFT: u32 = 56;
pub const REVOKED_BIT: u64 = 1u64 << 63;

/// Domain-separated fingerprint (56 bits) for cross-target attack resistance
pub fn secure_fp56(client_hash: &[u8; 32], asset: &Pubkey) -> u64 {
    use anchor_lang::solana_program::keccak;

    let mut data = [0u8; 80];
    data[0..16].copy_from_slice(b"ATOM_FEEDBACK_V1");
    data[16..48].copy_from_slice(asset.as_ref());
    data[48..80].copy_from_slice(client_hash);

    let hash = keccak::hash(&data);
    u64::from_le_bytes(hash.0[0..8].try_into().unwrap()) & FP_MASK
}

#[inline]
pub fn encode_caller_entry(fp56: u64, score: u8, revoked: bool) -> u64 {
    let mut entry = fp56 & FP_MASK;
    entry |= (score as u64 & 0x7F) << SCORE_SHIFT;
    if revoked { entry |= REVOKED_BIT; }
    entry
}

#[inline]
pub fn decode_caller_entry(entry: u64) -> (u64, u8, bool) {
    let fp56 = entry & FP_MASK;
    let score = ((entry >> SCORE_SHIFT) & 0x7F) as u8;
    let revoked = (entry & REVOKED_BIT) != 0;
    (fp56, score, revoked)
}

/// Find entry by fp56 in ring buffer
pub fn find_caller_entry(recent: &[u64; RING_BUFFER_SIZE], fp56: u64) -> Option<(usize, u8, bool)> {
    for (i, &entry) in recent.iter().enumerate() {
        let (stored_fp, score, revoked) = decode_caller_entry(entry);
        if stored_fp == fp56 && stored_fp != 0 {
            return Some((i, score, revoked));
        }
    }
    None
}

#[inline]
pub fn mark_entry_revoked(recent: &mut [u64; RING_BUFFER_SIZE], index: usize) {
    recent[index] |= REVOKED_BIT;
}

/// Push entry with Round Robin eviction (prevents targeted eviction attacks)
pub fn push_caller_encoded(recent: &mut [u64; RING_BUFFER_SIZE], cursor: &mut u8, fp56: u64, score: u8) {
    let evict_idx = *cursor as usize;
    recent[evict_idx] = encode_caller_entry(fp56, score, false);
    *cursor = ((*cursor as usize + 1) % RING_BUFFER_SIZE) as u8;
}

/// Update entry in-place if found, otherwise push new entry
pub fn upsert_caller_entry(recent: &mut [u64; RING_BUFFER_SIZE], cursor: &mut u8, fp56: u64, score: u8) -> bool {
    if let Some((idx, _old_score, _revoked)) = find_caller_entry(recent, fp56) {
        recent[idx] = encode_caller_entry(fp56, score, false);
        true
    } else {
        push_caller_encoded(recent, cursor, fp56, score);
        false
    }
}

/// Ring buffer size (requires 25+ wallets to bypass)
pub const RING_BUFFER_SIZE: usize = 24;

/// Check if fingerprint is in recent callers (constant-time)
pub fn check_recent_caller(recent: &[u64; RING_BUFFER_SIZE], fp: u64) -> bool {
    let mut found = false;
    for &r in recent.iter() {
        found |= r == fp;
    }
    found
}

/// Push fingerprint to ring buffer (shifts old ones out)
pub fn push_caller(recent: &mut [u64; RING_BUFFER_SIZE], fp: u64) {
    for i in (1..RING_BUFFER_SIZE).rev() {
        recent[i] = recent[i - 1];
    }
    recent[0] = fp;
}

// ============================================================================
// Helper Functions
// ============================================================================

#[inline]
pub fn ilog2_safe(x: u64) -> u8 {
    if x == 0 { 0 } else { (63 - x.leading_zeros()) as u8 }
}

#[inline]
pub fn safe_div(a: u64, b: u64) -> u64 {
    if b == 0 { 0 } else { a / b }
}

#[inline]
pub fn safe_div_u32(a: u32, b: u32) -> u32 {
    if b == 0 { 0 } else { a / b }
}

/// Salt client hash with asset pubkey (prevents HLL pre-mining)
#[inline]
pub fn salt_hash_with_asset(client_hash: &[u8; 32], asset: &Pubkey) -> [u8; 32] {
    let asset_bytes = asset.to_bytes();
    let mut salted = [0u8; 32];
    for i in 0..32 {
        salted[i] = client_hash[i] ^ asset_bytes[i];
    }
    salted
}
