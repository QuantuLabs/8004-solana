use anchor_lang::prelude::*;

declare_id!("3ah8M3viTAGHRkAqGshRF4b48Ey1ZwrMViQ6bkUNamTi");

pub mod error;
pub mod identity;
pub mod reputation;
pub mod validation;

// Re-export all contexts at crate root for Anchor macro
pub use identity::contexts::*;
pub use identity::state::*;
pub use identity::events::*;

pub use reputation::contexts::*;
pub use reputation::state::*;
pub use reputation::events::*;

pub use validation::contexts::*;
pub use validation::state::*;
pub use validation::events::*;

pub use error::RegistryError;

#[program]
pub mod agent_registry_8004 {
    use super::*;

    // ============================================================================
    // Identity Instructions (Metaplex Core)
    // ============================================================================

    /// Initialize the registry and create Core collection
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        identity::instructions::initialize(ctx)
    }

    /// Register a new agent with empty URI
    pub fn register_empty(ctx: Context<Register>) -> Result<()> {
        identity::instructions::register_empty(ctx)
    }

    /// Register a new agent with URI
    pub fn register(ctx: Context<Register>, agent_uri: String) -> Result<()> {
        identity::instructions::register(ctx, agent_uri)
    }

    /// Register a new agent with URI and initial metadata
    pub fn register_with_metadata(
        ctx: Context<Register>,
        agent_uri: String,
        metadata: Vec<MetadataEntry>,
    ) -> Result<()> {
        identity::instructions::register_with_metadata(ctx, agent_uri, metadata)
    }

    /// Get agent metadata value by key
    pub fn get_metadata(ctx: Context<GetMetadata>, key: String) -> Result<Vec<u8>> {
        identity::instructions::get_metadata(ctx, key)
    }

    /// Set agent metadata
    pub fn set_metadata(ctx: Context<SetMetadata>, key: String, value: Vec<u8>) -> Result<()> {
        identity::instructions::set_metadata(ctx, key, value)
    }

    /// Set agent URI
    pub fn set_agent_uri(ctx: Context<SetAgentUri>, new_uri: String) -> Result<()> {
        identity::instructions::set_agent_uri(ctx, new_uri)
    }

    /// Sync agent owner from Core asset
    pub fn sync_owner(ctx: Context<SyncOwner>) -> Result<()> {
        identity::instructions::sync_owner(ctx)
    }

    /// Get agent owner
    pub fn owner_of(ctx: Context<OwnerOf>) -> Result<Pubkey> {
        identity::instructions::owner_of(ctx)
    }

    /// Create metadata extension
    pub fn create_metadata_extension(
        ctx: Context<CreateMetadataExtension>,
        extension_index: u8,
    ) -> Result<()> {
        identity::instructions::create_metadata_extension(ctx, extension_index)
    }

    /// Set metadata in extension
    pub fn set_metadata_extended(
        ctx: Context<SetMetadataExtended>,
        extension_index: u8,
        key: String,
        value: Vec<u8>,
    ) -> Result<()> {
        identity::instructions::set_metadata_extended(ctx, extension_index, key, value)
    }

    /// Get metadata from extension
    pub fn get_metadata_extended(
        ctx: Context<GetMetadataExtended>,
        extension_index: u8,
        key: String,
    ) -> Result<Vec<u8>> {
        identity::instructions::get_metadata_extended(ctx, extension_index, key)
    }

    /// Transfer agent with automatic owner sync
    pub fn transfer_agent(ctx: Context<TransferAgent>) -> Result<()> {
        identity::instructions::transfer_agent(ctx)
    }

    // ============================================================================
    // Reputation Instructions
    // ============================================================================

    /// Give feedback to an agent
    pub fn give_feedback(
        ctx: Context<GiveFeedback>,
        agent_id: u64,
        score: u8,
        tag1: String,
        tag2: String,
        file_uri: String,
        file_hash: [u8; 32],
        feedback_index: u64,
    ) -> Result<()> {
        reputation::instructions::give_feedback(
            ctx,
            agent_id,
            score,
            tag1,
            tag2,
            file_uri,
            file_hash,
            feedback_index,
        )
    }

    /// Revoke feedback
    pub fn revoke_feedback(
        ctx: Context<RevokeFeedback>,
        agent_id: u64,
        feedback_index: u64,
    ) -> Result<()> {
        reputation::instructions::revoke_feedback(ctx, agent_id, feedback_index)
    }

    /// Append response to feedback
    pub fn append_response(
        ctx: Context<AppendResponse>,
        agent_id: u64,
        client_address: Pubkey,
        feedback_index: u64,
        response_uri: String,
        response_hash: [u8; 32],
    ) -> Result<()> {
        reputation::instructions::append_response(
            ctx,
            agent_id,
            client_address,
            feedback_index,
            response_uri,
            response_hash,
        )
    }

    // ============================================================================
    // Validation Instructions
    // ============================================================================

    /// Request validation for an agent
    pub fn request_validation(
        ctx: Context<RequestValidation>,
        agent_id: u64,
        validator_address: Pubkey,
        nonce: u32,
        request_uri: String,
        request_hash: [u8; 32],
    ) -> Result<()> {
        validation::instructions::request_validation(
            ctx,
            agent_id,
            validator_address,
            nonce,
            request_uri,
            request_hash,
        )
    }

    /// Validator responds to a validation request
    pub fn respond_to_validation(
        ctx: Context<RespondToValidation>,
        response: u8,
        response_uri: String,
        response_hash: [u8; 32],
        tag: String,
    ) -> Result<()> {
        validation::instructions::respond_to_validation(ctx, response, response_uri, response_hash, tag)
    }

    /// Update an existing validation response
    pub fn update_validation(
        ctx: Context<RespondToValidation>,
        response: u8,
        response_uri: String,
        response_hash: [u8; 32],
        tag: String,
    ) -> Result<()> {
        validation::instructions::update_validation(ctx, response, response_uri, response_hash, tag)
    }

    /// Close a validation request to recover rent
    pub fn close_validation(ctx: Context<CloseValidation>) -> Result<()> {
        validation::instructions::close_validation(ctx)
    }
}
