//! Centralized PDA seed constants for the 8004 Agent Registry.
//!
//! All PDA seeds are defined here to ensure consistency between
//! Anchor context definitions and manual seed construction in CPIs.
//!
//! IMPORTANT: When modifying seeds, update BOTH this file AND the
//! corresponding Anchor #[account(...)] constraints in contexts.rs.

use anchor_lang::prelude::*;

/// BPF Loader Upgradeable program ID (loader-v3)
/// Used for verifying program upgrade authority.
/// Defined here to avoid deprecated bpf_loader_upgradeable module import.
pub const BPF_LOADER_UPGRADEABLE_ID: Pubkey =
    pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

/// Root configuration PDA seed
/// PDA: ["root_config"]
pub const SEED_ROOT_CONFIG: &[u8] = b"root_config";

/// Registry configuration PDA seed
/// PDA: ["registry_config", collection.key()]
pub const SEED_REGISTRY_CONFIG: &[u8] = b"registry_config";

/// User collection authority PDA seed (shared across all user registries)
/// PDA: ["user_collection_authority"]
pub const SEED_USER_COLLECTION_AUTHORITY: &[u8] = b"user_collection_authority";

/// Agent account PDA seed
/// PDA: ["agent", asset.key()]
pub const SEED_AGENT: &[u8] = b"agent";

/// Agent metadata entry PDA seed
/// PDA: ["agent_meta", asset.key(), key_hash[0..16]]
pub const SEED_AGENT_META: &[u8] = b"agent_meta";

/// Validation request PDA seed (in validation module)
/// PDA: ["validation", asset.key(), validator.key(), nonce]
pub const SEED_VALIDATION: &[u8] = b"validation";

/// Validation config PDA seed
/// PDA: ["validation_config"]
pub const SEED_VALIDATION_CONFIG: &[u8] = b"validation_config";
