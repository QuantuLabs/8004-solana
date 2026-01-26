use anchor_lang::prelude::*;

declare_id!("6MuHv4dY4p9E4hSCEPr9dgbCSpMhq8x1vrUexbMVjfw1");

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
    // Identity Instructions (Metaplex Core) - Multi-Collection Architecture
    // ============================================================================

    /// Initialize the registry with root config and first base registry
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        identity::instructions::initialize(ctx)
    }

    /// Register agent in a specific registry (base or user)
    pub fn register(ctx: Context<Register>, agent_uri: String) -> Result<()> {
        identity::instructions::register(ctx, agent_uri)
    }

    /// Register agent with explicit ATOM setting (default is true)
    pub fn register_with_options(
        ctx: Context<Register>,
        agent_uri: String,
        atom_enabled: bool,
    ) -> Result<()> {
        identity::instructions::register_with_options(ctx, agent_uri, atom_enabled)
    }

    /// Enable ATOM for an agent (one-way)
    pub fn enable_atom(ctx: Context<EnableAtom>) -> Result<()> {
        identity::instructions::enable_atom(ctx)
    }

    /// Set agent metadata as individual PDA (key_hash = SHA256(key)[0..16])
    pub fn set_metadata_pda(
        ctx: Context<SetMetadataPda>,
        key_hash: [u8; 16],
        key: String,
        value: Vec<u8>,
        immutable: bool,
    ) -> Result<()> {
        identity::instructions::set_metadata_pda(ctx, key_hash, key, value, immutable)
    }

    /// Delete agent metadata PDA and recover rent (key_hash = SHA256(key)[0..16])
    pub fn delete_metadata_pda(ctx: Context<DeleteMetadataPda>, key_hash: [u8; 16]) -> Result<()> {
        identity::instructions::delete_metadata_pda(ctx, key_hash)
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

    /// Transfer agent with automatic owner sync
    pub fn transfer_agent(ctx: Context<TransferAgent>) -> Result<()> {
        identity::instructions::transfer_agent(ctx)
    }

    /// Set agent wallet with Ed25519 signature verification
    pub fn set_agent_wallet(
        ctx: Context<SetAgentWallet>,
        new_wallet: Pubkey,
        deadline: i64,
    ) -> Result<()> {
        identity::instructions::set_agent_wallet(ctx, new_wallet, deadline)
    }

    /// Create a new base registry (authority only)
    pub fn create_base_registry(ctx: Context<CreateBaseRegistry>) -> Result<()> {
        identity::instructions::create_base_registry(ctx)
    }

    /// Rotate to a new base registry (authority only)
    pub fn rotate_base_registry(ctx: Context<RotateBaseRegistry>) -> Result<()> {
        identity::instructions::rotate_base_registry(ctx)
    }

    /// Create a user registry (anyone can create their own shard)
    pub fn create_user_registry(
        ctx: Context<CreateUserRegistry>,
        collection_name: String,
        collection_uri: String,
    ) -> Result<()> {
        identity::instructions::create_user_registry(ctx, collection_name, collection_uri)
    }

    /// Update user registry collection metadata (owner only)
    pub fn update_user_registry_metadata(
        ctx: Context<UpdateUserRegistryMetadata>,
        new_name: Option<String>,
        new_uri: Option<String>,
    ) -> Result<()> {
        identity::instructions::update_user_registry_metadata(ctx, new_name, new_uri)
    }

    // ============================================================================
    // Reputation Instructions
    // ============================================================================

    /// Give feedback to an agent
    pub fn give_feedback(
        ctx: Context<GiveFeedback>,
        value: i64,
        value_decimals: u8,
        score: Option<u8>,
        feedback_hash: [u8; 32],
        feedback_index: u64,
        tag1: String,
        tag2: String,
        endpoint: String,
        feedback_uri: String,
    ) -> Result<()> {
        reputation::instructions::give_feedback(
            ctx,
            value,
            value_decimals,
            score,
            feedback_hash,
            feedback_index,
            tag1,
            tag2,
            endpoint,
            feedback_uri,
        )
    }

    /// Revoke feedback
    pub fn revoke_feedback(ctx: Context<RevokeFeedback>, feedback_index: u64) -> Result<()> {
        reputation::instructions::revoke_feedback(ctx, feedback_index)
    }

    /// Append response to feedback
    pub fn append_response(
        ctx: Context<AppendResponse>,
        asset_key: Pubkey,
        client_address: Pubkey,
        feedback_index: u64,
        response_uri: String,
        response_hash: [u8; 32],
    ) -> Result<()> {
        reputation::instructions::append_response(ctx, asset_key, client_address, feedback_index, response_uri, response_hash)
    }

    // ============================================================================
    // Validation Instructions
    // ============================================================================

    /// Initialize the ValidationConfig (global validation registry state)
    pub fn initialize_validation_config(ctx: Context<InitializeValidationConfig>) -> Result<()> {
        validation::instructions::initialize_validation_config(ctx)
    }

    /// Request validation for an agent
    pub fn request_validation(
        ctx: Context<RequestValidation>,
        asset_key: Pubkey,
        validator_address: Pubkey,
        nonce: u32,
        request_uri: String,
        request_hash: [u8; 32],
    ) -> Result<()> {
        validation::instructions::request_validation(
            ctx,
            asset_key,
            validator_address,
            nonce,
            request_uri,
            request_hash,
        )
    }

    /// Validator responds to a validation request
    /// ERC-8004: Enables progressive validation - validators can update responses
    pub fn respond_to_validation(
        ctx: Context<RespondToValidation>,
        asset_key: Pubkey,
        validator_address: Pubkey,
        nonce: u32,
        response: u8,
        response_uri: String,
        response_hash: [u8; 32],
        tag: String,
    ) -> Result<()> {
        validation::instructions::respond_to_validation(
            ctx,
            asset_key,
            validator_address,
            nonce,
            response,
            response_uri,
            response_hash,
            tag,
        )
    }

    // ERC-8004 Compliance: No close_validation() function
    // Per specification: "On-chain pointers and hashes cannot be deleted,
    // ensuring audit trail integrity." ValidationRequest PDAs are immutable
    // and permanent for reputation data integrity.
}
