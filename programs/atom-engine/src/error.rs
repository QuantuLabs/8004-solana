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

    #[msg("Checkpoint interval not reached")]
    CheckpointIntervalNotReached,

    #[msg("Invalid checkpoint data")]
    InvalidCheckpointData,

    #[msg("Hash chain mismatch")]
    HashChainMismatch,

    #[msg("Invalid replay batch")]
    InvalidReplayBatch,
}
