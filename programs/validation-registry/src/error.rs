use anchor_lang::prelude::*;

#[error_code]
pub enum ValidationError {
    #[msg("Request URI exceeds maximum length of 200 bytes")]
    RequestUriTooLong,

    #[msg("Response URI exceeds maximum length of 200 bytes")]
    ResponseUriTooLong,

    #[msg("Response must be between 0 and 100")]
    InvalidResponse,

    #[msg("Only the designated validator can respond to this request")]
    UnauthorizedValidator,

    #[msg("Only the agent owner can create validation requests")]
    UnauthorizedRequester,

    #[msg("Agent not found in Identity Registry")]
    AgentNotFound,

    #[msg("Validation request not found")]
    RequestNotFound,

    #[msg("Arithmetic overflow occurred")]
    Overflow,

    #[msg("Invalid nonce value")]
    InvalidNonce,

    #[msg("Request hash mismatch")]
    RequestHashMismatch,
}
