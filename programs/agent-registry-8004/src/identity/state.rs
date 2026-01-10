use anchor_lang::prelude::*;

// ============================================================================
// Scalability: Sharding via Multiple Collections
// ============================================================================

/// Registry type - Base (protocol managed) or User (custom shards)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RegistryType {
    /// Base registry managed by protocol authority
    Base,
    /// User-created registry (custom shard)
    User,
}

impl Default for RegistryType {
    fn default() -> Self {
        RegistryType::Base
    }
}

/// Root configuration - Global pointer to current base registry
/// Seeds: ["root_config"]
#[account]
#[derive(InitSpace)]
pub struct RootConfig {
    /// Current active base registry for new agent registrations
    pub current_base_registry: Pubkey,

    /// Number of base registries created (for indexing)
    pub base_registry_count: u32,

    /// Authority (can create base registries, rotate)
    pub authority: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

/// Per-collection registry configuration - Without counters (off-chain via indexer)
/// Seeds: ["registry_config", collection.key()]
/// EVM conformity: counters (total_agents, next_id) computed off-chain
#[account]
#[derive(InitSpace)]
pub struct RegistryConfig {
    /// Metaplex Core Collection address (also in seeds)
    pub collection: Pubkey,

    /// Registry type: Base (protocol) or User (custom shard)
    pub registry_type: RegistryType,

    /// Authority (protocol authority for Base, user for User)
    pub authority: Pubkey,

    /// Base registry index (0, 1, 2...) - only meaningful for Base type
    pub base_index: u32,

    /// PDA bump seed
    pub bump: u8,
}

/// Agent account (represents an AI agent identity)
/// Seeds: [b"agent", asset.key()]
/// EVM conformity: asset = unique identifier (no sequential agent_id)
/// Keeps nft_name to avoid extra Metaplex RPC calls
#[account]
#[derive(InitSpace)]
pub struct AgentAccount {
    /// Agent owner (cached from Core asset)
    pub owner: Pubkey,

    /// Metaplex Core asset address (unique identifier)
    pub asset: Pubkey,

    /// PDA bump seed (static field - fixed offset)
    pub bump: u8,

    /// Agent URI (IPFS/Arweave/HTTP link, max 200 bytes)
    #[max_len(200)]
    pub agent_uri: String,

    /// NFT name (e.g., "Agent #123", max 32 bytes)
    /// Kept to avoid extra RPC to Metaplex for display
    #[max_len(32)]
    pub nft_name: String,
}

impl AgentAccount {
    /// Maximum URI length in bytes (used for validation)
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Individual metadata entry stored as separate PDA
/// Seeds: [b"agent_meta", asset.key(), key_hash[0..8]]
///
/// This replaces Vec<MetadataEntry> in AgentAccount for:
/// - Unlimited metadata entries per agent
/// - Ability to delete entries and recover rent
/// - Optional immutability for certification/audit use cases
#[account]
#[derive(InitSpace)]
pub struct MetadataEntryPda {
    /// Asset this metadata belongs to (unique identifier)
    pub asset: Pubkey,

    /// If true, this metadata cannot be modified or deleted (static - fixed offset)
    pub immutable: bool,

    /// PDA bump seed (static - fixed offset)
    pub bump: u8,

    /// Metadata key (max 32 bytes)
    #[max_len(32)]
    pub metadata_key: String,

    /// Metadata value (max 256 bytes, arbitrary binary data)
    #[max_len(256)]
    pub metadata_value: Vec<u8>,
}

impl MetadataEntryPda {
    /// Maximum key length in bytes (used for validation)
    pub const MAX_KEY_LENGTH: usize = 32;

    /// Maximum value length in bytes (used for validation)
    pub const MAX_VALUE_LENGTH: usize = 256;
}
