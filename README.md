# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry) with comprehensive test coverage and devnet deployment

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor Version](https://img.shields.io/badge/Anchor-0.32.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Compatible-green)](https://solana.com)
[![Status](https://img.shields.io/badge/Status-Deployed%20on%20Devnet-success)]()
[![Tests](https://img.shields.io/badge/Tests-89%20Passing-brightgreen)]()
[![Spec Conformity](https://img.shields.io/badge/ERC--8004-100%25%20Conformity-success)]()

## v0.2.0 - Single Program Architecture

**What's New:**
- Single unified program with Identity, Reputation & Validation modules
- **Metaplex Core** NFTs (lighter, faster than Token Metadata)
- Global feedback index for simpler PDA derivation
- 89 comprehensive tests on devnet

## Features

### Identity Module

- ✅ NFT-based agent registration via **Metaplex Core**
- ✅ Cost-optimized metadata storage (1 on-chain + unlimited extensions)
- ✅ Sequential agent IDs with Core Collection
- ✅ Transfer support via Core transfer
- ✅ Full ERC-8004 spec compliance

### Reputation Module

- ✅ **giveFeedback** with score validation (0-100)
- ✅ **revokeFeedback** with author-only access control
- ✅ **appendResponse** with unlimited responses
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
│         3ah8M3viTAGHRkAqGshRF4b48Ey1ZwrMViQ6bkUNamTi            │
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
| **AgentRegistry8004** | `3ah8M3viTAGHRkAqGshRF4b48Ey1ZwrMViQ6bkUNamTi` |

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

### Operation Costs (SDK E2E Measured on Devnet)

| Operation | Total Cost | Lamports | Notes |
|-----------|------------|----------|-------|
| Register Agent | **0.00859 SOL** | 8,588,320 | Core asset + AgentAccount |
| Set Metadata | 0.000005 SOL | 5,000 | TX fee only |
| Give Feedback (1st) | 0.00474 SOL | 4,744,760 | Feedback + AgentReputation init |
| Give Feedback (2nd+) | 0.00351 SOL | 3,505,880 | FeedbackAccount only |
| Append Response (1st) | 0.00417 SOL | 4,167,080 | Response + ResponseIndex init |
| Append Response (2nd+) | 0.00305 SOL | 3,046,520 | ResponseAccount only |
| Revoke Feedback | 0.000005 SOL | 5,000 | TX fee only |
| Request Validation | 0.00183 SOL | 1,828,520 | ValidationRequest |
| Respond to Validation | 0.000005 SOL | 5,000 | TX fee only |

### First vs Subsequent Cost Savings

| Operation | 1st Call | 2nd+ Calls | Savings |
|-----------|----------|------------|---------|
| Give Feedback | 0.00474 SOL | 0.00351 SOL | **-26%** |
| Append Response | 0.00417 SOL | 0.00305 SOL | **-27%** |

*First operation creates init_if_needed accounts (AgentReputation, ResponseIndex). Subsequent calls skip initialization.*

### v0.2.0 Cost Savings (Metaplex Core)

| Operation | v0.1.0 | v0.2.0 | Savings |
|-----------|--------|--------|---------|
| Register Agent | ~0.025 SOL | 0.00859 SOL | **-66%** |
| Full Lifecycle | ~0.031 SOL | 0.0259 SOL | **-16%** |

**Note**: Rent is recoverable when closing accounts.

## Roadmap

### ✅ v0.2.0 - COMPLETE

- [x] Single unified program with 3 modules
- [x] Metaplex Core integration
- [x] Global feedback index
- [x] 89 tests passing on devnet
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

**Status**: ✅ v0.2.0 Deployed on Devnet | 89 tests passing | Full ERC-8004 conformity

**Last Updated**: 2025-12-03
