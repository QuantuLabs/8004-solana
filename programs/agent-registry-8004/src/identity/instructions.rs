use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use mpl_core::accounts::BaseAssetV1;
use mpl_core::instructions::{
    CreateCollectionV2CpiBuilder, CreateV2CpiBuilder, TransferV1CpiBuilder,
    UpdateCollectionV1CpiBuilder, UpdateV1CpiBuilder,
};

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::error::RegistryError;

/// Maximum deadline window: 5 minutes (300 seconds)
const MAX_DEADLINE_WINDOW: i64 = 300;

/// Message prefix for wallet set signature
const WALLET_SET_MESSAGE_PREFIX: &[u8] = b"8004_WALLET_SET:";

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
/// Note: "agentWallet" is a reserved key - use set_agent_wallet instruction instead
pub fn set_metadata_pda(
    ctx: Context<SetMetadataPda>,
    key_hash: [u8; 8],
    key: String,
    value: Vec<u8>,
    immutable: bool,
) -> Result<()> {
    // Block reserved metadata key "agentWallet" - must use set_agent_wallet instruction
    require!(
        key != "agentWallet",
        RegistryError::ReservedMetadataKey
    );

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
/// Updated for multi-collection architecture
/// Supports both base registries and user registries
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

    // Determine authority based on registry type
    let is_user_registry = ctx.accounts.registry_config.registry_type == RegistryType::User;

    if is_user_registry {
        // User registry: use user_collection_authority PDA
        let user_auth = ctx
            .accounts
            .user_collection_authority
            .as_ref()
            .ok_or(RegistryError::Unauthorized)?;

        let user_auth_bump = ctx.bumps.user_collection_authority.unwrap();
        let signer_seeds: &[&[&[u8]]] = &[&[b"user_collection_authority", &[user_auth_bump]]];

        update_core_asset_uri_cpi(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &user_auth.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            new_uri.clone(),
            signer_seeds,
        )?;
    } else {
        // Base registry: use registry_config PDA as authority
        let collection_key = ctx.accounts.collection.key();
        let registry_bump = ctx.accounts.registry_config.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"registry_config",
            collection_key.as_ref(),
            &[registry_bump],
        ]];

        update_core_asset_uri_cpi(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &ctx.accounts.registry_config.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            new_uri.clone(),
            signer_seeds,
        )?;
    }

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
/// If wallet_metadata PDA is provided, it will be closed (reset wallet on transfer)
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
    let agent_id = ctx.accounts.agent_account.agent_id;

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

    // If wallet_metadata was provided, it's been closed by Anchor (close = owner)
    // Emit WalletUpdated event to indicate wallet was reset
    if ctx.accounts.wallet_metadata.is_some() {
        // Get the old wallet from the PDA before it was closed
        // Note: The PDA is closed after this instruction, but we can still read it here
        let old_wallet = ctx.accounts.wallet_metadata.as_ref().and_then(|pda| {
            if pda.metadata_value.len() == 32 {
                Some(Pubkey::try_from(&pda.metadata_value[..]).unwrap())
            } else {
                None
            }
        });

        emit!(WalletUpdated {
            agent_id,
            old_wallet,
            new_wallet: Pubkey::default(), // Zero address = no wallet
            updated_by: old_owner,
        });

        msg!(
            "Agent {} wallet reset on transfer (PDA closed, rent returned to {})",
            agent_id,
            old_owner
        );
    }

    emit!(AgentOwnerSynced {
        agent_id,
        old_owner,
        new_owner,
        asset: agent.asset,
    });

    msg!(
        "Agent {} transferred: {} -> {}",
        agent_id,
        old_owner,
        new_owner
    );

    Ok(())
}

/// Set agent wallet with Ed25519 signature verification
///
/// The wallet owner must sign a message off-chain proving they control the wallet.
/// This transaction must include an Ed25519Program verify instruction before this one.
///
/// Message format: "8004_WALLET_SET:" || agent_id (8 bytes LE) || new_wallet (32 bytes) || owner (32 bytes) || deadline (8 bytes LE)
pub fn set_agent_wallet(
    ctx: Context<SetAgentWallet>,
    new_wallet: Pubkey,
    deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    let agent = &ctx.accounts.agent_account;

    // 1. Verify caller is Core asset owner
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    // 2. Verify deadline is not expired
    require!(
        clock.unix_timestamp <= deadline,
        RegistryError::DeadlineExpired
    );

    // 3. Verify deadline is not too far in the future (max 5 minutes)
    require!(
        deadline <= clock.unix_timestamp + MAX_DEADLINE_WINDOW,
        RegistryError::DeadlineTooFar
    );

    // 4. Build expected message and verify Ed25519 signature
    let expected_message = build_wallet_set_message(
        agent.agent_id,
        new_wallet,
        ctx.accounts.owner.key(),
        deadline,
    );
    verify_ed25519_signature(
        &ctx.accounts.instructions_sysvar,
        new_wallet,
        &expected_message,
    )?;

    // 5. Store wallet in MetadataEntryPda
    let wallet_pda = &mut ctx.accounts.wallet_metadata;
    let old_wallet = if wallet_pda.metadata_value.len() == 32 {
        Some(Pubkey::try_from(&wallet_pda.metadata_value[..]).unwrap())
    } else {
        None
    };

    // Initialize or update the PDA
    let is_new = wallet_pda.created_at == 0;
    wallet_pda.agent_id = agent.agent_id;
    wallet_pda.metadata_key = "agentWallet".to_string();
    wallet_pda.metadata_value = new_wallet.to_bytes().to_vec();
    wallet_pda.immutable = false; // Wallet can be updated via this instruction
    if is_new {
        wallet_pda.created_at = clock.unix_timestamp;
        wallet_pda.bump = ctx.bumps.wallet_metadata;
    }

    // 6. Emit event
    emit!(WalletUpdated {
        agent_id: agent.agent_id,
        old_wallet,
        new_wallet,
        updated_by: ctx.accounts.owner.key(),
    });

    msg!(
        "Agent {} wallet set to {} (verified via Ed25519 signature)",
        agent.agent_id,
        new_wallet
    );

    Ok(())
}

// ============================================================================
// Helper functions
// ============================================================================

/// Build the message that wallet owner must sign for set_agent_wallet
/// Format: "8004_WALLET_SET:" || agent_id (8 bytes LE) || new_wallet (32 bytes) || owner (32 bytes) || deadline (8 bytes LE)
fn build_wallet_set_message(
    agent_id: u64,
    new_wallet: Pubkey,
    owner: Pubkey,
    deadline: i64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(WALLET_SET_MESSAGE_PREFIX.len() + 8 + 32 + 32 + 8);
    message.extend_from_slice(WALLET_SET_MESSAGE_PREFIX);
    message.extend_from_slice(&agent_id.to_le_bytes());
    message.extend_from_slice(new_wallet.as_ref());
    message.extend_from_slice(owner.as_ref());
    message.extend_from_slice(&deadline.to_le_bytes());
    message
}

/// Verify Ed25519 signature via sysvar introspection
///
/// Checks that an Ed25519Program instruction exists before the current instruction
/// and that it verifies a signature from expected_signer on expected_message.
fn verify_ed25519_signature(
    instructions_sysvar: &AccountInfo,
    expected_signer: Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_idx = load_current_index_checked(instructions_sysvar)
        .map_err(|_| RegistryError::MissingSignatureVerification)?;

    // Look for Ed25519Program instruction before current
    for idx in 0..current_idx {
        let ix = load_instruction_at_checked(idx as usize, instructions_sysvar)
            .map_err(|_| RegistryError::MissingSignatureVerification)?;

        if ix.program_id == ed25519_program::ID {
            // Parse Ed25519 instruction data
            // Format: num_signatures (1) + padding (1) + signature_offset (2) + signature_instruction_index (2) +
            //         public_key_offset (2) + public_key_instruction_index (2) + message_data_offset (2) +
            //         message_data_size (2) + message_instruction_index (2) + [signature (64)] + [pubkey (32)] + [message]
            if ix.data.len() < 16 {
                continue;
            }

            let num_signatures = ix.data[0];
            if num_signatures != 1 {
                continue;
            }

            // Extract offsets (little-endian u16)
            let signature_offset = u16::from_le_bytes([ix.data[2], ix.data[3]]) as usize;
            let pubkey_offset = u16::from_le_bytes([ix.data[6], ix.data[7]]) as usize;
            let message_offset = u16::from_le_bytes([ix.data[10], ix.data[11]]) as usize;
            let message_size = u16::from_le_bytes([ix.data[12], ix.data[13]]) as usize;

            // Validate bounds
            if pubkey_offset + 32 > ix.data.len()
                || message_offset + message_size > ix.data.len()
                || signature_offset + 64 > ix.data.len()
            {
                continue;
            }

            // Extract and verify public key
            let pubkey_bytes: [u8; 32] = ix.data[pubkey_offset..pubkey_offset + 32]
                .try_into()
                .unwrap();
            let signer = Pubkey::from(pubkey_bytes);

            if signer != expected_signer {
                continue;
            }

            // Extract and verify message
            let message = &ix.data[message_offset..message_offset + message_size];

            if message != expected_message {
                continue;
            }

            // Ed25519Program verifies the signature, we just checked the params match
            return Ok(());
        }
    }

    Err(RegistryError::MissingSignatureVerification.into())
}

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

// ============================================================================
// Scalability: Multi-Collection Sharding Instructions
// ============================================================================

/// Initialize the root config and first base registry
///
/// Creates RootConfig (global pointer) and first RegistryConfig (base #0).
/// Sets up the first Metaplex Core collection for agent registration.
/// Only upgrade authority can call this (prevents front-running).
pub fn initialize_root(ctx: Context<InitializeRoot>) -> Result<()> {
    let root = &mut ctx.accounts.root_config;
    let registry = &mut ctx.accounts.registry_config;

    // Initialize root config
    root.authority = ctx.accounts.authority.key();
    root.base_registry_count = 1;
    root.bump = ctx.bumps.root_config;

    // Initialize first base registry
    registry.collection = ctx.accounts.collection.key();
    registry.registry_type = RegistryType::Base;
    registry.authority = ctx.accounts.authority.key();
    registry.next_agent_id = 0;
    registry.total_agents = 0;
    registry.base_index = 0;
    registry.bump = ctx.bumps.registry_config;

    // Set current_base_registry to this registry's PDA
    let (registry_pda, _) = Pubkey::find_program_address(
        &[b"registry_config", ctx.accounts.collection.key().as_ref()],
        &crate::ID,
    );
    root.current_base_registry = registry_pda;

    // Create Metaplex Core Collection with registry config PDA as update_authority
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.authority.to_account_info())
        .update_authority(Some(&registry.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name("8004 Base Registry #0".to_string())
        .uri(String::new())
        .invoke_signed(&[&[
            b"registry_config",
            ctx.accounts.collection.key().as_ref(),
            &[ctx.bumps.registry_config],
        ]])?;

    emit!(BaseRegistryCreated {
        registry: registry_pda,
        collection: ctx.accounts.collection.key(),
        base_index: 0,
        created_by: ctx.accounts.authority.key(),
    });

    msg!(
        "Root config initialized with base registry #0: {}",
        registry_pda
    );

    Ok(())
}

/// Create a new base registry (authority only)
///
/// Creates a new Metaplex Core collection and RegistryConfig.
/// Does NOT automatically rotate - use rotate_base_registry for that.
pub fn create_base_registry(ctx: Context<CreateBaseRegistry>) -> Result<()> {
    let root = &mut ctx.accounts.root_config;
    let registry = &mut ctx.accounts.registry_config;

    let new_base_index = root.base_registry_count;

    // Initialize registry config
    registry.collection = ctx.accounts.collection.key();
    registry.registry_type = RegistryType::Base;
    registry.authority = ctx.accounts.authority.key();
    registry.next_agent_id = 0;
    registry.total_agents = 0;
    registry.base_index = new_base_index;
    registry.bump = ctx.bumps.registry_config;

    // Increment base registry count
    root.base_registry_count = root
        .base_registry_count
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    // Create Metaplex Core Collection with registry config PDA as update_authority
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.authority.to_account_info())
        .update_authority(Some(&registry.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(format!("8004 Base Registry #{}", new_base_index))
        .uri(String::new())
        .invoke_signed(&[&[
            b"registry_config",
            ctx.accounts.collection.key().as_ref(),
            &[ctx.bumps.registry_config],
        ]])?;

    let (registry_pda, _) = Pubkey::find_program_address(
        &[b"registry_config", ctx.accounts.collection.key().as_ref()],
        &crate::ID,
    );

    emit!(BaseRegistryCreated {
        registry: registry_pda,
        collection: ctx.accounts.collection.key(),
        base_index: new_base_index,
        created_by: ctx.accounts.authority.key(),
    });

    msg!(
        "Base registry #{} created: {}",
        new_base_index,
        registry_pda
    );

    Ok(())
}

/// Rotate to a new base registry (authority only)
///
/// Updates RootConfig.current_base_registry to point to a new registry.
/// The new registry must already exist and be of type Base.
pub fn rotate_base_registry(ctx: Context<RotateBaseRegistry>) -> Result<()> {
    let root = &mut ctx.accounts.root_config;

    let old_registry = root.current_base_registry;
    let (new_registry_pda, _) = Pubkey::find_program_address(
        &[
            b"registry_config",
            ctx.accounts.new_registry.collection.as_ref(),
        ],
        &crate::ID,
    );

    root.current_base_registry = new_registry_pda;

    emit!(BaseRegistryRotated {
        old_registry,
        new_registry: new_registry_pda,
        rotated_by: ctx.accounts.authority.key(),
    });

    msg!(
        "Base registry rotated: {} -> {}",
        old_registry,
        new_registry_pda
    );

    Ok(())
}

// ============================================================================
// User Registry Instructions
// ============================================================================

/// Maximum collection name length
const MAX_COLLECTION_NAME_LENGTH: usize = 32;

/// Maximum collection URI length
const MAX_COLLECTION_URI_LENGTH: usize = 200;

/// Create a user registry (anyone can create their own shard)
///
/// The program PDA is the collection authority, not the user.
/// This prevents users from directly modifying/deleting assets.
/// Users can update collection metadata via update_user_registry_metadata.
pub fn create_user_registry(
    ctx: Context<CreateUserRegistry>,
    collection_name: String,
    collection_uri: String,
) -> Result<()> {
    // Validate collection name length
    require!(
        collection_name.len() <= MAX_COLLECTION_NAME_LENGTH,
        RegistryError::CollectionNameTooLong
    );

    // Validate collection URI length
    require!(
        collection_uri.len() <= MAX_COLLECTION_URI_LENGTH,
        RegistryError::CollectionUriTooLong
    );

    let registry = &mut ctx.accounts.registry_config;

    // Initialize user registry config
    registry.collection = ctx.accounts.collection.key();
    registry.registry_type = RegistryType::User;
    registry.authority = ctx.accounts.owner.key(); // User is registry owner
    registry.next_agent_id = 0;
    registry.total_agents = 0;
    registry.base_index = 0; // Not used for user registries
    registry.bump = ctx.bumps.registry_config;

    // Create Metaplex Core Collection with program PDA as authority
    // This prevents users from directly modifying the collection
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.owner.to_account_info())
        .update_authority(Some(&ctx.accounts.collection_authority.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(collection_name)
        .uri(collection_uri)
        .invoke_signed(&[&[
            b"user_collection_authority",
            &[ctx.bumps.collection_authority],
        ]])?;

    let (registry_pda, _) = Pubkey::find_program_address(
        &[b"registry_config", ctx.accounts.collection.key().as_ref()],
        &crate::ID,
    );

    emit!(UserRegistryCreated {
        registry: registry_pda,
        collection: ctx.accounts.collection.key(),
        owner: ctx.accounts.owner.key(),
    });

    msg!(
        "User registry created: {} by {}",
        registry_pda,
        ctx.accounts.owner.key()
    );

    Ok(())
}

/// Update user registry collection metadata (owner only)
///
/// Allows the registry owner to update collection name and/or URI.
/// Program PDA signs as collection authority.
pub fn update_user_registry_metadata(
    ctx: Context<UpdateUserRegistryMetadata>,
    new_name: Option<String>,
    new_uri: Option<String>,
) -> Result<()> {
    // Validate new name length if provided
    if let Some(ref name) = new_name {
        require!(
            name.len() <= MAX_COLLECTION_NAME_LENGTH,
            RegistryError::CollectionNameTooLong
        );
    }

    // Validate new URI length if provided
    if let Some(ref uri) = new_uri {
        require!(
            uri.len() <= MAX_COLLECTION_URI_LENGTH,
            RegistryError::CollectionUriTooLong
        );
    }

    // Update collection via Metaplex Core (use UpdateCollectionV1, not UpdateV1)
    // Use let bindings to extend lifetimes of AccountInfo temporaries
    let mpl_core_info = ctx.accounts.mpl_core_program.to_account_info();
    let collection_info = ctx.accounts.collection.to_account_info();
    let owner_info = ctx.accounts.owner.to_account_info();
    let authority_info = ctx.accounts.collection_authority.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();

    let mut builder = UpdateCollectionV1CpiBuilder::new(&mpl_core_info);
    builder
        .collection(&collection_info)
        .payer(&owner_info)
        .authority(Some(&authority_info))
        .system_program(&system_info);

    if let Some(name) = new_name {
        builder.new_name(name);
    }

    if let Some(uri) = new_uri {
        builder.new_uri(uri);
    }

    builder.invoke_signed(&[&[
        b"user_collection_authority",
        &[ctx.bumps.collection_authority],
    ]])?;

    msg!(
        "User registry metadata updated: {}",
        ctx.accounts.registry_config.collection
    );

    Ok(())
}

/// Register agent in a specific registry (base or user)
///
/// For base registries: registry_config PDA is the collection authority
/// For user registries: user_collection_authority PDA is the collection authority
pub fn register_agent_in_registry(
    ctx: Context<RegisterAgentInRegistry>,
    agent_uri: String,
) -> Result<()> {
    // Validate URI length
    require!(
        agent_uri.len() <= AgentAccount::MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );

    let registry = &mut ctx.accounts.registry_config;
    let agent_id = registry.next_agent_id;

    // Determine which authority to use based on registry type
    let is_user_registry = registry.registry_type == RegistryType::User;

    // Create Core asset with appropriate authority
    if is_user_registry {
        // User registry: use user_collection_authority PDA
        let user_auth = ctx
            .accounts
            .user_collection_authority
            .as_ref()
            .ok_or(RegistryError::Unauthorized)?;

        create_core_asset_cpi(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &user_auth.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            format!("Agent #{}", agent_id),
            if agent_uri.is_empty() {
                String::new()
            } else {
                agent_uri.clone()
            },
            &[&[
                b"user_collection_authority",
                &[ctx.bumps.user_collection_authority.unwrap()],
            ]],
        )?;
    } else {
        // Base registry: use registry_config PDA as authority
        create_core_asset_cpi(
            &ctx.accounts.mpl_core_program.to_account_info(),
            &ctx.accounts.asset.to_account_info(),
            &ctx.accounts.collection.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &registry.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            format!("Agent #{}", agent_id),
            if agent_uri.is_empty() {
                String::new()
            } else {
                agent_uri.clone()
            },
            &[&[
                b"registry_config",
                ctx.accounts.collection.key().as_ref(),
                &[registry.bump],
            ]],
        )?;
    }

    // Increment counters
    registry.next_agent_id = registry
        .next_agent_id
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    registry.total_agents = registry
        .total_agents
        .checked_add(1)
        .ok_or(RegistryError::Overflow)?;

    // Initialize agent account
    let agent = &mut ctx.accounts.agent_account;
    agent.agent_id = agent_id;
    agent.owner = ctx.accounts.owner.key();
    agent.asset = ctx.accounts.asset.key();
    agent.agent_uri = agent_uri;
    agent.nft_name = format!("Agent #{}", agent_id);
    agent.nft_symbol = String::new();
    agent.created_at = Clock::get()?.unix_timestamp;
    agent.bump = ctx.bumps.agent_account;

    let (registry_pda, _) = Pubkey::find_program_address(
        &[b"registry_config", ctx.accounts.collection.key().as_ref()],
        &crate::ID,
    );

    emit!(AgentRegisteredInRegistry {
        asset: ctx.accounts.asset.key(),
        registry: registry_pda,
        collection: ctx.accounts.collection.key(),
        local_agent_id: agent_id,
        owner: ctx.accounts.owner.key(),
    });

    msg!(
        "Agent {} registered in registry {} (collection {})",
        agent_id,
        registry_pda,
        ctx.accounts.collection.key()
    );

    Ok(())
}
