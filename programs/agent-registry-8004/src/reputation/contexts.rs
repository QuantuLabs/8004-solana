use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

pub const ATOM_CPI_AUTHORITY_SEED: &[u8] = b"atom_cpi_authority";

#[derive(Accounts)]
#[instruction(_score: u8, _tag1: String, _tag2: String, _endpoint: String, _feedback_uri: String, _feedback_hash: [u8; 32], _feedback_index: u64)]
pub struct GiveFeedback<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner != client.key() @ RegistryError::SelfFeedbackNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Collection for the agent (passed to atom-engine for filtering)
    pub collection: UncheckedAccount<'info>,

    // === OPTIONAL: CPI to atom-engine ===
    // If atom_stats is uninitialized (data.len() == 0), ATOM Engine CPI is skipped
    // This allows agents to function without Sybil resistance if desired

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program (when atom_stats initialized)
    pub atom_config: UncheckedAccount<'info>,

    /// AtomStats PDA - OPTIONAL initialization
    /// If uninitialized, feedback works without ATOM Engine
    /// CHECK: Validated by atom-engine program (when initialized)
    #[account(mut)]
    pub atom_stats: UncheckedAccount<'info>,

    /// CHECK: ATOM Engine program ID
    pub atom_engine_program: UncheckedAccount<'info>,

    /// CHECK: Registry authority PDA for CPI signing
    #[account(
        seeds = [ATOM_CPI_AUTHORITY_SEED],
        bump,
    )]
    pub registry_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// RevokeFeedback calls CPI to atom-engine to revoke stats (optional)
#[derive(Accounts)]
#[instruction(_feedback_index: u64)]
pub struct RevokeFeedback<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    // === OPTIONAL: CPI to atom-engine ===
    // If atom_stats is uninitialized, revoke works without ATOM Engine

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program (when atom_stats initialized)
    pub atom_config: UncheckedAccount<'info>,

    /// AtomStats PDA - OPTIONAL initialization
    /// If uninitialized, revoke works without ATOM Engine
    /// CHECK: Validated by atom-engine program (when initialized)
    #[account(mut)]
    pub atom_stats: UncheckedAccount<'info>,

    /// CHECK: ATOM Engine program ID
    pub atom_engine_program: UncheckedAccount<'info>,

    /// CHECK: Registry authority PDA for CPI signing
    #[account(
        seeds = [ATOM_CPI_AUTHORITY_SEED],
        bump,
    )]
    pub registry_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_feedback_index: u64, _response_uri: String, _response_hash: [u8; 32])]
pub struct AppendResponse<'info> {
    pub responder: Signer<'info>,

    /// CHECK: Just for event emission
    pub asset: UncheckedAccount<'info>,
}
