use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;
use mpl_core::instructions::{
    CreateCollectionV2CpiBuilder, CreateV2CpiBuilder, TransferV1CpiBuilder,
    UpdateV1CpiBuilder,
};

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

/// Initialize the identity registry
///
/// Creates the global RegistryConfig account and the Metaplex Core Collection.
/// All agents will be created as part of this collection.
/// The config PDA is set as collection update_authority for permissionless registration.
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.next_agent_id = 0;
    config.total_agents = 0;
    config.collection = ctx.accounts.collection.key();
    config.bump = ctx.bumps.config;

    // Create Metaplex Core Collection with config PDA as update_authority
    // This allows permissionless registration via invoke_signed
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.authority.to_account_info())
        .update_authority(Some(&config.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name("8004 Agent Registry".to_string())
        .uri(String::new())
        .invoke_signed(&[&[b"config", &[ctx.bumps.config]]])?;

    msg!(
        "Identity Registry initialized with Core collection: {}",
        config.collection
    );
    msg!(
        "Collection update_authority set to config PDA for permissionless registration"
    );

    Ok(())
}

/// Register a new agent with empty URI
pub fn register_empty(ctx: Context<Register>) -> Result<()> {
    register_internal(ctx, String::new())
}

/// Register a new agent with URI
pub fn register(ctx: Context<Register>, agent_uri: String) -> Result<()> {
    register_internal(ctx, agent_uri)
}

/// Internal registration logic (v0.2.0 - no inline metadata)
#[doc(hidden)]
fn register_internal(
    ctx: Context<Register>,
    agent_uri: String,
) -> Result<()> {
    // Validate token URI length
    require!(
        agent_uri.len() <= AgentAccount::MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );

    // Extract values before mutable borrow
    let config_bump = ctx.accounts.config.bump;
    let agent_id = ctx.accounts.config.next_agent_id;
    let collection_key = ctx.accounts.config.collection;

    // Config PDA seeds for signing
    let config_seeds = &[b"config".as_ref(), &[config_bump]];
    let signer_seeds = &[&config_seeds[..]];

    // Create Metaplex Core asset in collection via helper (separate stack frame)
    create_core_asset_cpi(
        &ctx.accounts.mpl_core_program.to_account_info(),
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.collection.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        format!("Agent #{}", agent_id),
        if agent_uri.is_empty() { String::new() } else { agent_uri.clone() },
        signer_seeds,
    )?;

    // Now update config (after CPI is done)
    let config = &mut ctx.accounts.config;

    // Increment counters with overflow protection
    config.next_agent_id = config
        .next_agent_id
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    config.total_agents = config
        .total_agents
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    // Initialize agent account (v0.2.0 - no inline metadata)
    let agent = &mut ctx.accounts.agent_account;
    agent.agent_id = agent_id;
    agent.owner = ctx.accounts.owner.key();
    agent.asset = ctx.accounts.asset.key();
    agent.agent_uri = agent_uri.clone();
    agent.nft_name = format!("Agent #{}", agent_id);
    agent.nft_symbol = String::new();
    agent.created_at = Clock::get()?.unix_timestamp;
    agent.bump = ctx.bumps.agent_account;

    // Emit registration event
    emit!(Registered {
        agent_id,
        agent_uri,
        owner: ctx.accounts.owner.key(),
        asset: ctx.accounts.asset.key(),
    });

    msg!(
        "Agent {} registered with Core asset {} in collection {}",
        agent_id,
        agent.asset,
        collection_key
    );

    Ok(())
}

/// Set metadata as individual PDA (v0.2.0)
///
/// Creates a new MetadataEntryPda if it doesn't exist.
/// Updates existing entry if not immutable.
/// key_hash is first 8 bytes of SHA256(key) for PDA derivation.
/// F-05: Validates key_hash matches SHA256(key) to prevent PDA manipulation
pub fn set_metadata_pda(
    ctx: Context<SetMetadataPda>,
    key_hash: [u8; 8],
    key: String,
    value: Vec<u8>,
    immutable: bool,
) -> Result<()> {
    // F-05: Verify key_hash matches SHA256(key)[0..8]
    use anchor_lang::solana_program::hash::hash;
    let computed_hash = hash(key.as_bytes());
    let expected: [u8; 8] = computed_hash.to_bytes()[0..8]
        .try_into()
        .expect("hash is 32 bytes");
    require!(key_hash == expected, RegistryError::KeyHashMismatch);

    // Verify ownership via Core asset
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    // Validate key length
    require!(
        key.len() <= MetadataEntryPda::MAX_KEY_LENGTH,
        RegistryError::KeyTooLong
    );

    // Validate value length
    require!(
        value.len() <= MetadataEntryPda::MAX_VALUE_LENGTH,
        RegistryError::ValueTooLong
    );

    let entry = &mut ctx.accounts.metadata_entry;
    let agent_id = ctx.accounts.agent_account.agent_id;

    // A-06: Check for key_hash collision (different keys with same hash)
    // If entry exists, stored key must match provided key
    if entry.created_at > 0 {
        require!(
            entry.metadata_key == key,
            RegistryError::KeyHashCollision
        );

        // Check if immutable (only after collision check)
        if entry.immutable {
            return Err(RegistryError::MetadataImmutable.into());
        }
    }

    // Set or update entry
    let is_new = entry.created_at == 0;
    entry.agent_id = agent_id;
    entry.metadata_key = key.clone();
    entry.metadata_value = value.clone();
    entry.immutable = immutable;
    if is_new {
        entry.created_at = Clock::get()?.unix_timestamp;
        entry.bump = ctx.bumps.metadata_entry;
    }

    // Emit event (value truncated to 64 bytes to reduce stack usage)
    let truncated_value = if value.len() > 64 {
        value[..64].to_vec()
    } else {
        value
    };
    emit!(MetadataSet {
        agent_id,
        key: key.clone(),
        value: truncated_value,
        immutable,
    });

    msg!(
        "Metadata '{}' set for agent {} (immutable: {})",
        key,
        agent_id,
        immutable
    );

    Ok(())
}

/// Delete metadata PDA and recover rent (v0.2.0)
///
/// Only works if metadata is not immutable.
/// Rent is returned to the owner.
pub fn delete_metadata_pda(
    ctx: Context<DeleteMetadataPda>,
    _key_hash: [u8; 8],
) -> Result<()> {
    // Verify ownership via Core asset
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    let entry = &ctx.accounts.metadata_entry;
    let agent_id = ctx.accounts.agent_account.agent_id;
    let key = entry.metadata_key.clone();

    // Check if immutable
    require!(!entry.immutable, RegistryError::MetadataImmutable);

    // Emit event before closing
    emit!(MetadataDeleted {
        agent_id,
        key: key.clone(),
    });

    msg!("Metadata '{}' deleted for agent {}, rent recovered", key, agent_id);

    // Account is closed automatically via close = owner constraint
    Ok(())
}

/// Set agent URI
pub fn set_agent_uri(ctx: Context<SetAgentUri>, new_uri: String) -> Result<()> {
    // Verify ownership via Core asset
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    // Validate URI length
    require!(
        new_uri.len() <= AgentAccount::MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );

    // Get agent_id before CPI to reduce stack usage during mpl-core call
    let agent_id = ctx.accounts.agent_account.agent_id;

    // Config PDA seeds for signing (collection update_authority is config PDA)
    let config_bump = ctx.accounts.config.bump;
    let config_seeds = &[b"config".as_ref(), &[config_bump]];
    let signer_seeds = &[&config_seeds[..]];

    // Update Core asset URI via helper (separate stack frame)
    update_core_asset_uri_cpi(
        &ctx.accounts.mpl_core_program.to_account_info(),
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.collection.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        new_uri.clone(),
        signer_seeds,
    )?;

    // CPI done, stack freed - now update AgentAccount
    let agent = &mut ctx.accounts.agent_account;
    agent.agent_uri = new_uri.clone();

    // Emit event (move ownership, no clone needed)
    emit!(UriUpdated {
        agent_id,
        new_uri,
        updated_by: ctx.accounts.owner.key(),
    });

    msg!(
        "Agent {} URI updated in AgentAccount and Core asset synced",
        agent_id
    );

    Ok(())
}

/// Sync agent owner from Core asset
pub fn sync_owner(ctx: Context<SyncOwner>) -> Result<()> {
    let agent = &mut ctx.accounts.agent_account;

    // Get current owner from Core asset
    let new_owner = get_core_owner(&ctx.accounts.asset)?;

    let old_owner = agent.owner;

    // Update cached owner
    agent.owner = new_owner;

    // Emit event
    emit!(AgentOwnerSynced {
        agent_id: agent.agent_id,
        old_owner,
        new_owner,
        asset: agent.asset,
    });

    msg!(
        "Agent {} owner synced: {} -> {}",
        agent.agent_id,
        old_owner,
        new_owner
    );

    Ok(())
}

/// Get agent owner
pub fn owner_of(ctx: Context<OwnerOf>) -> Result<Pubkey> {
    Ok(ctx.accounts.agent_account.owner)
}

/// Transfer agent with automatic owner sync
pub fn transfer_agent(ctx: Context<TransferAgent>) -> Result<()> {
    // Verify current ownership
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    // Prevent self-transfer
    require!(
        ctx.accounts.owner.key() != ctx.accounts.new_owner.key(),
        RegistryError::TransferToSelf
    );

    let old_owner = ctx.accounts.owner.key();
    let new_owner = ctx.accounts.new_owner.key();

    // Transfer Core asset
    TransferV1CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .payer(&ctx.accounts.owner.to_account_info())
        .authority(Some(&ctx.accounts.owner.to_account_info()))
        .new_owner(&ctx.accounts.new_owner.to_account_info())
        .invoke()?;

    // Update cached owner
    let agent = &mut ctx.accounts.agent_account;
    agent.owner = new_owner;

    emit!(AgentOwnerSynced {
        agent_id: agent.agent_id,
        old_owner,
        new_owner,
        asset: agent.asset,
    });

    msg!(
        "Agent {} transferred: {} -> {}",
        agent.agent_id,
        old_owner,
        new_owner
    );

    Ok(())
}

// ============================================================================
// Helper functions
// ============================================================================

/// Create Core asset via CPI in separate stack frame
///
/// Using #[inline(never)] to force a separate stack frame for mpl-core CPI.
/// Note: mpl-core v0.11.1 has an internal stack overflow warning in
/// registry_records_to_plugin_list - this is in the library, not our code.
#[inline(never)]
fn create_core_asset_cpi<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    name: String,
    uri: String,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    CreateV2CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(payer)
        .owner(Some(owner))
        .authority(Some(authority))
        .system_program(system_program)
        .name(name)
        .uri(uri)
        .invoke_signed(signer_seeds)?;
    Ok(())
}

/// Update Core asset URI via CPI in separate stack frame
#[inline(never)]
fn update_core_asset_uri_cpi<'info>(
    mpl_core_program: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    new_uri: String,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    UpdateV1CpiBuilder::new(mpl_core_program)
        .asset(asset)
        .collection(Some(collection))
        .payer(payer)
        .authority(Some(authority))
        .system_program(system_program)
        .new_uri(new_uri)
        .invoke_signed(signer_seeds)?;
    Ok(())
}

/// Verify that the signer owns the Core asset
fn verify_core_owner(asset_info: &AccountInfo, expected_owner: &Pubkey) -> Result<()> {
    let actual_owner = get_core_owner(asset_info)?;
    require!(
        actual_owner == *expected_owner,
        RegistryError::Unauthorized
    );
    Ok(())
}

/// Get owner from Core asset account data
/// Uses official mpl-core deserialization (no manual byte parsing)
fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    // F-06: Verify this is actually a Metaplex Core asset
    require!(
        *asset_info.owner == mpl_core::ID,
        RegistryError::InvalidAsset
    );

    // Use official mpl-core deserialization
    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data)
        .map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}
