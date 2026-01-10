use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
/// feedback_uri stored here only (not in FeedbackAccount)
#[event]
pub struct NewFeedback {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub score: u8,
    pub tag1: String,
    pub tag2: String,
    pub endpoint: String,
    pub feedback_uri: String,
    pub feedback_hash: [u8; 32],
}

/// Event emitted when feedback is revoked
#[event]
pub struct FeedbackRevoked {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
}

/// Event emitted when response is appended to feedback
/// response_uri stored here only (not in ResponseAccount)
#[event]
pub struct ResponseAppended {
    pub asset: Pubkey,
    pub feedback_index: u64,
    pub response_index: u64,
    pub responder: Pubkey,
    pub response_uri: String,
    pub response_hash: [u8; 32],
}
