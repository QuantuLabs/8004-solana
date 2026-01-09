use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

use super::state::*;
use crate::error::RegistryError;

/// Reserved key hash for "agentWallet" metadata
/// Computed as: sha256("agentWallet")[0..8] = 0x9554ffa5cdc8747a
pub const AGENT_WALLET_KEY_HASH: [u8; 8] = [0x95, 0x54, 0xff, 0xa5, 0xcd, 0xc8, 0x74, 0x7a];

/// Initialize the registry and create Core collection
/// F-01: Only upgrade authority can initialize (prevents front-running)
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::DISCRIMINATOR.len() + RegistryConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, RegistryConfig>,

    /// Metaplex Core collection (created by CPI)
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub collection: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// Program data account for upgrade authority verification
    /// F-01: Ensures only upgrade authority can initialize
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

/// Register a new agent with Core asset
#[derive(Accounts)]
pub struct Register<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = owner,
        space = AgentAccount::DISCRIMINATOR.len() + AgentAccount::INIT_SPACE,
        seeds = [b"agent", asset.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Metaplex Core asset (created by CPI)
    /// CHECK: Created by Metaplex Core CPI
    #[account(mut)]
    pub asset: Signer<'info>,

    /// Collection account (must match config)
    /// CHECK: Verified via constraint and Core CPI
    #[account(
        mut,
        constraint = collection.key() == config.collection @ RegistryError::InvalidCollection
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

/// Set metadata as individual PDA (v0.2.0)
/// Creates new PDA if not exists, updates if exists and not immutable
#[derive(Accounts)]
#[instruction(key_hash: [u8; 8], key: String, value: Vec<u8>, immutable: bool)]
pub struct SetMetadataPda<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = MetadataEntryPda::DISCRIMINATOR.len() + MetadataEntryPda::INIT_SPACE,
        seeds = [b"agent_meta", agent_account.agent_id.to_le_bytes().as_ref(), key_hash.as_ref()],
        bump
    )]
    pub metadata_entry: Account<'info, MetadataEntryPda>,

    #[account(
        seeds = [b"agent", agent_account.asset.as_ref()],
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

/// Delete metadata PDA and recover rent (v0.2.0)
/// Only works if metadata is not immutable
#[derive(Accounts)]
#[instruction(key_hash: [u8; 8])]
pub struct DeleteMetadataPda<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"agent_meta", agent_account.agent_id.to_le_bytes().as_ref(), key_hash.as_ref()],
        bump = metadata_entry.bump
    )]
    pub metadata_entry: Account<'info, MetadataEntryPda>,

    #[account(
        seeds = [b"agent", agent_account.asset.as_ref()],
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
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [b"agent", agent_account.asset.as_ref()],
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
    /// CHECK: Verified via config constraint
    #[account(
        constraint = collection.key() == config.collection @ RegistryError::InvalidCollection
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
        seeds = [b"agent", agent_account.asset.as_ref()],
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
        seeds = [b"agent", agent_account.asset.as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,
}

/// Transfer agent with automatic owner sync
/// Optionally closes wallet metadata PDA to reset agent wallet on transfer
#[derive(Accounts)]
pub struct TransferAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_account.asset.as_ref()],
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

    /// Current owner (must sign, receives rent back from wallet PDA if closed)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// New owner receiving the asset
    /// CHECK: Can be any account
    pub new_owner: UncheckedAccount<'info>,

    /// Metaplex Core program
    /// CHECK: Verified by address constraint
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    /// Optional wallet metadata PDA to close on transfer
    /// If provided, it will be closed and rent returned to owner
    /// Seeds: [b"agent_meta", agent_id, AGENT_WALLET_KEY_HASH]
    #[account(
        mut,
        seeds = [b"agent_meta", agent_account.agent_id.to_le_bytes().as_ref(), AGENT_WALLET_KEY_HASH.as_ref()],
        bump = wallet_metadata.bump,
        close = owner
    )]
    pub wallet_metadata: Option<Account<'info, MetadataEntryPda>>,
}

/// Set agent wallet with Ed25519 signature verification
/// The wallet owner must sign a message off-chain to prove control
/// Transaction must include Ed25519Program verify instruction before this one
#[derive(Accounts)]
#[instruction(new_wallet: Pubkey, deadline: i64)]
pub struct SetAgentWallet<'info> {
    /// Agent owner (must be Core asset owner)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Payer for wallet metadata PDA (if new)
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"agent", agent_account.asset.as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// MetadataEntryPda for reserved "agentWallet" key
    /// Uses fixed AGENT_WALLET_KEY_HASH for PDA derivation
    #[account(
        init_if_needed,
        payer = payer,
        space = MetadataEntryPda::DISCRIMINATOR.len() + MetadataEntryPda::INIT_SPACE,
        seeds = [b"agent_meta", agent_account.agent_id.to_le_bytes().as_ref(), AGENT_WALLET_KEY_HASH.as_ref()],
        bump
    )]
    pub wallet_metadata: Account<'info, MetadataEntryPda>,

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

    pub system_program: Program<'info, System>,
}
