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

    // === CPI to atom-engine ===

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program
    pub atom_config: UncheckedAccount<'info>,

    /// AtomStats PDA (owned by atom-engine, created on first feedback)
    /// CHECK: Validated by atom-engine program
    #[account(mut)]
    pub atom_stats: UncheckedAccount<'info>,

    /// CHECK: Program ID validated below
    #[account(constraint = atom_engine_program.key() == atom_engine::ID @ RegistryError::InvalidProgram)]
    pub atom_engine_program: UncheckedAccount<'info>,

    /// CHECK: PDA derived from this program, used to sign CPI calls to atom-engine
    #[account(
        seeds = [ATOM_CPI_AUTHORITY_SEED],
        bump,
    )]
    pub registry_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// RevokeFeedback calls CPI to atom-engine to revoke stats
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

    // === CPI to atom-engine ===

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program
    pub atom_config: UncheckedAccount<'info>,

    /// AtomStats PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program
    #[account(mut)]
    pub atom_stats: UncheckedAccount<'info>,

    /// CHECK: Program ID validated below
    #[account(constraint = atom_engine_program.key() == atom_engine::ID @ RegistryError::InvalidProgram)]
    pub atom_engine_program: UncheckedAccount<'info>,

    /// CHECK: PDA derived from this program, used to sign CPI calls to atom-engine
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
