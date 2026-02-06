use anchor_lang::prelude::*;

// ============================================================================
// Single Collection Architecture (v0.6.0)
// Extension collections will be in separate repo: 8004-collection-extension
// ============================================================================

/// Root configuration - Global registry state
/// Seeds: ["root_config"]
#[account]
#[derive(InitSpace)]
pub struct RootConfig {
    /// Base collection for agent registrations
    pub base_collection: Pubkey,

    /// Protocol authority
    pub authority: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

/// Registry configuration for the base collection
/// Seeds: ["registry_config", collection.key()]
#[account]
#[derive(InitSpace)]
pub struct RegistryConfig {
    /// Metaplex Core Collection address
    pub collection: Pubkey,

    /// Protocol authority
    pub authority: Pubkey,

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
    // === Fixed-size fields first (for predictable offsets) ===

    /// Collection this agent belongs to (offset 8 - for filtering)
    pub collection: Pubkey,

    /// Agent owner (cached from Core asset)
    pub owner: Pubkey,

    /// Metaplex Core asset address (unique identifier)
    pub asset: Pubkey,

    /// PDA bump seed
    pub bump: u8,

    /// ATOM Engine enabled (irreversible once set to true)
    pub atom_enabled: bool,

    /// Agent's operational wallet (set via Ed25519 signature verification)
    /// None = no wallet set, Some = wallet address
    pub agent_wallet: Option<Pubkey>,

    pub feedback_digest: [u8; 32],
    pub feedback_count: u64,
    pub response_digest: [u8; 32],
    pub response_count: u64,
    pub revoke_digest: [u8; 32],
    pub revoke_count: u64,

    // === Dynamic-size fields last ===

    /// Agent URI (IPFS/Arweave/HTTP link, max 250 bytes)
    #[max_len(250)]
    pub agent_uri: String,

    /// NFT name (e.g., "Agent #123", max 32 bytes)
    /// Kept to avoid extra RPC to Metaplex for display
    #[max_len(32)]
    pub nft_name: String,
}

impl AgentAccount {
    /// Maximum URI length in bytes (used for validation)
    /// MUST match #[max_len(250)] to prevent runtime serialization errors
    pub const MAX_URI_LENGTH: usize = 250;
}

/// Individual metadata entry stored as separate PDA
/// Seeds: [b"agent_meta", asset.key(), key_hash[0..16]]
/// key_hash is SHA256(key)[0..16] for collision resistance (2^128 space)
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

    /// Metadata value (max 250 bytes, arbitrary binary data)
    #[max_len(250)]
    pub metadata_value: Vec<u8>,
}

impl MetadataEntryPda {
    /// Maximum key length in bytes (used for validation)
    pub const MAX_KEY_LENGTH: usize = 32;

    /// Maximum value length in bytes (used for validation)
    pub const MAX_VALUE_LENGTH: usize = 250;
}


