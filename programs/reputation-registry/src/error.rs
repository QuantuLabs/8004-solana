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

    // FeedbackAuth errors
    #[msg("FeedbackAuth client_address does not match signer")]
    FeedbackAuthClientMismatch,

    #[msg("FeedbackAuth expired")]
    FeedbackAuthExpired,

    #[msg("FeedbackAuth index_limit exceeded")]
    FeedbackAuthIndexLimitExceeded,

    #[msg("FeedbackAuth signature invalid")]
    InvalidFeedbackAuthSignature,

    #[msg("FeedbackAuth signer is not agent owner")]
    UnauthorizedSigner,
}
