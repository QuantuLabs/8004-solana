use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use mpl_core::accounts::BaseAssetV1;

use super::chain::{
    chain_hash, compute_response_leaf, compute_revoke_leaf,
    DOMAIN_FEEDBACK, DOMAIN_RESPONSE, DOMAIN_REVOKE,
};
use super::seal::{compute_feedback_leaf_v1, compute_seal_hash};
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
    value: i64,
    value_decimals: u8,
    score: Option<u8>,
    feedback_file_hash: Option<[u8; 32]>,
    tag1: String,
    tag2: String,
    endpoint: String,
    feedback_uri: String,
) -> Result<()> {
    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    require!(
        core_owner != ctx.accounts.client.key(),
        RegistryError::SelfFeedbackNotAllowed
    );

    require!(value_decimals <= MAX_VALUE_DECIMALS, RegistryError::InvalidDecimals);
    if let Some(s) = score {
        require!(s <= 100, RegistryError::InvalidScore);
    }
    require!(tag1.len() <= MAX_TAG_LENGTH, RegistryError::TagTooLong);
    require!(tag2.len() <= MAX_TAG_LENGTH, RegistryError::TagTooLong);
    require!(
        feedback_uri.len() <= MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );
    require!(
        endpoint.len() <= MAX_ENDPOINT_LENGTH,
        RegistryError::EndpointTooLong
    );

    let asset = ctx.accounts.asset.key();

    let atom_enabled = ctx.accounts.agent_account.atom_enabled;
    let mut is_atom_initialized = false;

    // Check if ATOM stats are initialized (when atom_enabled)
    // NOTE: If atom_enabled but stats not initialized, feedback still works but without ATOM scoring
    // This prevents sellers from blocking all feedback by enabling ATOM but never initializing stats
    if atom_enabled {
        if let Some(atom_stats) = ctx.accounts.atom_stats.as_ref() {
            // SECURITY: Validate that atom_stats is the correct PDA for this asset
            let (expected_atom_stats, _bump) = Pubkey::find_program_address(
                &[b"atom_stats", asset.as_ref()],
                &atom_engine::ID,
            );
            require!(
                atom_stats.key() == expected_atom_stats,
                RegistryError::InvalidAtomStatsAccount
            );

            let atom_stats_info = atom_stats.to_account_info();
            is_atom_initialized = atom_stats_info.data_len() > 0
                && *atom_stats_info.owner == atom_engine::ID;
        }
        // If atom_stats not provided or not initialized, feedback proceeds without ATOM scoring
    }

    let update_result = if let Some(s) = score.filter(|_| is_atom_initialized) {
        let atom_config = ctx
            .accounts
            .atom_config
            .as_ref()
            .ok_or(RegistryError::InvalidProgram)?;
        let atom_engine_program = ctx
            .accounts
            .atom_engine_program
            .as_ref()
            .ok_or(RegistryError::InvalidProgram)?;
        let registry_authority = ctx
            .accounts
            .registry_authority
            .as_ref()
            .ok_or(RegistryError::InvalidProgram)?;
        let atom_stats_info = ctx
            .accounts
            .atom_stats
            .as_ref()
            .ok_or(RegistryError::AtomStatsNotInitialized)?
            .to_account_info();

        require!(
            atom_engine_program.key() == atom_engine::ID,
            RegistryError::InvalidProgram
        );

        let client_hash = keccak::hash(ctx.accounts.client.key().as_ref());

        let cpi_accounts = atom_engine::cpi::accounts::UpdateStats {
            payer: ctx.accounts.client.to_account_info(),
            asset: ctx.accounts.asset.to_account_info(),
            collection: ctx.accounts.collection.to_account_info(),
            config: atom_config.to_account_info(),
            stats: atom_stats_info,
            registry_authority: registry_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };

        let bump = ctx
            .bumps
            .registry_authority
            .ok_or(RegistryError::InvalidProgram)?;
        let signer_seeds: &[&[&[u8]]] = &[&[ATOM_CPI_AUTHORITY_SEED, &[bump]]];

        let cpi_ctx = CpiContext::new_with_signer(
            atom_engine_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        let cpi_result = atom_engine::cpi::update_stats(cpi_ctx, client_hash.0, s)?;
        cpi_result.get()
    } else {
        atom_engine::UpdateResult {
            trust_tier: 0,
            quality_score: 0,
            confidence: 0,
            risk_score: 0,
            diversity_ratio: 0,
            hll_changed: false,
        }
    };

    let slot = Clock::get()?.slot;
    let client = ctx.accounts.client.key();
    let agent = &mut ctx.accounts.agent_account;
    let feedback_index = agent.feedback_count;

    // SEAL v1: Compute content hash on-chain (trustless)
    let seal_hash = compute_seal_hash(
        value,
        value_decimals,
        score,
        &tag1,
        &tag2,
        &endpoint,
        &feedback_uri,
        feedback_file_hash,
    );

    // SEAL v1: Compute leaf with domain separator
    let asset_bytes = asset.to_bytes();
    let client_bytes = client.to_bytes();
    let leaf = compute_feedback_leaf_v1(
        &asset_bytes,
        &client_bytes,
        feedback_index as u32,
        &seal_hash,
        slot,
    );

    agent.feedback_digest = chain_hash(&agent.feedback_digest, DOMAIN_FEEDBACK, &leaf);
    agent.feedback_count += 1;

    emit!(NewFeedback {
        asset,
        client_address: client,
        feedback_index,
        slot,
        value,
        value_decimals,
        score,
        feedback_file_hash,
        seal_hash,
        atom_enabled: is_atom_initialized && score.is_some(),
        new_trust_tier: update_result.trust_tier,
        new_quality_score: update_result.quality_score,
        new_confidence: update_result.confidence,
        new_risk_score: update_result.risk_score,
        new_diversity_ratio: update_result.diversity_ratio,
        is_unique_client: update_result.hll_changed,
        new_feedback_digest: agent.feedback_digest,
        new_feedback_count: agent.feedback_count,
        tag1,
        tag2,
        endpoint,
        feedback_uri,
    });

    msg!(
        "Feedback #{} created: asset={}, client={}, score={:?}, atom_enabled={}, tier={}",
        feedback_index,
        asset,
        client,
        score,
        is_atom_initialized && score.is_some(),
        update_result.trust_tier
    );

    Ok(())
}

/// Revoke feedback calls CPI to atom-engine to update stats (optional)
/// SEAL v1: Client must provide the seal_hash (can be recomputed using the same algorithm)
pub fn revoke_feedback(
    ctx: Context<RevokeFeedback>,
    feedback_index: u64,
    seal_hash: [u8; 32],
) -> Result<()> {
    let asset = ctx.accounts.asset.key();
    let client = ctx.accounts.client.key();

    require!(
        feedback_index < ctx.accounts.agent_account.feedback_count,
        RegistryError::InvalidFeedbackIndex
    );

    let atom_enabled = ctx.accounts.agent_account.atom_enabled;
    let mut is_atom_initialized = false;

    // Check if ATOM stats are initialized (when atom_enabled)
    // NOTE: If atom_enabled but stats not initialized, revoke still works but without ATOM update
    if atom_enabled {
        if let Some(atom_stats) = ctx.accounts.atom_stats.as_ref() {
            // SECURITY: Validate that atom_stats is the correct PDA for this asset
            let (expected_atom_stats, _bump) = Pubkey::find_program_address(
                &[b"atom_stats", asset.as_ref()],
                &atom_engine::ID,
            );
            require!(
                atom_stats.key() == expected_atom_stats,
                RegistryError::InvalidAtomStatsAccount
            );

            let atom_stats_info = atom_stats.to_account_info();
            is_atom_initialized = atom_stats_info.data_len() > 0
                && *atom_stats_info.owner == atom_engine::ID;
        }
        // If atom_stats not provided or not initialized, revoke proceeds without ATOM update
    }

    let revoke_result = if is_atom_initialized {
        let atom_config = ctx
            .accounts
            .atom_config
            .as_ref()
            .ok_or(RegistryError::InvalidProgram)?;
        let atom_engine_program = ctx
            .accounts
            .atom_engine_program
            .as_ref()
            .ok_or(RegistryError::InvalidProgram)?;
        let registry_authority = ctx
            .accounts
            .registry_authority
            .as_ref()
            .ok_or(RegistryError::InvalidProgram)?;
        let atom_stats_info = ctx
            .accounts
            .atom_stats
            .as_ref()
            .ok_or(RegistryError::AtomStatsNotInitialized)?
            .to_account_info();

        // Validate ATOM Engine program ID
        require!(
            atom_engine_program.key() == atom_engine::ID,
            RegistryError::InvalidProgram
        );

        let cpi_accounts = atom_engine::cpi::accounts::RevokeStats {
            payer: ctx.accounts.client.to_account_info(),
            asset: ctx.accounts.asset.to_account_info(),
            config: atom_config.to_account_info(),
            stats: atom_stats_info,
            registry_authority: registry_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };

        let bump = ctx
            .bumps
            .registry_authority
            .ok_or(RegistryError::InvalidProgram)?;
        let signer_seeds: &[&[&[u8]]] = &[&[ATOM_CPI_AUTHORITY_SEED, &[bump]]];

        let cpi_ctx = CpiContext::new_with_signer(
            atom_engine_program.to_account_info(),
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

    let slot = Clock::get()?.slot;
    let leaf = compute_revoke_leaf(&asset, &client, feedback_index, &seal_hash, slot);
    let agent = &mut ctx.accounts.agent_account;
    agent.revoke_digest = chain_hash(&agent.revoke_digest, DOMAIN_REVOKE, &leaf);
    agent.revoke_count += 1;
    emit!(FeedbackRevoked {
        asset,
        client_address: client,
        feedback_index,
        seal_hash,
        slot,
        original_score: revoke_result.original_score,
        atom_enabled: is_atom_initialized,
        had_impact: revoke_result.had_impact,
        new_trust_tier: revoke_result.new_trust_tier,
        new_quality_score: revoke_result.new_quality_score,
        new_confidence: revoke_result.new_confidence,
        new_revoke_digest: agent.revoke_digest,
        new_revoke_count: agent.revoke_count,
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

/// SEAL v1: Client provides seal_hash (the on-chain computed hash from the original feedback)
pub fn append_response(
    ctx: Context<AppendResponse>,
    asset_key: Pubkey,
    client_address: Pubkey,
    feedback_index: u64,
    response_uri: String,
    response_hash: [u8; 32],
    seal_hash: [u8; 32],
) -> Result<()> {
    let responder = ctx.accounts.responder.key();
    let feedback_count = ctx.accounts.agent_account.feedback_count;

    require!(
        feedback_index < feedback_count,
        RegistryError::InvalidFeedbackIndex
    );

    let core_owner = get_core_owner(&ctx.accounts.asset)?;
    let cached_owner = ctx.accounts.agent_account.owner;
    let agent_wallet = ctx.accounts.agent_account.agent_wallet;

    let is_authorized = responder == core_owner ||
        (cached_owner == core_owner &&
         agent_wallet.is_some_and(|wallet| responder == wallet));

    require!(is_authorized, RegistryError::Unauthorized);

    require!(
        response_uri.len() <= MAX_URI_LENGTH,
        RegistryError::ResponseUriTooLong
    );

    let slot = Clock::get()?.slot;
    let leaf = compute_response_leaf(
        &asset_key,
        &client_address,
        feedback_index,
        &responder,
        &response_hash,
        &seal_hash,
        slot,
    );
    let agent = &mut ctx.accounts.agent_account;
    agent.response_digest = chain_hash(&agent.response_digest, DOMAIN_RESPONSE, &leaf);
    agent.response_count += 1;

    emit!(ResponseAppended {
        asset: asset_key,
        client: client_address,
        feedback_index,
        slot,
        responder,
        response_hash,
        seal_hash,
        new_response_digest: agent.response_digest,
        new_response_count: agent.response_count,
        response_uri,
    });

    Ok(())
}
