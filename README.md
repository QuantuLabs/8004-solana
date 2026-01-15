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

- **[ATOM](programs/atom-engine/README.md)** (Agent Trust On-chain Model): Reputation scoring with Sybil resistance
- **Multi-Collection Registry**: Global registry with base + user-created collections (sharding)
- **CPI Integration**: `give_feedback` / `revoke_feedback` → ATOM for real-time scoring

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
| **Reputation** | Feedback (0-100), revoke, responses → CPI to ATOM |
| **Validation** | Third-party verification, multi-validator, progressive (109B optimized) |
| **ATOM** | HLL uniqueness, ring buffer burst detection, trust tiers |

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
- [SDK](https://github.com/QuantuLabs/8004-solana-ts) - TypeScript SDK

## Roadmap

- [x] v0.4.0 - ATOM Engine + Multi-collection
- [ ] Mainnet deployment
- [ ] Indexer service

## References

- [8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Forum Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)

---

MIT License | v0.4.0 | Last Updated: 2026-01-15
