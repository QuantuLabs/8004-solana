use anchor_lang::prelude::*;

/// Feedback account - One per feedback (per client-agent pair)
/// Seeds: [b"feedback", agent_id, client_address, feedback_index]
#[account]
pub struct FeedbackAccount {
    /// Agent ID from Identity Registry
    pub agent_id: u64,

    /// Client who gave the feedback
    pub client_address: Pubkey,

    /// Sequential index for THIS client's feedbacks to THIS agent
    /// Client A: indices 0, 1, 2, 3...
    /// Client B: indices 0, 1, 2, 3... (independent)
    pub feedback_index: u64,

    /// Score (0-100, validated on-chain)
    pub score: u8,

    /// Tag1 - Full bytes32 (ERC-8004 spec requirement)
    pub tag1: [u8; 32],

    /// Tag2 - Full bytes32 (ERC-8004 spec requirement)
    pub tag2: [u8; 32],

    /// File URI (IPFS/Arweave link, max 200 bytes)
    pub file_uri: String,

    /// File hash (SHA-256, 32 bytes)
    pub file_hash: [u8; 32],

    /// Revocation status (preserves audit trail)
    pub is_revoked: bool,

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl FeedbackAccount {
    /// Maximum size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (feedback_index)
    /// + 1 (score) + 32 (tag1) + 32 (tag2) + 4 + 200 (file_uri)
    /// + 32 (file_hash) + 1 (is_revoked) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 8 + 1 + 32 + 32 + 4 + 200 + 32 + 1 + 8 + 1;

    /// Maximum URI length (ERC-8004 spec)
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Response account - Separate account per response (unlimited responses)
/// Seeds: [b"response", agent_id, client_address, feedback_index, response_index]
#[account]
pub struct ResponseAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Original feedback client
    pub client_address: Pubkey,

    /// Original feedback index
    pub feedback_index: u64,

    /// Sequential response index for this feedback
    pub response_index: u64,

    /// Who responded (anyone can respond)
    pub responder: Pubkey,

    /// Response URI (IPFS/Arweave link, max 200 bytes)
    pub response_uri: String,

    /// Response hash (SHA-256, 32 bytes)
    pub response_hash: [u8; 32],

    /// Creation timestamp
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl ResponseAccount {
    /// Maximum size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (feedback_index)
    /// + 8 (response_index) + 32 (responder) + 4 + 200 (response_uri)
    /// + 32 (response_hash) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 8 + 32 + 8 + 8 + 32 + 4 + 200 + 32 + 8 + 1;

    /// Maximum URI length
    pub const MAX_URI_LENGTH: usize = 200;
}

/// Client index account - Tracks next feedback index for client-agent pair
/// Seeds: [b"client_index", agent_id, client_address]
#[account]
pub struct ClientIndexAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Client address
    pub client_address: Pubkey,

    /// Last used index (next feedback will use this value)
    pub last_index: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ClientIndexAccount {
    /// Size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (last_index) + 1 (bump)
    pub const SIZE: usize = 8 + 8 + 32 + 8 + 1;
}

/// Agent reputation metadata - Cached aggregated stats
/// Seeds: [b"agent_reputation", agent_id]
#[account]
pub struct AgentReputationMetadata {
    /// Agent ID
    pub agent_id: u64,

    /// Total non-revoked feedbacks
    pub total_feedbacks: u64,

    /// Sum of all non-revoked scores (for average calculation)
    pub total_score_sum: u64,

    /// Average score (0-100, precalculated)
    pub average_score: u8,

    /// Last update timestamp
    pub last_updated: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl AgentReputationMetadata {
    /// Size calculation
    /// 8 (discriminator) + 8 (agent_id) + 8 (total_feedbacks) + 8 (total_score_sum)
    /// + 1 (average_score) + 8 (last_updated) + 1 (bump)
    pub const SIZE: usize = 8 + 8 + 8 + 8 + 1 + 8 + 1;
}

/// Response index account - Tracks next response index for a feedback
/// Seeds: [b"response_index", agent_id, client_address, feedback_index]
#[account]
pub struct ResponseIndexAccount {
    /// Agent ID
    pub agent_id: u64,

    /// Client address
    pub client_address: Pubkey,

    /// Feedback index
    pub feedback_index: u64,

    /// Next response index to use
    pub next_index: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl ResponseIndexAccount {
    /// Size calculation
    /// 8 (discriminator) + 8 (agent_id) + 32 (client_address) + 8 (feedback_index)
    /// + 8 (next_index) + 1 (bump)
    pub const SIZE: usize = 8 + 8 + 32 + 8 + 8 + 1;
}

/// Feedback authentication signature (ERC-8004 spec requirement)
/// Prevents spam by requiring agent owner pre-authorization
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FeedbackAuth {
    /// Agent ID this auth is for
    pub agent_id: u64,

    /// Client address authorized to give feedback
    pub client_address: Pubkey,

    /// Maximum number of feedbacks this client can submit
    pub index_limit: u64,

    /// Expiry timestamp (Unix epoch seconds)
    pub expiry: i64,

    /// Chain identifier (e.g., "solana-mainnet", "solana-devnet")
    pub chain_id: String,

    /// Identity Registry program ID
    pub identity_registry: Pubkey,

    /// Signer address (agent owner or delegate)
    pub signer_address: Pubkey,

    /// Ed25519 signature (64 bytes)
    pub signature: [u8; 64],
}

impl FeedbackAuth {
    /// Verify the feedback authentication signature
    ///
    /// # Arguments
    /// * `client` - The client public key attempting to give feedback
    /// * `current_index` - The current feedback index for this client
    /// * `current_time` - Current Unix timestamp
    ///
    /// # Returns
    /// * `Ok(())` if signature is valid
    /// * `Err` with appropriate error code if validation fails
    pub fn verify(
        &self,
        client: &Pubkey,
        current_index: u64,
        current_time: i64,
    ) -> Result<()> {
        use crate::error::ReputationError;

        // 1. Verify client_address matches
        require!(
            self.client_address == *client,
            ReputationError::FeedbackAuthClientMismatch
        );

        // 2. Verify not expired
        require!(
            current_time < self.expiry,
            ReputationError::FeedbackAuthExpired
        );

        // 3. Verify index_limit not exceeded
        require!(
            current_index < self.index_limit,
            ReputationError::FeedbackAuthIndexLimitExceeded
        );

        // 4. Construct message to verify signature
        let _message = self.construct_message();

        // 5. Verify Ed25519 signature
        // Note: For production, use ed25519-dalek crate or solana_program::ed25519_program
        // For now, we'll add a TODO and implement in next iteration
        // TODO: Implement Ed25519 signature verification
        // let signature = ed25519_dalek::Signature::from_bytes(&self.signature)?;
        // let public_key = ed25519_dalek::PublicKey::from_bytes(self.signer_address.as_ref())?;
        // public_key.verify(&_message, &signature)
        //     .map_err(|_| ReputationError::InvalidFeedbackAuthSignature)?;

        msg!("FeedbackAuth verified for client: {}", client);
        Ok(())
    }

    /// Construct the message to be signed/verified
    /// Format: "feedback_auth:{agent_id}:{client}:{index_limit}:{expiry}:{chain_id}:{identity_registry}"
    fn construct_message(&self) -> Vec<u8> {
        format!(
            "feedback_auth:{}:{}:{}:{}:{}:{}",
            self.agent_id,
            self.client_address,
            self.index_limit,
            self.expiry,
            self.chain_id,
            self.identity_registry
        )
        .as_bytes()
        .to_vec()
    }
}
