use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    // ========== Identity Errors (6000-6049) ==========
    #[msg("URI exceeds 200 bytes")]
    UriTooLong = 6000,
    #[msg("Key exceeds 32 bytes")]
    KeyTooLong = 6001,
    #[msg("Value exceeds 256 bytes")]
    ValueTooLong = 6002,
    #[msg("Metadata limit reached")]
    MetadataLimitReached = 6003,
    #[msg("Unauthorized")]
    Unauthorized = 6004,
    #[msg("Arithmetic overflow")]
    Overflow = 6005,
    #[msg("Metadata key not found")]
    MetadataNotFound = 6006,
    #[msg("Invalid token account")]
    InvalidTokenAccount = 6007,
    #[msg("Extension not found")]
    ExtensionNotFound = 6008,
    #[msg("Invalid extension index")]
    InvalidExtensionIndex = 6009,
    #[msg("Invalid collection")]
    InvalidCollection = 6010,
    #[msg("Invalid asset")]
    InvalidAsset = 6011,
    #[msg("Transfer to self not allowed")]
    TransferToSelf = 6012,
    #[msg("Metadata is immutable and cannot be modified or deleted")]
    MetadataImmutable = 6013,

    // ========== Reputation Errors (6050-6099) ==========
    #[msg("Score must be 0-100")]
    InvalidScore = 6050,
    #[msg("Response URI exceeds 200 bytes")]
    ResponseUriTooLong = 6051,
    #[msg("Feedback already revoked")]
    AlreadyRevoked = 6052,
    #[msg("Agent not found")]
    AgentNotFound = 6053,
    #[msg("Feedback not found")]
    FeedbackNotFound = 6054,
    #[msg("Invalid feedback index")]
    InvalidFeedbackIndex = 6055,
    #[msg("Tag exceeds 32 bytes")]
    TagTooLong = 6056,
    #[msg("At least one tag must be provided")]
    EmptyTags = 6057,

    // ========== Validation Errors (6100-6149) ==========
    #[msg("Request URI exceeds 200 bytes")]
    RequestUriTooLong = 6100,
    #[msg("Response must be 0-100")]
    InvalidResponse = 6101,
    #[msg("Unauthorized validator")]
    UnauthorizedValidator = 6102,
    #[msg("Unauthorized requester")]
    UnauthorizedRequester = 6103,
    #[msg("Validation request not found")]
    RequestNotFound = 6104,
    #[msg("Invalid nonce")]
    InvalidNonce = 6105,
    #[msg("Request hash mismatch")]
    RequestHashMismatch = 6106,
    #[msg("Rent receiver must be agent owner")]
    InvalidRentReceiver = 6107,

    // ========== Metadata Errors (6150-6199) ==========
    #[msg("Key hash does not match SHA256(key)")]
    KeyHashMismatch = 6150,
    #[msg("Key hash collision detected - stored key differs from provided key")]
    KeyHashCollision = 6151,
    #[msg("Reserved metadata key - use dedicated instruction")]
    ReservedMetadataKey = 6152,

    // ========== Wallet Errors (6200-6249) ==========
    #[msg("Deadline has expired")]
    DeadlineExpired = 6200,
    #[msg("Deadline too far in the future (max 5 minutes)")]
    DeadlineTooFar = 6201,
    #[msg("Missing Ed25519 signature verification instruction")]
    MissingSignatureVerification = 6202,
    #[msg("Ed25519 signature verification failed")]
    InvalidSignature = 6203,

    // ========== Scalability/Registry Errors (6250-6299) ==========
    #[msg("Invalid registry type for this operation")]
    InvalidRegistryType = 6250,
    #[msg("Root config already initialized")]
    RootAlreadyInitialized = 6251,
    #[msg("Registry already exists for this collection")]
    RegistryAlreadyExists = 6252,
    #[msg("Collection name exceeds maximum length")]
    CollectionNameTooLong = 6253,
    #[msg("Collection URI exceeds maximum length")]
    CollectionUriTooLong = 6254,
    #[msg("Cannot register in this registry")]
    RegistrationNotAllowed = 6255,

    // ========== Anti-Gaming Errors (6300-6309) ==========
    #[msg("Self-feedback is not allowed - agent owner cannot give feedback to their own agent")]
    SelfFeedbackNotAllowed = 6300,
    #[msg("Self-validation is not allowed - agent owner cannot validate their own agent")]
    SelfValidationNotAllowed = 6301,
}
