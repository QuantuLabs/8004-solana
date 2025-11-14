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

    /// Metaplex Collection NFT mint (all agents are part of this collection)
    pub collection_mint: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

impl RegistryConfig {
    /// Space required for RegistryConfig account
    /// 32 (authority) + 8 (next_agent_id) + 8 (total_agents) + 32 (collection_mint) + 1 (bump)
    pub const SIZE: usize = 32 + 8 + 8 + 32 + 1;
}

/// Agent account (equivalent to ERC-721 token)
#[account]
pub struct AgentAccount {
    /// Sequential agent ID (equivalent to ERC-721 tokenId)
    pub agent_id: u64,

    /// Agent owner (equivalent to ERC-721 owner)
    pub owner: Pubkey,

    /// Agent NFT mint (SPL Token with supply=1, decimals=0)
    pub agent_mint: Pubkey,

    /// Token URI (IPFS/Arweave/HTTP link)
    /// Max 200 bytes per ERC-8004 spec
    pub token_uri: String,

    /// Key-value metadata (max 10 entries)
    pub metadata: Vec<MetadataEntry>,

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl AgentAccount {
    /// Maximum size for AgentAccount
    /// 8 (discriminator) + 8 (agent_id) + 32 (owner) + 32 (agent_mint)
    /// + 4 + 200 (token_uri) + 4 + (10 * MetadataEntry::MAX_SIZE) (metadata)
    /// + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 32 + 4 + 200 + 4 + (10 * MetadataEntry::MAX_SIZE) + 8 + 1;

    /// Maximum number of metadata entries allowed
    pub const MAX_METADATA_ENTRIES: usize = 10;

    /// Maximum token URI length in bytes
    pub const MAX_URI_LENGTH: usize = 200;

    /// Find metadata entry by key
    pub fn find_metadata(&self, key: &str) -> Option<&MetadataEntry> {
        self.metadata.iter().find(|entry| entry.key == key)
    }

    /// Find mutable metadata entry by key
    pub fn find_metadata_mut(&mut self, key: &str) -> Option<&mut MetadataEntry> {
        self.metadata.iter_mut().find(|entry| entry.key == key)
    }
}

/// Metadata extension PDA for additional entries beyond the base 10
/// Allows unlimited metadata by creating multiple extension accounts
#[account]
pub struct MetadataExtension {
    /// Agent NFT mint reference
    pub agent_mint: Pubkey,

    /// Extension index (0, 1, 2, ...) for sequential extensions
    pub extension_index: u8,

    /// Additional metadata entries (max 10 per extension)
    pub metadata: Vec<MetadataEntry>,

    /// PDA bump seed
    pub bump: u8,
}

impl MetadataExtension {
    /// Maximum size for MetadataExtension
    /// 8 (discriminator) + 32 (agent_mint) + 1 (extension_index)
    /// + 4 + (10 * MetadataEntry::MAX_SIZE) (metadata) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 32 + 1 + 4 + (10 * MetadataEntry::MAX_SIZE) + 1;

    /// Maximum number of metadata entries per extension
    pub const MAX_METADATA_ENTRIES: usize = 10;

    /// Find metadata entry by key
    pub fn find_metadata(&self, key: &str) -> Option<&MetadataEntry> {
        self.metadata.iter().find(|entry| entry.key == key)
    }

    /// Find mutable metadata entry by key
    pub fn find_metadata_mut(&mut self, key: &str) -> Option<&mut MetadataEntry> {
        self.metadata.iter_mut().find(|entry| entry.key == key)
    }
}

/// Metadata entry (key-value pair)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MetadataEntry {
    /// Metadata key (max 32 bytes)
    pub key: String,

    /// Metadata value (arbitrary bytes, max 256 bytes)
    pub value: Vec<u8>,
}

impl MetadataEntry {
    /// Maximum size per metadata entry
    /// 4 (key length) + 32 (key) + 4 (value length) + 256 (value)
    pub const MAX_SIZE: usize = 4 + 32 + 4 + 256;

    /// Maximum key length in bytes
    pub const MAX_KEY_LENGTH: usize = 32;

    /// Maximum value length in bytes
    pub const MAX_VALUE_LENGTH: usize = 256;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_config_size() {
        assert_eq!(RegistryConfig::SIZE, 81);
    }

    #[test]
    fn test_metadata_entry_size() {
        assert_eq!(MetadataEntry::MAX_SIZE, 296);
    }

    #[test]
    fn test_agent_account_max_size() {
        // Should be under 10KB for reasonable rent costs
        assert!(AgentAccount::MAX_SIZE < 10240);
        // Actual expected size
        assert_eq!(AgentAccount::MAX_SIZE, 3257);
    }

    #[test]
    fn test_metadata_extension_max_size() {
        // Should be under 10KB for reasonable rent costs
        assert!(MetadataExtension::MAX_SIZE < 10240);
        // Actual expected size: 8 + 32 + 1 + 4 + (10 * 296) + 1 = 3006
        assert_eq!(MetadataExtension::MAX_SIZE, 3006);
    }
}
