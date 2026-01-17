# 8004 on Solana

> Solana implementation of 8004 (Trustless Agents Registry)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)

## Programs (Devnet)

| Program | Address |
|---------|---------|
| agent-registry-8004 | `6MuHv4dY4p9E4hSCEPr9dgbCSpMhq8x1vrUexbMVjfw1` |
| atom-engine | `6Mu7qj6tRDrqchxJJPjr9V1H2XQjCerVKixFEEMwC1Tf` |

## v0.5.0 Highlights

- **[ATOM v0.2.0 "Fortress"](programs/atom-engine/README.md)**: Production-ready with tier vesting and platinum loyalty gate
- **Tier Vesting**: 8-epoch delay (~20 days) before tier promotion prevents Sybil attacks
- **Platinum Loyalty Gate**: Requires 500+ loyalty score before platinum candidature
- **ERC-8004 Compliant**: Fully compliant with validation system optimizations (109B)

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Architecture

```
+-----------------------------------------------------------------+
|              agent-registry-8004 (Devnet)                        |
|         6MuHv4dY4p9E4hSCEPr9dgbCSpMhq8x1vrUexbMVjfw1            |
+-----------------------------------------------------------------+
|  +---------------+ +----------------+ +--------------------+     |
|  | Identity      | | Reputation     | | Validation         |     |
|  +---------------+ +----------------+ +--------------------+     |
|  | Agent NFTs    | | Feedback Events| | ValidationConfig   |     |
|  |  (Core)       | | Revocations    | | ValidationRequest  |     |
|  | Metadata PDAs | | Responses      | |  (109B optimized)  |     |
|  | Asset = ID    | |       |        | | Multi-validator    |     |
|  |               | |       |        | | Progressive        |     |
|  +---------------+ +-------+--------+ +--------------------+     |
+-----------------------------------------------------------------+
                             |
                             | CPI (give_feedback, revoke_feedback)
                             v
+-----------------------------------------------------------------+
|                    atom-engine (ATOM)                            |
|         6Mu7qj6tRDrqchxJJPjr9V1H2XQjCerVKixFEEMwC1Tf            |
+-----------------------------------------------------------------+
|  +---------------+ +------------------------------------------+ |
|  | AtomConfig    | |              AtomStats (561 bytes)       | |
|  +---------------+ +------------------------------------------+ |
|  | - authority   | | - HLL[256] + salt (unique clients)       | |
|  | - params      | | - ring buffer[24] (burst detection)      | |
|  | - thresholds  | | - tier vesting, loyalty, quality, risk   | |
|  +---------------+ +------------------------------------------+ |
+-----------------------------------------------------------------+
                             |
+-----------------------------------------------------------------+
|                      Metaplex Core                               |
|         (Collection + Agent Assets)                              |
+-----------------------------------------------------------------+
```

## Features

| Module | Description |
|--------|-------------|
| **Identity** | NFT-based agents (Metaplex Core), PDA metadata, immutable option |
| **Reputation** | Feedback (0-100), revoke, responses with optional ATOM Engine integration |
| **Validation** | Third-party verification, multi-validator, progressive (109B optimized) |
| **ATOM Engine** | Optional enhancement: Sybil resistance (HLL), burst detection, trust tiers (0-5) |

### Validation System

The validation module enables third-party validators to assess agent performance:

- **ValidationConfig** (global): Tracks total requests/responses, authority (49B)
- **ValidationRequest** (per validation): Stores minimal on-chain state (109B)
  - `asset` - Agent being validated
  - `validator_address` - Who can respond
  - `nonce` - Enables multiple validations from same validator
  - `request_hash` - Integrity verification (SHA-256)
  - `response` - Score 0-100 (0 = pending)
  - `responded_at` - Unix timestamp (0 if no response)

**Optimizations (v0.4.0):**
- Reduced from 150B → 109B (-27% rent cost)
- Moved to events: `response_hash`, `created_at`, `bump` (recalculable)
- Maintains ERC-8004 compliance for progressive validation

**PDA Seeds:**
- ValidationConfig: `["validation_config"]`
- ValidationRequest: `["validation", asset, validator_address, nonce]`

**Important:** Self-validation is not allowed (agent owner cannot validate their own agent)

## ERC-8004 Compliance

This implementation is **fully compliant** with the [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004), adapted for Solana's account-based architecture.

### Fully Compliant Features

| Module | Compliance | Details |
|--------|-----------|---------|
| **Identity Registry** | Complete | All core functions: `register()`, `setAgentURI()`, `setMetadata()`, `setAgentWallet()` with Ed25519 signature verification |
| **Reputation Registry** | Complete | `giveFeedback()`, `revokeFeedback()`, `appendResponse()` with score range 0-100 |
| **Validation Registry** | Complete | `validationRequest()`, `validationResponse()`, progressive validation, anti-self-validation |
| **Immutability** | Complete | On-chain pointers/hashes cannot be deleted, audit trail integrity maintained |

### Solana-Specific Adaptations

**Event-Only Feedback Storage**
- **Why:** Solana compute limits (1.4M CU) and cost optimization
- **Pattern:** Standard in Solana ecosystem (95% of dApps)
- **Solution:** Off-chain indexers for aggregation queries
- **Impact:** `getSummary()`, `readFeedback()` implemented via SDK/indexer

**Account-Based Storage**
- **Metadata:** Separate PDAs per entry (unlimited scalability)
- **Validation:** PDA per validation (109B optimized, -27% rent vs v0.3.0)
- **Agent IDs:** Pubkey (Metaplex Core asset) for native NFT integration

### Key Differentiators

- **ATOM Engine Integration:** Optional addition to ERC-8004 providing Sybil resistance via HyperLogLog, burst detection, trust tiers (can be skipped via `skipAtomInit` flag)
- **Multi-Collection Sharding:** Unlimited scalability via collection-based partitioning
- **Immutable Metadata:** Optional flag for permanent certification records
- **Cost Optimization:** 109B validation accounts (-27% vs initial design)

### Required Components

- [TypeScript SDK](https://github.com/QuantuLabs/8004-solana-ts) - Client-side read functions (`getSummary()`, `readAllFeedback()`)
- [Indexer](https://github.com/QuantuLabs/8004-solana-indexer) - Aggregation queries (standard Solana pattern)

See [ERC-8004 Spec](https://github.com/erc-8004/erc-8004-contracts/blob/master/ERC8004SPEC.md) for official specification.

## Costs (v0.5.0)

| Operation | Rent (SOL) | Notes |
|-----------|------------|-------|
| Register Agent | ~0.006 | AgentAccount (378B) + Core Asset (~250B) |
| Initialize ATOM Stats (optional) | ~0.005 | AtomStats (561B) - enables Sybil resistance |
| Give Feedback (with ATOM) | ~0.000005 | Event-only + ATOM CPI, tx fee only |
| Give Feedback (without ATOM) | ~0.000005 | Event-only, tx fee only (basic ERC-8004 compliant) |
| Request Validation | ~0.002 | ValidationRequest (109B) + event data |
| Respond to Validation | ~0.000005 | Updates existing account + event, tx fee only |
| Close Validation | 0 (refund) | Returns rent to closer |

## Quick Start

```bash
git clone https://github.com/QuantuLabs/8004-solana.git
cd 8004-solana
yarn install
anchor build
anchor test
```

## Documentation

- [ATOM Engine](programs/atom-engine/README.md) - Reputation model details
- [CHANGELOG](CHANGELOG.md) - Version history
- [Technical Docs](docs/index.html) - Full API reference
- [TypeScript SDK](https://github.com/QuantuLabs/8004-solana-ts) - Official SDK with client-side read functions
- [Indexer](https://github.com/QuantuLabs/8004-solana-indexer) - Off-chain indexer for aggregation queries

## Roadmap

- [x] v0.4.0 - ATOM Engine + Multi-collection
- [x] v0.5.0 - ATOM v0.2.0 "Fortress" (production-ready)
- [x] Off-chain indexer (Substreams-based)
- [ ] Production indexer deployment
- [ ] Mainnet deployment

## References

- [8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Forum Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)

---

MIT License | v0.5.0 | Last Updated: 2026-01-15
