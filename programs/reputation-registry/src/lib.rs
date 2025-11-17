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

    /// Revoke feedback (ERC-8004 spec: revokeFeedback)
    ///
    /// Marks feedback as revoked while preserving it in storage for audit trail.
    /// Only the original feedback author (client) can revoke their own feedback.
    /// Updates cached reputation metadata to exclude revoked feedback from aggregates.
    ///
    /// # Arguments
    /// * `agent_id` - Agent ID from Identity Registry
    /// * `feedback_index` - Index of feedback to revoke
    ///
    /// # Events
    /// * `FeedbackRevoked` - Emitted when feedback is successfully revoked
    ///
    /// # Errors
    /// * `Unauthorized` - Caller is not the original feedback author
    /// * `AlreadyRevoked` - Feedback was already revoked
    /// * `FeedbackNotFound` - Feedback doesn't exist
    pub fn revoke_feedback(
        ctx: Context<RevokeFeedback>,
        agent_id: u64,
        feedback_index: u64,
    ) -> Result<()> {
        let feedback = &mut ctx.accounts.feedback_account;

        // Validate caller is the original feedback author
        require!(
            feedback.client_address == ctx.accounts.client.key(),
            ReputationError::Unauthorized
        );

        // Validate feedback is not already revoked
        require!(!feedback.is_revoked, ReputationError::AlreadyRevoked);

        // Mark as revoked
        feedback.is_revoked = true;

        // Update agent reputation metadata (subtract from aggregates)
        let metadata = &mut ctx.accounts.agent_reputation;

        metadata.total_feedbacks = metadata
            .total_feedbacks
            .checked_sub(1)
            .ok_or(ReputationError::Overflow)?;

        metadata.total_score_sum = metadata
            .total_score_sum
            .checked_sub(feedback.score as u64)
            .ok_or(ReputationError::Overflow)?;

        // Recalculate average (avoid division by zero)
        metadata.average_score = if metadata.total_feedbacks == 0 {
            0
        } else {
            (metadata.total_score_sum / metadata.total_feedbacks) as u8
        };

        metadata.last_updated = Clock::get()?.unix_timestamp;

        // Emit event
        emit!(FeedbackRevoked {
            agent_id,
            client_address: ctx.accounts.client.key(),
            feedback_index,
        });

        msg!(
            "Feedback revoked: agent_id={}, client={}, index={}",
            agent_id,
            ctx.accounts.client.key(),
            feedback_index
        );

        Ok(())
    }

    /// Append response to feedback (ERC-8004 spec: appendResponse)
    ///
    /// Allows anyone (agent, third-party aggregator, etc.) to append a response
    /// to existing feedback. Responses are stored in separate PDA accounts,
    /// enabling unlimited responses per feedback. Common use cases:
    /// - Agent showing refund/resolution
    /// - Data aggregator flagging spam
    /// - Community providing additional context
    ///
    /// # Arguments
    /// * `agent_id` - Agent ID from Identity Registry
    /// * `client_address` - Original feedback author address
    /// * `feedback_index` - Index of feedback being responded to
    /// * `response_uri` - IPFS/Arweave link to response content (max 200 bytes)
    /// * `response_hash` - SHA-256 hash of response file
    ///
    /// # Events
    /// * `ResponseAppended` - Emitted when response is successfully added
    ///
    /// # Errors
    /// * `ResponseUriTooLong` - URI exceeds 200 bytes
    /// * `FeedbackNotFound` - Referenced feedback doesn't exist
    pub fn append_response(
        ctx: Context<AppendResponse>,
        agent_id: u64,
        client_address: Pubkey,
        feedback_index: u64,
        response_uri: String,
        response_hash: [u8; 32],
    ) -> Result<()> {
        // Validate URI length
        require!(
            response_uri.len() <= ResponseAccount::MAX_URI_LENGTH,
            ReputationError::ResponseUriTooLong
        );

        // Get or initialize response index account
        let response_index_account = &mut ctx.accounts.response_index;
        let response_index = if response_index_account.agent_id == 0 {
            // First response to this feedback
            response_index_account.agent_id = agent_id;
            response_index_account.client_address = client_address;
            response_index_account.feedback_index = feedback_index;
            response_index_account.next_index = 1; // Next response will be index 1
            response_index_account.bump = ctx.bumps.response_index;
            0u64
        } else {
            let current_index = response_index_account.next_index;
            response_index_account.next_index = current_index
                .checked_add(1)
                .ok_or(ReputationError::Overflow)?;
            current_index
        };

        // Initialize response account
        let response = &mut ctx.accounts.response_account;
        response.agent_id = agent_id;
        response.client_address = client_address;
        response.feedback_index = feedback_index;
        response.response_index = response_index;
        response.responder = ctx.accounts.responder.key();
        response.response_uri = response_uri.clone();
        response.response_hash = response_hash;
        response.created_at = Clock::get()?.unix_timestamp;
        response.bump = ctx.bumps.response_account;

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
            "Response appended: agent_id={}, feedback_index={}, response_index={}, responder={}",
            agent_id,
            feedback_index,
            response_index,
            ctx.accounts.responder.key()
        );

        Ok(())
    }
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

    /// Agent NFT mint (required to derive agent PDA correctly)
    /// This must be passed by the client who knows the agent's mint address
    /// CHECK: Will be validated via agent_account PDA derivation
    pub agent_mint: UncheckedAccount<'info>,

    /// Agent account from Identity Registry (validation)
    /// PDA derivation uses agent_mint to match Identity Registry's scheme
    /// CHECK: Validated via PDA seeds and agent_id match in instruction logic
    #[account(
        seeds = [b"agent", agent_mint.key().as_ref()],
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

/// Accounts for revoke_feedback instruction
#[derive(Accounts)]
#[instruction(agent_id: u64, feedback_index: u64)]
pub struct RevokeFeedback<'info> {
    /// Client revoking their feedback (must be original author)
    pub client: Signer<'info>,

    /// Feedback account to revoke
    #[account(
        mut,
        seeds = [
            b"feedback",
            agent_id.to_le_bytes().as_ref(),
            client.key().as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump = feedback_account.bump
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Agent reputation metadata (update aggregates)
    #[account(
        mut,
        seeds = [b"agent_reputation", agent_id.to_le_bytes().as_ref()],
        bump = agent_reputation.bump
    )]
    pub agent_reputation: Account<'info, AgentReputationMetadata>,
}

/// Accounts for append_response instruction
#[derive(Accounts)]
#[instruction(agent_id: u64, client_address: Pubkey, feedback_index: u64, _response_uri: String, _response_hash: [u8; 32])]
pub struct AppendResponse<'info> {
    /// Responder (can be anyone - agent, aggregator, etc.)
    pub responder: Signer<'info>,

    /// Payer for response account creation
    /// Can be same as responder or different for sponsorship
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Feedback account being responded to (validation)
    #[account(
        seeds = [
            b"feedback",
            agent_id.to_le_bytes().as_ref(),
            client_address.as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump = feedback_account.bump
    )]
    pub feedback_account: Account<'info, FeedbackAccount>,

    /// Response index account (tracks next response index for this feedback)
    #[account(
        init_if_needed,
        payer = payer,
        space = ResponseIndexAccount::SIZE,
        seeds = [
            b"response_index",
            agent_id.to_le_bytes().as_ref(),
            client_address.as_ref(),
            feedback_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub response_index: Account<'info, ResponseIndexAccount>,

    /// Response account (one per response)
    #[account(
        init,
        payer = payer,
        space = ResponseAccount::MAX_SIZE,
        seeds = [
            b"response",
            agent_id.to_le_bytes().as_ref(),
            client_address.as_ref(),
            feedback_index.to_le_bytes().as_ref(),
            response_index.next_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub response_account: Account<'info, ResponseAccount>,

    pub system_program: Program<'info, System>,
}

/// Stub for AgentAccount from Identity Registry (for CPI validation)
/// We only need agent_id field for validation
#[account]
pub struct AgentAccountStub {
    pub agent_id: u64,
    // Other fields omitted (not needed for validation)
}
