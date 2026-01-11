use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

#[derive(Accounts)]
#[instruction(_validator_address: Pubkey, _nonce: u32)]
pub struct RequestValidation<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    /// CHECK: Ownership verified in instruction via Core asset owner check
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// CHECK: Any pubkey is valid, will be in event
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(_nonce: u32)]
pub struct RespondToValidation<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,

    /// CHECK: Validated via agent_account constraint
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner != validator.key() @ RegistryError::SelfValidationNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,
}
