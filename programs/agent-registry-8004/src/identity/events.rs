use anchor_lang::prelude::*;

/// Event emitted when a new agent is registered (8004 spec: Registered)
#[event]
pub struct Registered {
    pub agent_id: u64,
    pub agent_uri: String,
    pub owner: Pubkey,
    pub asset: Pubkey, // Metaplex Core asset address
}

/// Event emitted when agent metadata is set (8004 spec: MetadataSet)
/// v0.2.0: Added immutable field, removed indexed_key, value truncated to 64 bytes
#[event]
pub struct MetadataSet {
    pub agent_id: u64,
    pub key: String,
    pub value: Vec<u8>, // Truncated to max 64 bytes in emit (fetch PDA for full value)
    pub immutable: bool, // v0.2.0: If true, cannot be modified/deleted
}

/// Event emitted when agent metadata is deleted (v0.2.0)
#[event]
pub struct MetadataDeleted {
    pub agent_id: u64,
    pub key: String,
}

/// Event emitted when agent URI is updated (8004 spec: UriUpdated)
#[event]
pub struct UriUpdated {
    pub agent_id: u64,
    pub new_uri: String,
    pub updated_by: Pubkey,
}

/// Event emitted when agent owner is synced after transfer
#[event]
pub struct AgentOwnerSynced {
    pub agent_id: u64,
    pub old_owner: Pubkey,
    pub new_owner: Pubkey,
    pub asset: Pubkey,
}

/// Event emitted when agent wallet is set or updated (8004 spec: WalletUpdated)
#[event]
pub struct WalletUpdated {
    pub agent_id: u64,
    pub old_wallet: Option<Pubkey>,
    pub new_wallet: Pubkey,
    pub updated_by: Pubkey,
}
