use anchor_lang::prelude::*;

#[error_code]
pub enum IdentityError {
    #[msg("URI>200")]
    UriTooLong,

    #[msg("Key>32")]
    KeyTooLong,

    #[msg("Val>256")]
    ValueTooLong,

    #[msg("Max1")]
    MetadataLimitReached,

    #[msg("!owner")]
    Unauthorized,

    #[msg("Overflow")]
    Overflow,

    #[msg("KeyNotFound")]
    MetadataNotFound,

    #[msg("!NFT")]
    InvalidTokenAccount,

    #[msg("!Ext")]
    ExtensionNotFound,

    #[msg("!Idx")]
    InvalidExtensionIndex,

    #[msg("!CollMint")]
    InvalidCollectionMint,

    #[msg("Supply!=1")]
    InvalidNftSupply,

    #[msg("Dec!=0")]
    InvalidNftDecimals,

    #[msg("Self")]
    TransferToSelf,
}
