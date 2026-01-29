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
- Agent Registry 8004: `8oo4SbcgjRBAXjmGU4YMcdFqfeLLrtn7n6f358PkAc3N`
- ATOM Engine: `AToMNmthLzvTy3D2kz2obFmbVCsTCmYpDw1ptWUJdeU8`

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

**Validation Registry** (v3.0.0 Consolidated):
- ValidationConfig PDA: `["validation_config"]` - Global state (authority, counters)
- ValidationRequest PDA: `["validation", asset, validator_address, nonce]` - Single PDA for request+response (109 bytes, immutable)

### Cross-Program Security

**v3.0.0 Consolidation**: Validation Registry is now integrated into the main `agent-registry-8004` program, eliminating CPI overhead and attack surface.

**Identity Verification**:
- Validation instructions reference `AgentAccount` PDA directly (same program)
- Additional Metaplex Core ownership verification via `get_core_owner()` for source-of-truth checks
- No cross-program CPI required (validation is a module, not separate program)

**Legacy (Pre-v3.0.0)**: Reputation Registry (still separate) validates agents via CPI with hardcoded program IDs using Cargo features.

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

## ATOM Engine (v0.2.0 "Fortress")

**ATOM** (AI Agent Trust & Reputation Metrics) is the reputation computation engine used by the Reputation Registry.

### Key Features
- **HyperLogLog** (256 registers, 4-bit) for unique client estimation (~6.5% error)
- **Dual EMA** (fast α=0.30, slow α=0.05) for score smoothing
- **MRT Protection** (Minimum Retention Time) prevents ring buffer gaming
- **Quality Circuit Breaker** with freeze mechanism and floor protection
- **Sybil Tax** with VIP lane for verified callers
- **Trust Tiers**: Platinum/Gold/Silver/Bronze with hysteresis

### Security Status
- **52 fixes** implemented (F01-F102)
- **58 accepted risks** (ROI < 1)
- **0 open vulnerabilities**
- **6 consecutive clean audits** (Hivemind: GPT-5.2 + Gemini 3 Pro)
- **99% confidence score**

See `ATOM-CHANGELOG.md` for full security audit history.

### ATOM Files
```
programs/atom-engine/src/
├── lib.rs          # Program entry, instructions (give_feedback, revoke)
├── compute.rs      # All calculation logic (EMA, risk, quality, tiers)
├── state.rs        # AtomStats struct, HLL, ring buffer, helpers
└── params.rs       # Tunable parameters and constants
```

## Validation Registry (v3.0.0 State On-Chain)

**Validation** provides ERC-8004 compliant task validation and certification system with immutable on-chain state.

### Architecture

**Design Philosophy**: State on-chain (ValidationRequest PDAs) instead of events-only to enable direct on-chain queries of certifications without requiring off-chain indexers.

**PDA Structure**:
- **ValidationConfig**: `["validation_config"]` - Global state (authority, counters)
- **ValidationRequest**: `["validation", asset, validator_address, nonce]` - Individual validation records (109 bytes, permanent)

### Key Features
- **ERC-8004 Immutability**: No close/delete function - validations are permanent audit trail
- **Progressive Validation**: Validators can update responses multiple times (lastUpdate semantics)
- **Self-Validation Protection**: Redundant checks (Anchor constraints + explicit Core owner verification)
- **Optimized Storage**: 109 bytes per validation (27% cheaper than initial 150-byte design)
- **Metaplex Core Integration**: Direct asset ownership verification via BaseAssetV1 parsing

### State Management

**On-Chain (ValidationRequest PDA - 109 bytes)**:
- `asset: Pubkey` - Metaplex Core asset being validated
- `validator_address: Pubkey` - Who can respond
- `nonce: u32` - Enables multiple validations from same validator
- `request_hash: [u8; 32]` - SHA-256 of request content
- `response: u8` - Validation score 0-100 (0 is valid score, not "pending")
- `responded_at: i64` - Timestamp of last response (0 if no response yet)

**Events-Only (Rent Optimization)**:
- `request_uri`, `response_uri` - IPFS/Arweave links (max 200 bytes)
- `response_hash` - SHA-256 of response content
- `tag` - Categorization string (max 32 bytes, e.g., "oasf-v0.8.0")
- `created_at` - Request timestamp

### Security Status
- **1st Hivemind Audit**: 0 critical vulnerabilities ✅
- **Auditors**: GPT-5.2 + Gemini 3 Pro
- **Known Issues**:
  - [MEDIUM] Global write lock contention on counters (performance trade-off for monitoring)
  - [LOW] Validator UncheckedAccount not constrained (cosmetic, no security impact)

### Cost Model
- **Rent**: ~0.00120 SOL per validation (permanent, not recoverable)
- **27% cheaper** than initial 150-byte design while maintaining full ERC-8004 compliance

### Usage

```typescript
// Request validation
await program.methods
  .requestValidation(
    validatorPubkey,
    nonce, // u32 - allows multiple validations
    requestUri, // IPFS link
    requestHash // SHA-256
  )
  .accounts({ requester, payer, agentAccount, asset, validationRequest })
  .rpc();

// Validator responds
await program.methods
  .respondToValidation(
    validatorAddress,
    nonce,
    85, // score 0-100
    responseUri,
    responseHash,
    "oasf-v0.8.0" // tag
  )
  .accounts({ validator, agentAccount, asset, validationRequest })
  .rpc();

// Query validation
const [validationPda] = getValidationRequestPda(asset, validator, nonce);
const validation = await program.account.validationRequest.fetch(validationPda);
console.log(`Score: ${validation.response}, Responded: ${validation.hasResponse()}`);
```

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
├── atom-engine/src/    # ATOM v0.2.0 - Reputation computation engine
│   ├── lib.rs
│   ├── compute.rs
│   ├── state.rs
│   └── params.rs
└── agent-registry-8004/src/validation/
    ├── mod.rs          # Module exports
    ├── state.rs        # ValidationConfig, ValidationRequest (state on-chain)
    ├── contexts.rs     # Anchor account validation contexts
    ├── instructions.rs # Core validation logic (request, respond)
    ├── events.rs       # ValidationRequested, ValidationResponded
    └── README.md       # Validation module documentation

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
