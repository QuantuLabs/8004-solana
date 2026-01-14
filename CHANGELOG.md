# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-01-14

### ATOM Engine v0.2.0 "Fortress" - Production Ready

The ATOM Engine has reached production stability after extensive security audits.

#### Added
- **Tier Vesting** - 8 epoch (~20 days) delay before tier promotion to prevent Sybil attacks
- **Platinum Loyalty Gate** - Requires 500+ loyalty score before Platinum candidature
- **Anti-Oscillation** - Tier fluctuations don't reset vesting timer

#### State Changes
- +4 bytes per agent (tier_candidate, tier_candidate_epoch, tier_confirmed)

See `ATOM-CHANGELOG.md` for complete security audit history.

---

## [0.4.0] - 2026-01-12

### Added - ATOM Engine Integration

New `atom-engine` program for advanced on-chain reputation analytics with Sybil resistance.

#### New Program: atom-engine
- **HyperLogLog (HLL)** - 256 registers (4-bit packed, 128 bytes) for unique client estimation
- **Ring Buffer** - 24 slots with 56-bit fingerprints for burst detection and revoke support
- **Per-Agent Salt** - 8-byte salt prevents HLL grinding attacks
- **Round Robin Eviction** - Cursor-based eviction prevents targeted manipulation
- **Trust Tiers** - 5 tiers (Unknown → Legendary) with hysteresis thresholds

#### CPI Integration
- `give_feedback` → CPI to `atom_engine::update_stats`
- `revoke_feedback` → CPI to `atom_engine::revoke_stats`
- `NewFeedback` event enriched with ATOM metrics (trust_tier, quality_score, confidence, risk_score, diversity_ratio)

#### New Account: AtomStats (460 bytes/agent)
| Field | Type | Description |
|-------|------|-------------|
| collection | Pubkey | Collection filter |
| asset | Pubkey | Agent identifier |
| feedback_count | u32 | Total feedbacks |
| quality_score | i32 | Weighted score (EMA) |
| hll_packed | [u8; 128] | HyperLogLog registers |
| hll_salt | u64 | Per-agent salt |
| recent_callers | [u64; 24] | Ring buffer fingerprints |
| eviction_cursor | u8 | Round robin pointer |
| trust_tier/confidence/risk_score/diversity_ratio | cached | Output cache |

### Changed
- `NewFeedback` event now includes 6 new ATOM fields
- `FeedbackRevoked` event now includes revoke impact metrics

### Storage
- AtomStats: 460 bytes (~$0.82 rent at 150 SOL/USD)
- Total per agent with ATOM: ~773 bytes

---

## [0.3.0] - 2026-01-10

### Breaking Changes - Asset-Based Identification + Multi-Collection Sharding

This version replaces `agent_id` (u64) with `asset` (Pubkey) as the unique identifier, and introduces multi-collection sharding for scalability.

### Added - Scalability Architecture

#### New Accounts
| Account | Seeds | Description |
|---------|-------|-------------|
| RootConfig | `["root_config"]` | Global pointer to current base registry |
| RegistryConfig | `["registry_config", collection]` | Per-collection config (Base or User type) |

#### New Instructions
| Instruction | Access | Description |
|-------------|--------|-------------|
| `initialize` | Authority | Initialize root config + first base registry |
| `create_base_registry` | Authority | Create additional base registries |
| `rotate_base_registry` | Authority | Switch active base registry |
| `create_user_registry` | Anyone | Create custom user shard |
| `update_user_registry_metadata` | Owner | Update user collection name/URI |
| `register` | Anyone | Register agent in specific registry |

#### Registry Types
- **Base Registry**: Protocol-managed, indexed (0, 1, 2...), rotatable
- **User Registry**: Custom shards, owned by creator, independent

### Changed

#### API Changes
- `give_feedback`: removed `agent_id` parameter (uses `asset` from context)
- `revoke_feedback`: removed `agent_id` parameter
- `append_response`: removed `agent_id` parameter
- `set_feedback_tags`: removed `agent_id` parameter
- `request_validation`: removed `agent_id` parameter
- All events now use `asset: Pubkey` instead of `agent_id: u64`

#### PDA Seeds Changes
| PDA | Before | After |
|-----|--------|-------|
| FeedbackAccount | `["feedback", collection, agent_id, index]` | `["feedback", asset, index]` |
| FeedbackTagsPda | `["feedback_tags", collection, agent_id, index]` | `["feedback_tags", asset, index]` |
| ResponseAccount | `["response", collection, agent_id, fb_idx, resp_idx]` | `["response", asset, fb_idx, resp_idx]` |
| ResponseIndexAccount | `["response_index", collection, agent_id, fb_idx]` | `["response_index", asset, fb_idx]` |
| AgentReputationMetadata | `["agent_reputation", collection, agent_id]` | `["agent_reputation", asset]` |
| ValidationRequest | `["validation", collection, agent_id, validator, nonce]` | `["validation", asset, validator, nonce]` |
| MetadataEntryPda | `["agent_meta", agent_id, key_hash]` | `["agent_meta", asset, key_hash]` |

### Removed

#### Accounts
- `ValidationStats` - counters now computed off-chain via indexer

#### Fields
- `agent_id` - everywhere (replaced by `asset`)
- `collection` - from FeedbackAccount, ValidationRequest (implicit via PDA)
- `created_at` - from FeedbackAccount, ResponseAccount, AgentAccount (use blockTime)
- `responded_at` - from ValidationRequest (replaced by `last_update` + `has_response`)
- `nft_symbol` - from AgentAccount (read from Metaplex if needed)
- `next_agent_id`, `total_agents` - from RegistryConfig (off-chain)
- `total_feedbacks`, `total_score_sum`, `average_score`, `last_updated` - from AgentReputationMetadata (off-chain)

### Added

#### Fields
- `last_update` - in ValidationRequest (timestamp of last update)
- `has_response` - in ValidationRequest (boolean flag)

### Storage Optimization

| Account | Before | After | Savings |
|---------|--------|-------|---------|
| FeedbackAccount | 99 bytes | 83 bytes | -16% |
| FeedbackTagsPda | 97 bytes | 81 bytes | -16% |
| AgentReputationMetadata | 50 bytes | 17 bytes | -66% |
| ValidationRequest | 166 bytes | 151 bytes | -9% |
| AgentAccount | 343 bytes | 313 bytes | -9% |
| RegistryConfig | 94 bytes | 78 bytes | -17% |
| ResponseAccount | 73 bytes | 41 bytes | -44% |
| ResponseIndexAccount | 33 bytes | 17 bytes | -48% |

**Per agent (1 feedback, 1 response, 1 validation):** -158 bytes (-18%), -0.14 SOL

---

## [0.2.2] - 2026-01-06

### Security Audit Fixes

- **F-01**: Initialize gate with upgrade authority check
- **F-02v2**: `close_validation` rent goes to current Core asset owner (not cached)
- **F-03**: Fixed `agent_id==0` sentinel bug for agent #0
- **F-05**: `key_hash` validated against SHA256(key)
- **F-06v2**: `mpl_core::ID` ownership check in `get_core_owner()`
- **A-06**: Key hash collision protection for metadata
- **A-07**: Average score rounding (instead of truncation)
- **V-01**: Tag length validation in `respond_to_validation`

### Added
- 29 dedicated security tests
- 100% conformity with Metaplex Core best practices
- 100% conformity with Anchor framework guidelines

---

## [0.2.1] - 2026-01-05

### Changed - Field Ordering for Indexing Optimization

- **Static fields first** - Reordered account fields for `memcmp` filtering
- **Fixed offsets** - `created_at`, `bump`, `immutable` now at predictable offsets
- **SDK backward compatibility** - Dual deserializers support both old and new layouts

### Breaking Changes
- Account binary layout changed (new accounts incompatible with pre-v0.2.1)
- SDK includes `LEGACY_DEVNET` fallback for old devnet accounts

---

## [0.2.0] - 2026-01-04

### Added
- **Metadata PDAs** - Individual PDAs per metadata key (replaces Vec)
- **Immutable Metadata** - Lock metadata permanently for certifications
- **Delete Metadata** - Recover rent by deleting mutable entries
- **Optional Tags PDA** - FeedbackTagsPda for -42% cost when tags not used
- **Global Feedback Index** - Simplified PDA derivation

### Changed
- **Hash-Only Storage** - URIs in events, hashes on-chain (-66% ResponseAccount)

### Breaking Changes
- `file_uri` and `response_uri` removed from accounts (events only)
- `tag1` and `tag2` moved to optional `FeedbackTagsPda`
- Metadata now via `set_metadata_pda` / `delete_metadata_pda`
- Account sizes changed (incompatible with v0.1.0)

---

## [0.1.0] - 2026-01-01

### Added
- Initial implementation of ERC-8004 on Solana
- Identity Registry with Metaplex Core integration
- Reputation Registry with feedback and responses
- Validation Registry with multi-validator support
- TypeScript SDK
- 118 tests with 100% pass rate
