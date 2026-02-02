use crate::params::*;
use crate::state::*;

// Re-export AtomConfig for convenience
pub use crate::state::AtomConfig;

// ============================================================================
// ATOM Engine - Calculation Functions
// ============================================================================
//
// All calculation logic using parameters from params.rs.
// CU Budget: ~4500 CU total for update_stats()

// ============================================================================
// EMA Updates
// ============================================================================

/// Update all EMA values with new feedback
fn update_ema(stats: &mut AtomStats, score: u8, slot_delta: u64, config: &AtomConfig) {
    let score_scaled = (score as u16) * 100;

    // Inactive decay: if slot_delta > 1 epoch, decay confidence
    if slot_delta > EPOCH_SLOTS {
        let epochs_inactive = (slot_delta / EPOCH_SLOTS).min(MAX_INACTIVE_EPOCHS) as u16;
        let decay_per_epoch = if epochs_inactive >= SEVERE_DORMANCY_EPOCHS as u16 {
            config.inactive_decay_per_epoch * SEVERE_DORMANCY_MULTIPLIER
        } else {
            config.inactive_decay_per_epoch
        };
        let decay_total = (epochs_inactive as u32)
            .saturating_mul(decay_per_epoch as u32)
            .min(u16::MAX as u32) as u16;
        stats.confidence = stats.confidence.saturating_sub(decay_total);
    }

    let alpha_fast = config.alpha_fast as u32;
    let alpha_slow = config.alpha_slow as u32;
    let alpha_vol = config.alpha_volatility as u32;
    let alpha_arr = config.alpha_arrival as u32;

    // Fast EMA
    stats.ema_score_fast = ((alpha_fast * score_scaled as u32
        + (100 - alpha_fast) * stats.ema_score_fast as u32) / 100) as u16;

    // Slow EMA
    stats.ema_score_slow = ((alpha_slow * score_scaled as u32
        + (100 - alpha_slow) * stats.ema_score_slow as u32) / 100) as u16;

    // Volatility EMA: |fast - slow|
    let deviation = stats.ema_score_fast.abs_diff(stats.ema_score_slow);
    stats.ema_volatility = ((alpha_vol * deviation as u32
        + (100 - alpha_vol) * stats.ema_volatility as u32) / 100) as u16;

    // Arrival rate EMA
    let arrival_log = ilog2_safe(slot_delta).min(15) as u16 * 100;
    stats.ema_arrival_log = ((alpha_arr * arrival_log as u32
        + (100 - alpha_arr) * stats.ema_arrival_log as u32) / 100) as u16;

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
fn calculate_risk(stats: &AtomStats, hll_est: u64, config: &AtomConfig) -> u8 {
    let mut risk: u32 = 0;
    let n = stats.feedback_count.max(1);
    let size_mod = (n.saturating_mul(5).min(100)) as u32;

    // 1. SYBIL RISK
    let diversity = safe_div(hll_est.saturating_mul(255), n).min(255) as u8;
    if diversity < config.diversity_threshold {
        risk += safe_div_u32(
            config.weight_sybil as u32 * (config.diversity_threshold - diversity) as u32 * size_mod,
            100
        );
    }

    // 2. BURST PRESSURE RISK
    if stats.burst_pressure > config.burst_threshold {
        risk += safe_div_u32(
            config.weight_burst as u32 * (stats.burst_pressure - config.burst_threshold) as u32 * size_mod,
            100
        );
    }

    // 3. STAGNATION RISK
    let stagnation_threshold = (hll_est / 10)
        .max(STAGNATION_THRESHOLD_MIN as u64)
        .min(STAGNATION_THRESHOLD_MAX as u64)
        .min(255) as u8;
    if stats.updates_since_hll_change > stagnation_threshold {
        risk += config.weight_stagnation as u32 * (stats.updates_since_hll_change - stagnation_threshold) as u32;
    }

    // 4. SHOCK RISK
    let shock = stats.ema_score_fast.abs_diff(stats.ema_score_slow);
    if shock > config.shock_threshold {
        risk += safe_div_u32(
            config.weight_shock as u32 * ((shock - config.shock_threshold) / 500) as u32 * size_mod,
            100
        );
    }

    // 5. VOLATILITY RISK
    if stats.ema_volatility > config.volatility_threshold {
        risk += config.weight_volatility as u32 * ((stats.ema_volatility - config.volatility_threshold) / 500) as u32;
    }

    // 6. ARRIVAL RATE RISK
    if stats.ema_arrival_log < config.arrival_fast_threshold && n > 10 {
        risk += safe_div_u32(
            config.weight_arrival as u32 * (config.arrival_fast_threshold - stats.ema_arrival_log) as u32,
            100
        ).min(10);
    }

    risk.min(100) as u8
}

// ============================================================================
// Quality Score
// ============================================================================

/// Calculate WUE (Weighted-Unique Endorsement) weight based on diversity
#[inline]
fn calculate_wue_weight(diversity_ratio: u8) -> u32 {
    if diversity_ratio <= WUE_DIVERSITY_LOW {
        WUE_WEIGHT_MIN
    } else if diversity_ratio >= WUE_DIVERSITY_HIGH {
        WUE_WEIGHT_MAX
    } else {
        let range = (WUE_DIVERSITY_HIGH - WUE_DIVERSITY_LOW) as u32;
        let pos = (diversity_ratio - WUE_DIVERSITY_LOW) as u32;
        WUE_WEIGHT_MIN + (pos * (WUE_WEIGHT_MAX - WUE_WEIGHT_MIN)) / range
    }
}

// ============================================================================
// Alpha Calculation Functions
// ============================================================================
// Caller-Specific Pricing & Temporal Inertia
// ============================================================================

/// Check if caller is a verified "VIP" (has positive history with this agent)
#[inline]
pub fn is_caller_verified(stats: &AtomStats, caller_fp: u64) -> bool {
    // Check ring buffer for positive non-revoked feedback
    for &packed in stats.recent_callers.iter() {
        if packed == 0 { continue; }
        let (stored_fp, score, revoked) = decode_caller_entry(packed);
        if stored_fp == caller_fp && !revoked && score >= V7_VIP_MIN_SCORE {
            return true;
        }
    }

    // Also check bypass fingerprints (Iron Dome victims)
    for &packed in stats.bypass_fingerprints.iter() {
        if packed == 0 { continue; }
        let (stored_fp, score, revoked) = decode_caller_entry(packed);
        if stored_fp == caller_fp && !revoked && score >= V7_VIP_MIN_SCORE {
            return true;
        }
    }

    false
}

/// Calculate discriminatory Sybil Tax based on caller history
/// Returns cost multiplier (shift amount for exponential pricing)
#[inline]
pub fn calculate_v7_tax_shift(stats: &AtomStats, caller_fp: u64) -> u32 {
    if stats.neg_pressure <= V7_PANIC_THRESHOLD {
        return 0;
    }

    // VIP Lane: verified callers exempt from tax
    if is_caller_verified(stats, caller_fp) {
        return 0;
    }

    // Unknown caller during attack: apply exponential tax
    let pressure_excess = (stats.neg_pressure - V7_PANIC_THRESHOLD) as u32;
    (pressure_excess / 5).min(10)
}

/// Compute alpha for degrading path with temporal inertia
#[inline]
fn compute_alpha_down_v8(stats: &AtomStats, base_alpha: u32, current_slot: u64, slot_delta: u64) -> u32 {
    let age_slots = current_slot.saturating_sub(stats.first_feedback_slot);
    let age_epochs = (age_slots / EPOCH_SLOTS) as u16;

    // Dormancy check
    let inactive_slots = slot_delta;
    let inactive_epochs = (inactive_slots / EPOCH_SLOTS) as u16;

    let base_temporal = (age_epochs / V7_TEMPORAL_INERTIA_EPOCHS)
        .max(1)
        .min(V7_TEMPORAL_INERTIA_MAX);

    // Dormant agents lose temporal inertia protection
    let temporal_inertia: u16 = if inactive_epochs >= V8_DORMANCY_EPOCHS {
        1
    } else if inactive_epochs >= 1 {
        base_temporal.min(4)
    } else {
        base_temporal
    };

    // Volume provides minor bonus (capped at 4)
    let volume_inertia = ((stats.feedback_count >> V7_VOLUME_INERTIA_SHIFT as u64) as u16)
        .max(1)
        .min(V7_VOLUME_INERTIA_MAX);

    // Time wins over volume
    let raw_inertia = temporal_inertia.max(volume_inertia);

    // Diversity gating (anti-Sybil)
    let sybil_cap = ((stats.diversity_ratio >> V7_DIVERSITY_CAP_SHIFT) as u16)
        .max(1)
        .min(V7_DIVERSITY_CAP_MAX);

    // Age penalty on inertia for sustained negatives
    let age_penalty_divisor: u16 = if stats.neg_pressure > V7_AGE_PENALTY_THRESHOLD && age_epochs > 1 {
        3
    } else {
        2
    };

    let effective_inertia = raw_inertia
        .saturating_mul(2)
        .saturating_div(age_penalty_divisor)
        .min(sybil_cap)
        .max(1);

    let mut alpha = (base_alpha / effective_inertia as u32).max(1);

    // Graded glass shield (newcomer protection)
    if stats.feedback_count < NEWCOMER_SHIELD_THRESHOLD && stats.neg_pressure < 2 {
        let shield_cap = if stats.feedback_count < 8 { 10 } else { 15 };
        alpha = alpha.min(shield_cap);
    }

    // Malice override for confirmed bad actors
    let persistent_neg = stats.neg_pressure >= 30;
    let enough_history = stats.feedback_count > NEWCOMER_SHIELD_THRESHOLD;
    let neg_dense = stats.neg_pressure >= 200;

    if persistent_neg && enough_history && neg_dense {
        let kill_floor = 12u32;
        alpha = alpha.max(kill_floor);
        alpha = (alpha + (alpha >> 1)).min(V7_ALPHA_MAX);
    }

    // ENTROPY GATE: Amplify alpha_down for repeat attackers (anti-griefing)
    // When HLL stagnates (same wallets repeating), increase penalty impact
    // Uses saturating_mul to safely increase impact of negative feedback from spammers
    let entropy_amplifier = (1 + (stats.updates_since_hll_change as u32 / ENTROPY_GATE_DIVISOR as u32))
        .min(ENTROPY_GATE_MAX_AMPLIFIER);

    alpha = alpha
        .saturating_mul(entropy_amplifier)
        .min(ALPHA_QUALITY_MAX_AMPLIFIED);

    alpha
}

/// Compute alpha for improving path
#[inline]
fn compute_alpha_up_v7(stats: &AtomStats, base_alpha: u32) -> u32 {
    let vol_penalty = (1 + (stats.ema_volatility >> 9) as u32).min(2);

    let effective_brake = if stats.neg_pressure == 0 {
        1
    } else {
        vol_penalty
    };

    (base_alpha / effective_brake).max(1)
}

/// Update quality score with anti-gaming protections
fn update_quality(
    stats: &mut AtomStats,
    score: u8,
    hll_changed: bool,
    slot_delta: u64,
    current_epoch: u16,
    current_slot: u64,
    config: &AtomConfig,
) {
    // Circuit breaker: dampen during freeze, never block negative
    let is_frozen = stats.freeze_epochs > 0;

    if is_frozen {
        // Decrement freeze on epoch change
        if current_epoch != stats.velocity_epoch {
            stats.freeze_epochs = stats.freeze_epochs.saturating_sub(1);
            stats.velocity_epoch = current_epoch;
            stats.quality_velocity = 0;
        }
    }

    // Reset velocity tracking on new epoch
    if current_epoch != stats.velocity_epoch {
        stats.velocity_epoch = current_epoch;
        stats.quality_velocity = 0;
    }

    let consistency = 100u32.saturating_sub(stats.ema_volatility as u32 / 100);
    let mut quality_delta: u32 = (score as u32 * consistency / 100) * 100;

    // Uniqueness bonus
    if hll_changed && stats.burst_pressure < config.bonus_max_burst_pressure {
        quality_delta = quality_delta.saturating_add(config.uniqueness_bonus as u32 * 100);
        stats.updates_since_hll_change = 0;
    } else {
        stats.updates_since_hll_change = stats.updates_since_hll_change.saturating_add(1);
    }

    // Loyalty bonus (capped to prevent farming)
    if !hll_changed && slot_delta > config.loyalty_min_slot_delta as u64 && stats.burst_pressure < config.burst_threshold {
        stats.loyalty_score = stats.loyalty_score.saturating_add(config.loyalty_bonus).min(LOYALTY_SCORE_MAX);
        quality_delta = quality_delta.saturating_add(config.loyalty_bonus as u32 * 100);
    }

    quality_delta = quality_delta.min(10000);

    // Determine if improving or degrading
    let is_improving = quality_delta > stats.quality_score as u32;

    // Alpha calculation with all protections
    let mut alpha = if is_improving {
        let base_alpha = compute_alpha_up_v7(stats, config.alpha_quality_up as u32);

        let wue_weight = calculate_wue_weight(stats.diversity_ratio);
        let alpha_with_wue = (base_alpha * wue_weight) / 100;

        let alpha_with_contradiction = if stats.neg_pressure > NEG_PRESSURE_THRESHOLD
            && stats.diversity_ratio < HEALTHY_DIVERSITY_THRESHOLD {
            alpha_with_wue / NEG_PRESSURE_DAMPENING
        } else {
            alpha_with_wue
        };

        stats.neg_pressure = stats.neg_pressure.saturating_sub(NEG_PRESSURE_DECAY);
        alpha_with_contradiction.max(2).min(V7_ALPHA_MAX)
    } else {
        stats.neg_pressure = stats.neg_pressure.saturating_add(NEG_PRESSURE_INCREMENT);
        compute_alpha_down_v8(stats, config.alpha_quality_down as u32, current_slot, slot_delta)
    };

    // During freeze, dampen BOTH directions symmetrically
    if is_frozen && stats.freeze_epochs > 0 {
        alpha = (alpha / 10).max(1);
    }

    let old_quality = stats.quality_score;
    stats.quality_score = ((alpha * quality_delta
        + (100 - alpha) * stats.quality_score as u32) / 100) as u16;

    // Enforce quality floor during freeze
    if is_frozen && stats.freeze_epochs > 0 {
        let floor_scaled = stats.quality_floor as u16 * 100;
        stats.quality_score = stats.quality_score.max(floor_scaled);
    }

    // Track quality velocity for circuit breaker
    let change_magnitude = old_quality.abs_diff(stats.quality_score);
    stats.quality_velocity = stats.quality_velocity.saturating_add(change_magnitude);

    // Trigger circuit breaker if velocity exceeds threshold
    if stats.quality_velocity > QUALITY_VELOCITY_THRESHOLD {
        if !is_frozen {
            // New freeze: set floor at 80% of current quality
            stats.quality_floor = ((stats.quality_score as u32 * 8) / 1000) as u8;
        }
        stats.freeze_epochs = QUALITY_FREEZE_EPOCHS;
    }
}

// ============================================================================
// Confidence Calculation
// ============================================================================

/// Update confidence using EMA (allows decrease when diversity drops)
fn update_confidence(stats: &mut AtomStats, hll_est: u64, config: &AtomConfig) {
    let n = stats.feedback_count;

    let count_factor = (n.min(100).saturating_mul(60)) as u32;
    let effective_unique = hll_est.min(n);
    let diversity_factor = (effective_unique.saturating_mul(40)).min(5000) as u32;

    let cold_penalty = if n < config.cold_start_min as u64 {
        config.cold_start_penalty_heavy as u32
    } else if n < config.cold_start_max as u64 {
        (config.cold_start_max as u64 - n) as u32 * config.cold_start_penalty_per_feedback as u32
    } else {
        0
    };

    let risk_penalty = if stats.risk_score > 50 {
        ((stats.risk_score - 50) as u32) * 50
    } else {
        0
    };

    let raw = (count_factor + diversity_factor)
        .saturating_sub(cold_penalty)
        .saturating_sub(risk_penalty);

    let target = raw.min(10000) as u16;

    stats.confidence = ((ALPHA_CONFIDENCE * target as u32
        + (100 - ALPHA_CONFIDENCE) * stats.confidence as u32) / 100) as u16;
}

// ============================================================================
// Trust Tier Classification with Vesting
// ============================================================================

/// Calculate raw tier based on quality/risk/confidence (without vesting)
#[inline]
fn calculate_raw_tier(stats: &AtomStats, config: &AtomConfig) -> u8 {
    let q = stats.quality_score;
    let r = stats.risk_score;
    let c = stats.confidence;
    let current = stats.tier_confirmed;
    let h = TIER_HYSTERESIS;

    let can_be_platinum = r <= config.tier_platinum_risk && c >= config.tier_platinum_confidence;
    let can_be_gold = r <= config.tier_gold_risk && c >= config.tier_gold_confidence;
    let can_be_silver = r <= config.tier_silver_risk && c >= config.tier_silver_confidence;
    let can_be_bronze = r <= config.tier_bronze_risk && c >= config.tier_bronze_confidence;

    if can_be_platinum &&
        (current == 4 && q >= config.tier_platinum_quality.saturating_sub(h) ||
         current < 4 && q >= config.tier_platinum_quality.saturating_add(h)) {
        4
    } else if can_be_gold &&
        (current >= 3 && q >= config.tier_gold_quality.saturating_sub(h) ||
         current < 3 && q >= config.tier_gold_quality.saturating_add(h)) {
        3
    } else if can_be_silver &&
        (current >= 2 && q >= config.tier_silver_quality.saturating_sub(h) ||
         current < 2 && q >= config.tier_silver_quality.saturating_add(h)) {
        2
    } else if can_be_bronze &&
        (current >= 1 && q >= config.tier_bronze_quality.saturating_sub(h) ||
         current < 1 && q >= config.tier_bronze_quality.saturating_add(h)) {
        1
    } else {
        0
    }
}

/// Update trust tier with vesting period for promotions
fn update_trust_tier(stats: &mut AtomStats, config: &AtomConfig) {
    let calculated_tier = calculate_raw_tier(stats, config).min(4);

    // During freeze, reset candidature
    if stats.freeze_epochs > 0 {
        stats.tier_candidate = 0;
        stats.tier_candidate_epoch = 0;
        stats.trust_tier = stats.tier_confirmed;
        return;
    }

    // Demotion is immediate
    if calculated_tier < stats.tier_confirmed {
        stats.tier_confirmed = calculated_tier;
        stats.tier_candidate = 0;
        stats.tier_candidate_epoch = 0;
        stats.trust_tier = stats.tier_confirmed;
        return;
    }

    // Promotion requires vesting
    if calculated_tier > stats.tier_confirmed {
        // Check loyalty before Platinum candidature
        let can_candidate_platinum = if calculated_tier >= 4 {
            stats.loyalty_score >= TIER_PLATINUM_MIN_LOYALTY
        } else {
            true
        };

        if !can_candidate_platinum {
            // Not enough loyalty for Platinum, cap at Gold
            let effective_tier = calculated_tier.min(3);
            if effective_tier > stats.tier_confirmed {
                if stats.tier_candidate != effective_tier {
                    stats.tier_candidate = effective_tier;
                    stats.tier_candidate_epoch = stats.current_epoch;
                }
            }
        } else {
            // Anti-oscillation: only reset timer if tier drops below candidate
            if stats.tier_candidate == 0 {
                stats.tier_candidate = calculated_tier;
                stats.tier_candidate_epoch = stats.current_epoch;
            } else if calculated_tier < stats.tier_candidate {
                stats.tier_candidate = calculated_tier;
                stats.tier_candidate_epoch = stats.current_epoch;
            }
        }

        // Check vesting completion
        let epochs_waiting = stats.current_epoch.saturating_sub(stats.tier_candidate_epoch);

        if epochs_waiting >= TIER_VESTING_EPOCHS && stats.tier_candidate > 0 {
            stats.tier_confirmed = stats.tier_candidate;

            if calculated_tier > stats.tier_confirmed {
                stats.tier_candidate = calculated_tier;
                stats.tier_candidate_epoch = stats.current_epoch;
            } else {
                stats.tier_candidate = 0;
                stats.tier_candidate_epoch = 0;
            }
        }
    } else {
        // Stable: reset candidature
        stats.tier_candidate = 0;
        stats.tier_candidate_epoch = 0;
    }

    stats.trust_tier = stats.tier_confirmed;
}

// ============================================================================
// Main Update Function (~4500 CU)
// ============================================================================

/// Update reputation stats with new feedback
pub fn update_stats(
    stats: &mut AtomStats,
    client_hash: &[u8; 32],
    score: u8,
    current_slot: u64,
    config: &AtomConfig,
) -> bool {
    let slot_delta = current_slot.saturating_sub(stats.last_feedback_slot);

    // Domain-separated fingerprint (56-bit)
    let caller_fp = secure_fp56(client_hash, &stats.asset);

    // Check if already in ring buffer or bypass buffer
    let existing_entry = find_caller_entry(&stats.recent_callers, caller_fp);
    let existing_bypass = find_bypass_entry(&stats.bypass_fingerprints, caller_fp);
    let is_known = existing_entry.is_some() || existing_bypass.is_some();
    let is_revoked = existing_entry.map(|(_, _, revoked)| revoked).unwrap_or(false)
        || existing_bypass.map(|(_, _, revoked)| revoked).unwrap_or(false);
    let is_recent = is_known && !is_revoked;

    // MRT-aware ring buffer update (preserve revoked status when updating)
    let (_wrote_to_buffer, bypassed) = if let Some((idx, _old_score, was_revoked)) = existing_entry {
        stats.recent_callers[idx] = encode_caller_entry(caller_fp, score, was_revoked);
        (true, false)
    } else if let Some((idx, _old_score, was_revoked)) = existing_bypass {
        stats.bypass_fingerprints[idx] = encode_caller_entry(caller_fp, score, was_revoked);
        (true, false)
    } else {
        // Try to push with MRT protection
        // Bypassed entries are now stored in bypass_fingerprints for revoke support
        push_caller_mrt(
            &mut stats.recent_callers,
            &mut stats.eviction_cursor,
            &mut stats.ring_base_slot,
            &mut stats.bypass_count,
            &mut stats.bypass_fingerprints,
            &mut stats.bypass_fp_cursor,
            caller_fp,
            score,
            current_slot,
        )
    };

    // Track bypass for metrics (only for real bypasses)
    if bypassed && _wrote_to_buffer {
        stats.bypass_score_avg = ((stats.bypass_score_avg as u16 + score as u16) / 2) as u8;
    }

    // Entry was dropped (bypass buffer saturated)
    if bypassed && !_wrote_to_buffer {
        stats.burst_pressure = stats.burst_pressure.saturating_add(BURST_INCREMENT * 2);
        return false;
    }

    // Burst pressure tracking
    if is_recent {
        stats.burst_pressure = stats.burst_pressure.saturating_add(BURST_INCREMENT);
    } else if !is_known {
        stats.burst_pressure = stats.burst_pressure.saturating_sub(BURST_DECAY_LINEAR);
    }

    // Revoked users don't affect stats
    if is_revoked {
        return false;
    }

    // Velocity-based burst detection
    if slot_delta < VELOCITY_MIN_SLOT_DELTA {
        stats.burst_pressure = stats.burst_pressure.saturating_add(VELOCITY_BURST_PENALTY);
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

        // Initialize MRT fields
        stats.ring_base_slot = current_slot;
        stats.velocity_epoch = (current_slot / EPOCH_SLOTS) as u16;

        // Generate per-agent HLL salt
        let asset_bytes = stats.asset.to_bytes();
        let mut salt_seed = [0u8; 40];
        salt_seed[0..32].copy_from_slice(&asset_bytes);
        salt_seed[32..40].copy_from_slice(&current_slot.to_le_bytes());
        stats.hll_salt = u64::from_le_bytes(
            anchor_lang::solana_program::keccak::hash(&salt_seed).0[0..8]
                .try_into()
                .expect("keccak hash is [u8; 32], slice [0..8] always fits [u8; 8]"),
        );
    }

    // Update core metrics
    stats.last_feedback_slot = current_slot;
    stats.last_score = score;
    stats.feedback_count = stats.feedback_count.saturating_add(1);
    stats.min_score = stats.min_score.min(score);
    stats.max_score = stats.max_score.max(score);

    // Epoch tracking with low-diversity decay
    let new_epoch = (current_slot / EPOCH_SLOTS) as u16;
    if new_epoch != stats.current_epoch {
        if stats.diversity_ratio < EPOCH_DECAY_DIVERSITY_THRESHOLD && stats.feedback_count > COLD_START_MAX {
            stats.quality_score = ((stats.quality_score as u32 * EPOCH_DECAY_PERCENT) / 100) as u16;
        }
        stats.current_epoch = new_epoch;
        stats.epoch_count = stats.epoch_count.saturating_add(1);
    }

    // HLL update with slot-gating and rotating salt
    let salted_hash = salt_hash_with_asset(client_hash, &stats.asset);
    let slot_entropy = current_slot / HLL_SALT_ROTATION_PERIOD;
    let effective_salt = stats.hll_salt ^ slot_entropy;
    let hll_changed = if slot_delta >= HLL_COOLDOWN_SLOTS || stats.feedback_count == 0 {
        hll_add(&mut stats.hll_packed, &salted_hash, effective_salt)
    } else {
        false
    };
    let hll_est = hll_estimate(&stats.hll_packed);

    // All updates
    let current_epoch = stats.current_epoch;
    update_ema(stats, score, slot_delta, config);
    update_quality(stats, score, hll_changed, slot_delta, current_epoch, current_slot, config);
    stats.risk_score = calculate_risk(stats, hll_est, config);
    stats.diversity_ratio = safe_div(hll_est.saturating_mul(255), stats.feedback_count.max(1)).min(255) as u8;
    update_confidence(stats, hll_est, config);
    update_trust_tier(stats, config);

    hll_changed
}

// ============================================================================
// Migration Support
// ============================================================================

/// Handle schema migrations if needed
pub fn maybe_migrate(stats: &mut AtomStats) {
    if stats.schema_version != AtomStats::SCHEMA_VERSION {
        stats.schema_version = AtomStats::SCHEMA_VERSION;
    }
}
