use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;

use super::contexts::*;
use super::events::*;
use crate::error::RegistryError;
use crate::reputation::state::{MAX_TAG_LENGTH, MAX_URI_LENGTH};

fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    require!(
        *asset_info.owner == mpl_core::ID,
        RegistryError::InvalidAsset
    );

    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data).map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}

fn verify_core_owner(asset_info: &AccountInfo, expected_owner: &Pubkey) -> Result<()> {
    let actual_owner = get_core_owner(asset_info)?;
    require!(
        actual_owner == *expected_owner,
        RegistryError::Unauthorized
    );
    Ok(())
}

pub fn request_validation(
    ctx: Context<RequestValidation>,
    validator_address: Pubkey,
    nonce: u32,
    request_uri: String,
    request_hash: [u8; 32],
) -> Result<()> {
    require!(
        request_uri.len() <= MAX_URI_LENGTH,
        RegistryError::RequestUriTooLong
    );

    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.requester.key())?;

    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    require!(
        core_owner != validator_address,
        RegistryError::SelfValidationNotAllowed
    );

    let asset = ctx.accounts.asset.key();

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

pub fn respond_to_validation(
    ctx: Context<RespondToValidation>,
    nonce: u32,
    response: u8,
    response_uri: String,
    response_hash: [u8; 32],
    tag: String,
) -> Result<()> {
    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    require!(
        core_owner != ctx.accounts.validator.key(),
        RegistryError::SelfValidationNotAllowed
    );

    require!(response <= 100, RegistryError::InvalidResponse);
    require!(
        response_uri.len() <= MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );
    require!(tag.len() <= MAX_TAG_LENGTH, RegistryError::TagTooLong);

    let asset = ctx.accounts.asset.key();

    emit!(ValidationResponded {
        asset,
        validator_address: ctx.accounts.validator.key(),
        nonce,
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
