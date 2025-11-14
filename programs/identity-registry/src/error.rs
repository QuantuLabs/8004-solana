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

    #[msg("Metadata key not found")]
    MetadataNotFound,

    #[msg("Invalid token account: does not hold the agent NFT")]
    InvalidTokenAccount,

    #[msg("Metadata extension not found for this agent")]
    ExtensionNotFound,

    #[msg("Invalid extension index")]
    InvalidExtensionIndex,

    #[msg("Collection mint does not match registry config")]
    InvalidCollectionMint,

    #[msg("NFT supply must be exactly 1")]
    InvalidNftSupply,

    #[msg("NFT decimals must be 0")]
    InvalidNftDecimals,

    #[msg("Transfer destination is same as source")]
    TransferToSelf,
}
