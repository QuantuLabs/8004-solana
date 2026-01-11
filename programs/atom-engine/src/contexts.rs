use anchor_lang::prelude::*;

use crate::state::{AtomConfig, AtomStats, AtomCheckpoint};

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

/// Update stats for an agent (called via CPI from agent-registry)
#[derive(Accounts)]
pub struct UpdateStats<'info> {
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
        init_if_needed,
        payer = payer,
        space = AtomStats::SIZE,
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump,
    )]
    pub stats: Account<'info, AtomStats>,

    pub system_program: Program<'info, System>,
}

/// Create a checkpoint for recovery
#[derive(Accounts)]
#[instruction(checkpoint_index: u64)]
pub struct CreateCheckpoint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Asset public key
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump = stats.bump,
    )]
    pub stats: Account<'info, AtomStats>,

    #[account(
        init,
        payer = payer,
        space = AtomCheckpoint::SIZE,
        seeds = [b"atom_checkpoint", asset.key().as_ref(), &checkpoint_index.to_le_bytes()],
        bump,
    )]
    pub checkpoint: Account<'info, AtomCheckpoint>,

    pub system_program: Program<'info, System>,
}

/// Restore stats from a checkpoint
#[derive(Accounts)]
#[instruction(checkpoint_index: u64)]
pub struct RestoreFromCheckpoint<'info> {
    pub authority: Signer<'info>,

    /// CHECK: Asset public key
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_config"],
        bump = config.bump,
        constraint = config.authority == authority.key(),
    )]
    pub config: Account<'info, AtomConfig>,

    #[account(
        mut,
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump = stats.bump,
    )]
    pub stats: Account<'info, AtomStats>,

    #[account(
        seeds = [b"atom_checkpoint", asset.key().as_ref(), &checkpoint_index.to_le_bytes()],
        bump = checkpoint.bump,
    )]
    pub checkpoint: Account<'info, AtomCheckpoint>,
}

/// Replay a batch of historical events (for recovery)
#[derive(Accounts)]
pub struct ReplayBatch<'info> {
    pub authority: Signer<'info>,

    /// CHECK: Asset public key
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [b"atom_config"],
        bump = config.bump,
        constraint = config.authority == authority.key(),
    )]
    pub config: Account<'info, AtomConfig>,

    #[account(
        mut,
        seeds = [b"atom_stats", asset.key().as_ref()],
        bump = stats.bump,
    )]
    pub stats: Account<'info, AtomStats>,
}
