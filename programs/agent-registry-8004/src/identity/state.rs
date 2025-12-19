use anchor_lang::prelude::*;

/// Global registry configuration
#[account]
pub struct RegistryConfig {
    /// Registry authority (admin)
    pub authority: Pubkey,

    /// Next agent ID to assign (sequential counter)
    pub next_agent_id: u64,

    /// Total agents registered
    pub total_agents: u64,

    /// Metaplex Core Collection address
    pub collection: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

impl RegistryConfig {
    /// Space required for RegistryConfig account
    /// 32 (authority) + 8 (next_agent_id) + 8 (total_agents) + 32 (collection) + 1 (bump)
    pub const SIZE: usize = 32 + 8 + 8 + 32 + 1;
}

/// Agent account (represents an AI agent identity)
/// Metadata is now stored in separate MetadataEntryPda accounts (v0.2.0)
/// Field order: static fields first for indexing optimization (v0.2.1)
#[account]
pub struct AgentAccount {
    /// Sequential agent ID
    pub agent_id: u64,

    /// Agent owner (cached from Core asset)
    pub owner: Pubkey,

    /// Metaplex Core asset address
    pub asset: Pubkey,

    /// Creation timestamp (static field - fixed offset for indexing)
    pub created_at: i64,

    /// PDA bump seed (static field - fixed offset)
    pub bump: u8,

    /// Agent URI (IPFS/Arweave/HTTP link, max 200 bytes)
    pub agent_uri: String,

    /// NFT name (e.g., "Agent #123", max 32 bytes)
    pub nft_name: String,

    /// NFT symbol (max 10 bytes)
    pub nft_symbol: String,
}

impl AgentAccount {
    /// Maximum size for AgentAccount (v0.2.0 - no inline metadata)
    /// 8 (discriminator) + 8 (agent_id) + 32 (owner) + 32 (asset) +
    /// 4+200 (agent_uri) + 4+32 (nft_name) + 4+10 (nft_symbol) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 32 + (4 + 200) + (4 + 32) + (4 + 10) + 8 + 1;

    /// Maximum URI length in bytes
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Individual metadata entry stored as separate PDA (v0.2.0)
/// Seeds: [b"agent_meta", agent_id.to_le_bytes(), key_hash[0..8]]
///
/// This replaces Vec<MetadataEntry> in AgentAccount for:
/// - Unlimited metadata entries per agent
/// - Ability to delete entries and recover rent
/// - Optional immutability for certification/audit use cases
/// Field order: static fields first for indexing optimization (v0.2.1)
#[account]
pub struct MetadataEntryPda {
    /// Agent ID this metadata belongs to
    pub agent_id: u64,

    /// Creation timestamp (static - fixed offset for common queries)
    pub created_at: i64,

    /// If true, this metadata cannot be modified or deleted (static - fixed offset)
    pub immutable: bool,

    /// PDA bump seed (static - fixed offset)
    pub bump: u8,

    /// Metadata key (max 32 bytes)
    pub metadata_key: String,

    /// Metadata value (max 256 bytes, arbitrary binary data)
    pub metadata_value: Vec<u8>,
}

impl MetadataEntryPda {
    /// Maximum size for MetadataEntryPda
    /// 8 (discriminator) + 8 (agent_id) + 4+32 (key) + 4+256 (value) + 1 (immutable) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + (4 + 32) + (4 + 256) + 1 + 8 + 1;

    /// Maximum key length in bytes
    pub const MAX_KEY_LENGTH: usize = 32;

    /// Maximum value length in bytes
    pub const MAX_VALUE_LENGTH: usize = 256;
}
