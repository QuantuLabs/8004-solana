use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

mod error;
mod events;
mod state;

use error::ValidationError;
use events::{ValidationRequested, ValidationResponded};
use state::{ValidationConfig, ValidationRequest};

declare_id!("2y87PVXuBoCTi9b6p44BJREVz14Te2pukQPSwqfPwhhw");

// SECURITY: Dynamic Identity Registry Program ID based on deployment environment
// This ensures only agents from the legitimate Identity Registry can be validated
// Configured via Cargo features matching Anchor.toml deployment targets

#[cfg(feature = "devnet")]
pub const IDENTITY_REGISTRY_ID: Pubkey = anchor_lang::solana_program::pubkey!("CAHKQ2amAyKGzPhSE1mJx5qgxn1nJoNToDaiU6Kmacss");

#[cfg(feature = "mainnet")]
pub const IDENTITY_REGISTRY_ID: Pubkey = anchor_lang::solana_program::pubkey!("MAINNET_ID_TBD_AFTER_DEPLOYMENT_REPLACE_THIS");

// Default to localnet for local development and testing
#[cfg(not(any(feature = "devnet", feature = "mainnet")))]
pub const IDENTITY_REGISTRY_ID: Pubkey = anchor_lang::solana_program::pubkey!("AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR");

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

        // Manually deserialize agent account to verify agent_id
        let agent_data = ctx.accounts.agent_account.try_borrow_data()?;

        // Skip 8-byte discriminator, read agent_id (next 8 bytes)
        require!(agent_data.len() >= 8 + 8, ValidationError::AgentNotFound);

        let stored_agent_id = u64::from_le_bytes(
            agent_data[8..16]
                .try_into()
                .map_err(|_| ValidationError::AgentNotFound)?
        );

        // Verify agent_id matches
        require!(stored_agent_id == agent_id, ValidationError::AgentNotFound);

        // Verify requester is the actual NFT holder (via token_account)
        require!(
            ctx.accounts.token_account.owner == ctx.accounts.requester.key(),
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
    /// - tag: String tag for categorization (e.g., "oasf-v0.8.0", "zkml-verified", max 32 bytes)
    pub fn respond_to_validation(
        ctx: Context<RespondToValidation>,
        response: u8,
        response_uri: String,
        response_hash: [u8; 32],
        tag: String,
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
        tag: String,
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
        ctx: Context<CloseValidation>,
    ) -> Result<()> {
        // Verify closer is either agent owner (NFT holder) or program authority
        // Check closer is either actual NFT holder OR program authority
        let is_agent_owner = ctx.accounts.token_account.owner == ctx.accounts.closer.key();
        let is_authority = ctx.accounts.config.authority == ctx.accounts.closer.key();

        require!(
            is_agent_owner || is_authority,
            ValidationError::Unauthorized
        );

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

    /// Agent owner (must match token_account.owner - the actual NFT holder)
    pub requester: Signer<'info>,

    /// Payer for the validation request account (can be different from requester)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Agent NFT mint (required to derive agent PDA correctly)
    /// CHECK: Validated via agent_account PDA derivation
    pub agent_mint: UncheckedAccount<'info>,

    /// Agent account from Identity Registry (for agent_id verification)
    /// CHECK: Verified via PDA seeds, program ownership check, and manual deserialization
    #[account(
        seeds = [b"agent", agent_mint.key().as_ref()],
        bump,
        seeds::program = identity_registry_program.key(),
        constraint = agent_account.owner == &IDENTITY_REGISTRY_ID @ ValidationError::AgentNotFound
    )]
    pub agent_account: UncheckedAccount<'info>,

    /// Token account holding the agent NFT - verifies actual ownership
    #[account(
        constraint = token_account.mint == agent_mint.key() @ ValidationError::InvalidTokenAccount,
        constraint = token_account.amount == 1 @ ValidationError::InvalidTokenAccount,
    )]
    pub token_account: Account<'info, TokenAccount>,

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

    /// Identity Registry program (for CPI validation)
    /// CHECK: Hardcoded program ID verified via constraint to prevent fake agent attacks
    #[account(constraint = identity_registry_program.key() == IDENTITY_REGISTRY_ID @ ValidationError::InvalidIdentityRegistry)]
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
    /// Program config (for authority check as fallback)
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ValidationConfig>,

    /// Agent owner (NFT holder) OR program authority can close validations
    /// Verified via token_account.owner in instruction
    pub closer: Signer<'info>,

    /// Agent NFT mint (required to derive agent PDA correctly)
    /// CHECK: Validated via agent_account PDA derivation
    pub agent_mint: UncheckedAccount<'info>,

    /// Agent account from Identity Registry (for PDA derivation)
    /// CHECK: Verified via PDA seeds and program ownership check
    #[account(
        seeds = [b"agent", agent_mint.key().as_ref()],
        bump,
        seeds::program = identity_registry_program.key(),
        constraint = agent_account.owner == &IDENTITY_REGISTRY_ID @ ValidationError::AgentNotFound
    )]
    pub agent_account: UncheckedAccount<'info>,

    /// Token account holding the agent NFT - verifies actual ownership
    #[account(
        constraint = token_account.mint == agent_mint.key() @ ValidationError::InvalidTokenAccount,
        constraint = token_account.amount == 1 @ ValidationError::InvalidTokenAccount,
    )]
    pub token_account: Account<'info, TokenAccount>,

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

    /// Identity Registry program (for CPI validation)
    /// CHECK: Hardcoded program ID verified via constraint
    #[account(constraint = identity_registry_program.key() == IDENTITY_REGISTRY_ID @ ValidationError::InvalidIdentityRegistry)]
    pub identity_registry_program: UncheckedAccount<'info>,

    /// Receiver of recovered rent
    #[account(mut)]
    pub rent_receiver: SystemAccount<'info>,
}

