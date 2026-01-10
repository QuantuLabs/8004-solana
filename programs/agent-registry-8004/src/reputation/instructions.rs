use anchor_lang::prelude::*;

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

/// Give feedback to an agent (8004 spec: giveFeedback)
///
/// Creates a new feedback entry for the specified agent with score 0-100.
/// Tags and endpoint are stored in event, use set_feedback_tags for on-chain tags.
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
    // Validate score (0-100)
    require!(score <= 100, RegistryError::InvalidScore);

    // Validate tag lengths (for event)
    require!(
        tag1.len() <= FeedbackTagsPda::MAX_TAG_LENGTH,
        RegistryError::TagTooLong
    );
    require!(
        tag2.len() <= FeedbackTagsPda::MAX_TAG_LENGTH,
        RegistryError::TagTooLong
    );

    // Validate URI length
    const MAX_URI_LENGTH: usize = 200;
    require!(
        feedback_uri.len() <= MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );
    require!(
        endpoint.len() <= MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );

    let asset = ctx.accounts.asset.key();

    // Get or initialize agent reputation metadata (sequencer only)
    let metadata = &mut ctx.accounts.agent_reputation;

    // Validate feedback_index matches expected global index
    require!(
        feedback_index == metadata.next_feedback_index,
        RegistryError::InvalidFeedbackIndex
    );

    // Initialize bump if first feedback
    if metadata.next_feedback_index == 0 {
        metadata.bump = ctx.bumps.agent_reputation;
    }

    // Increment global counter
    metadata.next_feedback_index = metadata
        .next_feedback_index
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    // Initialize feedback account
    let feedback = &mut ctx.accounts.feedback_account;
    feedback.asset = asset;
    feedback.client_address = ctx.accounts.client.key();
    feedback.feedback_index = feedback_index;
    feedback.score = score;
    feedback.is_revoked = false;
    feedback.bump = ctx.bumps.feedback_account;

    // Emit event (tags and endpoint in event for indexers)
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

/// Set feedback tags (creates FeedbackTagsPda)
///
/// Creates an optional tags PDA for an existing feedback.
/// Only the original feedback author can set tags.
pub fn set_feedback_tags(
    ctx: Context<SetFeedbackTags>,
    feedback_index: u64,
    tag1: String,
    tag2: String,
) -> Result<()> {
    // Validate tag lengths
    require!(
        tag1.len() <= FeedbackTagsPda::MAX_TAG_LENGTH,
        RegistryError::TagTooLong
    );
    require!(
        tag2.len() <= FeedbackTagsPda::MAX_TAG_LENGTH,
        RegistryError::TagTooLong
    );

    // At least one tag should be provided
    require!(
        !tag1.is_empty() || !tag2.is_empty(),
        RegistryError::EmptyTags
    );

    // Initialize tags PDA
    let tags = &mut ctx.accounts.feedback_tags;
    tags.tag1 = tag1.clone();
    tags.tag2 = tag2.clone();
    tags.bump = ctx.bumps.feedback_tags;

    msg!(
        "Tags set for feedback #{}: tag1='{}', tag2='{}'",
        feedback_index,
        tag1,
        tag2
    );

    Ok(())
}

/// Revoke feedback (8004 spec: revokeFeedback)
///
/// Marks feedback as revoked while preserving it for audit trail.
/// Only the original feedback author can revoke.
pub fn revoke_feedback(ctx: Context<RevokeFeedback>, feedback_index: u64) -> Result<()> {
    let feedback = &mut ctx.accounts.feedback_account;

    // Validate feedback is not already revoked
    require!(!feedback.is_revoked, RegistryError::AlreadyRevoked);

    // Mark as revoked
    feedback.is_revoked = true;

    let asset = ctx.accounts.asset.key();

    // Emit event
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

/// Append response to feedback (8004 spec: appendResponse)
///
/// Allows anyone to append a response to existing feedback.
/// Response content stored in event, account tracks responder only.
pub fn append_response(
    ctx: Context<AppendResponse>,
    feedback_index: u64,
    response_uri: String,
    response_hash: [u8; 32],
) -> Result<()> {
    // Validate URI length
    const MAX_URI_LENGTH: usize = 200;
    require!(
        response_uri.len() <= MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );

    let asset = ctx.accounts.asset.key();

    // Get or initialize response index account
    let response_index_account = &mut ctx.accounts.response_index;
    let response_index = if response_index_account.next_index == 0 {
        // First response to this feedback - initialize
        response_index_account.next_index = 1;
        response_index_account.bump = ctx.bumps.response_index;
        0u64
    } else {
        let current_index = response_index_account.next_index;
        response_index_account.next_index = current_index
            .checked_add(1)
            .ok_or(RegistryError::Overflow)?;
        current_index
    };

    // Initialize response account (simplified - just responder)
    let response = &mut ctx.accounts.response_account;
    response.responder = ctx.accounts.responder.key();
    response.bump = ctx.bumps.response_account;

    // Emit event (content stored in event only)
    emit!(ResponseAppended {
        asset,
        feedback_index,
        response_index,
        responder: ctx.accounts.responder.key(),
        response_uri,
        response_hash,
    });

    msg!(
        "Response #{} appended to feedback #{}: asset={}, responder={}",
        response_index,
        feedback_index,
        asset,
        ctx.accounts.responder.key()
    );

    Ok(())
}
