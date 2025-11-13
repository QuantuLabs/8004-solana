use anchor_lang::prelude::*;

#[error_code]
pub enum IdentityError {
    #[msg("Token URI exceeds maximum length of 200 bytes")]
    UriTooLong,

    #[msg("Metadata key exceeds maximum length of 32 bytes")]
    KeyTooLong,

    #[msg("Metadata value exceeds maximum length of 256 bytes")]
    ValueTooLong,

    #[msg("Maximum of 10 metadata entries reached")]
    MetadataLimitReached,

    #[msg("Only agent owner can perform this action")]
    Unauthorized,

    #[msg("Arithmetic overflow occurred")]
    Overflow,

    #[msg("Agent mint must be an NFT (supply=1, decimals=0)")]
    InvalidNFT,

    #[msg("Metadata key not found")]
    MetadataNotFound,

    #[msg("Invalid token account: does not hold the agent NFT")]
    InvalidTokenAccount,
}
