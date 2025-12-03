use anchor_lang::prelude::*;

/// Validation registry statistics (counters only, no authority needed)
/// PDA seeds: [b"validation_config"]
#[account]
pub struct ValidationStats {
    /// Total validation requests created
    pub total_requests: u64,

    /// Total validation responses recorded
    pub total_responses: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ValidationStats {
    /// Account size: 8 + 8 + 1 = 17 bytes
    pub const SIZE: usize = 8 + 8 + 1;
}

/// Individual validation request (optimized for cost - minimal state)
/// URIs and tags are stored in events only (not on-chain)
/// PDA seeds: [b"validation", agent_id, validator_address, nonce]
#[account]
pub struct ValidationRequest {
    /// Agent ID from Identity Registry
    pub agent_id: u64,

    /// Validator address (who can respond)
    pub validator_address: Pubkey,

    /// Nonce for multiple validations from same validator (enables re-validation)
    pub nonce: u32,

    /// Request hash (SHA-256 of request content for integrity verification)
    pub request_hash: [u8; 32],

    /// Response hash (SHA-256 of response content for integrity verification)
    /// Empty ([0; 32]) until validator responds
    pub response_hash: [u8; 32],

    /// Current response value (0-100, 0 = pending/no response)
    pub response: u8,

    /// Timestamp of request creation
    pub created_at: i64,

    /// Timestamp of last response (0 if no response yet)
    pub responded_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl ValidationRequest {
    /// Account size: 8 + 32 + 4 + 32 + 32 + 1 + 8 + 8 + 1 = 126 bytes
    pub const SIZE: usize = 8 + 32 + 4 + 32 + 32 + 1 + 8 + 8 + 1;

    /// Maximum URI length (validated but not stored on-chain)
    pub const MAX_URI_LENGTH: usize = 200;

    /// Check if validation has been responded to
    pub fn has_response(&self) -> bool {
        self.responded_at > 0
    }

    /// Check if response is pending
    pub fn is_pending(&self) -> bool {
        self.responded_at == 0
    }
}
