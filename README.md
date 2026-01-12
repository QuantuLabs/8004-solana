# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry) with comprehensive test coverage and devnet deployment

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor Version](https://img.shields.io/badge/Anchor-0.32.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Compatible-green)](https://solana.com)
[![Status](https://img.shields.io/badge/Status-Deployed%20on%20Devnet-success)]()
[![Tests](https://img.shields.io/badge/Tests-118%20Passing-brightgreen)]()
[![Spec Conformity](https://img.shields.io/badge/ERC--8004-100%25%20Conformity-success)]()

## v0.4.0 - ATOM Integration (Current)

- **[ATOM](programs/atom-engine/README.md)** (Agent Trust On-chain Model): Reputation scoring model with Sybil resistance
- **Multi-Collection Registry**: Global registry with base + user-created collections (sharding)
- **CPI Integration**: `give_feedback` / `revoke_feedback` → ATOM for real-time scoring

**Programs:**
| Program | Address | Description |
|---------|---------|-------------|
| agent-registry-8004 | `3GGkAWC3mYYdud8GVBsKXK5QC9siXtFkWVZFYtbueVbC` | Identity, Feedback events, Validation |
| atom-engine | `AToMNGXU9X5o9r2wg2d9xZnMQkGy6fypHs3c6DZd8VUp` | Reputation scoring (ATOM model) |

---

## v0.3.0 - Asset-Based Identification

**Major Changes:**
- **C-01 Fix**: Replaced `agent_id` (u64) with `asset` (Pubkey) as unique identifier
- **Storage Optimization**: -18% storage, -0.14 SOL per agent
- **Removed `ValidationStats`**: Counters now computed off-chain via indexer
- **Simplified Aggregates**: Removed cached aggregates from `AgentReputationMetadata`

See [CHANGELOG.md](CHANGELOG.md) for full details and previous versions.

---

## Features

### Identity Module

- NFT-based agent registration via **Metaplex Core**
- **Asset = Unique Identifier** (no sequential agent_id)
- **PDA-based metadata** (individual accounts per key)
- **Immutable metadata option** for certifications
- **Delete metadata** with rent recovery
- Transfer support via Core transfer

### Reputation Module

- **giveFeedback** with score validation (0-100) → CPI to ATOM Engine
- **revokeFeedback** with author-only access control → CPI to ATOM Engine
- **appendResponse** with unlimited responses
- **[ATOM Engine](programs/atom-engine/README.md)** for on-chain reputation scoring:
  - Dual-EMA trend detection (fast α=0.30, slow α=0.05)
  - HyperLogLog (256 regs, ~6.5% error) unique client estimation
  - Ring buffer (24 slots) for burst detection and revoke support
  - Multi-signal risk scoring (sybil, burst, stagnation, shock, volatility)
  - Trust tier classification (Platinum/Gold/Silver/Bronze)

### Validation Module

- **requestValidation** for third-party verification
- **respondToValidation** with multi-validator support
- **Progressive validation** with status tracking
- Complete validation lifecycle management

## What is ERC-8004?

[ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004) is an Ethereum standard for on-chain agent registries. It provides:

- **Identity Registry**: NFT-based agent registration with metadata storage
- **Reputation System**: Cryptographically authenticated feedback and scoring
- **Validation Registry**: Third-party verification and attestation

This Solana implementation leverages the platform's unique architecture:
- **Low transaction costs** (~$0.01 per operation)
- **O(1) queries** via PDA architecture
- **Unlimited responses** using PDA architecture
- **Native sponsorship** through multi-signer support

## Architecture

```
+-----------------------------------------------------------------+
|              agent-registry-8004 (Devnet)                        |
|         3GGkAWC3mYYdud8GVBsKXK5QC9siXtFkWVZFYtbueVbC            |
+-----------------------------------------------------------------+
|  +---------------+ +----------------+ +----------------+         |
|  | Identity      | | Reputation     | | Validation     |         |
|  +---------------+ +----------------+ +----------------+         |
|  | Agent NFTs    | | Feedback Events| | Validation Req |         |
|  |  (Core)       | | Revocations    | | Responses      |         |
|  | Metadata PDAs | | Responses      | | Multi-validator|         |
|  | Asset = ID    | |                | | Progressive    |         |
|  +---------------+ +-------+--------+ +----------------+         |
+-----------------------------------------------------------------+
                             |
                             | CPI (give_feedback)
                             v
+-----------------------------------------------------------------+
|                    atom-engine (ATOM)                            |
|         AToMNGXU9X5o9r2wg2d9xZnMQkGy6fypHs3c6DZd8VUp            |
+-----------------------------------------------------------------+
|  +---------------+ +------------------------------------------+ |
|  | AtomConfig    | |              AtomStats (460 bytes)       | |
|  +---------------+ +------------------------------------------+ |
|  | - authority   | | - dual EMA (fast/slow)                   | |
|  | - params      | | - HLL[256] + salt (128 bytes)            | |
|  | - weights     | | - ring buffer[24] + cursor               | |
|  | - thresholds  | | - quality, risk, tier, confidence        | |
|  +---------------+ +------------------------------------------+ |
+-----------------------------------------------------------------+
                             |
+-----------------------------------------------------------------+
|                      Metaplex Core                               |
|         (Collection + Agent Assets)                              |
+-----------------------------------------------------------------+
                             |
                             v
+-----------------------------------------------------------------+
|                TypeScript SDK (8004-solana-ts)                   |
+-----------------------------------------------------------------+
```

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

## Devnet Program IDs

| Program | Address | Description |
|---------|---------|-------------|
| **agent-registry-8004** | `3GGkAWC3mYYdud8GVBsKXK5QC9siXtFkWVZFYtbueVbC` | Identity, Validation, Feedback events |
| **atom-engine** | `AToMNGXU9X5o9r2wg2d9xZnMQkGy6fypHs3c6DZd8VUp` | ATOM reputation scoring |

### Run Specific Test Suites

```bash
# Identity Registry
anchor test --skip-build tests/identity-tests.ts

# Reputation Registry
anchor test --skip-build tests/reputation-tests.ts

# Validation Registry
anchor test --skip-build tests/validation-*.ts

# E2E Integration
anchor test --skip-build tests/e2e-*.ts
```

## Test Coverage

**Total: 118 tests passing on Devnet (100% success rate)**

| Test Suite | Tests | Coverage | Status |
|------------|-------|----------|--------|
| E2E Identity | 24 | Registration, metadata, transfers | Pass |
| E2E Reputation | 35 | Feedback, responses, aggregates | Pass |
| E2E Validation | 18 | Requests, responses, updates | Pass |
| Security Fixes | 29 | F-01 to V-01, edge cases | Pass |
| SDK Integration | 12 | Full SDK coverage | Pass |

## ERC-8004 Compliance Matrix

| Registry | Write Functions | Read Functions | Events | Storage | Status |
|----------|----------------|----------------|---------|---------|--------|
| **Identity** | 100% (5/5) | 100% | 100% | 100% | Complete |
| **Reputation** | 100% (3/3) | 100% (6/6) | 100% | 100% | Complete |
| **Validation** | 100% (2/2) | 100% | 100% | 100% | Complete |

## Performance & Costs

### Operation Costs (v0.3.0 on Devnet)

| Operation | Cost (SOL) | Notes |
|-----------|------------|-------|
| Register Agent | ~0.0058 | Core asset + AgentAccount (smaller) |
| Set Metadata | ~0.0032 | MetadataEntryPda |
| Give Feedback | ~0.0014 | FeedbackAccount (optimized) |
| Append Response | ~0.0012 | ResponseAccount (minimal) |
| Request Validation | ~0.0017 | ValidationRequest |

### v0.3.0 Storage Optimization

| Account | v0.2.x | v0.3.0 | Savings |
|---------|--------|--------|---------|
| FeedbackAccount | 99 bytes | 83 bytes | -16% |
| AgentReputationMetadata | 50 bytes | 17 bytes | **-66%** |
| ValidationRequest | 166 bytes | 151 bytes | -9% |
| AgentAccount | 343 bytes | 313 bytes | -9% |
| ResponseAccount | 73 bytes | 41 bytes | **-44%** |

## Roadmap

### v0.4.0 - CURRENT
- [x] ATOM Engine (separate program)
- [x] Dual-EMA reputation scoring
- [x] HyperLogLog unique client estimation
- [x] Trust tier classification
- [x] Tunable parameters via Config PDA
- [x] Checkpoint/recovery support
- [x] CPI integration (agent-registry → atom-engine)

### v0.3.0 - COMPLETE
- [x] Asset-based identification (C-01 fix)
- [x] Storage optimization (-18%)
- [x] Removed on-chain aggregates (off-chain indexer)

### Next
- [ ] Mainnet deployment
- [ ] Indexer service
- [ ] Sub-collections extension

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
- **Solana SDK**: https://github.com/QuantuLabs/8004-solana-ts
- **Original agent0-ts**: https://github.com/agent0lab/agent0-ts

---

**Status**: v0.4.0 Deployed on Devnet | Full ERC-8004 conformity | ATOM Engine

**Last Updated**: 2026-01-12
