use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
/// v0.2.0: file_uri stored here only (not in FeedbackAccount)
#[event]
pub struct NewFeedback {
    pub agent_id: u64,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub score: u8,
    pub tag1: String,
    pub tag2: String,
    pub file_uri: String,  // v0.2.0: URI stored in event only
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
/// v0.2.0: response_uri stored here only (not in ResponseAccount)
/// client_address derivable from FeedbackAccount
#[event]
pub struct ResponseAppended {
    pub agent_id: u64,
    pub feedback_index: u64,
    pub response_index: u64,
    pub responder: Pubkey,
    pub response_uri: String,  // v0.2.0: URI stored in event only
    pub response_hash: [u8; 32],
}
