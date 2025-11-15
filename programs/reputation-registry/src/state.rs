use anchor_lang::prelude::*;

/// Feedback account - One per feedback (per client-agent pair)
/// Seeds: [b"feedback", agent_id, client_address, feedback_index]
#[account]
pub struct FeedbackAccount {
    /// Agent ID from Identity Registry
    pub agent_id: u64,

    /// Client who gave the feedback
    pub client_address: Pubkey,

    /// Sequential index for THIS client's feedbacks to THIS agent
    /// Client A: indices 0, 1, 2, 3...
    /// Client B: indices 0, 1, 2, 3... (independent)
    pub feedback_index: u64,

    /// Score (0-100, validated on-chain)
    pub score: u8,

    /// Tag1 - Full bytes32 (ERC-8004 spec requirement)
    pub tag1: [u8; 32],

    /// Tag2 - Full bytes32 (ERC-8004 spec requirement)
    pub tag2: [u8; 32],

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
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (feedback_index)
    /// + 1 (score) + 32 (tag1) + 32 (tag2) + 4 + 200 (file_uri)
    /// + 32 (file_hash) + 1 (is_revoked) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 8 + 1 + 32 + 32 + 4 + 200 + 32 + 1 + 8 + 1;

    /// Maximum URI length (ERC-8004 spec)
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Response account - Separate account per response (unlimited responses)
/// Seeds: [b"response", agent_id, client_address, feedback_index, response_index]
#[account]
pub struct ResponseAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Original feedback client
    pub client_address: Pubkey,

    /// Original feedback index
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
    /// Maximum size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (feedback_index)
    /// + 8 (response_index) + 32 (responder) + 4 + 200 (response_uri)
    /// + 32 (response_hash) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 8 + 8 + 32 + 4 + 200 + 32 + 8 + 1;

    /// Maximum URI length
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Client index account - Tracks next feedback index for client-agent pair
/// Seeds: [b"client_index", agent_id, client_address]
#[account]
pub struct ClientIndexAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Client address
    pub client_address: Pubkey,

    /// Last used index (next feedback will use this value)
    pub last_index: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ClientIndexAccount {
    /// Size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (last_index) + 1 (bump)
    pub const SIZE: usize = 8 + 8 + 32 + 8 + 1;
}

/// Agent reputation metadata - Cached aggregated stats
/// Seeds: [b"agent_reputation", agent_id]
#[account]
pub struct AgentReputationMetadata {
    /// Agent ID
    pub agent_id: u64,

    /// Total non-revoked feedbacks
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
    /// Size calculation
    /// 8 (discriminator) + 8 (agent_id) + 8 (total_feedbacks) + 8 (total_score_sum)
    /// + 1 (average_score) + 8 (last_updated) + 1 (bump)
    pub const SIZE: usize = 8 + 8 + 8 + 8 + 1 + 8 + 1;
}

/// Response index account - Tracks next response index for a feedback
/// Seeds: [b"response_index", agent_id, client_address, feedback_index]
#[account]
pub struct ResponseIndexAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Client address
    pub client_address: Pubkey,

    /// Feedback index
    pub feedback_index: u64,

    /// Next response index to use
    pub next_index: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ResponseIndexAccount {
    /// Size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (feedback_index)
    /// + 8 (next_index) + 1 (bump)
    pub const SIZE: usize = 8 + 8 + 32 + 8 + 8 + 1;
}
