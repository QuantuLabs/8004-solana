use anchor_lang::prelude::*;
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

    // Create agent name early
    let agent_name = format!("Agent #{}", agent_id);
    let metadata_uri = if agent_uri.is_empty() {
        String::new()
    } else {
        agent_uri.clone()
    };

    // Config PDA seeds for signing
    let config_seeds = &[b"config".as_ref(), &[config_bump]];
    let signer_seeds = &[&config_seeds[..]];

    // Create Metaplex Core asset in collection
    // Config PDA is the collection's update_authority, so it signs via invoke_signed
    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .payer(&ctx.accounts.owner.to_account_info())
        .owner(Some(&ctx.accounts.owner.to_account_info()))
        .authority(Some(&ctx.accounts.config.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(agent_name.clone())
        .uri(metadata_uri)
        .invoke_signed(signer_seeds)?;

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
    agent.nft_name = agent_name;
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
pub fn set_metadata_pda(
    ctx: Context<SetMetadataPda>,
    _key_hash: [u8; 8],
    key: String,
    value: Vec<u8>,
    immutable: bool,
) -> Result<()> {
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

    // Check if entry already exists and is immutable
    if entry.created_at > 0 && entry.immutable {
        return Err(RegistryError::MetadataImmutable.into());
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

    // Emit event
    emit!(MetadataSet {
        agent_id,
        indexed_key: key.clone(),
        key: key.clone(),
        value,
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

    let agent = &mut ctx.accounts.agent_account;

    // Update AgentAccount URI
    agent.agent_uri = new_uri.clone();

    // Config PDA seeds for signing (collection update_authority is config PDA)
    let config_bump = ctx.accounts.config.bump;
    let config_seeds = &[b"config".as_ref(), &[config_bump]];
    let signer_seeds = &[&config_seeds[..]];

    // Update Core asset URI (config PDA signs as collection update_authority)
    UpdateV1CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .payer(&ctx.accounts.owner.to_account_info())
        .authority(Some(&ctx.accounts.config.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .new_uri(new_uri.clone())
        .invoke_signed(signer_seeds)?;

    // Emit event
    emit!(UriUpdated {
        agent_id: agent.agent_id,
        new_uri: new_uri.clone(),
        updated_by: ctx.accounts.owner.key(),
    });

    msg!(
        "Agent {} URI updated in AgentAccount and Core asset synced",
        agent.agent_id
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
fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    let data = asset_info.try_borrow_data()?;

    // Core asset layout: discriminator (1 byte) + update_authority (33 bytes) + owner (32 bytes)
    // Skip: Key (1) + UpdateAuthority (1 + 32) = 34 bytes, then owner is next 32 bytes
    // Actually, for BaseAssetV1:
    // - Key: 1 byte (discriminator)
    // - Owner: 32 bytes (at offset 1)
    // - UpdateAuthority: 33 bytes (enum variant + optional pubkey)
    // Let's read owner at offset 1
    if data.len() < 33 {
        return Err(RegistryError::InvalidAsset.into());
    }

    let owner_bytes: [u8; 32] = data[1..33]
        .try_into()
        .map_err(|_| RegistryError::InvalidAsset)?;

    Ok(Pubkey::new_from_array(owner_bytes))
}
