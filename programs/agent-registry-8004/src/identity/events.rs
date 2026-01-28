use anchor_lang::prelude::*;

/// Event emitted when agent metadata is set
/// Field order optimized for indexing: fixed-size fields first, variable-size (String/Vec) last
#[event]
pub struct MetadataSet {
    pub asset: Pubkey,              // offset 0
    pub immutable: bool,            // offset 32 (moved up)
    pub key: String,                // offset 33 (variable, moved to end)
    pub value: Vec<u8>,             // variable
}

/// Event emitted when agent metadata is deleted
#[event]
pub struct MetadataDeleted {
    pub asset: Pubkey,              // offset 0
    pub key: String,                // offset 32 (only variable field, OK at end)
}

/// Event emitted when agent URI is updated
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
#[event]
pub struct UriUpdated {
    pub asset: Pubkey,              // offset 0
    pub updated_by: Pubkey,         // offset 32 (moved up)
    pub new_uri: String,            // offset 64 (variable, moved to end)
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
    pub created_by: Pubkey,
}

/// Event emitted when a user registry is created
#[event]
pub struct UserRegistryCreated {
    pub registry: Pubkey,
    pub collection: Pubkey,
    pub owner: Pubkey,
}

/// Event emitted when agent is registered in a specific registry
/// Field order: fixed-size first (Pubkey, bool), variable-size last (String)
#[event]
pub struct AgentRegisteredInRegistry {
    pub asset: Pubkey,
    pub registry: Pubkey,
    pub collection: Pubkey,
    pub owner: Pubkey,
    pub atom_enabled: bool,
    pub agent_uri: String,
}

/// Event emitted when ATOM is enabled for an agent (one-way)
#[event]
pub struct AtomEnabled {
    pub asset: Pubkey,
    pub enabled_by: Pubkey,
}
