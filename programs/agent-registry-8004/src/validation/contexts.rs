use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::error::RegistryError;
use crate::identity::state::AgentAccount;
use super::state::{ValidationConfig, ValidationRequest};

/// Initialize the ValidationConfig (global validation registry state)
/// Only the program's upgrade authority can initialize to prevent squatting
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

    /// Must be the program's upgrade authority
    #[account(
        mut,
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ RegistryError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// Program data account containing upgrade authority
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// Request validation for an agent
#[derive(Accounts)]
#[instruction(asset_key: Pubkey, validator_address: Pubkey, nonce: u32)]
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
        seeds = [b"agent", asset_key.as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Agent asset (Metaplex Core)
    /// CHECK: Validated via constraints below
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset,
        constraint = asset.key() == asset_key @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Validation request PDA (to be created)
    #[account(
        init,
        payer = payer,
        space = 8 + ValidationRequest::SIZE,
        seeds = [
            b"validation",
            asset_key.as_ref(),
            validator_address.as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    pub system_program: Program<'info, System>,
}

/// Respond to a validation request
#[derive(Accounts)]
#[instruction(asset_key: Pubkey, validator_address: Pubkey, nonce: u32)]
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

    #[account(
        seeds = [b"agent", asset_key.as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Agent asset (Metaplex Core)
    /// CHECK: Validated via constraints below
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset,
        constraint = asset.key() == asset_key @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Validation request PDA (existing, to be updated)
    /// ERC-8004: Enables progressive validation - validators can update responses
    #[account(
        mut,
        seeds = [
            b"validation",
            asset_key.as_ref(),
            validator_address.as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump,
        constraint = validation_request.validator_address == validator.key() @ RegistryError::Unauthorized,
        constraint = validator.key() == validator_address @ RegistryError::Unauthorized
    )]
    pub validation_request: Account<'info, ValidationRequest>,
}

// ERC-8004: No close/delete function - validations are immutable and permanent
// This ensures audit trail integrity per specification
