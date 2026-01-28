use anchor_lang::prelude::*;

#[error_code]
pub enum AtomError {
    #[msg("Invalid score: must be 0-100")]
    InvalidScore,

    #[msg("Unauthorized: only authority can perform this action")]
    Unauthorized,

    #[msg("Unauthorized caller: only agent-registry can update stats")]
    UnauthorizedCaller,

    #[msg("Config already initialized")]
    ConfigAlreadyInitialized,

    #[msg("Engine is paused")]
    Paused,

    #[msg("Stats not initialized: call initialize_stats first")]
    StatsNotInitialized,

    #[msg("Not asset owner: only the Metaplex Core asset holder can initialize stats")]
    NotAssetOwner,

    #[msg("Invalid asset: cannot read owner from asset data")]
    InvalidAsset,

    #[msg("Invalid collection: must be owned by Metaplex Core program")]
    InvalidCollection,

    #[msg("Asset not in a collection: UpdateAuthority must be Collection type")]
    AssetNotInCollection,

    #[msg("Collection mismatch: asset belongs to a different collection")]
    CollectionMismatch,

    #[msg("Invalid asset type: expected Metaplex Core AssetV1")]
    InvalidAssetType,

    #[msg("Invalid config parameter: value out of allowed bounds")]
    InvalidConfigParameter,

    #[msg("Feedback not found in ring buffer (may be too old)")]
    FeedbackNotFound,

    #[msg("Feedback already revoked")]
    AlreadyRevoked,
}
