use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
/// v0.2.0: feedback_uri stored here only (not in FeedbackAccount)
/// 8004 Jan 2026 spec: renamed file_uri -> feedback_uri, file_hash -> feedback_hash, added endpoint
#[event]
pub struct NewFeedback {
    pub agent_id: u64,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub score: u8,
    pub tag1: String,
    pub tag2: String,
    pub endpoint: String,       // 8004 Jan 2026 spec: agent endpoint (event only)
    pub feedback_uri: String,   // renamed from file_uri
    pub feedback_hash: [u8; 32], // renamed from file_hash
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
