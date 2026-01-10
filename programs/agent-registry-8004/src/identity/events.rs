use anchor_lang::prelude::*;

/// Event emitted when agent metadata is set
#[event]
pub struct MetadataSet {
    pub asset: Pubkey,
    pub key: String,
    pub value: Vec<u8>,
    pub immutable: bool,
}

/// Event emitted when agent metadata is deleted
#[event]
pub struct MetadataDeleted {
    pub asset: Pubkey,
    pub key: String,
}

/// Event emitted when agent URI is updated
#[event]
pub struct UriUpdated {
    pub asset: Pubkey,
    pub new_uri: String,
    pub updated_by: Pubkey,
}

/// Event emitted when agent owner is synced after transfer
#[event]
pub struct AgentOwnerSynced {
    pub asset: Pubkey,
    pub old_owner: Pubkey,
    pub new_owner: Pubkey,
}

/// Event emitted when agent wallet is set or updated
#[event]
pub struct WalletUpdated {
    pub asset: Pubkey,
    pub old_wallet: Option<Pubkey>,
    pub new_wallet: Pubkey,
    pub updated_by: Pubkey,
}

// ============================================================================
// Scalability Events
// ============================================================================

/// Event emitted when a base registry is created
#[event]
pub struct BaseRegistryCreated {
    pub registry: Pubkey,
    pub collection: Pubkey,
    pub base_index: u32,
    pub created_by: Pubkey,
}

/// Event emitted when base registry is rotated
#[event]
pub struct BaseRegistryRotated {
    pub old_registry: Pubkey,
    pub new_registry: Pubkey,
    pub rotated_by: Pubkey,
}

/// Event emitted when a user registry is created
#[event]
pub struct UserRegistryCreated {
    pub registry: Pubkey,
    pub collection: Pubkey,
    pub owner: Pubkey,
}

/// Event emitted when agent is registered in a specific registry
#[event]
pub struct AgentRegisteredInRegistry {
    pub asset: Pubkey,
    pub registry: Pubkey,
    pub collection: Pubkey,
    pub owner: Pubkey,
}
