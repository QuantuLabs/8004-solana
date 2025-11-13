# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry) with agent0-ts compatible SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor Version](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Compatible-green)](https://solana.com)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange)]()

## 🚧 Building in Public

This project is actively under development. Follow along as we build a production-ready implementation of the ERC-8004 standard on Solana.

## What is ERC-8004?

[ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004) is an Ethereum standard for on-chain agent registries. It provides:

- **Identity Registry**: NFT-based agent registration with metadata storage
- **Reputation System**: Cryptographically authenticated feedback and scoring
- **Validation Registry**: Third-party verification and attestation

This implementation brings these capabilities to Solana while maintaining cross-chain compatibility via [CAIP-10](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-10.md) agent IDs.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Solana Programs                       │
├───────────────────┬──────────────────┬───────────────────┤
│ Identity Registry │ Reputation       │ Validation        │
│ (ERC-721 + URI)  │ Registry         │ Registry          │
│                   │                  │                   │
│ • Agent NFTs      │ • Feedback 0-100 │ • Validation      │
│ • Metadata        │ • Revocations    │   Requests        │
│ • Sequential IDs  │ • Responses      │ • Responses       │
└───────────────────┴──────────────────┴───────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              TypeScript SDK (agent0-ts style)            │
├─────────────────────────────────────────────────────────┤
│ • Agent class with create/load/get                      │
│ • IPFS/Arweave storage adapters                         │
│ • OASF taxonomies (136 skills + 204 domains)            │
│ • CAIP-10 multi-chain agent IDs                         │
│ • Search & reputation queries                           │
└─────────────────────────────────────────────────────────┘
```

## Features

### ✅ Planned Features

- [x] Project structure with 3 Anchor programs
- [ ] **Identity Registry**
  - [ ] NFT-based agent registration
  - [ ] Metadata storage (max 10 key-value pairs)
  - [ ] Sequential agent IDs
  - [ ] Transfer support via SPL Token
- [ ] **Reputation Registry**
  - [ ] Feedback scoring (0-100)
  - [ ] Revocation support
  - [ ] Agent responses (max 5 per feedback)
  - [ ] Cached reputation summaries
- [ ] **Validation Registry**
  - [ ] Validation requests
  - [ ] Validator responses
  - [ ] Multi-validator support
- [ ] **TypeScript SDK**
  - [ ] agent0-ts compatible API
  - [ ] IPFS storage (Pinata)
  - [ ] Arweave storage
  - [ ] OASF skills & domains
  - [ ] CAIP-10 formatting

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 1.18+
- [Anchor](https://www.anchor-lang.com/docs/installation) 0.31.1
- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://yarnpkg.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/erc8004-solana.git
cd erc8004-solana

# Install dependencies
yarn install

# Build programs
anchor build

# Run tests
anchor test
```

## ERC-8004 Specification Compliance

This implementation follows the official [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004) with adaptations for Solana's account model:

| Feature | Ethereum | Solana | Status |
|---------|----------|--------|--------|
| Agent Registration | ERC-721 tokenId | SPL Token NFT + PDA | 🚧 In Progress |
| Metadata Storage | Unlimited mapping | Max 10 entries | 🚧 In Progress |
| Reputation Scoring | 0-100 with tags | 0-100 with tags | 🚧 In Progress |
| Feedback Revocation | By client | By client | 🚧 In Progress |
| Agent Responses | Unlimited | Max 5 | 🚧 In Progress |
| Validation System | Request/Response | Request/Response | 🚧 In Progress |
| Cross-chain IDs | CAIP-10 | CAIP-10 | 🚧 In Progress |

## Official References

- **ERC-8004 Spec**: https://eips.ethereum.org/EIPS/eip-8004
- **Forum Discussion**: https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098
- **agent0-ts SDK**: https://github.com/agent0lab/agent0-ts (v0.31 alpha)
- **agent0-py SDK**: https://github.com/agent0lab/agent0-py (v0.31 alpha)
- **Deployed Contracts** (Ethereum Sepolia):
  - Identity: `0x8004a6090Cd10A7288092483047B097295Fb8847`
  - Reputation: `0x8004B8FD1A363aa02fDC07635C0c5F94f6Af5B7E`
  - Validation: `0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5`

## Roadmap

### Phase 1: Foundation (Current)
- [x] Project setup with 3 programs
- [ ] Identity Registry implementation
- [ ] Basic tests

### Phase 2: Core Features
- [ ] Reputation Registry with feedback system
- [ ] Validation Registry
- [ ] Comprehensive test suite

### Phase 3: SDK Development
- [ ] TypeScript SDK with agent0-ts API
- [ ] IPFS/Arweave storage adapters
- [ ] OASF taxonomies integration

### Phase 4: Production Ready
- [ ] Security audit
- [ ] Devnet deployment
- [ ] Documentation & examples
- [ ] Mainnet deployment

## Contributing

This is a build-in-public project. Contributions, suggestions, and feedback are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

We follow conventional commits:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions or changes
- `chore`: Maintenance tasks

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **agent0lab** for the original ERC-8004 specification and reference implementations
- **Solana Foundation** for the excellent development tools
- **Anchor Framework** for making Solana development accessible

---

**Status**: 🚧 Active Development - Last Updated: 2025-11-13

*Building the future of trustless agent registries on Solana*
