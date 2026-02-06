use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

use super::state::*;
use crate::constants::BPF_LOADER_UPGRADEABLE_ID;
use crate::error::RegistryError;

// ============================================================================
// Single Collection Architecture (v0.6.0)
// Extension collections will be in separate repo: 8004-collection-extension
// ============================================================================

/// Set metadata as individual PDA with dynamic sizing
/// Creates new PDA if not exists, updates if exists and not immutable
/// key_hash is SHA256(key)[0..16] for collision resistance (2^128 space)
#[derive(Accounts)]
#[instruction(key_hash: [u8; 16], key: String, value: Vec<u8>, immutable: bool)]
pub struct SetMetadataPda<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + MetadataEntryPda::INIT_SPACE,
        seeds = [b"agent_meta", asset.key().as_ref(), key_hash.as_ref()],
        bump
    )]
    pub metadata_entry: Account<'info, MetadataEntryPda>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset - verifies ownership
    /// CHECK: Ownership verified via mpl_core::accounts
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Owner must be the asset owner (verified in instruction)
    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Delete metadata PDA and recover rent
/// Only works if metadata is not immutable
/// key_hash is SHA256(key)[0..16] for collision resistance
#[derive(Accounts)]
#[instruction(key_hash: [u8; 16])]
pub struct DeleteMetadataPda<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"agent_meta", asset.key().as_ref(), key_hash.as_ref()],
        bump = metadata_entry.bump
    )]
    pub metadata_entry: Account<'info, MetadataEntryPda>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset - verifies ownership
    /// CHECK: Ownership verified via mpl_core::accounts
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Owner must be the asset owner (verified in instruction)
    /// Receives rent back when PDA is closed
    #[account(mut)]
    pub owner: Signer<'info>,
}

/// Set agent URI (owner only)
#[derive(Accounts)]
pub struct SetAgentUri<'info> {
    /// Registry config for this collection
    #[account(
        seeds = [b"registry_config", collection.key().as_ref()],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset for URI update
    /// CHECK: Ownership verified in instruction
    #[account(
        mut,
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Collection account (required by Core for assets in collection)
    /// CHECK: Verified via registry_config constraint
    #[account(
        mut,
        constraint = collection.key() == registry_config.collection @ RegistryError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Sync owner after Core transfer
#[derive(Accounts)]
pub struct SyncOwner<'info> {
    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset - ownership is read from asset data
    /// CHECK: Verified in instruction
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,
}

/// Get owner of agent (cached value - may be stale)
#[derive(Accounts)]
pub struct OwnerOf<'info> {
    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset (for PDA derivation)
    /// CHECK: Used for PDA derivation
    pub asset: UncheckedAccount<'info>,
}

/// Get authoritative Core owner (reads live from Metaplex Core)
#[derive(Accounts)]
pub struct CoreOwnerOf<'info> {
    /// Core asset to read owner from
    /// CHECK: Validated in instruction (must be MPL Core owned)
    pub asset: UncheckedAccount<'info>,
}

/// Transfer agent with automatic owner sync
/// Automatically resets agent_wallet to None on transfer
#[derive(Accounts)]
pub struct TransferAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset to transfer
    /// CHECK: Verified via agent_account constraint
    #[account(
        mut,
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Collection (required by Core transfer)
    /// CHECK: Verified by Core CPI
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,

    /// Current owner (must sign)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// New owner receiving the asset
    /// CHECK: Can be any account
    pub new_owner: UncheckedAccount<'info>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Set agent wallet with Ed25519 signature verification
/// Transaction must include Ed25519Program verify instruction before this one
/// Wallet is stored directly in AgentAccount (no separate PDA = no rent cost)
#[derive(Accounts)]
#[instruction(new_wallet: Pubkey, deadline: i64)]
pub struct SetAgentWallet<'info> {
    /// Agent owner (must be Core asset owner)
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset - ownership verified in instruction
    /// CHECK: Verified via agent_account constraint and in instruction
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Instructions sysvar for Ed25519 signature introspection
    /// CHECK: Verified by address constraint
    #[account(address = sysvar_instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

// ============================================================================
// Single Collection Architecture
// ============================================================================

/// Initialize the registry with root config and base collection
/// Only upgrade authority can call this (prevents front-running)
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Global root config
    #[account(
        init,
        payer = authority,
        space = RootConfig::DISCRIMINATOR.len() + RootConfig::INIT_SPACE,
        seeds = [b"root_config"],
        bump
    )]
    pub root_config: Account<'info, RootConfig>,

    /// Base registry config
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::DISCRIMINATOR.len() + RegistryConfig::INIT_SPACE,
        seeds = [b"registry_config", collection.key().as_ref()],
        bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// Base collection (created by CPI to Metaplex Core)
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub collection: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// Program data account for upgrade authority verification
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = BPF_LOADER_UPGRADEABLE_ID,
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ RegistryError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Register agent in the base collection
#[derive(Accounts)]
#[instruction(agent_uri: String)]
pub struct Register<'info> {
    /// Root config to validate base collection
    #[account(
        seeds = [b"root_config"],
        bump = root_config.bump,
        constraint = root_config.base_collection == collection.key() @ RegistryError::InvalidCollection
    )]
    pub root_config: Account<'info, RootConfig>,

    #[account(
        seeds = [b"registry_config", collection.key().as_ref()],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = owner,
        space = AgentAccount::DISCRIMINATOR.len() + AgentAccount::INIT_SPACE,
        seeds = [b"agent", asset.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// New asset to create
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub asset: Signer<'info>,

    /// Base collection
    /// CHECK: Verified via root_config constraint
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Enable ATOM for an agent (one-way)
#[derive(Accounts)]
pub struct EnableAtom<'info> {
    #[account(
        mut,
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Core asset for ownership verification
    /// CHECK: Verified via agent_account constraint
    #[account(
        constraint = asset.key() == agent_account.asset @ RegistryError::InvalidAsset
    )]
    pub asset: UncheckedAccount<'info>,

    /// Agent owner (must match Core asset owner)
    pub owner: Signer<'info>,
}
