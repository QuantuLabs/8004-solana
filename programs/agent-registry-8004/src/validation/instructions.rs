use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

/// Get owner from Core asset account data
/// Uses official mpl-core deserialization (no manual byte parsing)
fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    // F-06: Verify this is actually a Metaplex Core asset
    require!(
        *asset_info.owner == mpl_core::ID,
        RegistryError::InvalidAsset
    );

    // Use official mpl-core deserialization
    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data)
        .map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}

/// Helper to verify Core asset ownership
fn verify_core_owner(asset_info: &AccountInfo, expected_owner: &Pubkey) -> Result<()> {
    let actual_owner = get_core_owner(asset_info)?;
    require!(
        actual_owner == *expected_owner,
        RegistryError::Unauthorized
    );
    Ok(())
}

/// Request validation for an agent (8004 spec: validationRequest)
///
/// Only the agent owner can request validation.
/// URIs are stored in events only (not on-chain) for cost optimization.
pub fn request_validation(
    ctx: Context<RequestValidation>,
    agent_id: u64,
    validator_address: Pubkey,
    nonce: u32,
    request_uri: String,
    request_hash: [u8; 32],
) -> Result<()> {
    // Validate URI length
    require!(
        request_uri.len() <= ValidationRequest::MAX_URI_LENGTH,
        RegistryError::RequestUriTooLong
    );

    // Verify requester is the actual Core asset owner
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.requester.key())?;

    let validation_stats = &mut ctx.accounts.validation_stats;
    let validation_request = &mut ctx.accounts.validation_request;
    let clock = Clock::get()?;

    // Initialize stats if first time
    if validation_stats.total_requests == 0 && validation_stats.total_responses == 0 {
        validation_stats.bump = ctx.bumps.validation_stats;
    }

    // Initialize ValidationRequest
    validation_request.agent_id = agent_id;
    validation_request.validator_address = validator_address;
    validation_request.nonce = nonce;
    validation_request.request_hash = request_hash;
    validation_request.response_hash = [0; 32];
    validation_request.response = 0;
    validation_request.created_at = clock.unix_timestamp;
    validation_request.responded_at = 0;
    validation_request.bump = ctx.bumps.validation_request;

    // Increment total requests counter
    validation_stats.total_requests = validation_stats
        .total_requests
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    // Emit event (timestamp available from transaction blockTime)
    emit!(ValidationRequested {
        agent_id,
        validator_address,
        nonce,
        request_uri,
        request_hash,
        requester: ctx.accounts.requester.key(),
    });

    msg!(
        "Validation requested for agent #{} by validator {}",
        agent_id,
        validator_address
    );

    Ok(())
}

/// Validator responds to a validation request (8004 spec: validationResponse)
///
/// Only the designated validator can respond.
pub fn respond_to_validation(
    ctx: Context<RespondToValidation>,
    response: u8,
    response_uri: String,
    response_hash: [u8; 32],
    tag: String,
) -> Result<()> {
    // Validate response range (0-100)
    require!(response <= 100, RegistryError::InvalidResponse);

    // Validate URI length
    require!(
        response_uri.len() <= ValidationRequest::MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );

    // V-01: Validate tag length (consistent with FeedbackTagsPda::MAX_TAG_LENGTH)
    require!(tag.len() <= 32, RegistryError::TagTooLong);

    let validation_stats = &mut ctx.accounts.validation_stats;
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
        validation_stats.total_responses = validation_stats
            .total_responses
            .checked_add(1)
            .ok_or(RegistryError::Overflow)?;
    }

    // Emit event (timestamp available from transaction blockTime)
    emit!(ValidationResponded {
        agent_id: validation_request.agent_id,
        validator_address: validation_request.validator_address,
        nonce: validation_request.nonce,
        response,
        response_uri,
        response_hash,
        tag,
    });

    msg!(
        "Validator {} responded to agent #{} with score {}",
        ctx.accounts.validator.key(),
        validation_request.agent_id,
        response
    );

    Ok(())
}

/// Update an existing validation response (progressive validation)
pub fn update_validation(
    ctx: Context<RespondToValidation>,
    response: u8,
    response_uri: String,
    response_hash: [u8; 32],
    tag: String,
) -> Result<()> {
    respond_to_validation(ctx, response, response_uri, response_hash, tag)
}

/// Close a validation request to recover rent
///
/// Only the agent owner or program authority can close.
/// F-02v2: rent_receiver must be the current Core asset owner (not cached)
pub fn close_validation(ctx: Context<CloseValidation>) -> Result<()> {
    // F-02v2: Get actual current owner from Core asset
    let current_owner = get_core_owner(&ctx.accounts.asset)?;

    // Verify closer is either Core asset owner OR program authority
    let is_authority = ctx.accounts.config.authority == ctx.accounts.closer.key();

    if !is_authority {
        // Must be the Core asset owner
        require!(
            ctx.accounts.closer.key() == current_owner,
            RegistryError::Unauthorized
        );
    }

    // F-02v2: rent_receiver MUST be the current Core asset owner
    // This prevents rent theft even if cached agent_account.owner is stale
    require!(
        ctx.accounts.rent_receiver.key() == current_owner,
        RegistryError::InvalidRentReceiver
    );

    msg!("Validation request closed, rent recovered to current owner");
    Ok(())
}
