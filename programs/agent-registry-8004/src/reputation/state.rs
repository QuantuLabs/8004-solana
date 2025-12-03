use anchor_lang::prelude::*;

/// Feedback account - One per feedback (global index)
/// Seeds: [b"feedback", agent_id, feedback_index]
#[account]
pub struct FeedbackAccount {
    /// Agent ID from Identity Registry
    pub agent_id: u64,

    /// Client who gave the feedback
    pub client_address: Pubkey,

    /// Global sequential feedback index for this agent
    pub feedback_index: u64,

    /// Score (0-100, validated on-chain)
    pub score: u8,

    /// Tag1 - String tag for categorization (max 32 bytes)
    pub tag1: String,

    /// Tag2 - String tag for categorization (max 32 bytes)
    pub tag2: String,

    /// File URI (IPFS/Arweave link, max 200 bytes)
    pub file_uri: String,

    /// File hash (SHA-256, 32 bytes)
    pub file_hash: [u8; 32],

    /// Revocation status (preserves audit trail)
    pub is_revoked: bool,

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl FeedbackAccount {
    /// Maximum size calculation
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 8 + 1 + (4 + 32) + (4 + 32) + (4 + 200) + 32 + 1 + 8 + 1;

    /// Maximum URI length
    pub const MAX_URI_LENGTH: usize = 200;

    /// Maximum tag length
    pub const MAX_TAG_LENGTH: usize = 32;
}

/// Response account - Separate account per response (unlimited responses)
/// Seeds: [b"response", agent_id, feedback_index, response_index]
#[account]
pub struct ResponseAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Original feedback index (global)
    pub feedback_index: u64,

    /// Sequential response index for this feedback
    pub response_index: u64,

    /// Who responded (anyone can respond)
    pub responder: Pubkey,

    /// Response URI (IPFS/Arweave link, max 200 bytes)
    pub response_uri: String,

    /// Response hash (SHA-256, 32 bytes)
    pub response_hash: [u8; 32],

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl ResponseAccount {
    /// Maximum size calculation (removed client_address)
    pub const MAX_SIZE: usize = 8 + 8 + 8 + 8 + 32 + (4 + 200) + 32 + 8 + 1;

    /// Maximum URI length
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Agent reputation metadata - Cached aggregated stats and global feedback counter
/// Seeds: [b"agent_reputation", agent_id]
#[account]
pub struct AgentReputationMetadata {
    /// Agent ID
    pub agent_id: u64,

    /// Next feedback index to use (global counter)
    pub next_feedback_index: u64,

    /// Total non-revoked feedbacks (for average calculation)
    pub total_feedbacks: u64,

    /// Sum of all non-revoked scores (for average calculation)
    pub total_score_sum: u64,

    /// Average score (0-100, precalculated)
    pub average_score: u8,

    /// Last update timestamp
    pub last_updated: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl AgentReputationMetadata {
    /// Size calculation (added next_feedback_index)
    pub const SIZE: usize = 8 + 8 + 8 + 8 + 8 + 1 + 8 + 1;
}

/// Response index account - Tracks next response index for a feedback
/// Seeds: [b"response_index", agent_id, feedback_index]
#[account]
pub struct ResponseIndexAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Feedback index (global)
    pub feedback_index: u64,

    /// Next response index to use
    pub next_index: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ResponseIndexAccount {
    /// Size calculation (removed client_address)
    pub const SIZE: usize = 8 + 8 + 8 + 8 + 1;
}
