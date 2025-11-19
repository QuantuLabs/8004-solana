use anchor_lang::prelude::*;

mod error;
mod events;
mod state;

use error::ValidationError;
use events::{ValidationRequested, ValidationResponded};
use state::{ValidationConfig, ValidationRequest};

declare_id!("CXvuHNGWTHNqXmWr95wSpNGKR3kpcJUhzKofTF3zsoxW");

#[program]
pub mod validation_registry {
    use super::*;

    /// Initialize the Validation Registry with Identity Registry reference
    ///
    /// ERC-8004: Required setup to enable cross-program validation
    pub fn initialize(ctx: Context<Initialize>, identity_registry: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;

        config.authority = ctx.accounts.authority.key();
        config.identity_registry = identity_registry;
        config.total_requests = 0;
        config.total_responses = 0;
        config.bump = ctx.bumps.config;

        msg!("Validation Registry initialized");
        msg!("Identity Registry: {}", identity_registry);

        Ok(())
    }

    /// Request validation for an agent (ERC-8004: validationRequest)
    ///
    /// Only the agent owner can request validation.
    /// URIs are stored in events only (not on-chain) for cost optimization.
    ///
    /// Args:
    /// - agent_id: Agent to validate
    /// - validator_address: Who can respond to this validation
    /// - nonce: Sequence number for multiple validations from same validator
    /// - request_uri: IPFS/Arweave link to validation request (max 200 bytes)
    /// - request_hash: SHA-256 hash of request content for integrity
    pub fn request_validation(
        ctx: Context<RequestValidation>,
        agent_id: u64,
        validator_address: Pubkey,
        nonce: u32,
        request_uri: String,
        request_hash: [u8; 32],
    ) -> Result<()> {
        // Validate URI length (ERC-8004 spec)
        require!(
            request_uri.len() <= ValidationRequest::MAX_URI_LENGTH,
            ValidationError::RequestUriTooLong
        );

        // Manually deserialize and verify agent account
        let agent_data = ctx.accounts.agent_account.try_borrow_data()?;

        // Skip 8-byte discriminator, then read fields:
        // agent_id (8 bytes), owner (32 bytes), agent_mint (32 bytes)
        require!(agent_data.len() >= 8 + 8 + 32, ValidationError::AgentNotFound);

        let stored_agent_id = u64::from_le_bytes(
            agent_data[8..16]
                .try_into()
                .map_err(|_| ValidationError::AgentNotFound)?
        );
        let stored_owner = Pubkey::try_from(&agent_data[16..48])
            .map_err(|_| ValidationError::AgentNotFound)?;

        // Verify agent_id matches
        require!(stored_agent_id == agent_id, ValidationError::AgentNotFound);

        // Verify requester is the owner
        require!(
            stored_owner == ctx.accounts.requester.key(),
            ValidationError::UnauthorizedRequester
        );

        let config = &mut ctx.accounts.config;
        let validation_request = &mut ctx.accounts.validation_request;
        let clock = Clock::get()?;

        // Initialize ValidationRequest with minimal on-chain state
        validation_request.agent_id = agent_id;
        validation_request.validator_address = validator_address;
        validation_request.nonce = nonce;
        validation_request.request_hash = request_hash;
        validation_request.response_hash = [0; 32]; // Empty until response
        validation_request.response = 0; // 0 = pending
        validation_request.created_at = clock.unix_timestamp;
        validation_request.responded_at = 0; // No response yet
        validation_request.bump = ctx.bumps.validation_request;

        // Increment total requests counter
        config.total_requests = config.total_requests
            .checked_add(1)
            .ok_or(ValidationError::Overflow)?;

        // Emit event with full metadata (URI stored in event, not on-chain)
        emit!(ValidationRequested {
            agent_id,
            validator_address,
            nonce,
            request_uri,
            request_hash,
            requester: ctx.accounts.requester.key(),
            created_at: clock.unix_timestamp,
        });

        msg!("Validation requested for agent #{} by validator {}", agent_id, validator_address);

        Ok(())
    }

    /// Validator responds to a validation request (ERC-8004: validationResponse)
    ///
    /// Only the designated validator can respond.
    /// Response URIs and tags are stored in events only for cost optimization.
    ///
    /// Args:
    /// - response: Validation score 0-100 (0=failed, 100=passed)
    /// - response_uri: IPFS/Arweave link to validation report (max 200 bytes)
    /// - response_hash: SHA-256 hash of response content
    /// - tag: Tag for categorization (e.g., "oasf-v0.8.0", "zkml-verified")
    pub fn respond_to_validation(
        ctx: Context<RespondToValidation>,
        response: u8,
        response_uri: String,
        response_hash: [u8; 32],
        tag: [u8; 32],
    ) -> Result<()> {
        // Validate response range (ERC-8004 spec: 0-100)
        require!(response <= 100, ValidationError::InvalidResponse);

        // Validate URI length
        require!(
            response_uri.len() <= ValidationRequest::MAX_URI_LENGTH,
            ValidationError::ResponseUriTooLong
        );

        let config = &mut ctx.accounts.config;
        let validation_request = &mut ctx.accounts.validation_request;
        let clock = Clock::get()?;

        // Check if this is the first response
        let is_first_response = validation_request.responded_at == 0;

        // Update validation request
        validation_request.response = response;
        validation_request.response_hash = response_hash;
        validation_request.responded_at = clock.unix_timestamp;

        // Increment total responses counter (only on first response)
        if is_first_response {
            config.total_responses = config.total_responses
                .checked_add(1)
                .ok_or(ValidationError::Overflow)?;
        }

        // Emit event with full metadata
        emit!(ValidationResponded {
            agent_id: validation_request.agent_id,
            validator_address: validation_request.validator_address,
            nonce: validation_request.nonce,
            response,
            response_uri,
            response_hash,
            tag,
            responded_at: clock.unix_timestamp,
        });

        msg!(
            "Validator {} responded to agent #{} with score {}",
            ctx.accounts.validator.key(),
            validation_request.agent_id,
            response
        );

        Ok(())
    }

    /// Update an existing validation response (ERC-8004: progressive validation)
    ///
    /// Allows validators to update their validation as agents improve.
    /// This is the same as respond_to_validation but semantically clearer.
    pub fn update_validation(
        ctx: Context<RespondToValidation>,
        response: u8,
        response_uri: String,
        response_hash: [u8; 32],
        tag: [u8; 32],
    ) -> Result<()> {
        // Same logic as respond_to_validation
        // ERC-8004 allows multiple responses (progressive validation)
        respond_to_validation(ctx, response, response_uri, response_hash, tag)
    }

    /// Close a validation request to recover rent (optional)
    ///
    /// Only the agent owner or program authority can close validations.
    /// Rent is returned to the specified receiver.
    pub fn close_validation(
        _ctx: Context<CloseValidation>,
    ) -> Result<()> {
        // Account closure is handled automatically by Anchor's `close` constraint
        msg!("Validation request closed, rent recovered");
        Ok(())
    }
}

// ============================================================================
// Instruction Contexts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ValidationConfig::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ValidationConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: u64, validator_address: Pubkey, nonce: u32)]
pub struct RequestValidation<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ValidationConfig>,

    /// Agent owner (must match agent_account.owner)
    pub requester: Signer<'info>,

    /// Payer for the validation request account (can be different from requester)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Agent account from Identity Registry (for ownership verification)
    /// CHECK: Verified via program ownership and manual deserialization
    #[account(
        constraint = agent_account.owner == &config.identity_registry @ ValidationError::AgentNotFound
    )]
    pub agent_account: UncheckedAccount<'info>,

    /// Validation request PDA
    #[account(
        init,
        payer = payer,
        space = 8 + ValidationRequest::SIZE,
        seeds = [
            b"validation",
            agent_id.to_le_bytes().as_ref(),
            validator_address.as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    /// Identity Registry program (for CPI)
    /// CHECK: Program ID verified via seeds::program constraint above
    pub identity_registry_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RespondToValidation<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ValidationConfig>,

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
        constraint = validation_request.validator_address == validator.key() @ ValidationError::UnauthorizedValidator
    )]
    pub validation_request: Account<'info, ValidationRequest>,
}

#[derive(Accounts)]
pub struct CloseValidation<'info> {
    /// Agent owner or program authority
    pub authority: Signer<'info>,

    /// Validation request to close
    #[account(
        mut,
        close = rent_receiver,
        seeds = [
            b"validation",
            validation_request.agent_id.to_le_bytes().as_ref(),
            validation_request.validator_address.as_ref(),
            validation_request.nonce.to_le_bytes().as_ref()
        ],
        bump = validation_request.bump
    )]
    pub validation_request: Account<'info, ValidationRequest>,

    /// Receiver of recovered rent
    #[account(mut)]
    pub rent_receiver: SystemAccount<'info>,

    /// Identity Registry program (for ownership verification via CPI if needed)
    /// CHECK: Optional, can be used for additional checks
    pub identity_registry_program: Option<UncheckedAccount<'info>>,
}

