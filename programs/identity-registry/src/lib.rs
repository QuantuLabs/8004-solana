use anchor_lang::prelude::*;

declare_id!("AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR");

mod state;
mod error;

use state::*;
use error::*;

#[program]
pub mod identity_registry {
    use super::*;

    /// Initialize the identity registry
    ///
    /// Creates the global RegistryConfig account
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;

        config.authority = ctx.accounts.authority.key();
        config.next_agent_id = 0;
        config.total_agents = 0;
        config.bump = ctx.bumps.config;

        msg!("Identity Registry initialized by {}", ctx.accounts.authority.key());

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
