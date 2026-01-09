use anchor_lang::prelude::*;

/// Feedback account - One per feedback (global index)
/// Seeds: [b"feedback", agent_id, feedback_index]
/// Tags moved to optional FeedbackTagsPda for cost optimization
#[account]
#[derive(InitSpace)]
pub struct FeedbackAccount {
    /// Agent ID from Identity Registry
    pub agent_id: u64,

    /// Client who gave the feedback
    pub client_address: Pubkey,

    /// Global sequential feedback index for this agent
    pub feedback_index: u64,

    /// Score (0-100, validated on-chain)
    pub score: u8,

    /// Feedback hash (SHA-256, 32 bytes) - renamed from file_hash per 8004 Jan 2026 spec
    /// feedback_uri is stored in NewFeedback event only (v0.2.0 optimization)
    pub feedback_hash: [u8; 32],

    /// Revocation status (preserves audit trail)
    pub is_revoked: bool,

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

/// Optional tags PDA for feedback - Created only when tags are provided
/// Seeds: [b"feedback_tags", agent_id, feedback_index]
/// Separated from FeedbackAccount to save -42% when tags not used
/// Field order: static fields first for indexing optimization (v0.2.1)
#[account]
#[derive(InitSpace)]
pub struct FeedbackTagsPda {
    /// Agent ID (for validation)
    pub agent_id: u64,

    /// Feedback index (for validation)
    pub feedback_index: u64,

    /// PDA bump seed (static - fixed offset)
    pub bump: u8,

    /// Tag1 - String tag for categorization (max 32 bytes)
    #[max_len(32)]
    pub tag1: String,

    /// Tag2 - String tag for categorization (max 32 bytes)
    #[max_len(32)]
    pub tag2: String,
}

impl FeedbackTagsPda {
    /// Maximum tag length (used for validation)
    pub const MAX_TAG_LENGTH: usize = 32;
}

/// Response account - Separate account per response (unlimited responses)
/// Seeds: [b"response", agent_id, feedback_index, response_index]
/// v0.2.0: Removed response_uri (stored in event only)
#[account]
#[derive(InitSpace)]
pub struct ResponseAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Original feedback index (global)
    pub feedback_index: u64,

    /// Sequential response index for this feedback
    pub response_index: u64,

    /// Who responded (anyone can respond)
    pub responder: Pubkey,

    /// Response hash (SHA-256, 32 bytes)
    /// response_uri is stored in ResponseAppended event only (v0.2.0 optimization)
    pub response_hash: [u8; 32],

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

/// Agent reputation metadata - Cached aggregated stats and global feedback counter
/// Seeds: [b"agent_reputation", agent_id]
#[account]
#[derive(InitSpace)]
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

/// Response index account - Tracks next response index for a feedback
/// Seeds: [b"response_index", agent_id, feedback_index]
#[account]
#[derive(InitSpace)]
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
