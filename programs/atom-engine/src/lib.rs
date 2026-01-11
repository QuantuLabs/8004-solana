use anchor_lang::prelude::*;

declare_id!("AToMNGXU9X5o9r2wg2d9xZnMQkGy6fypHs3c6DZd8VUp");

pub mod compute;
pub mod contexts;
pub mod error;
pub mod events;
pub mod params;
pub mod state;

pub use contexts::*;
pub use error::AtomError;
pub use events::*;
pub use state::*;

/// Replay event for batch recovery
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReplayEvent {
    pub client_hash: [u8; 32],
    pub score: u8,
    pub slot: u64,
}

#[program]
pub mod atom_engine {
    use super::*;

    /// Initialize the ATOM config (authority only, once)
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        agent_registry_program: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.init_defaults(
            ctx.accounts.authority.key(),
            agent_registry_program,
            ctx.bumps.config,
        );

        emit!(ConfigInitialized {
            authority: ctx.accounts.authority.key(),
            agent_registry_program,
        });

        msg!("ATOM config initialized: authority={}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Update config parameters (authority only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        // EMA Parameters
        alpha_fast: Option<u16>,
        alpha_slow: Option<u16>,
        alpha_volatility: Option<u16>,
        alpha_arrival: Option<u16>,
        // Risk Weights
        weight_sybil: Option<u8>,
        weight_burst: Option<u8>,
        weight_stagnation: Option<u8>,
        weight_shock: Option<u8>,
        weight_volatility: Option<u8>,
        weight_arrival: Option<u8>,
        // Thresholds
        diversity_threshold: Option<u8>,
        burst_threshold: Option<u8>,
        shock_threshold: Option<u16>,
        volatility_threshold: Option<u16>,
        // Pause
        paused: Option<bool>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;

        // Update only provided values
        if let Some(v) = alpha_fast { config.alpha_fast = v; }
        if let Some(v) = alpha_slow { config.alpha_slow = v; }
        if let Some(v) = alpha_volatility { config.alpha_volatility = v; }
        if let Some(v) = alpha_arrival { config.alpha_arrival = v; }
        if let Some(v) = weight_sybil { config.weight_sybil = v; }
        if let Some(v) = weight_burst { config.weight_burst = v; }
        if let Some(v) = weight_stagnation { config.weight_stagnation = v; }
        if let Some(v) = weight_shock { config.weight_shock = v; }
        if let Some(v) = weight_volatility { config.weight_volatility = v; }
        if let Some(v) = weight_arrival { config.weight_arrival = v; }
        if let Some(v) = diversity_threshold { config.diversity_threshold = v; }
        if let Some(v) = burst_threshold { config.burst_threshold = v; }
        if let Some(v) = shock_threshold { config.shock_threshold = v; }
        if let Some(v) = volatility_threshold { config.volatility_threshold = v; }
        if let Some(v) = paused { config.paused = v; }

        config.version = config.version.saturating_add(1);

        emit!(ConfigUpdated {
            authority: ctx.accounts.authority.key(),
            version: config.version,
        });

        msg!("ATOM config updated: version={}", config.version);
        Ok(())
    }

    /// Update stats for an agent (called via CPI from agent-registry or directly for testing)
    pub fn update_stats(
        ctx: Context<UpdateStats>,
        client_hash: [u8; 32],
        score: u8,
    ) -> Result<()> {
        require!(score <= 100, AtomError::InvalidScore);
        require!(!ctx.accounts.config.paused, AtomError::Paused);

        let clock = Clock::get()?;
        let stats = &mut ctx.accounts.stats;

        // Initialize bump if this is a new account
        if stats.feedback_count == 0 {
            stats.bump = ctx.bumps.stats;
        }

        // Update stats
        compute::update_stats(stats, &client_hash, score, clock.slot);

        emit!(StatsUpdated {
            asset: ctx.accounts.asset.key(),
            feedback_index: stats.feedback_count,
            score,
            trust_tier: stats.trust_tier,
            risk_score: stats.risk_score,
            quality_score: stats.quality_score,
            confidence: stats.confidence,
        });

        msg!(
            "Stats updated: asset={}, count={}, tier={}, risk={}",
            ctx.accounts.asset.key(),
            stats.feedback_count,
            stats.trust_tier,
            stats.risk_score
        );

        Ok(())
    }

    /// Create a checkpoint for recovery (permissionless)
    pub fn create_checkpoint(
        ctx: Context<CreateCheckpoint>,
        checkpoint_index: u64,
        checkpoint_hash: [u8; 32],
    ) -> Result<()> {
        let stats = &ctx.accounts.stats;
        let checkpoint = &mut ctx.accounts.checkpoint;

        // Verify checkpoint interval
        require!(
            stats.feedback_count >= checkpoint_index * params::CHECKPOINT_INTERVAL,
            AtomError::CheckpointIntervalNotReached
        );

        // Serialize stats to snapshot
        let mut stats_snapshot = [0u8; 96];
        let stats_data = stats.try_to_vec()?;
        let copy_len = stats_data.len().min(96);
        stats_snapshot[..copy_len].copy_from_slice(&stats_data[..copy_len]);

        checkpoint.asset = ctx.accounts.asset.key();
        checkpoint.checkpoint_index = checkpoint_index;
        checkpoint.checkpoint_hash = checkpoint_hash;
        checkpoint.feedback_index = stats.feedback_count;
        checkpoint.stats_snapshot = stats_snapshot;
        checkpoint.created_at = Clock::get()?.unix_timestamp;
        checkpoint.bump = ctx.bumps.checkpoint;

        emit!(CheckpointCreated {
            asset: ctx.accounts.asset.key(),
            checkpoint_index,
            feedback_index: stats.feedback_count,
            checkpoint_hash,
        });

        msg!(
            "Checkpoint created: asset={}, index={}, feedback_count={}",
            ctx.accounts.asset.key(),
            checkpoint_index,
            stats.feedback_count
        );

        Ok(())
    }

    /// Restore stats from a checkpoint (authority only)
    pub fn restore_from_checkpoint(
        ctx: Context<RestoreFromCheckpoint>,
        checkpoint_index: u64,
    ) -> Result<()> {
        let checkpoint = &ctx.accounts.checkpoint;
        let stats = &mut ctx.accounts.stats;

        // Deserialize checkpoint data
        let restored: AtomStats = AtomStats::try_deserialize(
            &mut &checkpoint.stats_snapshot[..]
        ).map_err(|_| AtomError::InvalidCheckpointData)?;

        // Restore stats (preserve bump)
        let bump = stats.bump;
        **stats = restored;
        stats.bump = bump;

        emit!(StatsRestored {
            asset: ctx.accounts.asset.key(),
            checkpoint_index,
            feedback_index: stats.feedback_count,
        });

        msg!(
            "Stats restored: asset={}, from checkpoint {}",
            ctx.accounts.asset.key(),
            checkpoint_index
        );

        Ok(())
    }

    /// Replay a batch of historical events (authority only, for recovery)
    pub fn replay_batch(
        ctx: Context<ReplayBatch>,
        events: Vec<ReplayEvent>,
    ) -> Result<()> {
        require!(!events.is_empty(), AtomError::InvalidReplayBatch);

        let stats = &mut ctx.accounts.stats;
        let mut count = 0u32;

        for event in events.iter() {
            require!(event.score <= 100, AtomError::InvalidScore);
            compute::update_stats(stats, &event.client_hash, event.score, event.slot);
            count += 1;
        }

        emit!(BatchReplayed {
            asset: ctx.accounts.asset.key(),
            events_replayed: count,
            final_feedback_index: stats.feedback_count,
        });

        msg!(
            "Batch replayed: asset={}, events={}, final_count={}",
            ctx.accounts.asset.key(),
            count,
            stats.feedback_count
        );

        Ok(())
    }
}
