use anchor_lang::prelude::*;

declare_id!("8oo48pya1SZD23ZhzoNMhxR2UGb8BRa41Su4qP9EuaWm");

pub mod constants;
pub mod error;
pub mod identity;
pub mod reputation;

// Re-export all contexts at crate root for Anchor macro
pub use identity::contexts::*;
pub use identity::state::*;
pub use identity::events::*;

pub use reputation::contexts::*;
pub use reputation::state::*;
pub use reputation::events::*;

pub use error::RegistryError;

#[program]
pub mod agent_registry_8004 {
    use super::*;

    // ============================================================================
    // Identity Instructions - Single Collection Architecture (v0.6.0)
    // ============================================================================

    /// Initialize the registry with root config and base collection
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        identity::instructions::initialize(ctx)
    }

    /// Register agent in the base collection
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

    /// Get agent owner (cached - may be stale after external transfer)
    pub fn owner_of(ctx: Context<OwnerOf>) -> Result<Pubkey> {
        identity::instructions::owner_of(ctx)
    }

    /// Get authoritative Core owner (reads live from Metaplex Core)
    pub fn core_owner_of(ctx: Context<CoreOwnerOf>) -> Result<Pubkey> {
        identity::instructions::core_owner_of(ctx)
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

    // ============================================================================
    // Reputation Instructions
    // ============================================================================

    /// Give feedback to an agent
    /// SEAL v1: feedback_file_hash is optional (hash of external file),
    /// the program computes seal_hash on-chain for trustless integrity.
    pub fn give_feedback(
        ctx: Context<GiveFeedback>,
        value: i64,
        value_decimals: u8,
        score: Option<u8>,
        feedback_file_hash: Option<[u8; 32]>,
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
            feedback_file_hash,
            tag1,
            tag2,
            endpoint,
            feedback_uri,
        )
    }

    /// Revoke feedback
    /// SEAL v1: Client provides seal_hash (can be recomputed using computeSealHash)
    pub fn revoke_feedback(
        ctx: Context<RevokeFeedback>,
        feedback_index: u64,
        seal_hash: [u8; 32],
    ) -> Result<()> {
        reputation::instructions::revoke_feedback(ctx, feedback_index, seal_hash)
    }

    /// Append response to feedback
    /// SEAL v1: Client provides seal_hash from the original feedback
    pub fn append_response(
        ctx: Context<AppendResponse>,
        asset_key: Pubkey,
        client_address: Pubkey,
        feedback_index: u64,
        response_uri: String,
        response_hash: [u8; 32],
        seal_hash: [u8; 32],
    ) -> Result<()> {
        reputation::instructions::append_response(ctx, asset_key, client_address, feedback_index, response_uri, response_hash, seal_hash)
    }

    // NOTE: Validation module removed in v0.5.0 - planned for future upgrade
    // Archived code available in src/_archive/validation/
}
