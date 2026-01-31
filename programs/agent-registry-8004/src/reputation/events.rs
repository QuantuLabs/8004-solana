use anchor_lang::prelude::*;

/// Event emitted when new feedback is given
/// Field order optimized for indexing: fixed-size fields first, variable-size (String) last
///
/// SEAL v1: feedback_file_hash is optional (hash of external file content),
/// seal_hash is computed on-chain from feedback parameters (trustless).
#[event]
pub struct NewFeedback {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub slot: u64,
    pub value: i64,
    pub value_decimals: u8,
    pub score: Option<u8>,
    /// SEAL v1: Optional hash of the feedback file content (ERC-8004 spec)
    /// Client-provided, used for external file integrity verification.
    pub feedback_file_hash: Option<[u8; 32]>,
    /// SEAL v1: Hash computed on-chain from feedback parameters (trustless)
    /// This is the authoritative content hash used in the hash-chain.
    pub seal_hash: [u8; 32],
    pub atom_enabled: bool,
    pub new_trust_tier: u8,
    pub new_quality_score: u16,
    pub new_confidence: u16,
    pub new_risk_score: u8,
    pub new_diversity_ratio: u8,
    pub is_unique_client: bool,
    pub new_feedback_digest: [u8; 32],
    pub new_feedback_count: u64,
    pub tag1: String,
    pub tag2: String,
    pub endpoint: String,
    pub feedback_uri: String,
}

/// Event emitted when feedback is revoked
/// SEAL v1: Uses seal_hash (on-chain computed) for identification.
#[event]
pub struct FeedbackRevoked {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    /// SEAL v1: The seal_hash from the original feedback (for identification)
    pub seal_hash: [u8; 32],
    pub slot: u64,
    pub original_score: u8,
    /// Whether ATOM Engine was used for this revocation
    pub atom_enabled: bool,
    /// Enriched fields from revoke result (0 values if atom_enabled=false)
    pub had_impact: bool,
    pub new_trust_tier: u8,
    pub new_quality_score: u16,
    pub new_confidence: u16,
    pub new_revoke_digest: [u8; 32],
    pub new_revoke_count: u64,
}

/// Event emitted when response is appended to feedback
/// SEAL v1: Uses seal_hash (on-chain computed) for feedback identification.
#[event]
pub struct ResponseAppended {
    pub asset: Pubkey,
    pub client: Pubkey,
    pub feedback_index: u64,
    pub slot: u64,
    pub responder: Pubkey,
    pub response_hash: [u8; 32],
    /// SEAL v1: The seal_hash from the original feedback (for identification)
    pub seal_hash: [u8; 32],
    pub new_response_digest: [u8; 32],
    pub new_response_count: u64,
    pub response_uri: String,
}
