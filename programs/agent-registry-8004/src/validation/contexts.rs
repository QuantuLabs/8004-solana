use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

#[derive(Accounts)]
#[instruction(_validator_address: Pubkey, _nonce: u32)]
pub struct RequestValidation<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

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

    /// CHECK: Any pubkey is valid, will be in event
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(_nonce: u32)]
pub struct RespondToValidation<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner != validator.key() @ RegistryError::SelfValidationNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,
}
