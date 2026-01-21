use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;

use super::contexts::*;
use super::events::*;
use crate::error::RegistryError;
use crate::reputation::state::{MAX_TAG_LENGTH, MAX_URI_LENGTH};

/// Helper: Get the owner of a Metaplex Core asset
fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    require!(
        *asset_info.owner == mpl_core::ID,
        RegistryError::InvalidAsset
    );

    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data).map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}

/// Helper: Verify the owner of a Metaplex Core asset
fn verify_core_owner(asset_info: &AccountInfo, expected_owner: &Pubkey) -> Result<()> {
    let actual_owner = get_core_owner(asset_info)?;
    require!(
        actual_owner == *expected_owner,
        RegistryError::Unauthorized
    );
    Ok(())
}

/// Initialize the ValidationConfig (global validation registry state)
pub fn initialize_validation_config(ctx: Context<InitializeValidationConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.total_requests = 0;
    config.total_responses = 0;
    config.bump = ctx.bumps.config;

    msg!("ValidationConfig initialized with authority {}", config.authority);

    Ok(())
}

/// Request validation for an agent (ERC-8004: validationRequest)
///
/// Creates a ValidationRequest PDA with minimal state stored on-chain (109 bytes).
/// Full metadata (URIs, created_at) stored in events for off-chain indexing.
/// ERC-8004: Immutable - no close/delete function per specification.
///
/// Args:
/// - validator_address: Who can respond to this validation
/// - nonce: Sequence number for multiple validations from same validator
/// - request_uri: IPFS/Arweave link to validation request (max 200 bytes)
/// - request_hash: SHA-256 hash of request content for integrity
pub fn request_validation(
    ctx: Context<RequestValidation>,
    _asset_key: Pubkey,
    validator_address: Pubkey,
    nonce: u32,
    request_uri: String,
    request_hash: [u8; 32],
) -> Result<()> {
    // Validate URI length
    require!(
        request_uri.len() <= MAX_URI_LENGTH,
        RegistryError::RequestUriTooLong
    );

    // Verify requester is the asset owner
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.requester.key())?;

    // Prevent self-validation
    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    require!(
        core_owner != validator_address,
        RegistryError::SelfValidationNotAllowed
    );

    let config = &mut ctx.accounts.config;
    let validation_request = &mut ctx.accounts.validation_request;
    let clock = Clock::get()?;
    let asset = ctx.accounts.asset.key();

    // Initialize ValidationRequest PDA (optimized: 109 bytes)
    validation_request.asset = asset;
    validation_request.validator_address = validator_address;
    validation_request.nonce = nonce;
    validation_request.request_hash = request_hash;
    validation_request.response = 0; // 0 = pending (use responded_at to verify)
    validation_request.responded_at = 0; // No response yet

    // Increment total requests counter
    config.total_requests = config.total_requests
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    // Emit event with full metadata (created_at + URI not stored on-chain for rent optimization)
    emit!(ValidationRequested {
        asset,
        validator_address,
        nonce,
        requester: ctx.accounts.requester.key(),
        request_hash,
        created_at: clock.unix_timestamp,
        request_uri,
    });

    msg!(
        "Validation requested for asset {} by validator {} (nonce: {})",
        asset,
        validator_address,
        nonce
    );

    Ok(())
}

/// Validator responds to a validation request (ERC-8004: validationResponse)
///
/// Updates the existing ValidationRequest PDA with response data.
/// ERC-8004: Enables "progressive validation" - validators can update responses multiple times.
/// Full metadata (response_hash, response_uri, tag) stored in events only for rent optimization.
///
/// Args:
/// - asset_key: Asset pubkey (used for PDA derivation to avoid .key() allocation)
/// - validator_address: Validator address (used for PDA derivation to avoid .key() allocation)
/// - nonce: Nonce matching the ValidationRequest
/// - response: Validation score 0-100 (ERC-8004: 0 is valid score, not "pending")
/// - response_uri: IPFS/Arweave link to validation report (max 200 bytes)
/// - response_hash: SHA-256 hash of response content
/// - tag: String tag for categorization (e.g., "oasf-v0.8.0", max 32 bytes)
pub fn respond_to_validation(
    ctx: Context<RespondToValidation>,
    _asset_key: Pubkey,
    _validator_address: Pubkey,
    nonce: u32,
    response: u8,
    response_uri: String,
    response_hash: [u8; 32],
    tag: String,
) -> Result<()> {
    // Validate response range (ERC-8004 spec: 0-100)
    require!(response <= 100, RegistryError::InvalidResponse);

    // Validate URI and tag lengths
    require!(
        response_uri.len() <= MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );
    require!(tag.len() <= MAX_TAG_LENGTH, RegistryError::TagTooLong);

    // Prevent self-validation (redundant with context constraint, but explicit)
    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    require!(
        core_owner != ctx.accounts.validator.key(),
        RegistryError::SelfValidationNotAllowed
    );

    let config = &mut ctx.accounts.config;
    let validation_request = &mut ctx.accounts.validation_request;
    let clock = Clock::get()?;
    let asset = ctx.accounts.asset.key();

    // Check if this is the first response (for counter)
    let is_first_response = validation_request.responded_at == 0;

    // Update validation request (ERC-8004: lastUpdate equivalent)
    validation_request.response = response;
    validation_request.responded_at = clock.unix_timestamp;

    // Increment total responses counter (only on first response)
    if is_first_response {
        config.total_responses = config.total_responses
            .checked_add(1)
            .ok_or(RegistryError::Overflow)?;
    }

    // Emit event with full metadata (response_hash + tag not stored on-chain for rent optimization)
    emit!(ValidationResponded {
        asset,
        validator_address: ctx.accounts.validator.key(),
        nonce,
        response,
        response_hash,
        responded_at: clock.unix_timestamp,
        response_uri,
        tag,
    });

    msg!(
        "Validator {} responded to asset {} with score {} (nonce: {})",
        ctx.accounts.validator.key(),
        asset,
        response,
        nonce
    );

    Ok(())
}

// ERC-8004 Compliance: No close_validation() function
//
// Per ERC-8004 specification: "On-chain pointers and hashes cannot be deleted,
// ensuring audit trail integrity." ValidationRequest PDAs are immutable and
// permanent, ensuring reputation data cannot be censored or removed.
//
// Rent cost: ~0.00120 SOL per validation (109 bytes, permanent)
// This is 27% cheaper than initial design (150 bytes) while maintaining
// full ERC-8004 compliance and audit trail integrity.
