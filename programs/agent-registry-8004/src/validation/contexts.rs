use anchor_lang::prelude::*;

use super::state::*;
use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

/// Accounts for request_validation instruction
#[derive(Accounts)]
#[instruction(validator_address: Pubkey, nonce: u32)]
pub struct RequestValidation<'info> {
    /// Agent owner (must own the Core asset)
    pub requester: Signer<'info>,

    /// Payer for the validation request account
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Core asset (unique identifier for agent)
    /// CHECK: Used for PDA derivation and ownership verification
    pub asset: UncheckedAccount<'info>,

    /// Agent account (direct access)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        // Anti-gaming: prevent agent owner from validating their own agent
        constraint = agent_account.owner != validator_address @ RegistryError::SelfValidationNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Validation request PDA (keyed by asset)
    #[account(
        init,
        payer = payer,
        space = ValidationRequest::DISCRIMINATOR.len() + ValidationRequest::INIT_SPACE,
        seeds = [
            b"validation",
            asset.key().as_ref(),
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
    /// Validator (must match validation_request.validator_address)
    pub validator: Signer<'info>,

    /// Core asset (unique identifier for agent)
    /// CHECK: Used for PDA derivation
    pub asset: UncheckedAccount<'info>,

    /// Agent account (for self-validation check at response time)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        // Anti-gaming: prevent current owner from validating (even after transfer)
        constraint = agent_account.owner != validator.key() @ RegistryError::SelfValidationNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Validation request to respond to
    #[account(
        mut,
        seeds = [
            b"validation",
            asset.key().as_ref(),
            validation_request.validator_address.as_ref(),
            validation_request.nonce.to_le_bytes().as_ref()
        ],
        bump = validation_request.bump,
        constraint = validation_request.validator_address == validator.key() @ RegistryError::UnauthorizedValidator
    )]
    pub validation_request: Account<'info, ValidationRequest>,
}

/// Accounts for close_validation instruction
#[derive(Accounts)]
pub struct CloseValidation<'info> {
    /// Root config (for authority check)
    #[account(
        seeds = [b"root_config"],
        bump = root_config.bump
    )]
    pub root_config: Account<'info, crate::identity::state::RootConfig>,

    /// Agent owner (Core asset holder) OR program authority can close
    pub closer: Signer<'info>,

    /// Core asset (for ownership verification)
    /// CHECK: Ownership verified in instruction
    pub asset: UncheckedAccount<'info>,

    /// Agent account (for validation)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Validation request to close
    #[account(
        mut,
        close = rent_receiver,
        seeds = [
            b"validation",
            asset.key().as_ref(),
            validation_request.validator_address.as_ref(),
            validation_request.nonce.to_le_bytes().as_ref()
        ],
        bump = validation_request.bump
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    /// Receiver of recovered rent
    /// CHECK: Validated in instruction (must be current Core asset owner)
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}
