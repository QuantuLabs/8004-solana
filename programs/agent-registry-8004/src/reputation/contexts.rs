use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

pub const ATOM_CPI_AUTHORITY_SEED: &[u8] = b"atom_cpi_authority";

#[derive(Accounts)]
#[instruction(_value: i64, _value_decimals: u8, _score: Option<u8>, _feedback_hash: [u8; 32], _tag1: String, _tag2: String, _endpoint: String, _feedback_uri: String)]
pub struct GiveFeedback<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Collection for the agent (passed to atom-engine for filtering)
    pub collection: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    // === OPTIONAL: CPI to atom-engine ===
    // If atom_enabled is false, these accounts may be omitted

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program (when atom_stats initialized)
    pub atom_config: Option<UncheckedAccount<'info>>,

    /// AtomStats PDA - OPTIONAL initialization
    /// If uninitialized, feedback works without ATOM Engine
    /// CHECK: Validated by atom-engine program (when initialized)
    #[account(mut)]
    pub atom_stats: Option<UncheckedAccount<'info>>,

    /// CHECK: ATOM Engine program ID
    pub atom_engine_program: Option<UncheckedAccount<'info>>,

    /// CHECK: Registry authority PDA for CPI signing
    #[account(
        seeds = [ATOM_CPI_AUTHORITY_SEED],
        bump,
    )]
    pub registry_authority: Option<UncheckedAccount<'info>>,
}

/// RevokeFeedback calls CPI to atom-engine to revoke stats (optional)
#[derive(Accounts)]
#[instruction(_feedback_index: u64, _feedback_hash: [u8; 32])]
pub struct RevokeFeedback<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    // === OPTIONAL: CPI to atom-engine ===
    // If atom_enabled is false, these accounts may be omitted

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program (when atom_stats initialized)
    pub atom_config: Option<UncheckedAccount<'info>>,

    /// AtomStats PDA - OPTIONAL initialization
    /// If uninitialized, revoke works without ATOM Engine
    /// CHECK: Validated by atom-engine program (when initialized)
    #[account(mut)]
    pub atom_stats: Option<UncheckedAccount<'info>>,

    /// CHECK: ATOM Engine program ID
    pub atom_engine_program: Option<UncheckedAccount<'info>>,

    /// CHECK: Registry authority PDA for CPI signing
    #[account(
        seeds = [ATOM_CPI_AUTHORITY_SEED],
        bump,
    )]
    pub registry_authority: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
#[instruction(asset_key: Pubkey, _client_address: Pubkey, _feedback_index: u64, _response_uri: String, _response_hash: [u8; 32])]
pub struct AppendResponse<'info> {
    /// Responder must be agent owner or agent wallet
    pub responder: Signer<'info>,

    /// Agent account for authorization check and hash-chain update
    #[account(
        mut,
        seeds = [b"agent", asset_key.as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset (for PDA derivation)
    /// CHECK: Verified via agent_account constraint
    #[account(
        constraint = asset.key() == asset_key @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,
}
