use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use mpl_core::accounts::BaseAssetV1;

use super::contexts::{*, ATOM_CPI_AUTHORITY_SEED};
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

    let asset = ctx.accounts.asset.key();

    // SECURITY: Validate that atom_stats is the correct PDA for this asset
    // This prevents bypass attacks where users pass fake accounts to skip ATOM
    let (expected_atom_stats, _bump) = Pubkey::find_program_address(
        &[b"atom_stats", asset.as_ref()],
        &atom_engine::ID,
    );
    require!(
        ctx.accounts.atom_stats.key() == expected_atom_stats,
        RegistryError::InvalidAtomStatsAccount
    );

    // Check if AtomStats is initialized
    // If not initialized (data.len() == 0 or wrong owner), skip ATOM Engine CPI
    let atom_stats_info = ctx.accounts.atom_stats.to_account_info();
    let is_atom_initialized = atom_stats_info.data_len() > 0
        && *atom_stats_info.owner == atom_engine::ID;

    let update_result = if is_atom_initialized {
        // Validate ATOM Engine program ID
        require!(
            ctx.accounts.atom_engine_program.key() == atom_engine::ID,
            RegistryError::InvalidProgram
        );

        // Compute client hash for ATOM
        let client_hash = keccak::hash(ctx.accounts.client.key().as_ref());

        let cpi_accounts = atom_engine::cpi::accounts::UpdateStats {
            payer: ctx.accounts.client.to_account_info(),
            asset: ctx.accounts.asset.to_account_info(),
            collection: ctx.accounts.collection.to_account_info(),
            config: ctx.accounts.atom_config.to_account_info(),
            stats: atom_stats_info,
            registry_authority: ctx.accounts.registry_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };

        let bump = ctx.bumps.registry_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[ATOM_CPI_AUTHORITY_SEED, &[bump]]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.atom_engine_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        // Capture UpdateResult for enriched event
        let cpi_result = atom_engine::cpi::update_stats(cpi_ctx, client_hash.0, score)?;
        cpi_result.get()
    } else {
        // ATOM not initialized - return default values
        atom_engine::UpdateResult {
            trust_tier: 0,
            quality_score: 0,
            confidence: 0,
            risk_score: 0,
            diversity_ratio: 0,
            hll_changed: false,
        }
    };

    // Enriched event with AtomStats results
    emit!(NewFeedback {
        asset,
        client_address: ctx.accounts.client.key(),
        feedback_index,
        score,
        feedback_hash,
        atom_enabled: is_atom_initialized,
        new_trust_tier: update_result.trust_tier,
        new_quality_score: update_result.quality_score,
        new_confidence: update_result.confidence,
        new_risk_score: update_result.risk_score,
        new_diversity_ratio: update_result.diversity_ratio,
        is_unique_client: update_result.hll_changed,
        tag1,
        tag2,
        endpoint,
        feedback_uri,
    });

    msg!(
        "Feedback #{} created: asset={}, client={}, score={}, atom_enabled={}, tier={}",
        feedback_index,
        asset,
        ctx.accounts.client.key(),
        score,
        is_atom_initialized,
        update_result.trust_tier
    );

    Ok(())
}

/// Revoke feedback calls CPI to atom-engine to update stats (optional)
pub fn revoke_feedback(ctx: Context<RevokeFeedback>, feedback_index: u64) -> Result<()> {
    let asset = ctx.accounts.asset.key();
    let client = ctx.accounts.client.key();

    // SECURITY: Validate that atom_stats is the correct PDA for this asset
    // This prevents bypass attacks where users pass fake accounts to skip ATOM
    let (expected_atom_stats, _bump) = Pubkey::find_program_address(
        &[b"atom_stats", asset.as_ref()],
        &atom_engine::ID,
    );
    require!(
        ctx.accounts.atom_stats.key() == expected_atom_stats,
        RegistryError::InvalidAtomStatsAccount
    );

    // Check if AtomStats is initialized
    let atom_stats_info = ctx.accounts.atom_stats.to_account_info();
    let is_atom_initialized = atom_stats_info.data_len() > 0
        && *atom_stats_info.owner == atom_engine::ID;

    let revoke_result = if is_atom_initialized {
        // Validate ATOM Engine program ID
        require!(
            ctx.accounts.atom_engine_program.key() == atom_engine::ID,
            RegistryError::InvalidProgram
        );

        let cpi_accounts = atom_engine::cpi::accounts::RevokeStats {
            payer: ctx.accounts.client.to_account_info(),
            asset: ctx.accounts.asset.to_account_info(),
            config: ctx.accounts.atom_config.to_account_info(),
            stats: atom_stats_info,
            registry_authority: ctx.accounts.registry_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };

        let bump = ctx.bumps.registry_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[ATOM_CPI_AUTHORITY_SEED, &[bump]]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.atom_engine_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        // Capture RevokeResult for enriched event
        let cpi_result = atom_engine::cpi::revoke_stats(cpi_ctx, client)?;
        cpi_result.get()
    } else {
        // ATOM not initialized - return default values
        atom_engine::RevokeResult {
            original_score: 0,
            had_impact: false,
            new_trust_tier: 0,
            new_quality_score: 0,
            new_confidence: 0,
        }
    };

    // Enriched event with revoke results
    emit!(FeedbackRevoked {
        asset,
        client_address: client,
        feedback_index,
        original_score: revoke_result.original_score,
        atom_enabled: is_atom_initialized,
        had_impact: revoke_result.had_impact,
        new_trust_tier: revoke_result.new_trust_tier,
        new_quality_score: revoke_result.new_quality_score,
        new_confidence: revoke_result.new_confidence,
    });

    msg!(
        "Feedback #{} revoked: asset={}, client={}, atom_enabled={}, had_impact={}",
        feedback_index,
        asset,
        client,
        is_atom_initialized,
        revoke_result.had_impact
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
