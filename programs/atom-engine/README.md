# ATOM - Agent Trust On-chain Model

> On-chain reputation scoring engine for AI agents on Solana

**Program ID**: `B8Q2nXG7FT89Uau3n41T2qcDLAWxcaQggGqwFWGCEpr7`

## Why On-Chain?

On-chain reputation is **verifiable** (open algorithm), **immutable** (no silent deletions), and **composable** (other programs can read scores via CPI). The tradeoff is ~$0.80/agent storage cost.

**Core principle**: Good reputation = quality (high scores) + diversity (many unique clients). 100 perfect scores from 3 wallets is suspicious. 80-average from 50 clients is trustworthy.

## Overview

ATOM computes and stores reputation metrics for AI agents:

- **Dual-EMA System**: Fast (α=0.30) and Slow (α=0.05) moving averages for trend detection
- **HyperLogLog**: 256-register probabilistic counter for unique client estimation (~6.5% error)
- **Ring Buffer**: 24-slot buffer with 56-bit fingerprints for burst detection and revoke
- **Per-Agent Salt**: Random salt prevents cross-agent HLL grinding attacks
- **Round Robin Eviction**: Cursor-based eviction prevents targeted manipulation
- **Multi-signal Risk Score**: Sybil, burst, stagnation, shock, volatility

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ATOM Engine                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────────────────────────────────┐ │
│  │ AtomConfig  │    │             AtomStats                    │ │
│  │   (PDA)     │    │              (PDA)                       │ │
│  │             │    │                                          │ │
│  │ - authority │    │ - collection, asset (identity)          │ │
│  │ - params    │    │ - feedback_count, slots (core)          │ │
│  │ - weights   │    │ - ema_fast, ema_slow, volatility (EMA)  │ │
│  │ - thresholds│    │ - hll_packed[128], hll_salt (HLL)       │ │
│  │             │    │ - recent_callers[24], cursor (ring buf) │ │
│  └─────────────┘    │ - quality, risk, tier, confidence       │ │
│                     └─────────────────────────────────────────┘ │
│                                                                  │
│  Instructions:                                                   │
│  ├── initialize_config    (authority only)                      │
│  ├── update_stats         (CPI from agent-registry)             │
│  └── revoke_stats         (CPI from agent-registry)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## PDAs

| Account | Seeds | Size | Rent |
|---------|-------|------|------|
| AtomConfig | `["atom_config"]` | ~144 bytes | ~0.0014 SOL |
| AtomStats | `["atom_stats", asset]` | 476 bytes | ~0.0041 SOL |

## AtomStats Structure (476 bytes)

```rust
pub struct AtomStats {
    // Identity (64 bytes)
    pub collection: Pubkey,          // 32 - Collection filter
    pub asset: Pubkey,               // 32 - Agent identifier

    // Core (24 bytes)
    pub first_feedback_slot: u64,    // 8 - First feedback timestamp
    pub last_feedback_slot: u64,     // 8 - Last feedback timestamp
    pub feedback_count: u64,         // 8 - Total feedbacks

    // Dual-EMA (12 bytes)
    pub ema_score_fast: u16,         // α=0.30, scale 0-10000
    pub ema_score_slow: u16,         // α=0.05, scale 0-10000
    pub ema_volatility: u16,         // |fast - slow|
    pub ema_arrival_log: u16,        // ilog2(slot_delta)
    pub peak_ema: u16,               // Historical peak
    pub max_drawdown: u16,           // Peak - current

    // Epoch & Bounds (8 bytes)
    pub epoch_count: u16,            // Distinct epochs
    pub current_epoch: u16,          // Current epoch
    pub min_score: u8,               // Min score ever
    pub max_score: u8,               // Max score ever
    pub first_score: u8,             // First score
    pub last_score: u8,              // Last score

    // HyperLogLog (128 bytes = 256 regs × 4 bits)
    pub hll_packed: [u8; 128],       // ~6.5% error unique estimation

    // HLL Salt (8 bytes)
    pub hll_salt: u64,               // Per-agent salt (grinding resistance)

    // Ring Buffer (196 bytes)
    pub recent_callers: [u64; 24],   // 56-bit fp + 7-bit score + revoked flag
    pub burst_pressure: u8,          // EMA of repeat callers
    pub updates_since_hll_change: u8,// Stagnation detection
    pub neg_pressure: u8,            // Negative momentum
    pub eviction_cursor: u8,         // Round robin pointer

    // MRT Eviction Protection (8 bytes)
    pub ring_base_slot: u64,         // Slot when current ring window started

    // Quality Circuit Breaker (6 bytes)
    pub quality_velocity: u16,       // Quality change magnitude this epoch
    pub velocity_epoch: u16,         // Epoch when velocity tracking started
    pub freeze_epochs: u8,           // Epochs remaining in freeze
    pub quality_floor: u8,           // Floor quality during freeze

    // Bypass Tracking (2 bytes)
    pub bypass_count: u8,            // Bypassed writes in current window
    pub bypass_score_avg: u8,        // Average of bypassed scores

    // Output Cache (12 bytes)
    pub loyalty_score: u16,
    pub quality_score: u16,          // 0-10000
    pub risk_score: u8,              // 0-100
    pub diversity_ratio: u8,         // 0-255
    pub trust_tier: u8,              // 0-4
    pub flags: u8,
    pub confidence: u16,             // 0-10000
    pub bump: u8,
    pub schema_version: u8,
}
```

## Trust Tiers

| Tier | Value | Quality Min | Risk Max | Confidence Min |
|------|-------|-------------|----------|----------------|
| Platinum | 4 | ≥7000 | ≤15 | ≥6000 |
| Gold | 3 | ≥5000 | ≤30 | ≥4500 |
| Silver | 2 | ≥3000 | ≤50 | ≥3000 |
| Bronze | 1 | ≥1000 | ≤70 | ≥800 |
| Unrated | 0 | - | - | - |

## Risk Signals

| Signal | Weight | Detection |
|--------|--------|-----------|
| Sybil | 3 | Low diversity ratio (HLL/count) |
| Burst | 4 | Repeated caller in ring buffer |
| Stagnation | 2 | No new HLL register updates |
| Shock | 3 | Fast/slow EMA divergence |
| Volatility | 2 | High |fast - slow| over time |
| Arrival | 1 | Very fast feedback cadence |

## Key Algorithms

### HyperLogLog (Unique Client Estimation)

256 registers, 4-bit packed (128 bytes). Estimates unique clients with ~6.5% standard error.

```rust
// Per-agent salt prevents grinding attacks
salted_hash = client_hash ^ hll_salt
register_idx = salted_hash % 256
leading_zeros = count_leading_zeros(salted_hash)
registers[idx] = max(registers[idx], leading_zeros + 1)
```

### Ring Buffer (Burst Detection & Revoke)

24 slots with 56-bit fingerprints. Round-robin eviction prevents manipulation.

```rust
// Entry encoding: bits 0-55 = fingerprint, 56-62 = score, 63 = revoked
fingerprint = keccak256("ATOM_FEEDBACK_V1" || asset || client_hash)[0..7]

// Round-robin eviction
slot = eviction_cursor % 24
recent_callers[slot] = encode(fingerprint, score, revoked)
eviction_cursor += 1
```

### Asymmetric Quality EMA

Anti-whitewashing: slow to improve (α=0.05), fast to degrade (α=0.25).

```rust
if score > 50 {
    alpha = ALPHA_QUALITY_UP   // 5 (slow improvement)
} else {
    alpha = ALPHA_QUALITY_DOWN // 25 (fast penalty)
}
quality_score = (quality_score * (100 - alpha) + new_score * alpha) / 100
```

## Integration with agent-registry-8004

ATOM is called via CPI from `agent-registry-8004`:

```
agent-registry-8004                 atom-engine
      │                                  │
      │  give_feedback()                 │
      │  ─────────────────────────────►  │
      │        CPI: update_stats()       │
      │                                  │  Update HLL, ring buffer, EMA
      │                                  │  Compute risk, quality, tier
      │  ◄─────────────────────────────  │
      │        Returns: UpdateResult     │
      │                                  │
      │  revoke_feedback()               │
      │  ─────────────────────────────►  │
      │        CPI: revoke_stats()       │
      │                                  │  Mark entry in ring buffer
      │                                  │  Adjust quality score
      │  ◄─────────────────────────────  │
      │        Returns: RevokeResult     │
```

## CPI Return Values

### UpdateResult
```rust
pub struct UpdateResult {
    pub trust_tier: u8,
    pub quality_score: u16,
    pub confidence: u16,
    pub risk_score: u8,
    pub diversity_ratio: u8,
    pub hll_changed: bool,
}
```

### RevokeResult
```rust
pub struct RevokeResult {
    pub original_score: u8,
    pub had_impact: bool,
    pub new_trust_tier: u8,
    pub new_quality_score: u16,
    pub new_confidence: u16,
}
```

## Compute Units

| Operation | CU |
|-----------|-----|
| update_stats | ~4,500 |
| revoke_stats | ~3,000 |

## Tunable Parameters

All parameters can be updated via `AtomConfig` without program upgrade:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `alpha_fast` | 30 | Fast EMA α (÷100) |
| `alpha_slow` | 5 | Slow EMA α (÷100) |
| `alpha_quality_up` | 5 | Quality improvement α |
| `alpha_quality_down` | 25 | Quality penalty α |
| `weight_sybil` | 3 | Sybil risk weight |
| `weight_burst` | 4 | Burst risk weight |
| `diversity_threshold` | 50 | Sybil trigger (0-255) |
| `burst_threshold` | 30 | Burst trigger |
| `tier_platinum_quality` | 7000 | Platinum min quality |

## Security Features

- **Per-Agent HLL Salt**: Prevents pre-computing HLL collisions across agents
- **Round Robin Eviction**: Prevents targeted eviction of specific feedbacks
- **Domain-Separated Fingerprints**: `keccak256("ATOM_FEEDBACK_V1" || asset || client_hash)`
- **CPI Caller Verification**: Only agent-registry-8004 can call update/revoke
- **Asymmetric EMA**: Hard to whitewash reputation, easy to penalize bad actors
- **MRT Eviction Protection**: Minimum 150 slots (~60s) residency before eviction
- **Quality Circuit Breaker**: Freezes quality updates on excessive velocity
- **Capped Recovery Multipliers**: Elastic/veteran recovery capped at 10% alpha

## References

- [HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm](http://algo.inria.fr/flajolet/Publications/FlFuGaMe07.pdf) - Flajolet et al., 2007
- [HyperLogLog in Practice](https://research.google/pubs/pub40671/) - Google, 2013
- [Exponential Smoothing](https://en.wikipedia.org/wiki/Exponential_smoothing) - EMA fundamentals

## License

MIT
