use anchor_lang::prelude::*;

/// Emitted when stats are updated for an agent
#[event]
pub struct StatsUpdated {
    /// Asset (agent NFT) public key
    pub asset: Pubkey,
    /// Feedback index
    pub feedback_index: u64,
    /// Score received (0-100)
    pub score: u8,
    /// Computed trust tier (0-4)
    pub trust_tier: u8,
    /// Computed risk score (0-100)
    pub risk_score: u8,
    /// Quality score (0-10000)
    pub quality_score: u16,
    /// Confidence (0-10000)
    pub confidence: u16,
}

/// Emitted when config is initialized
#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub agent_registry_program: Pubkey,
}

/// Emitted when config is updated
#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
    pub version: u8,
}

/// Emitted when stats are initialized for a new agent
#[event]
pub struct StatsInitialized {
    pub asset: Pubkey,
    pub collection: Pubkey,
}

/// Emitted when a feedback is revoked
#[event]
pub struct StatsRevoked {
    /// Asset (agent NFT) public key
    pub asset: Pubkey,
    /// Client who gave the feedback
    pub client: Pubkey,
    /// Original score from the revoked feedback (0-100)
    pub original_score: u8,
    /// True if revoke had impact on stats (false = not found or already revoked)
    pub had_impact: bool,
    /// Trust tier after revoke (0-4)
    pub new_trust_tier: u8,
    /// Quality score after revoke (0-10000)
    pub new_quality_score: u16,
    /// Confidence after revoke (0-10000)
    pub new_confidence: u16,
}
