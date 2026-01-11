use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use mpl_core::accounts::BaseAssetV1;

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    require!(
        *asset_info.owner == mpl_core::ID,
        RegistryError::InvalidAsset
    );

    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data).map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}

pub fn give_feedback(
    ctx: Context<GiveFeedback>,
    score: u8,
    tag1: String,
    tag2: String,
    endpoint: String,
    feedback_uri: String,
    feedback_hash: [u8; 32],
    feedback_index: u64,
) -> Result<()> {
    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    require!(
        core_owner != ctx.accounts.client.key(),
        RegistryError::SelfFeedbackNotAllowed
    );

    require!(score <= 100, RegistryError::InvalidScore);
    require!(tag1.len() <= MAX_TAG_LENGTH, RegistryError::TagTooLong);
    require!(tag2.len() <= MAX_TAG_LENGTH, RegistryError::TagTooLong);
    require!(
        feedback_uri.len() <= MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );
    require!(
        endpoint.len() <= MAX_ENDPOINT_LENGTH,
        RegistryError::UriTooLong
    );

    // Compute client hash for ATOM
    let client_hash = keccak::hash(ctx.accounts.client.key().as_ref());

    // CPI to atom-engine to update stats
    let cpi_accounts = atom_engine::cpi::accounts::UpdateStats {
        payer: ctx.accounts.client.to_account_info(),
        asset: ctx.accounts.asset.to_account_info(),
        config: ctx.accounts.atom_config.to_account_info(),
        stats: ctx.accounts.atom_stats.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.atom_engine_program.to_account_info(),
        cpi_accounts,
    );

    atom_engine::cpi::update_stats(cpi_ctx, client_hash.0, score)?;

    let asset = ctx.accounts.asset.key();

    emit!(NewFeedback {
        asset,
        client_address: ctx.accounts.client.key(),
        feedback_index,
        score,
        feedback_hash,
        tag1,
        tag2,
        endpoint,
        feedback_uri,
    });

    msg!(
        "Feedback #{} created: asset={}, client={}, score={}",
        feedback_index,
        asset,
        ctx.accounts.client.key(),
        score
    );

    Ok(())
}

pub fn revoke_feedback(ctx: Context<RevokeFeedback>, feedback_index: u64) -> Result<()> {
    let asset = ctx.accounts.asset.key();

    emit!(FeedbackRevoked {
        asset,
        client_address: ctx.accounts.client.key(),
        feedback_index,
    });

    msg!(
        "Feedback #{} revoked: asset={}, client={}",
        feedback_index,
        asset,
        ctx.accounts.client.key()
    );

    Ok(())
}

pub fn append_response(
    ctx: Context<AppendResponse>,
    feedback_index: u64,
    response_uri: String,
    response_hash: [u8; 32],
) -> Result<()> {
    require!(
        response_uri.len() <= MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );

    let asset = ctx.accounts.asset.key();

    emit!(ResponseAppended {
        asset,
        feedback_index,
        responder: ctx.accounts.responder.key(),
        response_hash,
        response_uri,
    });

    msg!(
        "Response appended to feedback #{}: asset={}, responder={}",
        feedback_index,
        asset,
        ctx.accounts.responder.key()
    );

    Ok(())
}
