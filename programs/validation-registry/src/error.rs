use anchor_lang::prelude::*;

#[error_code]
pub enum ValidationError {
    #[msg("ReqURI>200")]
    RequestUriTooLong,

    #[msg("RespURI>200")]
    ResponseUriTooLong,

    #[msg("Resp[0-100]")]
    InvalidResponse,

    #[msg("!Validator")]
    UnauthorizedValidator,

    #[msg("!Owner")]
    UnauthorizedRequester,

    #[msg("!Agent")]
    AgentNotFound,

    #[msg("!Req")]
    RequestNotFound,

    #[msg("Overflow")]
    Overflow,

    #[msg("!Nonce")]
    InvalidNonce,

    #[msg("Hash!=")]
    RequestHashMismatch,

    #[msg("!IdReg")]
    InvalidIdentityRegistry,

    #[msg("!Auth")]
    Unauthorized,

    #[msg("!Token")]
    InvalidTokenAccount,
}
