# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry) with agent0-ts compatible SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor Version](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Compatible-green)](https://solana.com)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange)]()
[![Progress](https://img.shields.io/badge/Progress-Phase%201%20Complete-blue)]()
[![Devnet](https://img.shields.io/badge/Devnet-Live-success)]()
[![Tests](https://img.shields.io/badge/Tests-43%2F43-brightgreen)]()
[![Identity](https://img.shields.io/badge/Identity%20Registry-100%25%20Complete-brightgreen)]()

## 📊 Implementation Progress

**Phase 1: Identity Registry - ✅ COMPLETE**

- ✅ Data structures (RegistryConfig, AgentAccount, MetadataEntry, MetadataExtension)
- ✅ Initialize instruction with Metaplex Collection NFT
- ✅ Register instructions (register, registerEmpty, registerWithMetadata)
- ✅ Set metadata instruction + unlimited metadata via extensions
- ✅ Set agent URI instruction with Metaplex UpdateV1 CPI
- ✅ Transfer support via SPL Token + sync_owner + transfer_agent
- ✅ **Update authority transfer** - New NFT owners can modify tokenURI and metadata (ERC-8004 compliance)
- ✅ owner_of() view function (ERC-721 compatibility)
- ✅ Metadata extension system for unlimited metadata storage
- ✅ Events (Registered, MetadataSet, UriUpdated, AgentOwnerSynced)
- ✅ **Test suite: 43/43 passing (100% E2E coverage for Identity Registry)**
- ✅ **100% ERC-8004 Identity Registry Compliance**
- ✅ **Deployed to Solana Devnet**

**Phase 2: Reputation Registry - ⏳ NOT STARTED**

**Phase 3: Validation Registry - ⏳ NOT STARTED**

**Phase 4: TypeScript SDK - ⏳ NOT STARTED**

**Devnet Program IDs:**
- Identity Registry: `AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR`
- Reputation Registry: `9WcFLL3Fsqs96JxuewEt9iqRwULtCZEsPT717hPbsQAa`
- Validation Registry: `2masQXYbHKXMrTV9aNLTWS4NMbNHfJhgcsLBtP6N5j6x`

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
│ (NFT Collection)  │ Registry         │ Registry          │
│                   │                  │                   │
│ • Agent NFTs      │ • Feedback 0-100 │ • Validation      │
│   (via Metaplex)  │ • Revocations    │   Requests        │
│ • Metadata        │ • Responses      │ • Responses       │
│ • Sequential IDs  │                  │                   │
│ • Collection NFT  │                  │                   │
└───────────────────┴──────────────────┴───────────────────┘
         │                  │
         │                  ▼
         │         SPL Token + Metaplex
         │         (NFT minting & metadata)
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

**NFT Integration**: We use **Metaplex Token Metadata** for NFT management. The program controls minting via SPL Token (per ERC-8004 spec requirement), while Metaplex handles the metadata layer (name, URI, collection). This follows the standard Solana NFT pattern.

## Features

### ✅ Phase 1 Complete: Identity Registry

- [x] Project structure with 3 Anchor programs
- [x] **Identity Registry** (✅ COMPLETE)
  - [x] NFT-based agent registration via Metaplex (devnet ✓)
  - [x] Metadata storage with unlimited extensions (devnet ✓)
  - [x] Sequential agent IDs (devnet ✓)
  - [x] Set agent URI with update_authority transfer (devnet ✓)
  - [x] Transfer support via SPL Token + sync_owner + transfer_agent (devnet ✓)
  - [x] owner_of() view function (ERC-721 compatibility)
  - [x] Metadata extension system for unlimited storage
  - [x] UpdateV1 CPI for update_authority transfer to new owners
  - [x] Comprehensive test suite (43/43 tests passing)
  - [x] Devnet deployment (live at AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR)

### 🚀 Future Phases

- [ ] **Reputation Registry**
  - [ ] Feedback scoring (0-100)
  - [ ] Revocation support
  - [ ] Agent responses (unlimited via separate accounts)
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
git clone https://github.com/QuantumAgentic/erc8004-solana.git
cd erc8004-solana

# Install dependencies
yarn install

# Build programs
anchor build

# Run tests
anchor test
```

## ERC-8004 Specification Compliance

### Identity Registry - ✅ Fully Compliant

The Identity Registry implementation achieves **full compliance** with the [ERC-8004 Identity Registry specification](https://eips.ethereum.org/EIPS/eip-8004):

| Feature | ERC-8004 Requirement | Solana Implementation | Status |
|---------|---------------------|----------------------|--------|
| Agent Registration | Contract creates NFT | Program creates SPL Token NFT via Metaplex | ✅ Compliant |
| Metadata Storage | Unlimited on-chain | 10 base + unlimited via extensions | ✅ Compliant |
| Owner Modifications | Owner can modify tokenURI & metadata | UpdateV1 CPI transfers update_authority to new owner | ✅ Compliant |
| Sequential Agent IDs | Required | Implemented via RegistryConfig counter | ✅ Compliant |
| Empty URI Support | Must accept empty tokenURI | Supported in register/registerEmpty | ✅ Compliant |
| Transfer Support | NFT transfer = ownership transfer | SPL Token transfer + sync_owner | ✅ Compliant |
| ownerOf() Function | ERC-721 compatibility | Implemented as view function | ✅ Compliant |
| Events | Registered, MetadataSet, UriUpdated | All events implemented | ✅ Compliant |

**Key Implementation**: The program correctly transfers NFT `update_authority` to new owners via Metaplex UpdateV1 CPI, ensuring new NFT owners can modify tokenURI and metadata.

### Reputation & Validation (Future Phases)

| Feature | Ethereum | Solana | Status |
|---------|----------|--------|--------|
| Reputation Scoring | 0-100 with tags | 0-100 with tags | ⏳ Not started |
| Feedback Revocation | By client | By client | ⏳ Not started |
| Agent Responses | Unlimited | Unlimited | ⏳ Not started |
| Validation System | Request/Response | Request/Response | ⏳ Not started |
| Cross-chain IDs | CAIP-10 | CAIP-10 | ⏳ Not started |

## Metadata Storage

### On-Chain (10 entries max)

```typescript
await program.methods.setMetadata("name", Buffer.from("Alice")).rpc();
await program.methods.setMetadata("mcp_endpoint", Buffer.from("https://...")).rpc();
```

- Max 10 entries per agent
- Max 32 bytes per key, 256 bytes per value
- Cost: ~$0.60 rent (included in agent account)

### Extended Metadata

For >10 entries, use:

1. **TokenURI JSON** (recommended): Unlimited storage via IPFS/Arweave (~$0.01)
2. **Extension PDAs**: Additional on-chain entries (~$0.40/entry, recoverable)

See [METADATA_EXTENSIONS.md](./docs/METADATA_EXTENSIONS.md) for details.

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

### Phase 1: Identity Registry ✅ COMPLETE
- [x] Project setup with 3 programs
- [x] Identity Registry all instructions (initialize, register, set_metadata, set_agent_uri, transfer)
- [x] Update authority transfer via Metaplex UpdateV1 CPI
- [x] Metadata extension system for unlimited storage
- [x] Comprehensive test suite (43/43 passing)
- [x] ERC-8004 Identity Registry specification compliance
- [x] Devnet deployment (live)

### Phase 2: Core Features (Next)
- [ ] Reputation Registry with feedback system
- [ ] Validation Registry
- [ ] Cross-program integration tests

### Phase 3: SDK Development
- [ ] TypeScript SDK with agent0-ts API
- [ ] IPFS/Arweave storage adapters
- [ ] OASF taxonomies integration

### Phase 4: Production Deployment
- [ ] Security audit
- [ ] Mainnet deployment
- [ ] Documentation & examples
- [ ] Public launch

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

**Status**: 🚧 In Development - Phase 1 Complete (Identity Registry) - Last Updated: 2025-11-14

**Identity Registry Test Coverage**: 43/43 tests passing

*Building the future of trustless agent registries on Solana*
