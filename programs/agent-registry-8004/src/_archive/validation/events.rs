use anchor_lang::prelude::*;

/// Event emitted when validation is requested
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
/// ERC-8004: Events store full metadata not kept on-chain for rent optimization
#[event]
pub struct ValidationRequested {
    pub asset: Pubkey,              // offset 0
    pub validator_address: Pubkey,  // offset 32
    pub nonce: u32,                 // offset 64
    pub requester: Pubkey,          // offset 68
    pub request_hash: [u8; 32],     // offset 100
    pub created_at: i64,            // offset 132 - not stored on-chain (rent opt)
    pub request_uri: String,        // variable, moved to end
}

/// Event emitted when validator responds
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
/// ERC-8004: Enables progressive validation - validators can update responses
#[event]
pub struct ValidationResponded {
    pub asset: Pubkey,              // offset 0
    pub validator_address: Pubkey,  // offset 32
    pub nonce: u32,                 // offset 64
    pub response: u8,               // offset 68
    pub response_hash: [u8; 32],    // offset 69 - not stored on-chain (rent opt)
    pub responded_at: i64,          // offset 101 - stored on-chain as lastUpdate
    pub response_uri: String,       // variable, moved to end
    pub tag: String,                // variable - not stored on-chain (rent opt)
}
