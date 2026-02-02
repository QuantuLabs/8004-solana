use anchor_lang::prelude::*;

use crate::state::{AtomConfig, AtomStats};
use crate::error::AtomError;

/// BPF Loader Upgradeable program ID (loader-v3)
/// Defined locally to avoid deprecated bpf_loader_upgradeable module import.
const BPF_LOADER_UPGRADEABLE_ID: Pubkey =
    pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

/// Initialize the ATOM config (upgrade authority only, once)
/// SECURITY: Only the program deployer can initialize to prevent front-running
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

    /// Program data account for upgrade authority verification
    /// SECURITY: Only program deployer can initialize
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = BPF_LOADER_UPGRADEABLE_ID,
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ AtomError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

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
/// SECURITY: Verifies caller via PDA signer - only agent-registry can sign with this PDA
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

    /// Registry authority PDA - must be signed by agent-registry program
    /// Seeds: ["atom_cpi_authority"] derived from agent-registry program
    /// CHECK: Verified by constraint against config.agent_registry_program
    #[account(
        signer,
        constraint = is_valid_registry_authority(
            registry_authority.key,
            &config.agent_registry_program
        ) @ AtomError::UnauthorizedCaller
    )]
    pub registry_authority: UncheckedAccount<'info>,

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
/// SECURITY: Verifies caller via PDA signer - only agent-registry can sign with this PDA
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

    /// Registry authority PDA - must be signed by agent-registry program
    /// Seeds: ["atom_cpi_authority"] derived from agent-registry program
    /// CHECK: Verified by constraint against config.agent_registry_program
    #[account(
        signer,
        constraint = is_valid_registry_authority(
            registry_authority.key,
            &config.agent_registry_program
        ) @ AtomError::UnauthorizedCaller
    )]
    pub registry_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// CPI Authority Verification
// ============================================================================

/// Seeds used by agent-registry to derive its CPI authority PDA
pub const ATOM_CPI_AUTHORITY_SEED: &[u8] = b"atom_cpi_authority";

/// Verify that the provided authority is the correct PDA derived from agent-registry
/// This is cryptographically secure - only agent-registry can sign with this PDA
#[inline]
pub fn is_valid_registry_authority(authority: &Pubkey, registry_program: &Pubkey) -> bool {
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[ATOM_CPI_AUTHORITY_SEED],
        registry_program,
    );
    authority == &expected_pda
}
