use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    sysvar::instructions::{load_instruction_at_checked, load_current_index_checked},
    ed25519_program,
};

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
    /// * `instruction_sysvar` - Instructions sysvar for Ed25519 verification
    ///
    /// # Returns
    /// * `Ok(())` if signature is valid
    /// * `Err` with appropriate error code if validation fails
    pub fn verify(
        &self,
        client: &Pubkey,
        current_index: u64,
        current_time: i64,
        instruction_sysvar: &AccountInfo,
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
        let message = self.construct_message();

        // 5. Verify Ed25519 signature via instruction introspection
        // This verifies that an Ed25519Program.verify() instruction was executed
        // immediately before the current instruction with matching parameters

        // Load current instruction index
        let current_ix_index = load_current_index_checked(instruction_sysvar)
            .map_err(|_| ReputationError::InvalidFeedbackAuthSignature)?;

        // Verify there is a preceding instruction
        require!(
            current_ix_index > 0,
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Load preceding instruction (should be Ed25519Program)
        let ed25519_ix_index = current_ix_index.saturating_sub(1) as usize;
        let ed25519_ix = load_instruction_at_checked(ed25519_ix_index, instruction_sysvar)
            .map_err(|_| ReputationError::InvalidFeedbackAuthSignature)?;

        // Verify instruction is from Ed25519Program
        require!(
            ed25519_ix.program_id == ed25519_program::ID,
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Verify instruction has no accounts (stateless requirement)
        require!(
            ed25519_ix.accounts.is_empty(),
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Parse Ed25519 instruction data
        // Data layout (as per Solana Ed25519Program spec):
        // [0]: num_signatures (u8) - should be 1
        // [1]: padding (u8)
        // [2-3]: signature_offset (u16 LE)
        // [4-5]: signature_instruction_index (u16 LE) - should be 0xFFFF (current ix)
        // [6-7]: public_key_offset (u16 LE)
        // [8-9]: public_key_instruction_index (u16 LE) - should be 0xFFFF
        // [10-11]: message_data_offset (u16 LE)
        // [12-13]: message_data_size (u16 LE)
        // [14-15]: message_instruction_index (u16 LE) - should be 0xFFFF
        // [16+]: actual data (public_key, signature, message)
        let ix_data = &ed25519_ix.data;
        require!(
            ix_data.len() >= 16,
            ReputationError::InvalidFeedbackAuthSignature
        );

        let num_signatures = ix_data[0];
        require!(
            num_signatures == 1,
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Parse offsets (little-endian)
        let sig_offset = u16::from_le_bytes([ix_data[2], ix_data[3]]) as usize;
        let sig_ix_index = u16::from_le_bytes([ix_data[4], ix_data[5]]);
        let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
        let pubkey_ix_index = u16::from_le_bytes([ix_data[8], ix_data[9]]);
        let message_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
        let message_size = u16::from_le_bytes([ix_data[12], ix_data[13]]) as usize;
        let message_ix_index = u16::from_le_bytes([ix_data[14], ix_data[15]]);

        // Verify all data is in current instruction (0xFFFF sentinel)
        require!(
            sig_ix_index == u16::MAX
                && pubkey_ix_index == u16::MAX
                && message_ix_index == u16::MAX,
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Extract and verify public key (32 bytes)
        require!(
            pubkey_offset + 32 <= ix_data.len(),
            ReputationError::InvalidFeedbackAuthSignature
        );
        let pubkey_bytes = &ix_data[pubkey_offset..pubkey_offset + 32];
        let verified_pubkey = Pubkey::new_from_array(
            pubkey_bytes
                .try_into()
                .map_err(|_| ReputationError::InvalidFeedbackAuthSignature)?,
        );

        // Verify public key matches signer_address
        require!(
            verified_pubkey == self.signer_address,
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Extract and verify signature (64 bytes)
        require!(
            sig_offset + 64 <= ix_data.len(),
            ReputationError::InvalidFeedbackAuthSignature
        );
        let sig_bytes = &ix_data[sig_offset..sig_offset + 64];
        let verified_signature: [u8; 64] = sig_bytes
            .try_into()
            .map_err(|_| ReputationError::InvalidFeedbackAuthSignature)?;

        // Verify signature matches feedbackAuth.signature
        require!(
            verified_signature == self.signature,
            ReputationError::InvalidFeedbackAuthSignature
        );

        // Extract and verify message
        require!(
            message_offset + message_size <= ix_data.len(),
            ReputationError::InvalidFeedbackAuthSignature
        );
        let verified_message = &ix_data[message_offset..message_offset + message_size];

        // Verify message matches constructed message
        require!(
            verified_message == message.as_slice(),
            ReputationError::InvalidFeedbackAuthSignature
        );

        msg!(
            "FeedbackAuth signature verified via Ed25519Program introspection for client: {}",
            client
        );
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
