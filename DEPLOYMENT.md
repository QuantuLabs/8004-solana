# Deployment Guide - 8004 Agent Registry

## Prerequisites

- Solana CLI installed and configured
- Anchor CLI installed (`anchor --version` >= 0.30)
- Sufficient SOL for deployment (~5 SOL recommended)

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
| atom-engine | (generated) | AToM1iKaniUCuWfHd5WQy5aLgJYWMiKq78NtNJmtzSXJ |
| agent-registry-8004 | (generated) | 8oo48pya1SZD23ZhzoNMhxR2UGb8BRa41Su4qP9EuaWm |

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
