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

/// Emitted when a checkpoint is created
#[event]
pub struct CheckpointCreated {
    pub asset: Pubkey,
    pub checkpoint_index: u64,
    pub feedback_index: u64,
    pub checkpoint_hash: [u8; 32],
}

/// Emitted when stats are restored from checkpoint
#[event]
pub struct StatsRestored {
    pub asset: Pubkey,
    pub checkpoint_index: u64,
    pub feedback_index: u64,
}

/// Emitted when batch replay is complete
#[event]
pub struct BatchReplayed {
    pub asset: Pubkey,
    pub events_replayed: u32,
    pub final_feedback_index: u64,
}
