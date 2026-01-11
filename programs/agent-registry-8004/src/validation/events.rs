use anchor_lang::prelude::*;

/// Event emitted when validation is requested
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
#[event]
pub struct ValidationRequested {
    pub asset: Pubkey,              // offset 0
    pub validator_address: Pubkey,  // offset 32
    pub nonce: u32,                 // offset 64
    pub requester: Pubkey,          // offset 68 (moved up)
    pub request_hash: [u8; 32],     // offset 100 (moved up)
    pub request_uri: String,        // offset 132 (variable, moved to end)
}

/// Event emitted when validator responds
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
#[event]
pub struct ValidationResponded {
    pub asset: Pubkey,              // offset 0
    pub validator_address: Pubkey,  // offset 32
    pub nonce: u32,                 // offset 64
    pub response: u8,               // offset 68
    pub response_hash: [u8; 32],    // offset 69 (moved up)
    pub response_uri: String,       // offset 101 (variable, moved to end)
    pub tag: String,                // variable
}
