use anchor_lang::prelude::*;

use super::state::*;
use crate::error::RegistryError;
use crate::identity::state::{AgentAccount, RegistryConfig};

/// Accounts for request_validation instruction
#[derive(Accounts)]
#[instruction(agent_id: u64, validator_address: Pubkey, nonce: u32)]
pub struct RequestValidation<'info> {
    /// Validation stats (counters)
    #[account(
        init_if_needed,
        payer = payer,
        space = ValidationStats::DISCRIMINATOR.len() + ValidationStats::INIT_SPACE,
        seeds = [b"validation_config"],
        bump
    )]
    pub validation_stats: Account<'info, ValidationStats>,

    /// Agent owner (must own the Core asset)
    pub requester: Signer<'info>,

    /// Payer for the validation request account
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Core asset (for deriving agent PDA and ownership verification)
    /// CHECK: Used for PDA derivation
    pub asset: UncheckedAccount<'info>,

    /// Agent account (direct access)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.agent_id == agent_id @ RegistryError::AgentNotFound
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Validation request PDA
    #[account(
        init,
        payer = payer,
        space = ValidationRequest::DISCRIMINATOR.len() + ValidationRequest::INIT_SPACE,
        seeds = [
            b"validation",
            agent_id.to_le_bytes().as_ref(),
            validator_address.as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    pub system_program: Program<'info, System>,
}

/// Accounts for respond_to_validation instruction
#[derive(Accounts)]
pub struct RespondToValidation<'info> {
    /// Validation stats (counters)
    #[account(
        mut,
        seeds = [b"validation_config"],
        bump = validation_stats.bump
    )]
    pub validation_stats: Account<'info, ValidationStats>,

    /// Validator (must match validation_request.validator_address)
    pub validator: Signer<'info>,

    /// Validation request to respond to
    #[account(
        mut,
        seeds = [
            b"validation",
            validation_request.agent_id.to_le_bytes().as_ref(),
            validation_request.validator_address.as_ref(),
            validation_request.nonce.to_le_bytes().as_ref()
        ],
        bump = validation_request.bump,
        constraint = validation_request.validator_address == validator.key() @ RegistryError::UnauthorizedValidator
    )]
    pub validation_request: Account<'info, ValidationRequest>,
}

/// Accounts for close_validation instruction
/// F-02: Validation request must belong to this agent, rent goes to agent owner
#[derive(Accounts)]
pub struct CloseValidation<'info> {
    /// Identity config (for authority check)
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    /// Agent owner (Core asset holder) OR program authority can close
    pub closer: Signer<'info>,

    /// Core asset (for ownership verification)
    /// CHECK: Ownership verified in instruction
    pub asset: UncheckedAccount<'info>,

    /// Agent account (for agent_id verification)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Validation request to close
    /// F-02: Must belong to this agent (prevents closing other agents' validations)
    #[account(
        mut,
        close = rent_receiver,
        seeds = [
            b"validation",
            validation_request.agent_id.to_le_bytes().as_ref(),
            validation_request.validator_address.as_ref(),
            validation_request.nonce.to_le_bytes().as_ref()
        ],
        bump = validation_request.bump,
        constraint = validation_request.agent_id == agent_account.agent_id
            @ RegistryError::AgentNotFound
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    /// Receiver of recovered rent
    /// CHECK: Validated in instruction (must be current Core asset owner)
    /// F-02v2: Verified against actual Core asset owner (not cached agent_account.owner)
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}
