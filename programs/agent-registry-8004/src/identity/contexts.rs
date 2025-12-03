use anchor_lang::prelude::*;

use super::state::*;
use crate::error::RegistryError;

/// Initialize the registry and create Core collection
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + RegistryConfig::SIZE,
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
        space = 8 + AgentAccount::MAX_SIZE,
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

/// Get metadata from agent account
#[derive(Accounts)]
pub struct GetMetadata<'info> {
    #[account(
        seeds = [b"agent", agent_account.asset.as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,
}

/// Set metadata on agent account (owner only)
#[derive(Accounts)]
pub struct SetMetadata<'info> {
    #[account(
        mut,
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

/// Create metadata extension for additional entries
#[derive(Accounts)]
#[instruction(extension_index: u8)]
pub struct CreateMetadataExtension<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + MetadataExtension::MAX_SIZE,
        seeds = [b"metadata_ext", asset.key().as_ref(), &[extension_index]],
        bump
    )]
    pub metadata_extension: Account<'info, MetadataExtension>,

    /// Core asset
    /// CHECK: Verified via agent_account constraint
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Owner must be the asset owner (verified in instruction)
    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Set metadata in extension
#[derive(Accounts)]
#[instruction(extension_index: u8)]
pub struct SetMetadataExtended<'info> {
    #[account(
        mut,
        seeds = [b"metadata_ext", asset.key().as_ref(), &[extension_index]],
        bump = metadata_extension.bump
    )]
    pub metadata_extension: Account<'info, MetadataExtension>,

    /// Core asset
    /// CHECK: Verified via agent_account constraint
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"agent", asset.key().as_ref()],
        bump = agent_account.bump,
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Owner must be the asset owner (verified in instruction)
    pub owner: Signer<'info>,
}

/// Get metadata from extension
#[derive(Accounts)]
#[instruction(extension_index: u8)]
pub struct GetMetadataExtended<'info> {
    #[account(
        seeds = [b"metadata_ext", asset.key().as_ref(), &[extension_index]],
        bump = metadata_extension.bump
    )]
    pub metadata_extension: Account<'info, MetadataExtension>,

    /// Core asset (for PDA derivation)
    /// CHECK: Used for PDA seeds only
    pub asset: UncheckedAccount<'info>,
}

/// Transfer agent with automatic owner sync
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
