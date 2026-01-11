use crate::params::*;
use crate::state::*;

// ============================================================================
// ATOM Engine v1.0 - Calculation Functions
// ============================================================================
//
// All calculation logic using parameters from params.rs.
// CU Budget: ~4500 CU total for update_stats()

// ============================================================================
// EMA Updates
// ============================================================================

/// Update all EMA values with new feedback
fn update_ema(stats: &mut AtomStats, score: u8, slot_delta: u64) {
    let score_scaled = (score as u16) * 100; // 0-10000 scale

    // Inactive decay: if slot_delta > 1 epoch, decay confidence
    if slot_delta > EPOCH_SLOTS {
        let epochs_inactive = (slot_delta / EPOCH_SLOTS).min(MAX_INACTIVE_EPOCHS) as u16;
        stats.confidence = stats.confidence.saturating_sub(epochs_inactive * INACTIVE_DECAY_PER_EPOCH);
    }

    // Fast EMA (α = ALPHA_FAST/100)
    stats.ema_score_fast = ((ALPHA_FAST * score_scaled as u32
        + (100 - ALPHA_FAST) * stats.ema_score_fast as u32) / 100) as u16;

    // Slow EMA (α = ALPHA_SLOW/100)
    stats.ema_score_slow = ((ALPHA_SLOW * score_scaled as u32
        + (100 - ALPHA_SLOW) * stats.ema_score_slow as u32) / 100) as u16;

    // Volatility EMA: |fast - slow|
    let deviation = stats.ema_score_fast.abs_diff(stats.ema_score_slow);
    stats.ema_volatility = ((ALPHA_VOLATILITY * deviation as u32
        + (100 - ALPHA_VOLATILITY) * stats.ema_volatility as u32) / 100) as u16;

    // Arrival rate EMA (ilog2 of slot delta, capped at 15)
    let arrival_log = ilog2_safe(slot_delta).min(15) as u16 * 100;
    stats.ema_arrival_log = ((ALPHA_ARRIVAL * arrival_log as u32
        + (100 - ALPHA_ARRIVAL) * stats.ema_arrival_log as u32) / 100) as u16;

    // Peak and drawdown tracking
    if stats.ema_score_slow > stats.peak_ema {
        stats.peak_ema = stats.ema_score_slow;
        stats.max_drawdown = 0;
    } else {
        let drawdown = stats.peak_ema.saturating_sub(stats.ema_score_slow);
        stats.max_drawdown = stats.max_drawdown.max(drawdown);
    }
}

// ============================================================================
// Risk Calculation
// ============================================================================

/// Calculate risk score based on multiple signals
fn calculate_risk(stats: &AtomStats, hll_est: u64) -> u8 {
    let mut risk: u32 = 0;
    let n = stats.feedback_count.max(1);

    // Sample-size modulation factor (0-100, ramps over 20 feedbacks)
    let size_mod = ((n * 5).min(100)) as u32;

    // 1. SYBIL RISK - Low diversity = high risk
    let diversity = safe_div(hll_est * 255, n).min(255) as u8;
    if diversity < DIVERSITY_THRESHOLD {
        risk += safe_div_u32(
            WEIGHT_SYBIL * (DIVERSITY_THRESHOLD - diversity) as u32 * size_mod,
            100
        );
    }

    // 2. BURST PRESSURE RISK - Repeated same caller
    if stats.burst_pressure > BURST_THRESHOLD {
        risk += safe_div_u32(
            WEIGHT_BURST * (stats.burst_pressure - BURST_THRESHOLD) as u32 * size_mod,
            100
        );
    }

    // 3. STAGNATION RISK - No new unique clients (wallet rotation)
    // Dynamic threshold: scales with HLL estimate
    let stagnation_threshold = (hll_est / 10)
        .max(STAGNATION_THRESHOLD_MIN as u64)
        .min(STAGNATION_THRESHOLD_MAX as u64) as u8;

    if stats.updates_since_hll_change > stagnation_threshold {
        risk += WEIGHT_STAGNATION * (stats.updates_since_hll_change - stagnation_threshold) as u32;
    }

    // 4. SHOCK RISK - Fast/slow EMA divergence
    let shock = stats.ema_score_fast.abs_diff(stats.ema_score_slow);
    if shock > SHOCK_THRESHOLD {
        risk += safe_div_u32(
            WEIGHT_SHOCK * ((shock - SHOCK_THRESHOLD) / 500) as u32 * size_mod,
            100
        );
    }

    // 5. VOLATILITY RISK - Inconsistent scores
    if stats.ema_volatility > VOLATILITY_THRESHOLD {
        risk += WEIGHT_VOLATILITY * ((stats.ema_volatility - VOLATILITY_THRESHOLD) / 500) as u32;
    }

    // 6. ARRIVAL RATE RISK - Very fast feedback cadence
    if stats.ema_arrival_log < ARRIVAL_FAST_THRESHOLD && n > 10 {
        risk += safe_div_u32(
            WEIGHT_ARRIVAL * (ARRIVAL_FAST_THRESHOLD - stats.ema_arrival_log) as u32,
            100
        ).min(10);
    }

    risk.min(100) as u8
}

// ============================================================================
// Quality Score
// ============================================================================

/// Update quality score with optional bonuses
fn update_quality(
    stats: &mut AtomStats,
    score: u8,
    hll_changed: bool,
    slot_delta: u64,
) {
    // Base quality = score × consistency (inverse of volatility)
    let consistency = 100u16.saturating_sub(stats.ema_volatility / 100);
    let mut quality_delta = (score as u16 * consistency) / 100;

    // Uniqueness bonus: if HLL changed AND not in burst mode
    if hll_changed && stats.burst_pressure < BONUS_MAX_BURST_PRESSURE {
        quality_delta = quality_delta.saturating_add(UNIQUENESS_BONUS);
        stats.updates_since_hll_change = 0;
    } else {
        stats.updates_since_hll_change = stats.updates_since_hll_change.saturating_add(1);
    }

    // Loyalty bonus: slow repeat (not spam, returning customer)
    if !hll_changed && slot_delta > LOYALTY_MIN_SLOT_DELTA && stats.burst_pressure < BURST_THRESHOLD {
        stats.loyalty_score = stats.loyalty_score.saturating_add(LOYALTY_BONUS);
        quality_delta = quality_delta.saturating_add(LOYALTY_BONUS);
    }

    // EMA of quality (α = ALPHA_QUALITY/100)
    stats.quality_score = ((ALPHA_QUALITY * quality_delta as u32
        + (100 - ALPHA_QUALITY) * stats.quality_score as u32) / 100) as u16;
}

// ============================================================================
// Confidence Calculation
// ============================================================================

/// Update confidence based on sample size and diversity
fn update_confidence(stats: &mut AtomStats, hll_est: u64) {
    let n = stats.feedback_count;

    // Count factor: more feedbacks = more confidence (up to 100)
    let count_factor = (n.min(100) * 50) as u32; // 0-5000

    // Diversity factor: more unique clients = more confidence
    let diversity_factor = (hll_est * 20).min(5000) as u32; // 0-5000

    // Gradual cold start penalty (ramps from COLD_START_MIN to COLD_START_MAX)
    let cold_penalty = if n < COLD_START_MIN {
        COLD_START_PENALTY_HEAVY
    } else if n < COLD_START_MAX {
        (COLD_START_MAX - n) as u32 * COLD_START_PENALTY_PER_FEEDBACK
    } else {
        0
    };

    let raw = (count_factor + diversity_factor).saturating_sub(cold_penalty);

    // Don't decrease confidence faster than decay (preserve gains)
    stats.confidence = stats.confidence.max(raw.min(10000) as u16);
}

// ============================================================================
// Trust Tier Classification
// ============================================================================

/// Update trust tier based on quality, risk, and confidence
fn update_trust_tier(stats: &mut AtomStats) {
    let q = stats.quality_score;
    let r = stats.risk_score;
    let c = stats.confidence;

    stats.trust_tier = if q >= TIER_PLATINUM.0 && r <= TIER_PLATINUM.1 && c >= TIER_PLATINUM.2 {
        4 // Platinum
    } else if q >= TIER_GOLD.0 && r <= TIER_GOLD.1 && c >= TIER_GOLD.2 {
        3 // Gold
    } else if q >= TIER_SILVER.0 && r <= TIER_SILVER.1 && c >= TIER_SILVER.2 {
        2 // Silver
    } else if q >= TIER_BRONZE.0 && r <= TIER_BRONZE.1 && c >= TIER_BRONZE.2 {
        1 // Bronze
    } else {
        0 // Unrated
    };
}

// ============================================================================
// Main Update Function (~4500 CU)
// ============================================================================

/// Update reputation stats with new feedback
///
/// # Arguments
/// * `stats` - Mutable reference to AtomStats account
/// * `client_hash` - Keccak256 hash of client pubkey (32 bytes)
/// * `score` - Feedback score (0-100)
/// * `current_slot` - Current Solana slot
pub fn update_stats(
    stats: &mut AtomStats,
    client_hash: &[u8; 32],
    score: u8,
    current_slot: u64,
) {
    let slot_delta = current_slot.saturating_sub(stats.last_feedback_slot);

    // Fingerprint for burst detection
    let caller_fp = splitmix64_fp16(client_hash);

    // Alternating wallet detection via ring buffer
    let is_recent = check_recent_caller(&stats.recent_callers, caller_fp);
    push_caller(&mut stats.recent_callers, caller_fp);

    // Burst pressure EMA: increases if caller was in recent ring, decays otherwise
    if is_recent {
        stats.burst_pressure = ((ALPHA_BURST_UP * 100
            + (100 - ALPHA_BURST_UP) * stats.burst_pressure as u32) / 100) as u8;
    } else {
        stats.burst_pressure = ((ALPHA_BURST_DOWN * stats.burst_pressure as u32) / 100) as u8;
    }

    // First-time initialization
    if stats.feedback_count == 0 {
        stats.first_feedback_slot = current_slot;
        stats.first_score = score;
        stats.min_score = score;
        stats.max_score = score;
        stats.ema_score_fast = (score as u16) * 100;
        stats.ema_score_slow = (score as u16) * 100;
        stats.peak_ema = (score as u16) * 100;
        stats.schema_version = AtomStats::SCHEMA_VERSION;
    }

    // Update core metrics
    stats.last_feedback_slot = current_slot;
    stats.last_score = score;
    stats.feedback_count = stats.feedback_count.saturating_add(1);
    stats.min_score = stats.min_score.min(score);
    stats.max_score = stats.max_score.max(score);

    // Epoch tracking
    let new_epoch = (current_slot / EPOCH_SLOTS) as u16;
    if new_epoch != stats.current_epoch {
        stats.current_epoch = new_epoch;
        stats.epoch_count = stats.epoch_count.saturating_add(1);
    }

    // HLL update (unique client detection)
    let hll_changed = hll_add(&mut stats.hll_packed, client_hash);
    let hll_est = hll_estimate(&stats.hll_packed);

    // EMA updates with decay
    update_ema(stats, score, slot_delta);

    // Quality with bonuses
    update_quality(stats, score, hll_changed, slot_delta);

    // Risk calculation
    stats.risk_score = calculate_risk(stats, hll_est);

    // Diversity ratio
    stats.diversity_ratio = safe_div(hll_est * 255, stats.feedback_count.max(1)).min(255) as u8;

    // Confidence
    update_confidence(stats, hll_est);

    // Trust tier
    update_trust_tier(stats);
}

// ============================================================================
// Migration Support
// ============================================================================

/// Migrate stats from older schema versions if needed
pub fn maybe_migrate(stats: &mut AtomStats) {
    match stats.schema_version {
        0 => {
            // Schema version 0 means uninitialized or pre-v1.0
            stats.schema_version = AtomStats::SCHEMA_VERSION;
        }
        1 => {
            // Current version, no migration needed
        }
        _ => {
            // Future versions - handle here when needed
        }
    }
}
