use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;
use super::state::{ValidationConfig, ValidationRequest};

/// Initialize the ValidationConfig (global validation registry state)
#[derive(Accounts)]
pub struct InitializeValidationConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ValidationConfig::SIZE,
        seeds = [b"validation_config"],
        bump
    )]
    pub config: Account<'info, ValidationConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Request validation for an agent
#[derive(Accounts)]
#[instruction(validator_address: Pubkey, nonce: u32)]
pub struct RequestValidation<'info> {
    /// ValidationConfig for tracking global counters
    #[account(
        mut,
        seeds = [b"validation_config"],
        bump = config.bump
    )]
    pub config: Account<'info, ValidationConfig>,

    /// Agent owner (requester)
    #[account(mut)]
    pub requester: Signer<'info>,

    /// Payer for the validation request account (can be different from requester)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Agent account (to verify ownership and get asset)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Agent asset (Metaplex Core)
    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Validation request PDA (to be created)
    #[account(
        init,
        payer = payer,
        space = 8 + ValidationRequest::SIZE,
        seeds = [
            b"validation",
            asset.key().as_ref(),
            validator_address.as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    /// CHECK: Any pubkey is valid for validator
    pub validator: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Respond to a validation request
#[derive(Accounts)]
#[instruction(_validator_address: Pubkey, nonce: u32)]
pub struct RespondToValidation<'info> {
    /// ValidationConfig for tracking global counters
    #[account(
        mut,
        seeds = [b"validation_config"],
        bump = config.bump
    )]
    pub config: Account<'info, ValidationConfig>,

    /// Validator (signer)
    #[account(mut)]
    pub validator: Signer<'info>,

    /// Agent account (to verify no self-validation)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner != validator.key() @ RegistryError::SelfValidationNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Agent asset (Metaplex Core)
    /// CHECK: Validated via agent_account.asset constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Validation request PDA (existing, to be updated)
    /// ERC-8004: Enables progressive validation - validators can update responses
    #[account(
        mut,
        seeds = [
            b"validation",
            asset.key().as_ref(),
            validator.key().as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump,
        constraint = validation_request.validator_address == validator.key() @ RegistryError::Unauthorized
    )]
    pub validation_request: Account<'info, ValidationRequest>,
}

// ERC-8004: No close/delete function - validations are immutable and permanent
// This ensures audit trail integrity per specification
