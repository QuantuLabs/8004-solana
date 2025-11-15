use anchor_lang::prelude::*;

declare_id!("9WcFLL3Fsqs96JxuewEt9iqRwULtCZEsPT717hPbsQAa");

pub mod error;
pub mod events;
pub mod state;

use error::*;
use events::*;
use state::*;

#[program]
pub mod reputation_registry {
    use super::*;

    /// Initialize placeholder - reputation registry doesn't require initialization
    /// (relies on Identity Registry for agent validation)
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Reputation Registry: {:?}", ctx.program_id);
        Ok(())
    }

    /// Give feedback to an agent (ERC-8004 spec: giveFeedback)
    ///
    /// Creates a new feedback entry for the specified agent with score 0-100,
    /// tags, and file metadata. Uses client_index account to determine the
    /// sequential feedback_index per client-agent pair and updates cached reputation stats.
    ///
    /// # Arguments
    /// * `agent_id` - Agent ID from Identity Registry
    /// * `score` - Rating 0-100 (validated on-chain)
    /// * `tag1` - Full bytes32 tag (ERC-8004 spec requirement)
    /// * `tag2` - Full bytes32 tag (ERC-8004 spec requirement)
    /// * `file_uri` - IPFS/Arweave link (max 200 bytes)
    /// * `file_hash` - SHA-256 hash of feedback file
    /// * `feedback_index` - Expected index (must match client_index.last_index)
    ///
    /// # Events
    /// * `NewFeedback` - Emitted when feedback is successfully created
    ///
    /// # Errors
    /// * `InvalidScore` - Score not in range 0-100
    /// * `UriTooLong` - URI exceeds 200 bytes
    /// * `AgentNotFound` - Agent doesn't exist in Identity Registry
    /// * `InvalidFeedbackIndex` - Provided index doesn't match expected
    /// * `Overflow` - Arithmetic overflow in index or stats
    pub fn give_feedback(
        ctx: Context<GiveFeedback>,
        agent_id: u64,
        score: u8,
        tag1: [u8; 32],
        tag2: [u8; 32],
        file_uri: String,
        file_hash: [u8; 32],
        feedback_index: u64,
    ) -> Result<()> {
        // Validate score (0-100)
        require!(score <= 100, ReputationError::InvalidScore);

        // Validate URI length
        require!(
            file_uri.len() <= FeedbackAccount::MAX_URI_LENGTH,
            ReputationError::UriTooLong
        );

        // Validate agent exists in Identity Registry
        // AgentAccount PDA must exist and match the agent_id
        let agent_account = &ctx.accounts.agent_account;
        require!(
            agent_account.agent_id == agent_id,
            ReputationError::AgentNotFound
        );

        // Get or initialize client index account
        let client_index = &mut ctx.accounts.client_index;

        // Validate feedback_index matches expected
        if client_index.last_index == 0 && client_index.agent_id == 0 {
            // First feedback from this client to this agent
            require!(feedback_index == 0, ReputationError::InvalidFeedbackIndex);
            client_index.agent_id = agent_id;
            client_index.client_address = ctx.accounts.client.key();
            client_index.bump = ctx.bumps.client_index;
        } else {
            // Subsequent feedback - validate index matches
            require!(
                feedback_index == client_index.last_index,
                ReputationError::InvalidFeedbackIndex
            );
        }

        // Increment index for next feedback
        client_index.last_index = client_index
            .last_index
            .checked_add(1)
            .ok_or(ReputationError::Overflow)?;

        // Initialize feedback account
        let feedback = &mut ctx.accounts.feedback_account;
        feedback.agent_id = agent_id;
        feedback.client_address = ctx.accounts.client.key();
        feedback.feedback_index = feedback_index;
        feedback.score = score;
        feedback.tag1 = tag1;
        feedback.tag2 = tag2;
        feedback.file_uri = file_uri.clone();
        feedback.file_hash = file_hash;
        feedback.is_revoked = false;
        feedback.created_at = Clock::get()?.unix_timestamp;
        feedback.bump = ctx.bumps.feedback_account;

        // Update agent reputation metadata (cached stats)
        let metadata = &mut ctx.accounts.agent_reputation;

        if metadata.agent_id == 0 {
            // First feedback for this agent - initialize
            metadata.agent_id = agent_id;
            metadata.total_feedbacks = 1;
            metadata.total_score_sum = score as u64;
            metadata.average_score = score;
            metadata.bump = ctx.bumps.agent_reputation;
        } else {
            // Update existing stats
            metadata.total_feedbacks = metadata
                .total_feedbacks
                .checked_add(1)
                .ok_or(ReputationError::Overflow)?;

            metadata.total_score_sum = metadata
                .total_score_sum
                .checked_add(score as u64)
                .ok_or(ReputationError::Overflow)?;

            metadata.average_score = (metadata.total_score_sum / metadata.total_feedbacks) as u8;
        }

        metadata.last_updated = Clock::get()?.unix_timestamp;

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
            "Feedback created: agent_id={}, client={}, index={}, score={}",
            agent_id,
            ctx.accounts.client.key(),
            feedback_index,
            score
        );

        Ok(())
    }

    // TODO: Jour 3 - Implement revoke_feedback instruction
    // TODO: Jour 3 - Implement append_response instruction
}

#[derive(Accounts)]
pub struct Initialize {}

/// Accounts for give_feedback instruction
#[derive(Accounts)]
#[instruction(agent_id: u64, _score: u8, _tag1: [u8; 32], _tag2: [u8; 32], _file_uri: String, _file_hash: [u8; 32], feedback_index: u64)]
pub struct GiveFeedback<'info> {
    /// Client giving the feedback (signer & author)
    #[account(mut)]
    pub client: Signer<'info>,

    /// Payer for sponsorship (pays for account creation)
    /// Can be same as client or different wallet for sponsored feedback
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Agent account from Identity Registry (validation)
    /// CHECK: Validated via agent_id match in instruction logic
    #[account(
        seeds = [b"agent", agent_id.to_le_bytes().as_ref()],
        bump,
        seeds::program = identity_registry_program.key()
    )]
    pub agent_account: Account<'info, AgentAccountStub>,

    /// Client index account (tracks next feedback index for this client-agent pair)
    #[account(
        init_if_needed,
        payer = payer,
        space = ClientIndexAccount::SIZE,
        seeds = [b"client_index", agent_id.to_le_bytes().as_ref(), client.key().as_ref()],
        bump
    )]
    pub client_index: Account<'info, ClientIndexAccount>,

    /// Feedback account (one per feedback)
    #[account(
        init,
        payer = payer,
        space = FeedbackAccount::MAX_SIZE,
        seeds = [
            b"feedback",
            agent_id.to_le_bytes().as_ref(),
            client.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Agent reputation metadata (cached stats)
    #[account(
        init_if_needed,
        payer = payer,
        space = AgentReputationMetadata::SIZE,
        seeds = [b"agent_reputation", agent_id.to_le_bytes().as_ref()],
        bump
    )]
    pub agent_reputation: Account<'info, AgentReputationMetadata>,

    /// Identity Registry program (for CPI validation)
    /// CHECK: Program ID verified via seeds::program constraint
    pub identity_registry_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Stub for AgentAccount from Identity Registry (for CPI validation)
/// We only need agent_id field for validation
#[account]
pub struct AgentAccountStub {
    pub agent_id: u64,
    // Other fields omitted (not needed for validation)
}
