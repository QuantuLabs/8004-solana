use anchor_lang::prelude::*;

/// Individual validation request
/// Seeds: [b"validation", asset.key(), validator_address, nonce]
/// EVM conformity: struct ValidationStatus { hasResponse, lastUpdate, response, responseHash }
/// URIs and tags are stored in events only (not on-chain)
#[account]
#[derive(InitSpace)]
pub struct ValidationRequest {
    /// Asset (NFT address - unique identifier replacing agent_id)
    pub asset: Pubkey,

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

    /// Last update timestamp (EVM: lastUpdate)
    pub last_update: i64,

    /// Has response flag (EVM: hasResponse)
    pub has_response: bool,

    /// PDA bump seed
    pub bump: u8,
}

impl ValidationRequest {
    /// Maximum URI length (validated but not stored on-chain)
    pub const MAX_URI_LENGTH: usize = 200;

    /// Check if validation has been responded to
    pub fn is_responded(&self) -> bool {
        self.has_response
    }

    /// Check if response is pending
    pub fn is_pending(&self) -> bool {
        !self.has_response
    }
}
