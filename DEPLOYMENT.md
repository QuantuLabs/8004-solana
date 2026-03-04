# Deployment Guide - 8004 Agent Registry

## Prerequisites

- Solana CLI installed and configured
- Anchor CLI installed (`anchor --version` >= 0.30)
- Sufficient SOL for deployment (mainnet measured baseline is `6.081890720 SOL`; fund with at least `8 SOL`)

## Mainnet Preparation (Practical)

### 1. Keep Devnet and Mainnet Keys Fully Separate

Do not reuse program keypairs across clusters. Keep dedicated files per network in both repos:

- Registry (`8004-solana`) devnet: `keys/devnet-program/8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C.json`
- Registry (`8004-solana`) mainnet: `keys/mainnet-program/8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ.json`
- ATOM (`../8004-atom`) devnet: `../8004-atom/keys/devnet-program/AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF.json`
- ATOM (`../8004-atom`) mainnet: `../8004-atom/keys/mainnet-program/AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb.json`

Use a dedicated mainnet deployer wallet file (not your devnet wallet), and set it explicitly with `--wallet`.

### 2. Deployment Order (Mainnet)

Deploy in this order:

1. `ATOM` program from `../8004-atom`
2. `agent-registry-8004` program from this repo

Then run initialization steps (`init-atom`, `init-registry`, and optional `init-validation`) after both binaries are deployed.

### 3. Budget From Measured Run

| Item | Cost (SOL) |
|------|------------|
| `deploy_atom_cost` | `2.385549800` |
| `deploy_registry_cost` | `3.690222000` |
| `init_total_cost` | `0.006118920` |
| `grand_total` | `6.081890720` |

Recommended safety buffer: add at least 25% (`+1.520472680 SOL`), so target `>= 7.602363400 SOL` and round up operationally to `8 SOL`.

### 3.b Mint Batch Preflight (Localnet, 100 assets, no collection pointer)

Measured with a dedicated single-pass localnet test (`tests/mainnet-prep-mint-100-no-collection.ts`):

| Item | Value |
|------|-------|
| `mint_100_total_cost` | `0.933547904 SOL` (`933547904` lamports) |
| `mint_100_avg_per_asset` | `0.009335479 SOL` (`9335479` lamports) |

Combined baseline before any safety margin (`deploy + init + mint_100`):

- `7.015438624 SOL` (`7015438624` lamports)

Recommended operational funding (25% buffer):

- `8.769298280 SOL` minimum
- Round to `9 SOL` for cleaner runway

### 4. Manual Execution Only (No Auto-Push/Deploy)

This repository does not auto-push git changes and does not auto-deploy on-chain.

- Nothing is deployed unless you manually run `solana program deploy ...` and/or `npx ts-node scripts/deploy.ts ...`
- Review command flags (`--cluster`, `--wallet`, `--step`) before each run

## Quick Start

```bash
# Localnet (for testing)
anchor test  # This runs full init + tests

# Or use deployment script directly:
npx ts-node scripts/deploy.ts --cluster localnet --full
```

## Deployment Order

```
1. atom-engine        (reputation computation)
2. agent-registry-8004 (identity + reputation)
```

**Important**: `agent-registry-8004` has a compile-time dependency on `atom-engine::ID`. If deploying with new Program IDs, update `declare_id!()` in both programs before building.

## Step-by-Step Deployment

### 1. Build Programs

```bash
anchor build
```

### 2. Deploy atom-engine

```bash
# Localnet
solana program deploy target/deploy/atom_engine.so --program-id target/deploy/atom_engine-keypair.json

# Devnet
solana program deploy target/deploy/atom_engine.so --program-id target/deploy/atom_engine-keypair.json -u devnet
```

### 3. Initialize AtomConfig

```bash
# Run via script (see scripts/deploy.ts)
npx ts-node scripts/deploy.ts --cluster localnet --step init-atom
```

### 4. Deploy agent-registry-8004

```bash
# Localnet
solana program deploy target/deploy/agent_registry_8004.so --program-id target/deploy/agent_registry_8004-keypair.json

# Devnet
solana program deploy target/deploy/agent_registry_8004.so --program-id target/deploy/agent_registry_8004-keypair.json -u devnet
```

### 5. Initialize Registry

```bash
# Run via script
npx ts-node scripts/deploy.ts --cluster localnet --step init-registry
```

## Full Deployment (All Steps)

```bash
# Localnet (starts local validator)
npx ts-node scripts/deploy.ts --cluster localnet --full

# Devnet
npx ts-node scripts/deploy.ts --cluster devnet --full
```

## Program IDs

| Program | Localnet | Devnet |
|---------|----------|--------|
| atom-engine | (generated) | AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF |
| agent-registry-8004 | (generated) | 8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C |

## Verification

After deployment, verify initialization:

```bash
# Check AtomConfig
solana account <atom_config_pda> -u <cluster>

# Check RootConfig
solana account <root_config_pda> -u <cluster>
```

## Troubleshooting

### "Account already exists"
Config accounts are already initialized. Use `--skip-init` flag or reset the cluster.

### "Insufficient funds"
Ensure wallet has enough SOL:
```bash
solana balance
solana airdrop 2  # devnet only
```

### "Program ID mismatch"
Rebuild after updating `declare_id!()`:
```bash
anchor build
anchor keys sync  # updates declare_id from keypair
```
