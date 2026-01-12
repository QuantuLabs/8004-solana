use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
#[event]
pub struct NewFeedback {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub score: u8,
    pub feedback_hash: [u8; 32],
    // Enriched fields from AtomStats
    pub new_trust_tier: u8,
    pub new_quality_score: u16,
    pub new_confidence: u16,
    pub new_risk_score: u8,
    pub new_diversity_ratio: u8,
    pub is_unique_client: bool,
    // Variable-size fields last
    pub tag1: String,
    pub tag2: String,
    pub endpoint: String,
    pub feedback_uri: String,
}

/// Event emitted when feedback is revoked
#[event]
pub struct FeedbackRevoked {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    // Enriched fields from revoke result
    pub original_score: u8,
    pub had_impact: bool,
    pub new_trust_tier: u8,
    pub new_quality_score: u16,
    pub new_confidence: u16,
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
