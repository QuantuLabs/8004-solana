use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

/// Get owner from Core asset account data
fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    require!(
        *asset_info.owner == mpl_core::ID,
        RegistryError::InvalidAsset
    );

    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data).map_err(|_| RegistryError::InvalidAsset)?;

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
/// URIs are stored in events only (not on-chain).
pub fn request_validation(
    ctx: Context<RequestValidation>,
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

    let asset = ctx.accounts.asset.key();
    let validation_request = &mut ctx.accounts.validation_request;
    let clock = Clock::get()?;

    // Initialize ValidationRequest
    validation_request.asset = asset;
    validation_request.validator_address = validator_address;
    validation_request.nonce = nonce;
    validation_request.request_hash = request_hash;
    validation_request.response_hash = [0; 32];
    validation_request.response = 0;
    validation_request.last_update = clock.unix_timestamp;
    validation_request.has_response = false;
    validation_request.bump = ctx.bumps.validation_request;

    // Emit event
    emit!(ValidationRequested {
        asset,
        validator_address,
        nonce,
        request_uri,
        request_hash,
        requester: ctx.accounts.requester.key(),
    });

    msg!(
        "Validation requested for asset {} by validator {}",
        asset,
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

    // Validate tag length
    require!(tag.len() <= 32, RegistryError::TagTooLong);

    let validation_request = &mut ctx.accounts.validation_request;
    let clock = Clock::get()?;

    // Update validation request
    validation_request.response = response;
    validation_request.response_hash = response_hash;
    validation_request.last_update = clock.unix_timestamp;
    validation_request.has_response = true;

    let asset = ctx.accounts.asset.key();

    // Emit event
    emit!(ValidationResponded {
        asset,
        validator_address: validation_request.validator_address,
        nonce: validation_request.nonce,
        response,
        response_uri,
        response_hash,
        tag,
    });

    msg!(
        "Validator {} responded to asset {} with score {}",
        ctx.accounts.validator.key(),
        asset,
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
pub fn close_validation(ctx: Context<CloseValidation>) -> Result<()> {
    // Get actual current owner from Core asset
    let current_owner = get_core_owner(&ctx.accounts.asset)?;

    // Verify closer is either Core asset owner OR program authority
    let is_authority = ctx.accounts.root_config.authority == ctx.accounts.closer.key();

    if !is_authority {
        require!(
            ctx.accounts.closer.key() == current_owner,
            RegistryError::Unauthorized
        );
    }

    // rent_receiver MUST be the current Core asset owner
    require!(
        ctx.accounts.rent_receiver.key() == current_owner,
        RegistryError::InvalidRentReceiver
    );

    msg!("Validation request closed, rent recovered to current owner");
    Ok(())
}
