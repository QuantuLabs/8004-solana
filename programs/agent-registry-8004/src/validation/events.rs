use anchor_lang::prelude::*;

/// Event emitted when validation is requested
/// Timestamp available from transaction blockTime
#[event]
pub struct ValidationRequested {
    pub agent_id: u64,
    pub validator_address: Pubkey,
    pub nonce: u32,
    pub request_uri: String,
    pub request_hash: [u8; 32],
    pub requester: Pubkey,
}

/// Event emitted when validator responds
/// Timestamp available from transaction blockTime
#[event]
pub struct ValidationResponded {
    pub agent_id: u64,
    pub validator_address: Pubkey,
    pub nonce: u32,
    pub response: u8,
    pub response_uri: String,
    pub response_hash: [u8; 32],
    pub tag: String,
}
