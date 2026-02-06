# 8004 on Solana

**The trust layer for AI agents.** Identity and reputation—on-chain.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)

## Programs (Devnet)

| Program | Address |
|---------|---------|
| agent-registry-8004 | `8oo4SbcgjRBAXjmGU4YMcdFqfeLLrtn7n6f358PkAc3N` |
| [atom-engine](https://github.com/QuantuLabs/8004-atom) | `AToMNmthLzvTy3D2kz2obFmbVCsTCmYpDw1ptWUJdeU8` |

## Highlights

- **SEAL v1** (Solana Event Authenticity Layer): Trustless on-chain hash computation
- **[ATOM Engine](programs/atom-engine/README.md)**: Hardened EMA arithmetic, tier vesting, platinum loyalty gate
- **Hash-chain integrity**: Rolling digests for feedback, response, and revoke events
- **Single-collection architecture**: All agents in one Metaplex Core collection

See [CHANGELOG.md](CHANGELOG.md).

## Architecture

Two core modules (Identity + Reputation) with an external reputation engine (ATOM).

> Validation module archived for future upgrade.

```
+-----------------------------------------------------------------+
|              agent-registry-8004 (Devnet)                        |
|         8oo4SbcgjRBAXjmGU4YMcdFqfeLLrtn7n6f358PkAc3N            |
+-----------------------------------------------------------------+
|  +---------------+ +------------------+                          |
|  | Identity      | | Reputation       |                          |
|  +---------------+ +------------------+                          |
|  | Agent NFTs    | | SEAL v1 Events   |                          |
|  |  (Core)       | | Hash-Chains      |                          |
|  | Metadata PDAs | | seal_hash        |                          |
|  +---------------+ +------------------+                          |
+-----------------------------------------------------------------+
          |                    |
          | CPI                | Events
          v                    v
+-----------------------------------------------------------------+
|                    atom-engine (ATOM)                            |
|         AToMNmthLzvTy3D2kz2obFmbVCsTCmYpDw1ptWUJdeU8            |
+-----------------------------------------------------------------+
|  HLL[256] + ring buffer[24] + tier vesting + quality/risk       |
+-----------------------------------------------------------------+
          |                    |
          |                    v
          |     +---------------------------------+
          |     |           Indexer               |
          |     |   (Supabase / Substreams)       |
          |     +---------------------------------+
          |     | Events → DB (seal_hash stored) |
          |     | Hash-chain verification        |
          |     | REST API for queries           |
          |     +---------------------------------+
          |                    |
          v                    v
+-----------------------------------------------------------------+
|                      Metaplex Core                               |
|         (Single Collection + Agent Assets)                       |
+-----------------------------------------------------------------+
```

### SEAL v1 - Trustless Integrity

The program is the **sole source of truth**. On-chain `seal_hash` computation ensures both client-submitted data and indexer-stored data can be verified at any time against the blockchain.

```
Client ─┐
        ├──► Program (seal_hash on-chain) ──► Hash-Chain ──► Verifiable
Indexer ┘         ▲ source of truth
```

See **[docs/SEAL.md](docs/SEAL.md)** for full specification.

## Features

| Module | Description |
|--------|-------------|
| **Identity** | Metaplex Core NFTs, PDA metadata, immutable option |
| **Reputation** | Feedback (0-100), revoke, responses, SEAL v1 integrity |
| **ATOM Engine** | Sybil resistance (HLL), burst detection, trust tiers (0-4) |

## ERC-8004 Compliance

Fully compliant with the [ERC-8004 spec](https://eips.ethereum.org/EIPS/eip-8004), adapted for Solana.

| Module | Functions |
|--------|-----------|
| **Identity** | `register()`, `setAgentURI()`, `setMetadata()`, `setAgentWallet()` |
| **Reputation** | `giveFeedback()`, `revokeFeedback()`, `appendResponse()` |

### Solana Architecture

| Pattern | Implementation |
|---------|----------------|
| Feedback/Response/Revoke | Event-only with hash-chain proof |
| Metadata | Separate PDAs per entry |
| Agent IDs | Metaplex Core asset pubkey |

### Beyond the Spec

| Feature | What it brings |
|---------|----------------|
| **ATOM Engine** | Sybil resistance, burst detection, 5-tier trust |
| **SEAL v1** | On-chain hash of feedback parameters for integrity verification |
| **Immutable Metadata** | Lock critical data forever |

### Get Started Fast

| Component | What you get |
|-----------|--------------|
| [TypeScript SDK](https://github.com/QuantuLabs/8004-solana-ts) | Full client library |
| [Indexer](https://github.com/QuantuLabs/8004-solana-indexer) | Query all events |

## Costs

| Operation | Rent (SOL) |
|-----------|------------|
| Register Agent | ~0.006 |
| Initialize ATOM Stats | ~0.005 |
| Give Feedback | ~0.000005 |

## Quick Start

Clone, build, test—you're up in minutes:

```bash
git clone https://github.com/QuantuLabs/8004-solana.git
cd 8004-solana
yarn install
anchor build
anchor test
```

## Devnet Setup

After deploying the programs to devnet, **initialize the registry** (one-time setup by the upgrade authority):

```bash
# Set environment variables
export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"

# Run the init script (creates config + base collection)
npx ts-node scripts/init-devnet.ts
```

This creates:
- **Config PDA**: Global registry config (authority, collection mint)
- **Base Collection**: Single Metaplex Core collection for all agent NFTs

| Account | Current Devnet Address |
|---------|----------------------|
| Config | `EJ3UN1Rp9QCqe5xjHMuoxTmRWm6KBYrxSeATtheFmgZb` |
| Base Collection | `C6W2bq4BoVT8FDvqhdp3sbcHFBjNBXE8TsNak2wTXQs9` |

**Note**: Only the program upgrade authority can call `initialize`.

## Documentation

- [ATOM Engine](programs/atom-engine/README.md)
- [CHANGELOG](CHANGELOG.md)
- [TypeScript SDK](https://github.com/QuantuLabs/8004-solana-ts)
- [Indexer](https://github.com/QuantuLabs/8004-solana-indexer)

## Roadmap

- [x] v0.4.0 - ATOM Engine + Multi-collection
- [x] v0.5.0 - ATOM v0.2.0 + Canonical dedup
- [x] v0.5.1 - Security hardening
- [x] v0.6.0 - SEAL v1 (trustless on-chain hash)
- [x] Substreams indexer
- [ ] Mainnet deployment

## References

- [8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Forum Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)

## Join Us

- [qnt.sh](https://qnt.sh)
- [Telegram](https://t.me/sol8004)
- [X @Quantu_AI](https://x.com/Quantu_AI)

## Acknowledgments

Special thanks to [PayAI](https://payai.network) for supporting the mainnet deployment, Solana devs for early program reviews, and all 8004 contributors.

---

MIT License
