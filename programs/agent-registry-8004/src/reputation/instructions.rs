use anchor_lang::prelude::*;

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

/// Give feedback to an agent (8004 spec: giveFeedback)
///
/// Creates a new feedback entry for the specified agent with score 0-100,
/// tags, and file metadata. Uses global sequential feedback index.
pub fn give_feedback(
    ctx: Context<GiveFeedback>,
    agent_id: u64,
    score: u8,
    tag1: String,
    tag2: String,
    file_uri: String,
    file_hash: [u8; 32],
    feedback_index: u64,
) -> Result<()> {
    // Validate score (0-100)
    require!(score <= 100, RegistryError::InvalidScore);

    // Validate tag lengths
    require!(
        tag1.len() <= FeedbackAccount::MAX_TAG_LENGTH,
        RegistryError::TagTooLong
    );
    require!(
        tag2.len() <= FeedbackAccount::MAX_TAG_LENGTH,
        RegistryError::TagTooLong
    );

    // Validate URI length
    require!(
        file_uri.len() <= FeedbackAccount::MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );

    // Get or initialize agent reputation metadata (serves as global counter)
    let metadata = &mut ctx.accounts.agent_reputation;

    // Validate feedback_index matches expected global index
    // For first feedback (new account), next_feedback_index defaults to 0
    require!(
        feedback_index == metadata.next_feedback_index,
        RegistryError::InvalidFeedbackIndex
    );

    // Increment global counter
    metadata.next_feedback_index = metadata
        .next_feedback_index
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    if metadata.agent_id == 0 {
        // First feedback for this agent - initialize
        metadata.agent_id = agent_id;
        metadata.total_feedbacks = 1;
        metadata.total_score_sum = score as u64;
        metadata.average_score = score;
        metadata.bump = ctx.bumps.agent_reputation;
    } else {

        // Update stats
        metadata.total_feedbacks = metadata
            .total_feedbacks
            .checked_add(1)
            .ok_or(RegistryError::Overflow)?;

        metadata.total_score_sum = metadata
            .total_score_sum
            .checked_add(score as u64)
            .ok_or(RegistryError::Overflow)?;

        // Cap at 100 to ensure valid range
        let avg = metadata.total_score_sum / metadata.total_feedbacks;
        metadata.average_score = std::cmp::min(avg, 100) as u8;
    }

    metadata.last_updated = Clock::get()?.unix_timestamp;

    // Initialize feedback account
    let feedback = &mut ctx.accounts.feedback_account;
    feedback.agent_id = agent_id;
    feedback.client_address = ctx.accounts.client.key();
    feedback.feedback_index = feedback_index;
    feedback.score = score;
    feedback.tag1 = tag1.clone();
    feedback.tag2 = tag2.clone();
    feedback.file_uri = file_uri.clone();
    feedback.file_hash = file_hash;
    feedback.is_revoked = false;
    feedback.created_at = Clock::get()?.unix_timestamp;
    feedback.bump = ctx.bumps.feedback_account;

    // Emit event
    emit!(NewFeedback {
        agent_id,
        client_address: ctx.accounts.client.key(),
        feedback_index,
        score,
        tag1,
        tag2,
        file_uri,
        file_hash,
    });

    msg!(
        "Feedback #{} created: agent_id={}, client={}, score={}",
        feedback_index,
        agent_id,
        ctx.accounts.client.key(),
        score
    );

    Ok(())
}

/// Revoke feedback (8004 spec: revokeFeedback)
///
/// Marks feedback as revoked while preserving it for audit trail.
/// Only the original feedback author can revoke (enforced via account constraint).
pub fn revoke_feedback(
    ctx: Context<RevokeFeedback>,
    agent_id: u64,
    feedback_index: u64,
) -> Result<()> {
    let feedback = &mut ctx.accounts.feedback_account;

    // Note: Authorization check is enforced in account constraint
    // (feedback_account.client_address == client.key())

    // Validate feedback is not already revoked
    require!(!feedback.is_revoked, RegistryError::AlreadyRevoked);

    // Mark as revoked
    feedback.is_revoked = true;

    // Update agent reputation metadata (subtract from aggregates)
    let metadata = &mut ctx.accounts.agent_reputation;

    metadata.total_feedbacks = metadata
        .total_feedbacks
        .checked_sub(1)
        .ok_or(RegistryError::Overflow)?;

    metadata.total_score_sum = metadata
        .total_score_sum
        .checked_sub(feedback.score as u64)
        .ok_or(RegistryError::Overflow)?;

    // Recalculate average (avoid division by zero, cap at 100)
    metadata.average_score = if metadata.total_feedbacks == 0 {
        0
    } else {
        let avg = metadata.total_score_sum / metadata.total_feedbacks;
        std::cmp::min(avg, 100) as u8
    };

    metadata.last_updated = Clock::get()?.unix_timestamp;

    // Emit event
    emit!(FeedbackRevoked {
        agent_id,
        client_address: ctx.accounts.client.key(),
        feedback_index,
    });

    msg!(
        "Feedback #{} revoked: agent_id={}, client={}",
        feedback_index,
        agent_id,
        ctx.accounts.client.key()
    );

    Ok(())
}

/// Append response to feedback (8004 spec: appendResponse)
///
/// Allows anyone to append a response to existing feedback.
pub fn append_response(
    ctx: Context<AppendResponse>,
    agent_id: u64,
    feedback_index: u64,
    response_uri: String,
    response_hash: [u8; 32],
) -> Result<()> {
    // Validate URI length
    require!(
        response_uri.len() <= ResponseAccount::MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );

    // Get or initialize response index account
    let response_index_account = &mut ctx.accounts.response_index;
    let response_index = if response_index_account.agent_id == 0 {
        // First response to this feedback
        response_index_account.agent_id = agent_id;
        response_index_account.feedback_index = feedback_index;
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

    // Initialize response account
    let response = &mut ctx.accounts.response_account;
    response.agent_id = agent_id;
    response.feedback_index = feedback_index;
    response.response_index = response_index;
    response.responder = ctx.accounts.responder.key();
    response.response_uri = response_uri.clone();
    response.response_hash = response_hash;
    response.created_at = Clock::get()?.unix_timestamp;
    response.bump = ctx.bumps.response_account;

    // Get client_address from feedback account for the event
    let client_address = ctx.accounts.feedback_account.client_address;

    // Emit event
    emit!(ResponseAppended {
        agent_id,
        client_address,
        feedback_index,
        response_index,
        responder: ctx.accounts.responder.key(),
        response_uri,
    });

    msg!(
        "Response #{} appended to feedback #{}: agent_id={}, responder={}",
        response_index,
        feedback_index,
        agent_id,
        ctx.accounts.responder.key()
    );

    Ok(())
}
