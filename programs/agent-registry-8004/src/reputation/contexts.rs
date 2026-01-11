use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;
use super::stats::ReputationStats;

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

    /// ReputationStats PDA - created on first feedback, updated on subsequent
    #[account(
        init_if_needed,
        payer = client,
        space = ReputationStats::SIZE,
        seeds = [b"rep_stats", asset.key().as_ref()],
        bump,
    )]
    pub reputation_stats: Account<'info, ReputationStats>,

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
