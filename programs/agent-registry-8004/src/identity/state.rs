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
#[account]
pub struct AgentAccount {
    /// Sequential agent ID
    pub agent_id: u64,

    /// Agent owner (cached from Core asset)
    pub owner: Pubkey,

    /// Metaplex Core asset address
    pub asset: Pubkey,

    /// Agent URI (IPFS/Arweave/HTTP link, max 200 bytes)
    pub agent_uri: String,

    /// NFT name (e.g., "Agent #123", max 32 bytes)
    pub nft_name: String,

    /// NFT symbol (max 10 bytes)
    pub nft_symbol: String,

    /// Key-value metadata (max 1 entry in base, use extension for more)
    pub metadata: Vec<MetadataEntry>,

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl AgentAccount {
    /// Maximum size for AgentAccount
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 32 + 4 + 200 + 4 + 32 + 4 + 10 + 4 + (1 * MetadataEntry::MAX_SIZE) + 8 + 1;

    /// Maximum number of metadata entries in base account
    pub const MAX_METADATA_ENTRIES: usize = 1;

    /// Maximum URI length in bytes
    pub const MAX_URI_LENGTH: usize = 200;

    /// Find metadata entry by key
    pub fn find_metadata(&self, key: &str) -> Option<&MetadataEntry> {
        self.metadata.iter().find(|entry| entry.metadata_key == key)
    }

    /// Find mutable metadata entry by key
    pub fn find_metadata_mut(&mut self, key: &str) -> Option<&mut MetadataEntry> {
        self.metadata.iter_mut().find(|entry| entry.metadata_key == key)
    }
}

/// Metadata extension for additional entries beyond base account
#[account]
pub struct MetadataExtension {
    /// Agent asset reference
    pub asset: Pubkey,

    /// Extension index (0, 1, 2, ...)
    pub extension_index: u8,

    /// Additional metadata entries (max 10 per extension)
    pub metadata: Vec<MetadataEntry>,

    /// PDA bump seed
    pub bump: u8,
}

impl MetadataExtension {
    /// Maximum size for MetadataExtension
    pub const MAX_SIZE: usize = 8 + 32 + 1 + 4 + (10 * MetadataEntry::MAX_SIZE) + 1;

    /// Maximum number of metadata entries per extension
    pub const MAX_METADATA_ENTRIES: usize = 10;

    /// Find metadata entry by key
    pub fn find_metadata(&self, key: &str) -> Option<&MetadataEntry> {
        self.metadata.iter().find(|entry| entry.metadata_key == key)
    }

    /// Find mutable metadata entry by key
    pub fn find_metadata_mut(&mut self, key: &str) -> Option<&mut MetadataEntry> {
        self.metadata.iter_mut().find(|entry| entry.metadata_key == key)
    }
}

/// Metadata entry (key-value pair)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MetadataEntry {
    /// Metadata key (max 32 bytes)
    pub metadata_key: String,

    /// Metadata value (max 256 bytes)
    pub metadata_value: Vec<u8>,
}

impl MetadataEntry {
    /// Maximum size per metadata entry
    pub const MAX_SIZE: usize = 4 + 32 + 4 + 256;

    /// Maximum key length in bytes
    pub const MAX_KEY_LENGTH: usize = 32;

    /// Maximum value length in bytes
    pub const MAX_VALUE_LENGTH: usize = 256;
}
