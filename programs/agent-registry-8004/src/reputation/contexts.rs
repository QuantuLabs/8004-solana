use anchor_lang::prelude::*;

use super::state::*;
use crate::error::RegistryError;
use crate::identity::state::AgentAccount;

/// Accounts for give_feedback instruction
/// Seeds use asset.key() instead of agent_id for C-01 fix
#[derive(Accounts)]
#[instruction(_score: u8, _tag1: String, _tag2: String, _endpoint: String, _feedback_uri: String, _feedback_hash: [u8; 32], feedback_index: u64)]
pub struct GiveFeedback<'info> {
    /// Client giving the feedback (signer & author)
    #[account(mut)]
    pub client: Signer<'info>,

    /// Payer for sponsorship (pays for account creation)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Core asset (unique identifier for agent)
    /// CHECK: Used for PDA derivation and ownership verification
    pub asset: UncheckedAccount<'info>,

    /// Agent account (direct access, no cross-program CPI needed)
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
        // Anti-gaming: prevent agent owner from giving feedback to their own agent
        constraint = agent_account.owner != client.key() @ RegistryError::SelfFeedbackNotAllowed
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Feedback account (one per feedback, keyed by asset)
    #[account(
        init,
        payer = payer,
        space = FeedbackAccount::DISCRIMINATOR.len() + FeedbackAccount::INIT_SPACE,
        seeds = [
            b"feedback",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Agent reputation metadata (sequencer for feedback indices)
    #[account(
        init_if_needed,
        payer = payer,
        space = AgentReputationMetadata::DISCRIMINATOR.len() + AgentReputationMetadata::INIT_SPACE,
        seeds = [b"agent_reputation", asset.key().as_ref()],
        bump
    )]
    pub agent_reputation: Account<'info, AgentReputationMetadata>,

    pub system_program: Program<'info, System>,
}

/// Accounts for revoke_feedback instruction
#[derive(Accounts)]
#[instruction(feedback_index: u64)]
pub struct RevokeFeedback<'info> {
    /// Client revoking their feedback (must be original author)
    pub client: Signer<'info>,

    /// Core asset (unique identifier for agent)
    /// CHECK: Used for PDA derivation
    pub asset: UncheckedAccount<'info>,

    /// Feedback account to revoke
    #[account(
        mut,
        seeds = [
            b"feedback",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump = feedback_account.bump,
        constraint = feedback_account.client_address == client.key() @ RegistryError::Unauthorized
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Agent reputation metadata (no longer updating aggregates - just for validation)
    #[account(
        seeds = [b"agent_reputation", asset.key().as_ref()],
        bump = agent_reputation.bump
    )]
    pub agent_reputation: Account<'info, AgentReputationMetadata>,
}

/// Accounts for append_response instruction
#[derive(Accounts)]
#[instruction(feedback_index: u64, _response_uri: String, _response_hash: [u8; 32])]
pub struct AppendResponse<'info> {
    /// Responder (can be anyone - agent, aggregator, etc.)
    pub responder: Signer<'info>,

    /// Payer for response account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Core asset (unique identifier for agent)
    /// CHECK: Used for PDA derivation
    pub asset: UncheckedAccount<'info>,

    /// Feedback account being responded to (validation)
    #[account(
        seeds = [
            b"feedback",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump = feedback_account.bump
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Response index account (tracks next response index for this feedback)
    #[account(
        init_if_needed,
        payer = payer,
        space = ResponseIndexAccount::DISCRIMINATOR.len() + ResponseIndexAccount::INIT_SPACE,
        seeds = [
            b"response_index",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub response_index: Account<'info, ResponseIndexAccount>,

    /// Response account (one per response, simplified)
    #[account(
        init,
        payer = payer,
        space = ResponseAccount::DISCRIMINATOR.len() + ResponseAccount::INIT_SPACE,
        seeds = [
            b"response",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref(),
            response_index.next_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub response_account: Account<'info, ResponseAccount>,

    pub system_program: Program<'info, System>,
}

/// Accounts for set_feedback_tags instruction
/// Creates a FeedbackTagsPda for an existing feedback
#[derive(Accounts)]
#[instruction(feedback_index: u64, _tag1: String, _tag2: String)]
pub struct SetFeedbackTags<'info> {
    /// Feedback author (must be original client)
    pub client: Signer<'info>,

    /// Payer for tags PDA creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Core asset (unique identifier for agent)
    /// CHECK: Used for PDA derivation
    pub asset: UncheckedAccount<'info>,

    /// Feedback account (must exist and belong to client)
    #[account(
        seeds = [
            b"feedback",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump = feedback_account.bump,
        constraint = feedback_account.client_address == client.key() @ RegistryError::Unauthorized
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Tags PDA (created once, cannot be modified)
    #[account(
        init,
        payer = payer,
        space = FeedbackTagsPda::DISCRIMINATOR.len() + FeedbackTagsPda::INIT_SPACE,
        seeds = [
            b"feedback_tags",
            asset.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub feedback_tags: Account<'info, FeedbackTagsPda>,

    pub system_program: Program<'info, System>,
}
