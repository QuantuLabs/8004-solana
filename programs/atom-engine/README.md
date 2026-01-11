# ATOM - Agent Trust On-chain Model

> On-chain reputation scoring engine for AI agents on Solana

**Program ID**: `AToMNGXU9X5o9r2wg2d9xZnMQkGy6fypHs3c6DZd8VUp`

## Overview

ATOM is a standalone Solana program that computes and stores reputation metrics for AI agents. It uses a sophisticated statistical model with:

- **Dual-EMA System**: Fast (α=0.30) and Slow (α=0.05) exponential moving averages for trend detection
- **HyperLogLog**: 48-register probabilistic counter for unique client estimation (~15% error)
- **Burst Detection**: 3-slot ring buffer + pressure EMA to detect manipulation patterns
- **Multi-signal Risk Score**: Sybil, burst, stagnation, shock, volatility, arrival rate

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ATOM Engine                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────┐    │
│  │ AtomConfig  │    │  AtomStats  │    │  AtomCheckpoint  │    │
│  │   (PDA)     │    │   (PDA)     │    │     (PDA)        │    │
│  │             │    │             │    │                  │    │
│  │ - authority │    │ - dual EMA  │    │ - stats snapshot │    │
│  │ - params    │    │ - HLL[48]   │    │ - feedback_index │    │
│  │ - weights   │    │ - burst     │    │ - checkpoint_hash│    │
│  │ - thresholds│    │ - quality   │    │                  │    │
│  └─────────────┘    │ - risk      │    └──────────────────┘    │
│                     │ - tier      │                             │
│                     └─────────────┘                             │
│                                                                  │
│  Instructions:                                                   │
│  ├── initialize_config    (authority)                           │
│  ├── update_config        (authority)                           │
│  ├── update_stats         (CPI or direct)                       │
│  ├── create_checkpoint    (permissionless)                      │
│  ├── restore_from_checkpoint (authority)                        │
│  └── replay_batch         (authority)                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## PDAs

| Account | Seeds | Size | Rent |
|---------|-------|------|------|
| AtomConfig | `["atom_config"]` | ~148 bytes | ~0.001 SOL |
| AtomStats | `["atom_stats", asset]` | 104 bytes | ~0.0009 SOL |
| AtomCheckpoint | `["atom_checkpoint", asset, index]` | ~193 bytes | ~0.002 SOL |

## AtomStats Structure (96 bytes)

```rust
pub struct AtomStats {
    // Core (24 bytes)
    pub first_feedback_slot: u64,
    pub last_feedback_slot: u64,
    pub feedback_count: u64,

    // Dual-EMA (12 bytes)
    pub ema_score_fast: u16,      // α=0.30, scale 0-10000
    pub ema_score_slow: u16,      // α=0.05, scale 0-10000
    pub ema_volatility: u16,      // |fast - slow|
    pub ema_arrival_log: u16,     // ilog2(slot_delta)
    pub peak_ema: u16,
    pub max_drawdown: u16,

    // Epoch & Bounds (8 bytes)
    pub epoch_count: u16,
    pub current_epoch: u16,
    pub min_score: u8,
    pub max_score: u8,
    pub first_score: u8,
    pub last_score: u8,

    // HyperLogLog (24 bytes)
    pub hll_packed: [u8; 24],     // 48 regs × 4 bits

    // Burst Detection (8 bytes)
    pub recent_callers: [u16; 3], // Ring buffer
    pub burst_pressure: u8,
    pub updates_since_hll_change: u8,

    // Output Cache (12 bytes)
    pub loyalty_score: u16,
    pub quality_score: u16,
    pub risk_score: u8,          // 0-100
    pub diversity_ratio: u8,
    pub trust_tier: u8,          // 0-4
    pub flags: u8,
    pub confidence: u16,         // 0-10000
    pub bump: u8,
    pub schema_version: u8,
}
```

## Trust Tiers

| Tier | Quality | Risk Max | Confidence |
|------|---------|----------|------------|
| Platinum (4) | ≥7000 | ≤15 | ≥8000 |
| Gold (3) | ≥5000 | ≤30 | ≥6000 |
| Silver (2) | ≥3000 | ≤50 | ≥4000 |
| Bronze (1) | ≥1000 | ≤70 | ≥2000 |
| Unrated (0) | - | - | - |

## Risk Signals

| Signal | Weight | Detection |
|--------|--------|-----------|
| Sybil | 3 | Low diversity ratio (HLL/count) |
| Burst | 4 | Repeated caller in ring buffer |
| Stagnation | 2 | No new HLL register updates |
| Shock | 3 | Fast/slow EMA divergence |
| Volatility | 2 | High |fast - slow| over time |
| Arrival | 1 | Very fast feedback cadence |

## Usage

### Initialize Config (once)

```typescript
await program.methods
  .initializeConfig(agentRegistryProgramId)
  .accounts({
    authority: wallet.publicKey,
    config: configPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Update Stats (per feedback)

```typescript
await program.methods
  .updateStats(clientHash, score)
  .accounts({
    payer: wallet.publicKey,
    asset: agentAssetPubkey,
    config: configPda,
    stats: statsPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Read Stats

```typescript
const stats = await program.account.atomStats.fetch(statsPda);
console.log(`Trust Tier: ${stats.trustTier}`);
console.log(`Risk Score: ${stats.riskScore}`);
console.log(`Quality: ${stats.qualityScore}`);
console.log(`Confidence: ${stats.confidence}`);
```

## Tunable Parameters

All parameters can be updated via `update_config` without program upgrade:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `alpha_fast` | 30 | Fast EMA α (÷100) |
| `alpha_slow` | 5 | Slow EMA α (÷100) |
| `weight_sybil` | 3 | Sybil risk weight |
| `weight_burst` | 4 | Burst risk weight |
| `diversity_threshold` | 50 | Sybil trigger (0-255) |
| `burst_threshold` | 30 | Burst trigger |
| `tier_platinum_quality` | 7000 | Platinum min quality |

## Recovery & Checkpoints

ATOM supports recovery via checkpoints:

1. **Create Checkpoint**: Snapshot stats every N feedbacks
2. **Restore from Checkpoint**: Load snapshot (authority only)
3. **Replay Batch**: Re-process historical events

```typescript
// Create checkpoint
await program.methods
  .createCheckpoint(checkpointIndex, checkpointHash)
  .accounts({ ... })
  .rpc();

// Restore from checkpoint
await program.methods
  .restoreFromCheckpoint(checkpointIndex)
  .accounts({ ... })
  .rpc();
```

## Integration with agent-registry-8004

ATOM is designed to be called via CPI from `agent-registry-8004`:

```
agent-registry-8004          atom-engine
      │                           │
      │  give_feedback()          │
      │ ──────────────────────────►
      │        CPI                 │
      │                           │  update_stats()
      │                           │
      │ ◄──────────────────────────
      │                           │
```

## Compute Units

| Operation | CU |
|-----------|-----|
| update_stats | ~4,500 |
| create_checkpoint | ~3,000 |
| restore_from_checkpoint | ~2,500 |
| replay_batch (per event) | ~4,500 |

## License

MIT
