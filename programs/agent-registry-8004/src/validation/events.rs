use anchor_lang::prelude::*;

/// Event emitted when validation is requested
#[event]
pub struct ValidationRequested {
    pub agent_id: u64,
    pub validator_address: Pubkey,
    pub nonce: u32,
    pub request_uri: String,
    pub request_hash: [u8; 32],
    pub requester: Pubkey,
    pub created_at: i64,
}

/// Event emitted when validator responds
#[event]
pub struct ValidationResponded {
    pub agent_id: u64,
    pub validator_address: Pubkey,
    pub nonce: u32,
    pub response: u8,
    pub response_uri: String,
    pub response_hash: [u8; 32],
    pub tag: String,
    pub responded_at: i64,
}
