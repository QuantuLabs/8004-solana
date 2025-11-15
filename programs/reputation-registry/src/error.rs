use anchor_lang::prelude::*;

#[error_code]
pub enum ReputationError {
    #[msg("Score must be between 0 and 100")]
    InvalidScore,

    #[msg("File URI exceeds maximum length of 200 bytes")]
    UriTooLong,

    #[msg("Response URI exceeds maximum length of 200 bytes")]
    ResponseUriTooLong,

    #[msg("Only feedback author can revoke")]
    Unauthorized,

    #[msg("Feedback already revoked")]
    AlreadyRevoked,

    #[msg("Arithmetic overflow occurred")]
    Overflow,

    #[msg("Agent not found in Identity Registry")]
    AgentNotFound,

    #[msg("Feedback not found")]
    FeedbackNotFound,

    #[msg("Invalid feedback index")]
    InvalidFeedbackIndex,

    #[msg("Response not found")]
    ResponseNotFound,
}
