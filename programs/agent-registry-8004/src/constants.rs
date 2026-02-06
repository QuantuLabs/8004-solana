//! Centralized PDA seed constants for the 8004 Agent Registry.
//!
//! All PDA seeds are defined here to ensure consistency between
//! Anchor context definitions and manual seed construction in CPIs.
//!
//! Single Collection Architecture (v0.6.0)
//! Extension collections will be in separate repo: 8004-collection-extension

use anchor_lang::prelude::*;

/// BPF Loader Upgradeable program ID (loader-v3)
/// Used for verifying program upgrade authority.
pub const BPF_LOADER_UPGRADEABLE_ID: Pubkey =
    pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

/// Root configuration PDA seed
/// PDA: ["root_config"]
pub const SEED_ROOT_CONFIG: &[u8] = b"root_config";

/// Registry configuration PDA seed
/// PDA: ["registry_config", collection.key()]
pub const SEED_REGISTRY_CONFIG: &[u8] = b"registry_config";

/// Agent account PDA seed
/// PDA: ["agent", asset.key()]
pub const SEED_AGENT: &[u8] = b"agent";

/// Agent metadata entry PDA seed
/// PDA: ["agent_meta", asset.key(), key_hash[0..16]]
pub const SEED_AGENT_META: &[u8] = b"agent_meta";
