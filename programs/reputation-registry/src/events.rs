use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
#[event]
pub struct NewFeedback {
    pub agent_id: u64,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub score: u8,
    pub tag1: [u8; 32],
    pub tag2: [u8; 32],
    pub file_uri: String,
    pub file_hash: [u8; 32],
}

/// Event emitted when feedback is revoked
#[event]
pub struct FeedbackRevoked {
    pub agent_id: u64,
    pub client_address: Pubkey,
    pub feedback_index: u64,
}

/// Event emitted when response is appended to feedback
#[event]
pub struct ResponseAppended {
    pub agent_id: u64,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub response_index: u64,
    pub responder: Pubkey,
    pub response_uri: String,
}
