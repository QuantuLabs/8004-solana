# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Solana implementation of ERC-8004 (AI Agent Identity & Reputation Registry) using the Anchor framework. The system consists of three interconnected Solana programs deployed on devnet.

**Architecture**: Three independent but interlinked programs:
- **Identity Registry**: Agent registration with NFT-based identity (Metaplex)
- **Reputation Registry**: Feedback/review system with client-agent reputation tracking
- **Validation Registry**: Task validation and dispute resolution

## Build & Test Commands

### Building
```bash
# Build all programs (optimized for deployment)
anchor build

# Build a specific program
cargo build-sbf --manifest-path programs/identity-registry/Cargo.toml
```

### Testing

**Localnet** (spins up local test validator with Metaplex cloned):
```bash
# Full test suite on localnet
anchor test

# Skip rebuild
anchor test --skip-build

# Run specific test file
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/identity-registry.ts
```

**Devnet** (tests against live devnet programs):
```bash
# Test on devnet (no deploy)
ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
ANCHOR_WALLET="~/.config/solana/id.json" \
anchor test --skip-build --skip-deploy

# Run specific e2e test on devnet
ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
ANCHOR_WALLET="~/.config/solana/id.json" \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e-integration.ts
```

### Deployment

Programs are deployed to devnet with fixed program IDs (see Anchor.toml).

```bash
# Deploy to devnet (requires SOL for fees)
anchor deploy --provider.cluster devnet

# Deploy specific program
solana program deploy target/deploy/identity_registry.so \
  --program-id E1jPnYYvGdJQUghMvL1iyub3JPcPkFkcuBryc9o6Lg17
```

**Devnet Program IDs**:
- Identity Registry: `28oby6bmCvmoybb7849stjECZWxiU6gfJJM6DKA2Kj4f`
- Reputation Registry: `9WcFLL3Fsqs96JxuewEt9iqRwULtCZEsPT717hPbsQAa`
- Validation Registry: `CXvuHNGWTHNqXmWr95wSpNGKR3kpcJUhzKofTF3zsoxW`

## Critical Architecture Details

### PDA Seeds & Account Structure

**Identity Registry**:
- Config PDA: `["config"]` - Global registry config (authority, next_agent_id, collection_mint)
- Collection Authority PDA: `["collection_authority"]` - Signs for Metaplex collection verification
- Agent PDA: `["agent", mint.key()]` - Agent account (keyed by NFT mint, NOT agent_id)
- Metadata Extension PDA: `["metadata_ext", mint.key(), extension_index]` - For >10 metadata entries

**Reputation Registry**:
- Feedback PDA: `["feedback", agent_id (u64 LE), feedback_index (u64 LE)]`
- Client Index PDA: `["client_index", agent_id, client.key()]` - Tracks next feedback index per client
- Response PDA: `["response", agent_id, client.key(), feedback_index, response_index]`
- Agent Reputation PDA: `["agent_reputation", agent_id]` - Cached aggregated stats

**Validation Registry**:
- Config PDA: `["config"]`
- Validation Request PDA: `["validation_request", agent_id, validator.key(), request_index]`
- Validation Response PDA: `["validation_response", agent_id, validator.key(), request_index]`

### Cross-Program Security

**CRITICAL**: Reputation and Validation registries MUST validate that agents exist in Identity Registry to prevent fake agent attacks. This is enforced via:

1. **CPI Account Constraint** - Verify Identity Registry program ID:
```rust
#[account(constraint = identity_registry_program.key() == IDENTITY_REGISTRY_ID)]
pub identity_registry_program: Program<'info, IdentityRegistry>,
```

2. **Environment-Based Program IDs** - Uses Cargo features (devnet/localnet/mainnet) configured in Anchor.toml to set the correct hardcoded program ID at compile time.

### Permissionless Agent Registration

**Key Design**: Anyone can register agents (not just collection authority). This is achieved via:

1. **Collection Authority PDA** (`["collection_authority"]`) - The program itself owns collection authority
2. **invoke_signed()** - Program signs for SetAndVerifyCollection CPI using PDA seeds
3. **No External Signature Required** - Users pay gas, program signs authorization

See `programs/identity-registry/src/lib.rs:register()` for implementation.

### Metadata Field Naming

**Important**: Metadata fields use `metadata_key` and `metadata_value` (NOT `key`/`value`) to avoid Rust reserved keywords:
```rust
pub struct MetadataEntry {
    pub metadata_key: String,    // Max 32 bytes
    pub metadata_value: Vec<u8>, // Max 256 bytes
}
```

### Feedback Tags

Tags are **String type** (not bytes32) per ERC-8004 spec updates:
```rust
pub tag1: String,  // Max 32 bytes
pub tag2: String,  // Max 32 bytes
```

## Testing Against Devnet

When testing against devnet programs that have been upgraded:

**State Migration Issue**: Devnet config may have old account layout from before spec updates. Cannot use `program.account.fetch()` directly.

**Solution**: Parse raw account data manually:
```typescript
const accountInfo = await provider.connection.getAccountInfo(configPda);
const COLLECTION_MINT_OFFSET = 8 + 32 + 8 + 8; // discriminator + authority + next_id + total
const collectionMintBytes = accountInfo.data.slice(COLLECTION_MINT_OFFSET, COLLECTION_MINT_OFFSET + 32);
const collectionMintPubkey = new PublicKey(collectionMintBytes);
```

See `tests/e2e-integration.ts` for reference implementation.

## Code Organization

```
programs/
├── identity-registry/src/
│   ├── lib.rs          # Main program logic (initialize, register, update_metadata)
│   ├── state.rs        # Account structures (RegistryConfig, AgentAccount, MetadataEntry)
│   ├── error.rs        # Custom error codes
│   └── events.rs       # Anchor events
├── reputation-registry/src/
│   ├── lib.rs          # Give/revoke feedback, respond to feedback
│   ├── state.rs        # FeedbackAccount, ResponseAccount, AgentReputationMetadata
│   ├── error.rs
│   └── events.rs
└── validation-registry/src/
    ├── lib.rs          # Request/respond to validation tasks
    ├── state.rs        # ValidationRequest, ValidationResponse
    ├── error.rs
    └── events.rs

tests/
├── e2e-*.ts            # End-to-end integration tests
├── *-registry.ts       # Per-program unit tests
└── security-critical.ts # Security-focused tests
```

## Important Constraints

- **Agent ID**: Sequential u64 counter (NOT derived from mint)
- **Metadata**: Max 10 entries in base AgentAccount, unlimited via MetadataExtension PDAs
- **Feedback Score**: 0-100 (validated on-chain)
- **Tag Length**: Max 32 bytes (String type)
- **URI Length**: Max 200 bytes (token_uri, file_uri, response_uri)
- **File Hash**: Fixed 32 bytes (SHA-256)

## Metaplex Integration

Uses Metaplex Token Metadata for NFT creation and collection management:
- **Collection NFT**: Created during Identity Registry initialization
- **Agent NFTs**: Each agent gets a unique NFT (supply=1, decimals=0)
- **Collection Verification**: Automatic via PDA-signed SetAndVerifyCollection CPI

**Dependencies**:
- `@metaplex-foundation/mpl-token-metadata` (Rust)
- `@metaplex-foundation/js` (TypeScript)

Test validator clones Metaplex program: `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`

## Environment Configuration

Controlled by Anchor.toml:
- `cluster = "devnet"` - Default target cluster
- `wallet = "~/.config/solana/id.json"` - Default wallet path
- Programs have separate addresses for localnet/devnet

For devnet testing, always use:
```bash
ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
ANCHOR_WALLET="~/.config/solana/id.json"
```
