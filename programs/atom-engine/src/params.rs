// ============================================================================
// ATOM Engine v1.0 - Tunable Parameters
// ============================================================================
//
// All algorithm parameters in one place.
// These can be overridden by AtomConfig PDA for runtime tuning.

// ============================================================================
// EMA Parameters (scaled by 100, e.g., 30 = 0.30 alpha)
// ============================================================================

/// Fast EMA smoothing factor (α = 0.30)
/// Reacts quickly to recent scores, good for detecting sudden changes
pub const ALPHA_FAST: u32 = 30;

/// Slow EMA smoothing factor (α = 0.05)
/// Stable long-term trend, resistant to short-term manipulation
pub const ALPHA_SLOW: u32 = 5;

/// Volatility EMA smoothing factor (α = 0.20)
/// Tracks score consistency over time
pub const ALPHA_VOLATILITY: u32 = 20;

/// Arrival rate EMA smoothing factor (α = 0.10)
/// Tracks feedback frequency patterns
pub const ALPHA_ARRIVAL: u32 = 10;

/// Quality score EMA smoothing factor (α = 0.10)
/// Combines score with consistency for positive metric
pub const ALPHA_QUALITY: u32 = 10;

/// Burst pressure EMA increase rate (α = 0.30)
/// How fast burst pressure rises on repeat caller
pub const ALPHA_BURST_UP: u32 = 30;

/// Burst pressure EMA decay rate (multiplier = 0.70)
/// How fast burst pressure decays on new caller
pub const ALPHA_BURST_DOWN: u32 = 70;

// ============================================================================
// Risk Weights (sum = 15 for normalization)
// ============================================================================

/// Sybil risk weight (low diversity = high risk)
pub const WEIGHT_SYBIL: u32 = 3;

/// Burst risk weight (repeated same caller)
pub const WEIGHT_BURST: u32 = 4;

/// Stagnation risk weight (no new unique clients)
pub const WEIGHT_STAGNATION: u32 = 2;

/// Shock risk weight (fast/slow EMA divergence)
pub const WEIGHT_SHOCK: u32 = 3;

/// Volatility risk weight (inconsistent scores)
pub const WEIGHT_VOLATILITY: u32 = 2;

/// Arrival rate risk weight (very fast feedback cadence)
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

/// Arrival log below this triggers fast-arrival risk (ilog2 * 100 scale)
pub const ARRIVAL_FAST_THRESHOLD: u16 = 500;

/// Minimum stagnation threshold (dynamic, scales with HLL)
pub const STAGNATION_THRESHOLD_MIN: u8 = 3;

/// Maximum stagnation threshold
pub const STAGNATION_THRESHOLD_MAX: u8 = 20;

// ============================================================================
// Trust Tier Thresholds (quality_min, risk_max, confidence_min)
// ============================================================================

/// Platinum tier: top agents with excellent reputation
pub const TIER_PLATINUM: (u16, u8, u16) = (7000, 15, 8000);

/// Gold tier: very good agents
pub const TIER_GOLD: (u16, u8, u16) = (5000, 30, 6000);

/// Silver tier: good agents
pub const TIER_SILVER: (u16, u8, u16) = (3000, 50, 4000);

/// Bronze tier: acceptable agents
pub const TIER_BRONZE: (u16, u8, u16) = (1000, 70, 2000);

// ============================================================================
// Cold Start Parameters
// ============================================================================

/// Minimum feedbacks before any confidence
pub const COLD_START_MIN: u64 = 5;

/// Feedbacks needed for full confidence (gradual ramp)
pub const COLD_START_MAX: u64 = 30;

/// Heavy penalty during cold start (0-10000 scale)
pub const COLD_START_PENALTY_HEAVY: u32 = 8000;

/// Penalty reduction per feedback during ramp
pub const COLD_START_PENALTY_PER_FEEDBACK: u32 = 200;

// ============================================================================
// Bonus/Loyalty Parameters
// ============================================================================

/// Bonus for unique client (HLL register changed)
pub const UNIQUENESS_BONUS: u16 = 15;

/// Bonus for loyal repeat (slow return)
pub const LOYALTY_BONUS: u16 = 5;

/// Minimum slot delta for loyalty bonus (not spam)
pub const LOYALTY_MIN_SLOT_DELTA: u64 = 2000;

/// Maximum burst pressure for bonuses to apply
pub const BONUS_MAX_BURST_PRESSURE: u8 = 20;

// ============================================================================
// Epoch & Decay Parameters
// ============================================================================

/// Slots per epoch (~2.5 days on Solana mainnet, 400ms slots)
pub const EPOCH_SLOTS: u64 = 432_000;

/// Confidence decay per inactive epoch
pub const INACTIVE_DECAY_PER_EPOCH: u16 = 500;

/// Maximum epochs of inactivity to consider for decay
pub const MAX_INACTIVE_EPOCHS: u64 = 10;

// ============================================================================
// HLL Parameters
// ============================================================================

/// Number of HLL registers (48 = good balance of accuracy vs size)
pub const HLL_REGISTERS: usize = 48;

/// Maximum rho value (4-bit registers)
pub const HLL_MAX_RHO: u8 = 15;

/// Alpha constant for HLL estimation (0.709 * 48^2 * 65536)
pub const HLL_ALPHA_M2_SCALED: u64 = 107_055_104;

/// Linear counting threshold
pub const HLL_LINEAR_COUNTING_THRESHOLD: u64 = 120;

// ============================================================================
// Checkpoint Parameters
// ============================================================================

/// Minimum feedbacks between checkpoints
pub const CHECKPOINT_INTERVAL: u64 = 100;
