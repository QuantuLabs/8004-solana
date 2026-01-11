use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use mpl_core::accounts::BaseAssetV1;

use super::compute;
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

    // Update on-chain reputation stats
    let clock = Clock::get()?;
    let client_hash = keccak::hash(ctx.accounts.client.key().as_ref());

    // Initialize bump if this is a new account
    if ctx.accounts.reputation_stats.feedback_count == 0 {
        ctx.accounts.reputation_stats.bump = ctx.bumps.reputation_stats;
    }

    compute::update_reputation(
        &mut ctx.accounts.reputation_stats,
        &client_hash.0,
        score,
        clock.slot,
    );

    let asset = ctx.accounts.asset.key();

    emit!(NewFeedback {
        asset,
        client_address: ctx.accounts.client.key(),
        feedback_index,
        score,
        tag1,
        tag2,
        endpoint,
        feedback_uri,
        feedback_hash,
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
        response_uri,
        response_hash,
    });

    msg!(
        "Response appended to feedback #{}: asset={}, responder={}",
        feedback_index,
        asset,
        ctx.accounts.responder.key()
    );

    Ok(())
}
