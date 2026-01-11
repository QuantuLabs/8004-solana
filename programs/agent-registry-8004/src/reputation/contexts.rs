use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

#[derive(Accounts)]
#[instruction(_score: u8, _tag1: String, _tag2: String, _endpoint: String, _feedback_uri: String, _feedback_hash: [u8; 32], _feedback_index: u64)]
pub struct GiveFeedback<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    /// CHECK: Validated via agent_account constraint
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner != client.key() @ RegistryError::SelfFeedbackNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    // === CPI to atom-engine ===

    /// AtomConfig PDA (owned by atom-engine)
    /// CHECK: Validated by atom-engine program
    pub atom_config: UncheckedAccount<'info>,

    /// AtomStats PDA (owned by atom-engine, created on first feedback)
    /// CHECK: Validated by atom-engine program
    #[account(mut)]
    pub atom_stats: UncheckedAccount<'info>,

    /// atom-engine program
    /// CHECK: Program ID validated below
    #[account(constraint = atom_engine_program.key() == atom_engine::ID @ RegistryError::InvalidProgram)]
    pub atom_engine_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_feedback_index: u64)]
pub struct RevokeFeedback<'info> {
    pub client: Signer<'info>,

    /// CHECK: Just for event emission
    pub asset: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(_feedback_index: u64, _response_uri: String, _response_hash: [u8; 32])]
pub struct AppendResponse<'info> {
    pub responder: Signer<'info>,

    /// CHECK: Just for event emission
    pub asset: UncheckedAccount<'info>,
}
