use anchor_lang::prelude::*;

/// Feedback account - One per feedback
/// Seeds: [b"feedback", asset.key(), feedback_index]
/// EVM conformity: struct Feedback { score, isRevoked, tag1, tag2 }
#[account]
#[derive(InitSpace)]
pub struct FeedbackAccount {
    /// Asset (NFT address - unique identifier replacing agent_id)
    pub asset: Pubkey,

    /// Client who gave the feedback
    pub client_address: Pubkey,

    /// Global sequential feedback index for this agent
    pub feedback_index: u64,

    /// Score (0-100, validated on-chain)
    pub score: u8,

    /// Revocation status (preserves audit trail)
    pub is_revoked: bool,

    /// PDA bump seed
    pub bump: u8,
}

/// Optional tags PDA for feedback - Created only when tags are provided
/// Seeds: [b"feedback_tags", asset.key(), feedback_index]
/// Separated from FeedbackAccount to save rent when tags not used
/// EVM conformity: Feedback.tag1/tag2 stored on-chain for filtering
#[account]
#[derive(InitSpace)]
pub struct FeedbackTagsPda {
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

/// Response account - Simplified, content stored in events only
/// Seeds: [b"response", asset.key(), feedback_index, response_index]
/// EVM conformity: _responders mapping tracks WHO responded
/// Response content (URI, hash) emitted via ResponseAppended event
#[account]
#[derive(InitSpace)]
pub struct ResponseAccount {
    /// Who responded (anyone can respond)
    pub responder: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

/// Agent reputation metadata - Sequencer for feedback indices
/// Seeds: [b"agent_reputation", asset.key()]
/// EVM conformity: _lastIndex mapping - only tracks next index
/// Aggregates (total, sum, average) computed off-chain via indexer
#[account]
#[derive(InitSpace)]
pub struct AgentReputationMetadata {
    /// Next feedback index to use (global counter)
    pub next_feedback_index: u64,

    /// PDA bump seed
    pub bump: u8,
}

/// Response index account - Tracks next response index for a feedback
/// Seeds: [b"response_index", asset.key(), feedback_index]
#[account]
#[derive(InitSpace)]
pub struct ResponseIndexAccount {
    /// Next response index to use
    pub next_index: u64,

    /// PDA bump seed
    pub bump: u8,
}
