use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

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

    /// Register a new agent (ERC-8004 spec: register(tokenURI))
    ///
    /// Creates an agent with the provided token URI and assigns a sequential agent ID.
    /// The agent_mint must be a valid NFT (supply=1, decimals=0).
    ///
    /// # Arguments
    /// * `token_uri` - IPFS/Arweave/HTTP URI (max 200 bytes, can be empty string)
    ///
    /// # Events
    /// * `AgentRegistered` - Emitted when agent is successfully registered
    ///
    /// # Errors
    /// * `UriTooLong` - If token_uri exceeds 200 bytes
    /// * `InvalidNFT` - If agent_mint is not supply=1, decimals=0
    /// * `Overflow` - If agent ID counter overflows
    pub fn register(ctx: Context<Register>, token_uri: String) -> Result<()> {
        // Validate token URI length (ERC-8004 spec: max 200 bytes)
        require!(
            token_uri.len() <= AgentAccount::MAX_URI_LENGTH,
            IdentityError::UriTooLong
        );

        // Validate agent_mint is NFT (supply=1, decimals=0)
        let mint = &ctx.accounts.agent_mint;
        require!(
            mint.supply == 1 && mint.decimals == 0,
            IdentityError::InvalidNFT
        );

        let config = &mut ctx.accounts.config;
        let agent = &mut ctx.accounts.agent_account;

        // Assign sequential agent ID (like ERC-721 tokenId)
        let agent_id = config.next_agent_id;

        // Increment counters with overflow protection
        config.next_agent_id = config
            .next_agent_id
            .checked_add(1)
            .ok_or(IdentityError::Overflow)?;

        config.total_agents = config
            .total_agents
            .checked_add(1)
            .ok_or(IdentityError::Overflow)?;

        // Initialize agent account
        agent.agent_id = agent_id;
        agent.owner = ctx.accounts.owner.key();
        agent.agent_mint = ctx.accounts.agent_mint.key();
        agent.token_uri = token_uri.clone();
        agent.metadata = Vec::new();
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent_account;

        // Emit event (ERC-8004 spec: Registered event)
        emit!(AgentRegistered {
            agent_id,
            token_uri,
            owner: ctx.accounts.owner.key(),
            agent_mint: ctx.accounts.agent_mint.key(),
        });

        msg!(
            "Agent {} registered with mint {} by owner {}",
            agent_id,
            agent.agent_mint,
            agent.owner
        );

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
        space = AgentAccount::MAX_SIZE,
        seeds = [b"agent", agent_mint.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Agent NFT mint (must be supply=1, decimals=0)
    pub agent_mint: Account<'info, Mint>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Event emitted when a new agent is registered (ERC-8004 spec: Registered)
#[event]
pub struct AgentRegistered {
    pub agent_id: u64,
    pub token_uri: String,
    pub owner: Pubkey,
    pub agent_mint: Pubkey,
}
