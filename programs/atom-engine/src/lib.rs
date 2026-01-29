use anchor_lang::prelude::*;

declare_id!("AToMNmthLzvTy3D2kz2obFmbVCsTCmYpDw1ptWUJdeU8");

/// Metaplex Core program ID
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

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

// Caller-specific pricing exports
pub use compute::{is_caller_verified, calculate_v7_tax_shift};

/// Summary returned by get_summary instruction (CPI-friendly)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Summary {
    /// Collection this agent belongs to
    pub collection: Pubkey,
    /// Asset (agent) this summary is for
    pub asset: Pubkey,
    /// Trust tier (0=Unrated, 1=Bronze, 2=Silver, 3=Gold, 4=Platinum)
    pub trust_tier: u8,
    /// Quality score (0-10000, represents 0.00-100.00)
    pub quality_score: u16,
    /// Risk score (0-100)
    pub risk_score: u8,
    /// Confidence in metrics (0-10000)
    pub confidence: u16,
    /// Total feedback count
    pub feedback_count: u64,
    /// Estimated unique clients (HLL)
    pub unique_clients: u64,
    /// Diversity ratio (0-255)
    pub diversity_ratio: u8,
    /// Fast EMA of scores (0-10000)
    pub ema_score_fast: u16,
    /// Slow EMA of scores (0-10000)
    pub ema_score_slow: u16,
    /// Loyalty score
    pub loyalty_score: u16,
    /// First feedback slot
    pub first_feedback_slot: u64,
    /// Last feedback slot
    pub last_feedback_slot: u64,
}

/// Result of update_stats for enriched events
/// Returned to caller so agent-registry can emit detailed NewFeedback event
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct UpdateResult {
    /// Trust tier after update (0-4)
    pub trust_tier: u8,
    /// Quality score after update (0-10000)
    pub quality_score: u16,
    /// Confidence after update (0-10000)
    pub confidence: u16,
    /// Risk score after update (0-100)
    pub risk_score: u8,
    /// Diversity ratio after update (0-255)
    pub diversity_ratio: u8,
    /// True if HLL register changed (likely new unique client)
    pub hll_changed: bool,
}

/// Result of revoke_stats for enriched events
/// Returned to caller so agent-registry can emit detailed FeedbackRevoked event
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct RevokeResult {
    /// Original score from the revoked feedback (0-100)
    pub original_score: u8,
    /// True if revoke had impact (false = feedback not found or already revoked)
    pub had_impact: bool,
    /// Trust tier after revoke (0-4)
    pub new_trust_tier: u8,
    /// Quality score after revoke (0-10000)
    pub new_quality_score: u16,
    /// Confidence after revoke (0-10000)
    pub new_confidence: u16,
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
    /// NOTE: compute.rs currently uses compile-time params; config is metadata-only until wired.
    /// SECURITY: Added parameter bounds validation
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

        // SECURITY: Validate parameter bounds before updating
        // EMA alphas must be 1-100 (used as percentage in calculations)
        if let Some(v) = alpha_fast {
            require!(v >= 1 && v <= 100, AtomError::InvalidConfigParameter);
            config.alpha_fast = v;
        }
        if let Some(v) = alpha_slow {
            require!(v >= 1 && v <= 100, AtomError::InvalidConfigParameter);
            config.alpha_slow = v;
        }
        if let Some(v) = alpha_volatility {
            require!(v >= 1 && v <= 100, AtomError::InvalidConfigParameter);
            config.alpha_volatility = v;
        }
        if let Some(v) = alpha_arrival {
            require!(v >= 1 && v <= 100, AtomError::InvalidConfigParameter);
            config.alpha_arrival = v;
        }
        // Risk weights: max 50 each to prevent single factor domination (sum capped at 300)
        if let Some(v) = weight_sybil {
            require!(v <= 50, AtomError::InvalidConfigParameter);
            config.weight_sybil = v;
        }
        if let Some(v) = weight_burst {
            require!(v <= 50, AtomError::InvalidConfigParameter);
            config.weight_burst = v;
        }
        if let Some(v) = weight_stagnation {
            require!(v <= 50, AtomError::InvalidConfigParameter);
            config.weight_stagnation = v;
        }
        if let Some(v) = weight_shock {
            require!(v <= 50, AtomError::InvalidConfigParameter);
            config.weight_shock = v;
        }
        if let Some(v) = weight_volatility {
            require!(v <= 50, AtomError::InvalidConfigParameter);
            config.weight_volatility = v;
        }
        if let Some(v) = weight_arrival {
            require!(v <= 50, AtomError::InvalidConfigParameter);
            config.weight_arrival = v;
        }
        // Thresholds: reasonable bounds
        if let Some(v) = diversity_threshold {
            require!(v <= 100, AtomError::InvalidConfigParameter);
            config.diversity_threshold = v;
        }
        if let Some(v) = burst_threshold {
            // u8 always <= 255, no validation needed
            config.burst_threshold = v;
        }
        if let Some(v) = shock_threshold {
            require!(v <= 10000, AtomError::InvalidConfigParameter);
            config.shock_threshold = v;
        }
        if let Some(v) = volatility_threshold {
            require!(v <= 10000, AtomError::InvalidConfigParameter);
            config.volatility_threshold = v;
        }
        if let Some(v) = paused { config.paused = v; }

        config.version = config.version.saturating_add(1);

        emit!(ConfigUpdated {
            authority: ctx.accounts.authority.key(),
            version: config.version,
        });

        msg!("ATOM config updated: version={}", config.version);
        Ok(())
    }

    /// Initialize stats for a new agent (only asset holder can initialize)
    pub fn initialize_stats(ctx: Context<InitializeStats>) -> Result<()> {
        use mpl_core::accounts::BaseAssetV1;
        use mpl_core::types::UpdateAuthority;

        require!(
            *ctx.accounts.asset.owner == MPL_CORE_ID,
            AtomError::InvalidAsset
        );

        require!(
            *ctx.accounts.collection.owner == MPL_CORE_ID,
            AtomError::InvalidCollection
        );

        let asset_data = ctx.accounts.asset.try_borrow_data()?;
        let asset = BaseAssetV1::from_bytes(&asset_data)
            .map_err(|_| AtomError::InvalidAsset)?;

        require!(
            asset.owner == ctx.accounts.owner.key(),
            AtomError::NotAssetOwner
        );

        let asset_collection = match asset.update_authority {
            UpdateAuthority::Collection(addr) => addr,
            _ => return Err(AtomError::AssetNotInCollection.into()),
        };

        require!(
            asset_collection == ctx.accounts.collection.key(),
            AtomError::CollectionMismatch
        );

        let stats = &mut ctx.accounts.stats;

        stats.bump = ctx.bumps.stats;
        stats.collection = ctx.accounts.collection.key();
        stats.asset = ctx.accounts.asset.key();
        stats.schema_version = AtomStats::SCHEMA_VERSION;

        emit!(StatsInitialized {
            asset: ctx.accounts.asset.key(),
            collection: ctx.accounts.collection.key(),
        });

        Ok(())
    }

    /// Update stats for an agent (called via CPI from agent-registry during feedback)
    /// Stats must already exist (created during agent registration via initialize_stats)
    /// SECURITY: Caller verified via PDA signer (registry_authority) in context constraints
    /// Returns UpdateResult for enriched events in agent-registry
    pub fn update_stats(
        ctx: Context<UpdateStats>,
        client_hash: [u8; 32],
        score: u8,
    ) -> Result<UpdateResult> {
        require!(score <= 100, AtomError::InvalidScore);
        require!(!ctx.accounts.config.paused, AtomError::Paused);

        let clock = Clock::get()?;
        let stats = &mut ctx.accounts.stats;

        // Stats should already be initialized via initialize_stats
        require!(stats.schema_version > 0, AtomError::StatsNotInitialized);

        // Update stats with config parameters
        let hll_changed = compute::update_stats(
            stats,
            &client_hash,
            score,
            clock.slot,
            &ctx.accounts.config,
        );

        emit!(StatsUpdated {
            asset: ctx.accounts.asset.key(),
            feedback_index: stats.feedback_count,
            score,
            trust_tier: stats.trust_tier,
            risk_score: stats.risk_score,
            quality_score: stats.quality_score,
            confidence: stats.confidence,
        });

        // Return result for enriched events
        Ok(UpdateResult {
            trust_tier: stats.trust_tier,
            quality_score: stats.quality_score,
            confidence: stats.confidence,
            risk_score: stats.risk_score,
            diversity_ratio: stats.diversity_ratio,
            hll_changed,
        })
    }

    /// Get summary for an agent (CPI-callable, returns Summary struct)
    /// Other programs can call this via CPI to get reputation data
    pub fn get_summary(ctx: Context<GetSummary>) -> Result<Summary> {
        let stats = &ctx.accounts.stats;

        // Estimate unique clients from HLL
        let unique_clients = hll_estimate(&stats.hll_packed);

        Ok(Summary {
            collection: stats.collection,
            asset: stats.asset,
            trust_tier: stats.trust_tier,
            quality_score: stats.quality_score,
            risk_score: stats.risk_score,
            confidence: stats.confidence,
            feedback_count: stats.feedback_count,
            unique_clients,
            diversity_ratio: stats.diversity_ratio,
            ema_score_fast: stats.ema_score_fast,
            ema_score_slow: stats.ema_score_slow,
            loyalty_score: stats.loyalty_score,
            first_feedback_slot: stats.first_feedback_slot,
            last_feedback_slot: stats.last_feedback_slot,
        })
    }

    /// Revoke a feedback entry from the ring buffer
    /// Called via CPI from agent-registry during revoke_feedback
    /// SECURITY: Caller verified via PDA signer (registry_authority) in context constraints
    ///
    /// # Arguments
    /// * `client_pubkey` - The pubkey of the client who gave the feedback
    ///
    /// # Returns
    /// RevokeResult with original_score, had_impact, and new stats
    ///
    /// # Soft Fail Behavior
    /// If feedback is not found (too old, ejected from ring buffer) or already revoked,
    /// returns `had_impact: false` instead of erroring. This is intentional for UX.
    pub fn revoke_stats(
        ctx: Context<RevokeStats>,
        client_pubkey: Pubkey,
    ) -> Result<RevokeResult> {
        require!(!ctx.accounts.config.paused, AtomError::Paused);

        let stats = &mut ctx.accounts.stats;
        require!(stats.schema_version > 0, AtomError::StatsNotInitialized);

        // Compute fingerprint from client pubkey (same as give_feedback does)
        use anchor_lang::solana_program::keccak;
        let client_hash = keccak::hash(client_pubkey.as_ref());
        let fp56 = secure_fp56(&client_hash.0, &stats.asset);

        // Try to find entry in ring buffer first, then check bypass_fingerprints
        // (Iron Dome fix: bypassed entries are stored in bypass_fingerprints for revoke support)
        let (original_score, had_impact) = if let Some((idx, score, already_revoked)) =
            find_caller_entry(&stats.recent_callers, fp56)
        {
            if already_revoked {
                // Already revoked - soft fail
                (score, false)
            } else {
                // Mark as revoked
                mark_entry_revoked(&mut stats.recent_callers, idx);

                // Apply inverse correction to quality EMA
                let correction_score: u16 = if score > 50 { 0 } else { 10000 };
                let dampened_alpha = params::ALPHA_QUALITY_DOWN / 2;
                stats.quality_score = ((dampened_alpha * correction_score as u32
                    + (100 - dampened_alpha) * stats.quality_score as u32) / 100) as u16;

                // Decrease confidence slightly
                stats.confidence = stats.confidence.saturating_sub(100);

                (score, true)
            }
        } else if let Some((idx, score, already_revoked)) =
            find_bypass_entry(&stats.bypass_fingerprints, fp56)
        {
            // Found in bypass buffer (was bypassed due to Iron Dome attack)
            if already_revoked {
                (score, false)
            } else {
                // Mark as revoked in bypass buffer
                mark_bypass_revoked(&mut stats.bypass_fingerprints, idx);

                // Apply inverse correction
                let correction_score: u16 = if score > 50 { 0 } else { 10000 };
                let dampened_alpha = params::ALPHA_QUALITY_DOWN / 2;
                stats.quality_score = ((dampened_alpha * correction_score as u32
                    + (100 - dampened_alpha) * stats.quality_score as u32) / 100) as u16;

                stats.confidence = stats.confidence.saturating_sub(100);

                (score, true)
            }
        } else {
            // Not found in ring buffer or bypass buffer - soft fail
            (0, false)
        };

        emit!(StatsRevoked {
            asset: ctx.accounts.asset.key(),
            client: client_pubkey,
            original_score,
            had_impact,
            new_trust_tier: stats.trust_tier,
            new_quality_score: stats.quality_score,
            new_confidence: stats.confidence,
        });

        Ok(RevokeResult {
            original_score,
            had_impact,
            new_trust_tier: stats.trust_tier,
            new_quality_score: stats.quality_score,
            new_confidence: stats.confidence,
        })
    }
}
