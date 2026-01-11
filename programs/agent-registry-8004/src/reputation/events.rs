use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
/// feedback_uri stored here only (not in FeedbackAccount)
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
#[event]
pub struct NewFeedback {
    pub asset: Pubkey,              // offset 0
    pub client_address: Pubkey,     // offset 32
    pub feedback_index: u64,        // offset 64
    pub score: u8,                  // offset 72
    pub feedback_hash: [u8; 32],    // offset 73 (moved up)
    pub tag1: String,               // offset 105 (variable, moved to end)
    pub tag2: String,               // variable
    pub endpoint: String,           // variable
    pub feedback_uri: String,       // variable
}

/// Event emitted when feedback is revoked
#[event]
pub struct FeedbackRevoked {
    pub asset: Pubkey,              // offset 0
    pub client_address: Pubkey,     // offset 32
    pub feedback_index: u64,        // offset 64
}

/// Event emitted when response is appended to feedback
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
#[event]
pub struct ResponseAppended {
    pub asset: Pubkey,              // offset 0
    pub feedback_index: u64,        // offset 32
    pub responder: Pubkey,          // offset 40
    pub response_hash: [u8; 32],    // offset 72 (moved up)
    pub response_uri: String,       // offset 104 (variable, moved to end)
}
