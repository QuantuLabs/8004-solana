# 8004 on Solana

> Solana implementation of 8004 (Trustless Agents Registry)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor](https://img.shields.io/badge/Anchor-0.32.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)

## Programs (Devnet)

| Program | Address |
|---------|---------|
| agent-registry-8004 | `HHCVWcqsziJMmp43u2UAgAfH2cBjUFxVdW1M3C3NqzvT` |
| atom-engine | `B8Q2nXG7FT89Uau3n41T2qcDLAWxcaQggGqwFWGCEpr7` |

## v0.4.0 Highlights

- **[ATOM](programs/atom-engine/README.md)** (Agent Trust On-chain Model): Integrated reputation scoring with Sybil resistance
- **Multi-Collection Registry**: Global registry with base + user-created collections (sharding)
- **Mandatory CPI**: All feedback operations require ATOM Engine for trust metrics

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Architecture

```
+-----------------------------------------------------------------+
|              agent-registry-8004 (Devnet)                        |
|         HHCVWcqsziJMmp43u2UAgAfH2cBjUFxVdW1M3C3NqzvT            |
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
|         B8Q2nXG7FT89Uau3n41T2qcDLAWxcaQggGqwFWGCEpr7            |
+-----------------------------------------------------------------+
|  +---------------+ +------------------------------------------+ |
|  | AtomConfig    | |              AtomStats (460 bytes)       | |
|  +---------------+ +------------------------------------------+ |
|  | - authority   | | - HLL[256] + salt (unique clients)       | |
|  | - params      | | - ring buffer[24] (burst detection)      | |
|  | - thresholds  | | - quality, risk, tier, confidence        | |
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
| **Reputation** | Feedback (0-100), revoke, responses → **requires** ATOM Engine CPI |
| **Validation** | Third-party verification, multi-validator, progressive (109B optimized) |
| **ATOM Engine** | Integrated Sybil resistance (HLL), burst detection, trust tiers (0-5) |

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

- **ATOM Engine Integration:** Mandatory Sybil resistance via HyperLogLog, burst detection, trust tiers (not in base spec)
- **Multi-Collection Sharding:** Unlimited scalability via collection-based partitioning
- **Immutable Metadata:** Optional flag for permanent certification records
- **Cost Optimization:** 109B validation accounts (-27% vs initial design)

### Required Components

- [TypeScript SDK](https://github.com/QuantuLabs/8004-solana-ts) - Client-side read functions (`getSummary()`, `readAllFeedback()`)
- [Indexer](https://github.com/QuantuLabs/8004-solana-indexer) - Aggregation queries (standard Solana pattern)

See [ERC-8004 Spec](https://github.com/erc-8004/erc-8004-contracts/blob/master/ERC8004SPEC.md) for official specification.

## Costs (v0.4.0)

| Operation | Rent (SOL) | Notes |
|-----------|------------|-------|
| Register Agent | ~0.009 | AgentAccount (378B) + AtomStats (476B) + Core Asset |
| Give Feedback | ~0.00001 | Event-only, just tx fee |
| Request Validation | ~0.0004 | ValidationRequest (109B) + event data (-27% vs v0.3.0) |
| Respond to Validation | ~0.00001 | Updates existing account + event |
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
- [x] Off-chain indexer (Substreams-based)
- [ ] Production indexer deployment
- [ ] Mainnet deployment

## References

- [8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Forum Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)

---

MIT License | v0.4.0 | Last Updated: 2026-01-15
