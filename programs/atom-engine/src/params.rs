// ============================================================================
// ATOM Engine - Tunable Parameters
// ============================================================================
//
// All algorithm parameters in one place.
// These can be overridden by AtomConfig PDA for runtime tuning.

// ============================================================================
// EMA Parameters (scaled by 100, e.g., 30 = 0.30 alpha)
// ============================================================================

/// Fast EMA smoothing factor (α = 0.30)
pub const ALPHA_FAST: u32 = 30;

/// Slow EMA smoothing factor (α = 0.05)
pub const ALPHA_SLOW: u32 = 5;

/// Volatility EMA smoothing factor (α = 0.20)
pub const ALPHA_VOLATILITY: u32 = 20;

/// Arrival rate EMA smoothing factor (α = 0.10)
pub const ALPHA_ARRIVAL: u32 = 10;

/// Quality score EMA smoothing factor - DEPRECATED, use UP/DOWN
pub const ALPHA_QUALITY: u32 = 10;

/// Asymmetric Quality EMA: slow to improve (anti-whitewashing)
pub const ALPHA_QUALITY_UP: u32 = 5;

/// Asymmetric Quality EMA: fast to degrade (quick penalty)
pub const ALPHA_QUALITY_DOWN: u32 = 25;

/// Confidence EMA smoothing factor (α = 0.05)
pub const ALPHA_CONFIDENCE: u32 = 5;

/// Probation threshold: quality below this triggers dampened recovery
pub const PROBATION_THRESHOLD: u16 = 3000;

/// Probation dampening factor: divide alpha_up by this when in probation
pub const PROBATION_DAMPENING: u32 = 3;

/// Tier shielding minimum tier: tier >= this gets shielding from nuking attacks
pub const TIER_SHIELD_THRESHOLD: u8 = 3;

/// Tier shielding dampening factor: divide alpha_down by this for shielded agents
pub const TIER_SHIELD_DAMPENING: u32 = 2;

/// Newcomer shielding: first N feedbacks get reduced alpha_down
pub const NEWCOMER_SHIELD_THRESHOLD: u64 = 20;

/// Velocity burst threshold (slot delta below this = too fast)
pub const VELOCITY_MIN_SLOT_DELTA: u64 = 3;

/// Velocity burst penalty added to burst_pressure when too fast
pub const VELOCITY_BURST_PENALTY: u8 = 15;

/// Burst-negative threshold: when burst_pressure > this AND negative feedback
pub const BURST_NEGATIVE_THRESHOLD: u8 = 20;

/// Burst-negative dampening factor - DEPRECATED
pub const BURST_NEGATIVE_DAMPENING: u32 = 3;

/// Burst-negative amplifier: multiply alpha_down during suspicious burst patterns
pub const BURST_NEGATIVE_AMPLIFIER: u32 = 2;

/// Burst pressure linear increment when repeat caller detected
pub const BURST_INCREMENT: u8 = 2;

/// Burst pressure linear decay when new caller detected
pub const BURST_DECAY_LINEAR: u8 = 1;

/// Elastic recovery multiplier when fast_ema < slow_ema
pub const ELASTIC_RECOVERY_MULTIPLIER: u32 = 2;

/// Veteran recovery bonus for high-confidence agents
pub const VETERAN_RECOVERY_BONUS: u32 = 2;

/// Confidence threshold for veteran status
pub const VETERAN_CONFIDENCE_THRESHOLD: u16 = 4500;

/// Healthy diversity threshold for probation bypass
pub const HEALTHY_DIVERSITY_THRESHOLD: u8 = 50;

/// HLL update cooldown in slots to prevent single-block stuffing
pub const HLL_COOLDOWN_SLOTS: u64 = 2;

// ============================================================================
// Anti-Cartel Parameters
// ============================================================================

/// WUE (Weighted-Unique Endorsement) thresholds
pub const WUE_DIVERSITY_LOW: u8 = 20;
pub const WUE_DIVERSITY_HIGH: u8 = 50;
pub const WUE_WEIGHT_MIN: u32 = 25;
pub const WUE_WEIGHT_MAX: u32 = 100;

/// Negative pressure constants (contradiction penalty)
pub const NEG_PRESSURE_INCREMENT: u8 = 15;
pub const NEG_PRESSURE_DECAY: u8 = 2;
pub const NEG_PRESSURE_THRESHOLD: u8 = 30;
pub const NEG_PRESSURE_DAMPENING: u32 = 2;

/// Epoch decay under low diversity
pub const EPOCH_DECAY_DIVERSITY_THRESHOLD: u8 = 35;
pub const EPOCH_DECAY_PERCENT: u32 = 98;

// ============================================================================
// Anti-Griefing Parameters
// ============================================================================

/// Volatility-indexed griefing shield divisor
pub const VOLATILITY_SHIELD_DIVISOR: u32 = 500;
pub const VOLATILITY_SHIELD_MAX: u32 = 4;

/// Entropy-gated alpha_down parameters (for repeat attacker amplification)
pub const ENTROPY_GATE_DIVISOR: u8 = 3;
pub const ENTROPY_GATE_MAX_DAMPENING: u32 = 4; // DEPRECATED: kept for backward compat
pub const ENTROPY_GATE_MAX_AMPLIFIER: u32 = 3; // Max 3x amplification for repeat attackers
pub const ALPHA_QUALITY_MAX_AMPLIFIED: u32 = 75; // Cap amplified alpha_down at 75

/// Newcomer alpha_down cap to protect bootstrapping agents
pub const NEWCOMER_ALPHA_DOWN_CAP: u32 = 10;

/// Burst pressure EMA rates - DEPRECATED, kept for backwards compatibility
pub const ALPHA_BURST_UP: u32 = 30;
pub const ALPHA_BURST_DOWN: u32 = 70;

// ============================================================================
// Risk Weights (sum = 15 for normalization)
// ============================================================================

pub const WEIGHT_SYBIL: u32 = 3;
pub const WEIGHT_BURST: u32 = 4;
pub const WEIGHT_STAGNATION: u32 = 2;
pub const WEIGHT_SHOCK: u32 = 3;
pub const WEIGHT_VOLATILITY: u32 = 2;
pub const WEIGHT_ARRIVAL: u32 = 1;

// ============================================================================
// Risk Thresholds
// ============================================================================

/// Diversity ratio below this triggers Sybil risk (0-255 scale)
pub const DIVERSITY_THRESHOLD: u8 = 50;

/// Burst pressure above this triggers burst risk
pub const BURST_THRESHOLD: u8 = 30;

/// Fast/slow EMA difference above this triggers shock risk (0-10000 scale)
pub const SHOCK_THRESHOLD: u16 = 2000;

/// Volatility above this triggers volatility risk (0-10000 scale)
pub const VOLATILITY_THRESHOLD: u16 = 1500;

/// Arrival log below this triggers fast-arrival risk
pub const ARRIVAL_FAST_THRESHOLD: u16 = 500;

/// Stagnation thresholds (dynamic, scales with HLL)
pub const STAGNATION_THRESHOLD_MIN: u8 = 3;
pub const STAGNATION_THRESHOLD_MAX: u8 = 20;

// ============================================================================
// Trust Tier Thresholds (quality_min, risk_max, confidence_min)
// ============================================================================

pub const TIER_PLATINUM: (u16, u8, u16) = (7000, 15, 6000);
pub const TIER_GOLD: (u16, u8, u16) = (5000, 30, 4500);
pub const TIER_SILVER: (u16, u8, u16) = (3000, 50, 3000);
pub const TIER_BRONZE: (u16, u8, u16) = (1000, 70, 800);

// ============================================================================
// Tier Hysteresis
// ============================================================================

/// Hysteresis margin for tier promotion/demotion to prevent gaming
pub const TIER_HYSTERESIS: u16 = 200;

// ============================================================================
// Cold Start Parameters
// ============================================================================

/// Minimum feedbacks before any confidence
pub const COLD_START_MIN: u64 = 5;

/// Feedbacks needed for full confidence
pub const COLD_START_MAX: u64 = 15;

/// Heavy penalty during cold start (0-10000 scale)
pub const COLD_START_PENALTY_HEAVY: u32 = 4000;

/// Penalty reduction per feedback during ramp
pub const COLD_START_PENALTY_PER_FEEDBACK: u32 = 400;

// ============================================================================
// Bonus/Loyalty Parameters
// ============================================================================

/// Bonus for unique client (HLL register changed)
pub const UNIQUENESS_BONUS: u16 = 15;

/// Bonus for loyal repeat (slow return)
pub const LOYALTY_BONUS: u16 = 5;

/// Maximum loyalty score (F99: prevents unbounded accumulation via bot farming)
pub const LOYALTY_SCORE_MAX: u16 = 1000;

/// Minimum slot delta for loyalty bonus
pub const LOYALTY_MIN_SLOT_DELTA: u64 = 2000;

/// Maximum burst pressure for bonuses to apply
pub const BONUS_MAX_BURST_PRESSURE: u8 = 20;

// ============================================================================
// Epoch & Decay Parameters
// ============================================================================

/// Slots per epoch (~2.5 days on Solana mainnet)
pub const EPOCH_SLOTS: u64 = 432_000;

/// Confidence decay per inactive epoch
pub const INACTIVE_DECAY_PER_EPOCH: u16 = 500;

/// Maximum epochs of inactivity to consider
pub const MAX_INACTIVE_EPOCHS: u64 = 10;

/// Severe dormancy threshold in epochs (~12.5 days)
pub const SEVERE_DORMANCY_EPOCHS: u64 = 5;

/// Severe dormancy decay multiplier
pub const SEVERE_DORMANCY_MULTIPLIER: u16 = 3;

// ============================================================================
// HLL Parameters
// ============================================================================

/// Number of HLL registers (256 regs = ~6.5% error, 128 bytes storage)
pub const HLL_REGISTERS: usize = 256;

/// Maximum rho value (4-bit registers)
pub const HLL_MAX_RHO: u8 = 15;

/// Alpha constant for HLL estimation (0.709 * m^2 * 65536)
pub const HLL_ALPHA_M2_SCALED: u64 = 3_045_994_599;

/// Linear counting threshold (roughly 2.5 * m)
pub const HLL_LINEAR_COUNTING_THRESHOLD: u64 = 640;

/// Salt rotation period in slots (~2.5 hours on Solana mainnet)
/// Breaks pre-mining attacks by invalidating pre-computed keypairs periodically
pub const HLL_SALT_ROTATION_PERIOD: u64 = 10_000;

// ============================================================================
// MRT (Minimum Residency Time) Parameters
// ============================================================================

/// Minimum slots an entry must stay in ring buffer before eviction (~60 seconds)
pub const MRT_MIN_SLOTS: u64 = 150;

/// Maximum bypass count before forcing eviction (prevents infinite bypass)
pub const MRT_MAX_BYPASS: u8 = 10;

// ============================================================================
// Quality Circuit Breaker Parameters
// ============================================================================

/// Quality velocity threshold that triggers circuit breaker (sum of changes)
pub const QUALITY_VELOCITY_THRESHOLD: u16 = 2000;

/// Epochs to freeze quality updates when circuit breaker triggers
pub const QUALITY_FREEZE_EPOCHS: u8 = 2;

/// Maximum alpha for quality updates (caps elastic recovery abuse)
pub const ALPHA_QUALITY_MAX: u32 = 10;

// ============================================================================
// "Sovereign" Parameters - Caller-Specific Pricing & Temporal Inertia
// ============================================================================

/// Panic threshold for dynamic pricing (neg_pressure above this triggers tax)
pub const V7_PANIC_THRESHOLD: u8 = 30;

/// Diversity floor for panic salt rotation (low diversity = under Sybil attack)
pub const V7_PANIC_DIVERSITY_FLOOR: u8 = 100;

/// Minimum positive score to be considered a "VIP" (verified caller)
pub const V7_VIP_MIN_SCORE: u8 = 30;

/// Epochs per temporal inertia unit (1 inertia per 4 epochs of existence)
pub const V7_TEMPORAL_INERTIA_EPOCHS: u16 = 4;

/// Maximum temporal inertia (cap at 10)
pub const V7_TEMPORAL_INERTIA_MAX: u16 = 10;

/// Volume-based inertia divisor (feedback_count >> 6 = /64)
pub const V7_VOLUME_INERTIA_SHIFT: u8 = 6;

/// Maximum volume-based inertia (cap at 4)
pub const V7_VOLUME_INERTIA_MAX: u16 = 4;

/// Diversity cap divisor (>> 4 = /16)
pub const V7_DIVERSITY_CAP_SHIFT: u8 = 4;

/// Maximum diversity cap (12 for more headroom for legitimate agents)
pub const V7_DIVERSITY_CAP_MAX: u16 = 12;

/// Age penalty threshold (neg_pressure must exceed this with epochs > 1)
pub const V7_AGE_PENALTY_THRESHOLD: u8 = 20;

/// Age penalty multiplier (alpha * 3/2 for old agents with sustained negatives)
pub const V7_AGE_PENALTY_NUMERATOR: u32 = 3;
pub const V7_AGE_PENALTY_DENOMINATOR: u32 = 2;

/// Maximum alpha after all adjustments
pub const V7_ALPHA_MAX: u32 = 50;

/// Panic salt rotation XOR mask (DEPRECATED)
pub const V7_PANIC_SALT_MASK: u64 = 0xDEAD_BEEF_CAFE_BABE;

// ============================================================================
// Temporal Inertia and Salt Hardening Parameters
// ============================================================================

/// Dormancy threshold in epochs (agents inactive >= this lose temporal inertia)
/// Mitigates sleeper cell attacks.
pub const V8_DORMANCY_EPOCHS: u16 = 2;

/// Salt entropy mixing constant (SplitMix64-style)
/// Mitigates predictive salt by adding non-slot entropy.
pub const V8_SALT_MIX_CONSTANT: u64 = 0x517c_c1b7_2722_0a95;

// ============================================================================
// Tier Vesting Parameters
// ============================================================================

/// Epochs of vesting before tier promotion (8 epochs ≈ 20 days)
/// Prevents instant Platinum promotion, oscillation griefing, and promotion during freezes.
pub const TIER_VESTING_EPOCHS: u16 = 8;

/// Minimum loyalty score for Platinum candidature (anti-Sybil)
/// Check loyalty before candidature to prevent late loyalty injection.
/// 500 = requires multiple returning customers over time
pub const TIER_PLATINUM_MIN_LOYALTY: u16 = 500;
