use anchor_lang::prelude::*;

/// Global validation registry configuration
#[account]
pub struct ValidationConfig {
    /// Registry authority (programme owner)
    pub authority: Pubkey,

    /// Identity Registry program ID (for CPI validation)
    pub identity_registry: Pubkey,

    /// Total validation requests created
    pub total_requests: u64,

    /// Total validation responses recorded
    pub total_responses: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ValidationConfig {
    /// Account size: 32 + 32 + 8 + 8 + 1 = 81 bytes
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 1;
}

/// Individual validation request (optimized for cost - minimal state)
/// URIs and tags are stored in events only (not on-chain)
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
    /// This is 5x smaller than storing URIs on-chain (~590 bytes)
    /// Cost savings: ~$0.67 → ~$0.14 per validation
    pub const SIZE: usize = 8 + 32 + 4 + 32 + 32 + 1 + 8 + 8 + 1;

    /// Maximum URI length per ERC-8004 spec (validated but not stored on-chain)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validation_config_size() {
        assert_eq!(ValidationConfig::SIZE, 81);
    }

    #[test]
    fn test_validation_request_size() {
        assert_eq!(ValidationRequest::SIZE, 126);
    }

    #[test]
    fn test_max_uri_length() {
        assert_eq!(ValidationRequest::MAX_URI_LENGTH, 200);
    }
}
