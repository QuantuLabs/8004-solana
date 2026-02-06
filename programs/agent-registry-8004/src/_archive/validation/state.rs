use anchor_lang::prelude::*;

/// Global validation registry configuration
#[account]
#[derive(InitSpace)]
pub struct ValidationConfig {
    /// Registry authority (program owner)
    pub authority: Pubkey,

    /// Total validation requests created
    pub total_requests: u64,

    /// Total validation responses recorded
    pub total_responses: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ValidationConfig {
    /// Account size: 32 + 8 + 8 + 1 = 49 bytes
    pub const SIZE: usize = 32 + 8 + 8 + 1;
}

/// Individual validation request (state stored on-chain)
/// URIs, tags, hashes (except request_hash), and created_at are stored in events only
/// This optimized structure follows ERC-8004 immutability requirements while minimizing rent cost
#[account]
#[derive(InitSpace)]
pub struct ValidationRequest {
    /// Agent asset (Metaplex Core) - used as primary identifier
    pub asset: Pubkey,

    /// Validator address (who can respond)
    pub validator_address: Pubkey,

    /// Nonce for multiple validations from same validator (enables re-validation)
    pub nonce: u32,

    /// Request hash (SHA-256 of request content for integrity verification)
    pub request_hash: [u8; 32],

    /// Current response value (0-100, 0 = pending/no response)
    /// ERC-8004: 0 is a valid response score, use responded_at to determine pending status
    pub response: u8,

    /// Timestamp of last response (0 if no response yet)
    /// ERC-8004: Equivalent to lastUpdate, enables progressive validation
    pub responded_at: i64,
}

impl ValidationRequest {
    /// Account size: 32 + 32 + 4 + 32 + 1 + 8 = 109 bytes
    /// Optimized from 150 bytes (-27% rent cost)
    /// Fields moved to events: response_hash, created_at, bump (recalculable)
    pub const SIZE: usize = 32 + 32 + 4 + 32 + 1 + 8;

    /// Check if validation has been responded to
    /// ERC-8004: hasResponse equivalent
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
        assert_eq!(ValidationConfig::SIZE, 49);
    }

    #[test]
    fn test_validation_request_size() {
        assert_eq!(ValidationRequest::SIZE, 109);
    }

    #[test]
    fn test_validation_request_helpers() {
        let mut request = ValidationRequest {
            asset: Pubkey::default(),
            validator_address: Pubkey::default(),
            nonce: 0,
            request_hash: [0; 32],
            response: 0,
            responded_at: 0,
        };

        // Test pending state
        assert!(request.is_pending());
        assert!(!request.has_response());

        // Test responded state
        request.responded_at = 1234567890;
        assert!(!request.is_pending());
        assert!(request.has_response());
    }
}
