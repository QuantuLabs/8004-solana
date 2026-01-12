use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

use crate::state::{AtomConfig, AtomStats};
use crate::error::AtomError;

/// Initialize the ATOM config (authority only, once)
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = AtomConfig::SIZE,
        seeds = [b"atom_config"],
        bump,
    )]
    pub config: Account<'info, AtomConfig>,

    pub system_program: Program<'info, System>,
}

/// Update config parameters (authority only)
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"atom_config"],
        bump = config.bump,
        constraint = config.authority == authority.key(),
    )]
    pub config: Account<'info, AtomConfig>,
}

/// Initialize stats for a new agent (only asset holder can initialize)
/// This ensures the agent owner pays for their own reputation account, not the first reviewer
/// Verification: owner == asset.data[1..33] (Metaplex Core owner offset)
#[derive(Accounts)]
pub struct InitializeStats<'info> {
    /// Agent owner (must be the Metaplex Core asset holder)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Metaplex Core asset - ownership verified in instruction
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Collection public key
    pub collection: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, AtomConfig>,

    #[account(
        init,
        payer = owner,
        space = AtomStats::SIZE,
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump,
    )]
    pub stats: Account<'info, AtomStats>,

    pub system_program: Program<'info, System>,
}

/// Update stats for an agent (called via CPI from agent-registry during feedback)
/// Stats must already exist (created during agent registration)
/// SECURITY: Verifies caller is the authorized agent-registry program via instruction sysvar
#[derive(Accounts)]
pub struct UpdateStats<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Asset public key, validated by caller
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Collection public key, validated by caller
    pub collection: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, AtomConfig>,

    #[account(
        mut,
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump = stats.bump,
    )]
    pub stats: Account<'info, AtomStats>,

    /// Instructions sysvar for CPI caller verification
    /// CHECK: Verified by address constraint
    #[account(address = sysvar_instructions::ID @ AtomError::UnauthorizedCaller)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Get summary for an agent (CPI-callable, read-only)
#[derive(Accounts)]
pub struct GetSummary<'info> {
    /// CHECK: Asset public key used for PDA derivation
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump = stats.bump,
    )]
    pub stats: Account<'info, AtomStats>,
}

/// Revoke stats for an agent (called via CPI from agent-registry during revoke_feedback)
/// SECURITY: Verifies caller is the authorized agent-registry program via instruction sysvar
#[derive(Accounts)]
pub struct RevokeStats<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Asset public key, validated by caller
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, AtomConfig>,

    #[account(
        mut,
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump = stats.bump,
    )]
    pub stats: Account<'info, AtomStats>,

    /// Instructions sysvar for CPI caller verification
    /// CHECK: Verified by address constraint
    #[account(address = sysvar_instructions::ID @ AtomError::UnauthorizedCaller)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
