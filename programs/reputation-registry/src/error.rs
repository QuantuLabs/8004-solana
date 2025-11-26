use anchor_lang::prelude::*;

#[error_code]
pub enum ReputationError {
    #[msg("Score[0-100]")]
    InvalidScore,

    #[msg("URI>200")]
    UriTooLong,

    #[msg("RespURI>200")]
    ResponseUriTooLong,

    #[msg("!author")]
    Unauthorized,

    #[msg("Revoked")]
    AlreadyRevoked,

    #[msg("Overflow")]
    Overflow,

    #[msg("!Agent")]
    AgentNotFound,

    #[msg("!Feedback")]
    FeedbackNotFound,

    #[msg("!FbIdx")]
    InvalidFeedbackIndex,

    #[msg("!Resp")]
    ResponseNotFound,

    #[msg("!IdReg")]
    InvalidIdentityRegistry,
}
