# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry) with comprehensive test coverage and devnet deployment

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor Version](https://img.shields.io/badge/Anchor-0.32.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Compatible-green)](https://solana.com)
[![Status](https://img.shields.io/badge/Status-Deployed%20on%20Devnet-success)]()
[![Tests](https://img.shields.io/badge/Tests-89%20Passing-brightgreen)]()
[![Spec Conformity](https://img.shields.io/badge/ERC--8004-100%25%20Conformity-success)]()

## v0.2.1 - Field Ordering for Indexing Optimization

**What's New in v0.2.1:**
- **Static fields first** - Reordered account fields for `memcmp` filtering
- **Fixed offsets** - `created_at`, `bump`, `immutable` now at predictable offsets
- **SDK backward compatibility** - Dual deserializers support both old and new layouts

**Affected Accounts:**
- `AgentAccount` - `created_at`, `bump` moved before dynamic strings
- `MetadataEntryPda` - `immutable`, `created_at`, `bump` moved before dynamic fields
- `FeedbackTagsPda` - `bump` moved before tag strings

**Breaking Changes:**
- Account binary layout changed (new accounts incompatible with pre-v0.2.1)
- SDK includes `LEGACY_DEVNET` fallback for old devnet accounts

---

## v0.2.0 - Optimized Storage & Metadata PDAs

**What's New in v0.2.0:**
- **Metadata PDAs** - Individual PDAs per metadata key (replaces Vec)
- **Immutable Metadata** - Lock metadata permanently for certifications
- **Delete Metadata** - Recover rent by deleting mutable entries
- **Hash-Only Storage** - URIs in events, hashes on-chain (-66% ResponseAccount)
- **Optional Tags PDA** - FeedbackTagsPda for -42% cost when tags not used
- **Global Feedback Index** - Simplified PDA derivation

**Breaking Changes:**
- `file_uri` and `response_uri` removed from accounts (events only)
- `tag1` and `tag2` moved to optional `FeedbackTagsPda`
- Metadata now via `set_metadata_pda` / `delete_metadata_pda`
- Account sizes changed (incompatible with v0.1.0)

## Features

### Identity Module

- ✅ NFT-based agent registration via **Metaplex Core**
- ✅ **PDA-based metadata** (individual accounts per key)
- ✅ **Immutable metadata option** for certifications
- ✅ **Delete metadata** with rent recovery
- ✅ Sequential agent IDs with Core Collection
- ✅ Transfer support via Core transfer

### Reputation Module

- ✅ **giveFeedback** with score validation (0-100)
- ✅ **revokeFeedback** with author-only access control
- ✅ **appendResponse** with unlimited responses
- ✅ **setFeedbackTags** creates optional tags PDA (-42% cost without tags)
- ✅ **Hash-only storage** (URIs in events, -66% ResponseAccount)
- ✅ **Cached aggregates** for O(1) reputation queries
- ✅ **Global feedback index** for simplified PDA derivation

### Validation Module

- ✅ **requestValidation** for third-party verification
- ✅ **respondToValidation** with multi-validator support
- ✅ **Progressive validation** with status tracking
- ✅ Complete validation lifecycle management

## What is ERC-8004?

[ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004) is an Ethereum standard for on-chain agent registries. It provides:

- **Identity Registry**: NFT-based agent registration with metadata storage
- **Reputation System**: Cryptographically authenticated feedback and scoring
- **Validation Registry**: Third-party verification and attestation

This Solana implementation leverages the platform's unique architecture:
- **Low transaction costs** (~$0.01 per operation)
- **O(1) queries** via cached aggregates
- **Unlimited responses** using PDA architecture
- **Native sponsorship** through multi-signer support

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              AgentRegistry8004 (Devnet)                          │
│         HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ Identity Module │ │ Reputation Module│ │ Validation Module│  │
│  ├─────────────────┤ ├──────────────────┤ ├──────────────────┤  │
│  │ • Agent NFTs    │ │ • Feedback (0-100)│ │ • Validation Req │  │
│  │   (Core)        │ │ • Revocations    │ │ • Responses      │  │
│  │ • Metadata      │ │ • Responses      │ │ • Multi-validator│  │
│  │ • Sequential IDs│ │ • Cached Aggr.   │ │ • Progressive    │  │
│  └─────────────────┘ └──────────────────┘ └──────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      Metaplex Core                               │
│         (Collection + Agent Assets)                              │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                TypeScript SDK (8004-solana-ts)                   │
├─────────────────────────────────────────────────────────────────┤
│ • PDA derivation utilities                                      │
│ • Borsh serialization schemas                                   │
│ • Full SDK wrapper (SolanaSDK class)                            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

### 100% ERC-8004 Spec Conformity

All three registries achieve **full compliance** with the ERC-8004 specification:

| Registry | Write Functions | Read Functions | Events | Storage | Status |
|----------|----------------|----------------|---------|---------|--------|
| **Identity** | ✅ 100% (5/5) | ✅ 100% | ✅ 100% | ✅ 100% | Complete |
| **Reputation** | ✅ 100% (3/3) | ✅ 100% (6/6) | ✅ 100% | ✅ 100% | Complete |
| **Validation** | ✅ 100% (2/2) | ✅ 100% | ✅ 100% | ✅ 100% | Complete |

### Solana-Specific Optimizations

| Feature | Implementation | Benefits |
|---------|----------------|----------|
| **Transaction Costs** | ~$0.01 per operation | Enables high-frequency usage |
| **Reputation Queries** | Cached aggregates (O(1)) | Instant reputation lookups |
| **Response Storage** | Unlimited PDAs | No storage constraints |
| **Compute Units** | <50,000 CU per operation | 79% headroom below limits |
| **Rent Recovery** | Close accounts to recover | Effectively "free" storage |

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 1.18+
- [Anchor](https://www.anchor-lang.com/docs/installation) 0.32.1+
- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://yarnpkg.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/QuantumAgentic/erc8004-solana.git
cd erc8004-solana

# Install dependencies
yarn install

# Build programs
anchor build

# Run all tests
anchor test
```

## Devnet Program ID

Single unified program deployed on Solana Devnet:

| Program | Address |
|---------|---------|
| **AgentRegistry8004** | `HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp` |

### Run Specific Test Suites

```bash
# Identity Registry
anchor test --skip-build tests/identity-registry.ts

# Reputation Registry
anchor test --skip-build tests/reputation-feedbackauth.ts

# Security Critical Tests
anchor test --skip-build tests/security-critical.ts

# Concurrency Tests
anchor test --skip-build tests/concurrency-tests.ts

# Validation Registry
anchor test --skip-build tests/validation-*.ts

# E2E Integration
anchor test --skip-build tests/e2e-integration.ts
```

## Test Coverage

**Total: 89 tests passing on Devnet (100% success rate)**

| Test Suite | Tests | Coverage | Status |
|------------|-------|----------|--------|
| E2E Identity | 24 | Registration, metadata, transfers | ✅ |
| E2E Reputation | 35 | Feedback, responses, aggregates | ✅ |
| E2E Validation | 18 | Requests, responses, updates | ✅ |
| SDK Integration | 12 | Full SDK coverage | ✅ |

## ERC-8004 Compliance Matrix

### Validation Registry

| Feature | ERC-8004 | Solana | Status | Evidence |
|---------|----------|--------|--------|----------|
| Request Validation | Required | requestValidation | ✅ | `validation-registry/lib.rs` |
| Respond to Validation | Required | respondToValidation | ✅ | `validation-registry/lib.rs` |
| Multi-Validator Support | Required | Unlimited validators | ✅ | `validation-advanced.ts` |
| Progressive Updates | Optional | Implemented | ✅ | Tests demonstrate |
| Cross-Registry Check | Required | Identity verification | ✅ | CPI validation |

## Security

### Security Features

- ✅ Input validation (score 0-100, URI limits)
- ✅ Access control (author-only revoke, validator permissions)
- ✅ Integer overflow protection (checked arithmetic)
- ✅ Division by zero protection
- ✅ PDA substitution prevention
- ✅ Cross-program validation (Identity Registry checks)
- ✅ Input validation (score 0-100, URI limits, expiry checks)

## Performance & Costs

### Operation Costs (v0.2.0 Measured on Devnet)

| Operation | Cost (SOL) | Lamports | Notes |
|-----------|------------|----------|-------|
| Register Agent | **0.00650** | 6,500,320 | Core asset + AgentAccount |
| Set Metadata (1st) | **0.00319** | 3,192,680 | +MetadataEntryPda |
| Set Metadata (update) | 0.000005 | 5,000 | TX fee only |
| Give Feedback (1st) | 0.00282 | 2,823,800 | +AgentReputation init |
| Give Feedback (2nd+) | 0.00158 | 1,584,920 | FeedbackAccount only |
| Append Response (1st) | 0.00275 | 2,747,240 | +ResponseIndex init |
| Append Response (2nd+) | 0.00163 | 1,626,680 | ResponseAccount only |
| Revoke Feedback | 0.000005 | 5,000 | TX fee only |
| Request Validation | 0.00183 | 1,828,520 | ValidationRequest |
| Respond Validation | 0.000005 | 5,000 | TX fee only |
| **Full Lifecycle** | **0.0235** | 23,511,840 | Complete test cycle |

### First vs Subsequent Savings

| Operation | 1st Call | 2nd+ Calls | Savings |
|-----------|----------|------------|---------|
| Set Metadata | 0.00319 | 0.000005 | **-99%** |
| Give Feedback | 0.00282 | 0.00158 | **-44%** |
| Append Response | 0.00275 | 0.00163 | **-41%** |

### v0.2.0 Account Size Optimizations

| Account | v0.1.0 | v0.2.0 | Savings |
|---------|--------|--------|---------|
| FeedbackAccount | 375 bytes | 99 bytes | **-74%** |
| ResponseAccount | 309 bytes | 105 bytes | **-66%** |
| AgentAccount | 661 bytes | ~365 bytes | **-45%** |

*URIs stored in events only. Tags moved to optional FeedbackTagsPda.*

### Optional Tags (FeedbackTagsPda)

Tags are now stored in a **separate optional PDA** created only when needed:
- **Without tags**: FeedbackAccount = 99 bytes (**-42% vs inline tags**)
- **With tags**: FeedbackAccount (99) + FeedbackTagsPda (97) = 196 bytes

Use `setFeedbackTags` after `giveFeedback` to add tags on-chain for `getProgramAccounts` filtering. Tags are always included in the `NewFeedback` event for indexers.

**Note**: Rent is recoverable when closing accounts or deleting metadata.

## Roadmap

### ✅ v0.2.0 - COMPLETE

- [x] **Metadata PDAs** - Individual accounts per key (replaces Vec)
- [x] **Immutable metadata** - Lock entries permanently
- [x] **Delete metadata** - Recover rent on mutable entries
- [x] **Hash-only storage** - URIs in events (-66% ResponseAccount)
- [x] **Optional Tags PDA** - FeedbackTagsPda for -42% feedback cost
- [x] **Global feedback index** - Simplified PDA derivation
- [x] Metaplex Core integration
- [x] TypeScript SDK updated

### 🔜 Next

- [ ] Mainnet deployment
- [ ] Sub-collections extension
- [ ] Indexer service

## Contributing

This is a build-in-public project. Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`anchor test`)
4. Commit changes (`git commit -m 'feat: add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Commit Convention

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `test`: Tests
- `chore`: Maintenance
- `refactor`: Code restructuring

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- **agent0lab** for ERC-8004 specification
- **Solana Labs** for the Solana blockchain platform
- **Coral** for the Anchor framework
- **Metaplex** for NFT infrastructure

## Official References

- **ERC-8004 Spec**: https://eips.ethereum.org/EIPS/eip-8004
- **Forum**: https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098
- **agent0-ts SDK**: https://github.com/agent0lab/agent0-ts
- **Ethereum Contracts** (Sepolia):
  - Identity: `0x8004a6090Cd10A7288092483047B097295Fb8847`
  - Reputation: `0x8004B8FD1A363aa02fDC07635C0c5F94f6Af5B7E`
  - Validation: `0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5`

---

**Status**: ✅ v0.2.0 Deployed on Devnet | Full ERC-8004 conformity

**Last Updated**: 2025-12-04
