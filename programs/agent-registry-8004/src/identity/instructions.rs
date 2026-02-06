use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use mpl_core::accounts::BaseAssetV1;
use mpl_core::instructions::{
    CreateCollectionV2CpiBuilder, CreateV2CpiBuilder, TransferV1CpiBuilder,
    UpdateV1CpiBuilder,
};

use super::contexts::*;
use super::events::*;
use super::state::*;
use crate::constants::*;
use crate::error::RegistryError;

/// Maximum deadline window: 5 minutes (300 seconds)
const MAX_DEADLINE_WINDOW: i64 = 300;

/// Message prefix for wallet set signature
const WALLET_SET_MESSAGE_PREFIX: &[u8] = b"8004_WALLET_SET:";

/// Set metadata as individual PDA
///
/// Creates a new MetadataEntryPda if it doesn't exist.
/// Updates existing entry if not immutable.
/// key_hash is SHA256(key)[0..16] for collision resistance (2^128 space)
/// Note: "agentWallet" is a reserved key - use set_agent_wallet instruction instead
pub fn set_metadata_pda(
    ctx: Context<SetMetadataPda>,
    key_hash: [u8; 16],
    key: String,
    value: Vec<u8>,
    immutable: bool,
) -> Result<()> {
    // Block reserved metadata key "agentWallet" - must use set_agent_wallet instruction
    require!(key != "agentWallet", RegistryError::ReservedMetadataKey);

    // Verify key_hash matches SHA256(key)[0..16]
    use anchor_lang::solana_program::hash::hash;
    let computed_hash = hash(key.as_bytes());
    let expected: [u8; 16] = computed_hash.to_bytes()[0..16]
        .try_into()
        .map_err(|_| RegistryError::Overflow)?;
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

    let asset = ctx.accounts.asset.key();
    let is_new = ctx.accounts.metadata_entry.asset == Pubkey::default();

    // Check for key_hash collision and immutability (existing entries only)
    if !is_new {
        require!(
            ctx.accounts.metadata_entry.metadata_key == key,
            RegistryError::KeyHashCollision
        );

        if ctx.accounts.metadata_entry.immutable {
            return Err(RegistryError::MetadataImmutable.into());
        }
    }

    // Set or update entry
    let entry = &mut ctx.accounts.metadata_entry;
    entry.asset = asset;
    entry.metadata_key = key.clone();
    entry.metadata_value = value.clone();
    entry.immutable = immutable;
    if is_new {
        entry.bump = ctx.bumps.metadata_entry;
    }

    // Emit event with full value (max 250 bytes, validated above)
    emit!(MetadataSet {
        asset,
        immutable,
        key: key.clone(),
        value,
    });

    msg!("Metadata '{}' set for asset {} (immutable: {})", key, asset, immutable);

    Ok(())
}

/// Delete metadata PDA and recover rent
///
/// Only works if metadata is not immutable.
pub fn delete_metadata_pda(ctx: Context<DeleteMetadataPda>, _key_hash: [u8; 16]) -> Result<()> {
    // Verify ownership via Core asset
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    let entry = &ctx.accounts.metadata_entry;
    let asset = ctx.accounts.asset.key();
    let key = entry.metadata_key.clone();

    // Check if immutable
    require!(!entry.immutable, RegistryError::MetadataImmutable);

    // Emit event before closing
    emit!(MetadataDeleted { asset, key: key.clone() });

    msg!("Metadata '{}' deleted for asset {}, rent recovered", key, asset);

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

    let asset = ctx.accounts.asset.key();
    let collection_key = ctx.accounts.collection.key();
    let registry_bump = ctx.accounts.registry_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        SEED_REGISTRY_CONFIG,
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

    // Update AgentAccount
    let agent = &mut ctx.accounts.agent_account;
    agent.agent_uri = new_uri.clone();

    emit!(UriUpdated {
        asset,
        updated_by: ctx.accounts.owner.key(),
        new_uri,
    });

    msg!("Agent URI updated for asset {}", asset);

    Ok(())
}

/// Sync agent owner from Core asset
/// Automatically resets agent_wallet when ownership changes (security feature)
/// Use case: After marketplace transfer, new owner calls this to sync + reset wallet
pub fn sync_owner(ctx: Context<SyncOwner>) -> Result<()> {
    let agent = &mut ctx.accounts.agent_account;
    let new_owner = get_core_owner(&ctx.accounts.asset)?;
    let old_owner = agent.owner;
    let asset = agent.asset;

    // Only update if owner changed
    if old_owner != new_owner {
        agent.owner = new_owner;

        // Reset wallet on ownership change (security: prevents old owner's wallet from being used)
        let old_wallet = agent.agent_wallet;
        if old_wallet.is_some() {
            agent.agent_wallet = None;
            emit!(WalletUpdated {
                asset,
                old_wallet,
                new_wallet: Pubkey::default(),
                updated_by: new_owner,
            });
        }

        emit!(AgentOwnerSynced {
            asset,
            old_owner,
            new_owner,
        });

        msg!("Agent owner synced for asset {}: {} -> {} (wallet reset)", asset, old_owner, new_owner);
    } else {
        msg!("Agent owner unchanged for asset {}", asset);
    }

    Ok(())
}

/// Get agent owner (CACHED value - may be stale after external transfer)
///
/// WARNING: This returns the cached owner from AgentAccount, not the live Core owner.
/// After an external NFT transfer (via Metaplex Core directly), this value becomes stale
/// until sync_owner is called. For authoritative ownership, read the Core asset directly.
///
/// Use cases:
/// - Quick lookup when staleness is acceptable
/// - UI display (with note about potential staleness)
///
/// For authoritative ownership verification, use verify_core_owner() or read Core asset.
pub fn owner_of(ctx: Context<OwnerOf>) -> Result<Pubkey> {
    Ok(ctx.accounts.agent_account.owner)
}

/// Get authoritative Core owner (reads directly from Metaplex Core asset)
///
/// This always returns the current owner regardless of cache state.
/// Use this when authoritative ownership is required.
pub fn core_owner_of(ctx: Context<CoreOwnerOf>) -> Result<Pubkey> {
    get_core_owner(&ctx.accounts.asset)
}

/// Transfer agent with automatic owner sync
/// Automatically resets agent_wallet to None on transfer for security
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
    let asset = ctx.accounts.agent_account.asset;

    // Transfer Core asset
    TransferV1CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .payer(&ctx.accounts.owner.to_account_info())
        .authority(Some(&ctx.accounts.owner.to_account_info()))
        .new_owner(&ctx.accounts.new_owner.to_account_info())
        .invoke()?;

    // Update cached owner and reset wallet
    let agent = &mut ctx.accounts.agent_account;
    let old_wallet = agent.agent_wallet;
    agent.owner = new_owner;
    agent.agent_wallet = None; // Security: reset wallet on transfer

    // Emit wallet reset event if there was a wallet
    if old_wallet.is_some() {
        emit!(WalletUpdated {
            asset,
            old_wallet,
            new_wallet: Pubkey::default(),
            updated_by: old_owner,
        });
        msg!("Agent wallet reset on transfer");
    }

    emit!(AgentOwnerSynced {
        asset,
        old_owner,
        new_owner,
    });

    msg!("Agent transferred: {} -> {}", old_owner, new_owner);

    Ok(())
}

/// Set agent wallet with Ed25519 signature verification
///
/// Message format: "8004_WALLET_SET:" || asset (32 bytes) || new_wallet (32 bytes) || owner (32 bytes) || deadline (8 bytes LE)
/// Wallet is stored directly in AgentAccount (no separate PDA = no rent cost)
pub fn set_agent_wallet(
    ctx: Context<SetAgentWallet>,
    new_wallet: Pubkey,
    deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    let asset = ctx.accounts.asset.key();

    // 1. Verify caller is Core asset owner
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    // 2. Verify deadline is not expired
    require!(
        clock.unix_timestamp <= deadline,
        RegistryError::DeadlineExpired
    );

    // 3. Verify deadline is not too far in the future
    require!(
        deadline <= clock.unix_timestamp + MAX_DEADLINE_WINDOW,
        RegistryError::DeadlineTooFar
    );

    // 4. Build expected message and verify Ed25519 signature
    let expected_message =
        build_wallet_set_message(asset, new_wallet, ctx.accounts.owner.key(), deadline);
    verify_ed25519_signature(
        &ctx.accounts.instructions_sysvar,
        new_wallet,
        &expected_message,
    )?;

    // 5. Store wallet and sync owner atomically
    // SECURITY: Sync owner ensures append_response's wallet check passes
    // (wallet only valid when cached_owner == core_owner)
    let agent = &mut ctx.accounts.agent_account;
    let old_wallet = agent.agent_wallet;
    let old_owner = agent.owner;
    let new_owner = ctx.accounts.owner.key();

    agent.agent_wallet = Some(new_wallet);
    agent.owner = new_owner; // Implicit sync

    emit!(WalletUpdated {
        asset,
        old_wallet,
        new_wallet,
        updated_by: new_owner,
    });

    if old_owner != new_owner {
        emit!(AgentOwnerSynced {
            asset,
            old_owner,
            new_owner,
        });
    }

    msg!("Agent wallet set to {} (verified via Ed25519 signature)", new_wallet);

    Ok(())
}

// ============================================================================
// Helper functions
// ============================================================================

/// Build the message that wallet owner must sign for set_agent_wallet
fn build_wallet_set_message(
    asset: Pubkey,
    new_wallet: Pubkey,
    owner: Pubkey,
    deadline: i64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(WALLET_SET_MESSAGE_PREFIX.len() + 32 + 32 + 32 + 8);
    message.extend_from_slice(WALLET_SET_MESSAGE_PREFIX);
    message.extend_from_slice(asset.as_ref());
    message.extend_from_slice(new_wallet.as_ref());
    message.extend_from_slice(owner.as_ref());
    message.extend_from_slice(&deadline.to_le_bytes());
    message
}

/// Verify Ed25519 signature via sysvar introspection
/// SECURITY: Ed25519 instruction MUST be immediately before this instruction (current_index - 1)
fn verify_ed25519_signature(
    instructions_sysvar: &AccountInfo,
    expected_signer: Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_idx = load_current_index_checked(instructions_sysvar)
        .map_err(|_| RegistryError::MissingSignatureVerification)?;

    // SECURITY FIX: Ed25519 instruction MUST be at index (current_index - 1)
    // This prevents signature reuse attacks where an attacker places a valid
    // signature earlier in the transaction for a different purpose
    require!(current_idx >= 1, RegistryError::MissingSignatureVerification);
    let ed25519_idx = (current_idx - 1) as usize;

    let ix = load_instruction_at_checked(ed25519_idx, instructions_sysvar)
        .map_err(|_| RegistryError::MissingSignatureVerification)?;

    // Must be Ed25519 program
    require!(
        ix.program_id == ed25519_program::ID,
        RegistryError::MissingSignatureVerification
    );

    // Validate instruction data length (header is 16 bytes minimum)
    require!(ix.data.len() >= 16, RegistryError::InvalidSignature);

    let num_signatures = ix.data[0];
    require!(num_signatures == 1, RegistryError::InvalidSignature);

    // SECURITY FIX: Verify all instruction indices are u16::MAX (0xFFFF)
    // This ensures signature, pubkey, and message are INLINE in this instruction,
    // not referenced from another instruction in the transaction.
    // Without this check, an attacker could craft an Ed25519 instruction that
    // references data from a different instruction, bypassing our validation.
    let sig_instruction_index = u16::from_le_bytes([ix.data[4], ix.data[5]]);
    let pubkey_instruction_index = u16::from_le_bytes([ix.data[8], ix.data[9]]);
    let msg_instruction_index = u16::from_le_bytes([ix.data[14], ix.data[15]]);

    require!(
        sig_instruction_index == u16::MAX
            && pubkey_instruction_index == u16::MAX
            && msg_instruction_index == u16::MAX,
        RegistryError::InvalidSignature
    );

    let signature_offset = u16::from_le_bytes([ix.data[2], ix.data[3]]) as usize;
    let pubkey_offset = u16::from_le_bytes([ix.data[6], ix.data[7]]) as usize;
    let message_offset = u16::from_le_bytes([ix.data[10], ix.data[11]]) as usize;
    let message_size = u16::from_le_bytes([ix.data[12], ix.data[13]]) as usize;

    // Validate bounds
    require!(
        pubkey_offset + 32 <= ix.data.len()
            && message_offset + message_size <= ix.data.len()
            && signature_offset + 64 <= ix.data.len(),
        RegistryError::InvalidSignature
    );

    // Verify pubkey matches expected signer
    let pubkey_bytes: [u8; 32] = ix.data[pubkey_offset..pubkey_offset + 32]
        .try_into()
        .map_err(|_| RegistryError::InvalidSignature)?;
    let signer = Pubkey::from(pubkey_bytes);
    require!(signer == expected_signer, RegistryError::InvalidSignature);

    // Verify message matches expected message
    let message = &ix.data[message_offset..message_offset + message_size];
    require!(message == expected_message, RegistryError::InvalidSignature);

    Ok(())
}

/// Create Core asset via CPI
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

/// Update Core asset URI via CPI
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
    require!(actual_owner == *expected_owner, RegistryError::Unauthorized);
    Ok(())
}

/// Get owner from Core asset account data
fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    require!(*asset_info.owner == mpl_core::ID, RegistryError::InvalidAsset);

    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data).map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}

// ============================================================================
// Single Collection Instructions
// ============================================================================

/// Initialize the registry with root config and base collection
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let root = &mut ctx.accounts.root_config;
    let registry = &mut ctx.accounts.registry_config;
    let collection_key = ctx.accounts.collection.key();

    // Initialize root config
    root.base_collection = collection_key;
    root.authority = ctx.accounts.authority.key();
    root.bump = ctx.bumps.root_config;

    // Initialize registry config
    registry.collection = collection_key;
    registry.authority = ctx.accounts.authority.key();
    registry.bump = ctx.bumps.registry_config;

    // Create Metaplex Core Collection
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.authority.to_account_info())
        .update_authority(Some(&registry.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name("8004 Agent Registry".to_string())
        .uri(String::new())
        .invoke_signed(&[&[
            SEED_REGISTRY_CONFIG,
            collection_key.as_ref(),
            &[ctx.bumps.registry_config],
        ]])?;

    emit!(RegistryInitialized {
        collection: collection_key,
        authority: ctx.accounts.authority.key(),
    });

    msg!("Registry initialized with collection: {}", collection_key);

    Ok(())
}

fn register_inner(
    ctx: Context<Register>,
    agent_uri: String,
    atom_enabled: bool,
) -> Result<()> {
    require!(
        agent_uri.len() <= AgentAccount::MAX_URI_LENGTH,
        RegistryError::UriTooLong
    );

    let registry = &ctx.accounts.registry_config;
    let asset = ctx.accounts.asset.key();
    let collection_key = ctx.accounts.collection.key();

    // Create Core asset
    create_core_asset_cpi(
        &ctx.accounts.mpl_core_program.to_account_info(),
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.collection.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &registry.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        "Agent".to_string(),
        if agent_uri.is_empty() {
            String::new()
        } else {
            agent_uri.clone()
        },
        &[&[
            SEED_REGISTRY_CONFIG,
            collection_key.as_ref(),
            &[registry.bump],
        ]],
    )?;

    // Initialize agent account
    let agent = &mut ctx.accounts.agent_account;
    agent.collection = collection_key;
    agent.owner = ctx.accounts.owner.key();
    agent.asset = asset;
    agent.bump = ctx.bumps.agent_account;
    agent.atom_enabled = atom_enabled;
    agent.agent_wallet = None;
    agent.feedback_digest = [0u8; 32];
    agent.feedback_count = 0;
    agent.response_digest = [0u8; 32];
    agent.response_count = 0;
    agent.revoke_digest = [0u8; 32];
    agent.revoke_count = 0;
    agent.agent_uri = agent_uri;
    agent.nft_name = "Agent".to_string();

    emit!(AgentRegistered {
        asset,
        collection: collection_key,
        owner: ctx.accounts.owner.key(),
        atom_enabled: agent.atom_enabled,
        agent_uri: agent.agent_uri.clone(),
    });

    msg!("Agent registered: {} in collection {}", asset, collection_key);

    Ok(())
}

/// Register agent in the base collection
pub fn register(ctx: Context<Register>, agent_uri: String) -> Result<()> {
    register_inner(ctx, agent_uri, true)
}

/// Register agent with explicit ATOM setting (default is true)
pub fn register_with_options(
    ctx: Context<Register>,
    agent_uri: String,
    atom_enabled: bool,
) -> Result<()> {
    register_inner(ctx, agent_uri, atom_enabled)
}

/// Enable ATOM for an agent (one-way)
pub fn enable_atom(ctx: Context<EnableAtom>) -> Result<()> {
    // Verify ownership via Core asset
    verify_core_owner(&ctx.accounts.asset, &ctx.accounts.owner.key())?;

    let agent = &mut ctx.accounts.agent_account;
    require!(!agent.atom_enabled, RegistryError::AtomAlreadyEnabled);

    agent.atom_enabled = true;

    emit!(AtomEnabled {
        asset: agent.asset,
        enabled_by: ctx.accounts.owner.key(),
    });

    Ok(())
}
