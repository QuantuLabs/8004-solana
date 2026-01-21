use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

use super::state::*;
use crate::error::RegistryError;

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

    /// User collection authority PDA (required for user registries)
    /// Optional: only needed when registry_type == User
    /// CHECK: Verified by seeds constraint when provided
    #[account(
        seeds = [b"user_collection_authority"],
        bump
    )]
    pub user_collection_authority: Option<UncheckedAccount<'info>>,

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

/// Get owner of agent
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
// Scalability: Multi-Collection Sharding Contexts
// ============================================================================

/// Initialize the registry with root config and first base registry
/// Only upgrade authority can call this (prevents front-running)
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Global root config pointing to current base registry
    #[account(
        init,
        payer = authority,
        space = RootConfig::DISCRIMINATOR.len() + RootConfig::INIT_SPACE,
        seeds = [b"root_config"],
        bump
    )]
    pub root_config: Account<'info, RootConfig>,

    /// First base registry config (base #0)
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::DISCRIMINATOR.len() + RegistryConfig::INIT_SPACE,
        seeds = [b"registry_config", collection.key().as_ref()],
        bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// First collection (created by CPI to Metaplex Core)
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub collection: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// Program data account for upgrade authority verification
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
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

/// Create a new base registry (authority only)
#[derive(Accounts)]
pub struct CreateBaseRegistry<'info> {
    #[account(
        mut,
        seeds = [b"root_config"],
        bump = root_config.bump,
        constraint = root_config.authority == authority.key() @ RegistryError::Unauthorized
    )]
    pub root_config: Account<'info, RootConfig>,

    /// New base registry config
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::DISCRIMINATOR.len() + RegistryConfig::INIT_SPACE,
        seeds = [b"registry_config", collection.key().as_ref()],
        bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// New collection to create
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub collection: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Rotate to a new base registry (authority only)
#[derive(Accounts)]
pub struct RotateBaseRegistry<'info> {
    #[account(
        mut,
        seeds = [b"root_config"],
        bump = root_config.bump,
        constraint = root_config.authority == authority.key() @ RegistryError::Unauthorized
    )]
    pub root_config: Account<'info, RootConfig>,

    /// New registry to rotate to (must be Base type)
    #[account(
        constraint = new_registry.registry_type == RegistryType::Base @ RegistryError::InvalidRegistryType
    )]
    pub new_registry: Account<'info, RegistryConfig>,

    pub authority: Signer<'info>,
}

/// Create a user registry (anyone can create their own shard)
#[derive(Accounts)]
#[instruction(collection_name: String, collection_uri: String)]
pub struct CreateUserRegistry<'info> {
    /// PDA authority for all user collections
    /// CHECK: PDA verified by seeds
    #[account(
        seeds = [b"user_collection_authority"],
        bump
    )]
    pub collection_authority: UncheckedAccount<'info>,

    /// User registry config
    #[account(
        init,
        payer = owner,
        space = RegistryConfig::DISCRIMINATOR.len() + RegistryConfig::INIT_SPACE,
        seeds = [b"registry_config", collection.key().as_ref()],
        bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// New collection to create (program PDA is authority)
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub collection: Signer<'info>,

    /// User who creates and owns this registry
    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Update user registry collection metadata (owner only)
#[derive(Accounts)]
#[instruction(new_name: Option<String>, new_uri: Option<String>)]
pub struct UpdateUserRegistryMetadata<'info> {
    /// PDA authority for signing
    /// CHECK: PDA verified by seeds
    #[account(
        seeds = [b"user_collection_authority"],
        bump
    )]
    pub collection_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"registry_config", collection.key().as_ref()],
        bump = registry_config.bump,
        constraint = registry_config.registry_type == RegistryType::User @ RegistryError::InvalidRegistryType,
        constraint = registry_config.authority == owner.key() @ RegistryError::Unauthorized
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// Collection to update
    /// CHECK: Verified via registry_config constraint
    #[account(
        mut,
        constraint = collection.key() == registry_config.collection @ RegistryError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// Owner of this user registry
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

/// Register agent in a specific registry (base or user)
#[derive(Accounts)]
#[instruction(agent_uri: String)]
pub struct Register<'info> {
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

    /// Collection for this registry
    /// CHECK: Verified via registry_config constraint
    #[account(
        mut,
        constraint = collection.key() == registry_config.collection @ RegistryError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// Optional: PDA authority for user collections
    /// CHECK: PDA verified by seeds when needed
    #[account(
        seeds = [b"user_collection_authority"],
        bump
    )]
    pub user_collection_authority: Option<UncheckedAccount<'info>>,

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
