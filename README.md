# ERC-8004 on Solana

> Solana implementation of ERC-8004 (Trustless Agents Registry) with agent0-ts compatible SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Anchor Version](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://github.com/coral-xyz/anchor)
[![Solana](https://img.shields.io/badge/Solana-Compatible-green)](https://solana.com)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange)]()
[![Progress](https://img.shields.io/badge/Progress-10%25-blue)]()
[![Devnet](https://img.shields.io/badge/Devnet-Live-success)]()
[![Tests](https://img.shields.io/badge/Tests-31%2F32%20Identity-brightgreen)]()

## 📊 Implementation Progress: ~10%

**Phase 1: Identity Registry - ✅ DEPLOYED TO DEVNET (75% ERC-8004 compliant)**

- ✅ Data structures (RegistryConfig, AgentAccount, MetadataEntry, MetadataExtension)
- ✅ Initialize instruction (devnet ✓)
- ✅ Register instruction with NFT validation (devnet ✓)
- ✅ Set metadata instruction + extensions for unlimited storage (devnet ✓)
- ✅ Set agent URI instruction (devnet ✓) - *Note: NFT metadata not auto-synced*
- ✅ Transfer support via SPL Token + sync_owner + transfer_agent (devnet ✓)
- ✅ owner_of() view function (ERC-721 compliance)
- ✅ Events (Registered, MetadataSet, UriUpdated, AgentOwnerSynced)
- ✅ Test suite (31/32 passing - Identity Registry only)
- ✅ **Deployed to Solana Devnet**
- ✅ Metadata extensions: unlimited via PDAs (10 per extension, manual creation)

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

### ✅ Planned Features

- [x] Project structure with 3 Anchor programs
- [x] **Identity Registry** (✅ DEPLOYED & TESTED)
  - [x] NFT-based agent registration (devnet ✓)
  - [x] Metadata storage (max 10 key-value pairs, devnet ✓)
  - [x] Sequential agent IDs (devnet ✓)
  - [x] Set agent URI instruction (devnet ✓)
  - [x] Transfer support via SPL Token + sync_owner (devnet ✓)
  - [x] Devnet deployment (live at AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR)
  - [x] Live integration tests (17/17 functional tests passing)
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

This implementation follows the official [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004) with adaptations for Solana's account model:

| Feature | Ethereum | Solana | Status |
|---------|----------|--------|--------|
| Agent Registration | ERC-721 tokenId | SPL Token NFT + PDA | ✅ Devnet deployed |
| Metadata Storage | Unlimited mapping | 10 base + unlimited via extensions | ✅ Devnet deployed |
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

## Known Limitations & Deviations

This implementation maintains high ERC-8004 compliance while adapting to Solana's architecture. Key differences:

### ✅ Architectural (by design, not bugs)
- **Metadata Extensions**: Require manual PDA creation vs. automatic mapping in Solidity
  - *Why*: Solana's account model requires explicit account initialization
  - *Impact*: Users must call `create_metadata_extension(index)` before storing >10 entries

- **Owner Sync**: Cached owner field requires manual `sync_owner()` call after SPL token transfers
  - *Why*: SPL Token transfers bypass program logic (unlike ERC-721 hooks)
  - *Impact*: Minimal - `transfer_agent()` helper auto-syncs, manual transfers need sync

### ⚠️ Pending Improvements
- **set_agent_uri() NFT Metadata**: Updates AgentAccount but not Metaplex NFT metadata
  - *Why*: Metaplex update requires full metadata struct (compute-intensive)
  - *Impact*: Wallets/marketplaces show original URI unless updated off-chain
  - *Workaround*: Set correct URI at registration; use Metaplex directly for updates
  - *Roadmap*: Add `update_nft_metadata()` helper instruction (Phase 2)

- **transfer_agent() Testing**: Instruction exists but lacks test coverage
  - *Status*: Untested in integration tests
  - *Roadmap*: Add comprehensive transfer tests (Phase 2)

### ❌ Not Yet Implemented (67% of spec)
- **Reputation Registry**: 0% complete (feedback, revocation, responses)
- **Validation Registry**: 0% complete (validation requests/responses)
- **CAIP-10 Global IDs**: Cross-chain agent identifiers not implemented
- **ERC-721 Transfer Event**: Uses custom `AgentOwnerSynced` instead

**Compliance Score**: 28/100 overall, 75/100 for Identity Registry only

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

### Phase 1: Foundation (Current - ~30% Complete)
- [x] Project setup with 3 programs
- [x] Identity Registry core instructions (initialize, register, set_metadata)
- [x] Local tests (14/14 passing)
- [ ] Remaining identity instructions (set_agent_uri, transfer)
- [ ] Devnet deployment
- [ ] Live testing

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
