# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor](https://img.shields.io/badge/Anchor-0.32.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)

## Programs (Devnet)

| Program | Address |
|---------|---------|
| agent-registry-8004 | `3GGkAWC3mYYdud8GVBsKXK5QC9siXtFkWVZFYtbueVbC` |
| atom-engine | `AToMNGXU9X5o9r2wg2d9xZnMQkGy6fypHs3c6DZd8VUp` |

## v0.4.0 Highlights

- **[ATOM](programs/atom-engine/README.md)** (Agent Trust On-chain Model): Reputation scoring with Sybil resistance
- **Multi-Collection Registry**: Global registry with base + user-created collections (sharding)
- **CPI Integration**: `give_feedback` / `revoke_feedback` → ATOM for real-time scoring

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Architecture

```
agent-registry-8004                      atom-engine
┌────────────────────────────┐          ┌─────────────────────┐
│ Identity   │ Reputation    │   CPI    │ AtomStats (460B)    │
│ - register │ - giveFeedback│ ───────► │ - HLL[256] + salt   │
│ - metadata │ - revoke      │          │ - ring buffer[24]   │
│ - transfer │ - respond     │          │ - trust tier        │
├────────────┴───────────────┤          └─────────────────────┘
│ Validation                 │
│ - request/respond/close    │
└────────────────────────────┘
            │
            ▼
      Metaplex Core
   (Collection + Assets)
```

## Features

| Module | Description |
|--------|-------------|
| **Identity** | NFT-based agents (Metaplex Core), PDA metadata, immutable option |
| **Reputation** | Feedback (0-100), revoke, responses → CPI to ATOM |
| **Validation** | Third-party verification, multi-validator, progressive |
| **ATOM** | HLL uniqueness, ring buffer burst detection, trust tiers |

## Costs (v0.4.0)

| Operation | Rent (SOL) |
|-----------|------------|
| Register Agent | ~0.006 |
| Give Feedback + ATOM | ~0.005 |
| Set Metadata | ~0.003 |
| Request Validation | ~0.002 |

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

- [ERC-8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Forum Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)

---

MIT License | v0.4.0 | Last Updated: 2026-01-12
