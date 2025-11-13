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

    /// Set agent metadata (ERC-8004 spec: setMetadata(agentId, key, value))
    ///
    /// Updates or adds a metadata entry for the agent. Only the agent owner can call this.
    /// If the key exists, the value is updated. If the key is new, a new entry is added.
    /// Maximum 10 metadata entries per agent.
    ///
    /// # Arguments
    /// * `key` - Metadata key (max 32 bytes)
    /// * `value` - Metadata value (max 256 bytes)
    ///
    /// # Events
    /// * `MetadataSet` - Emitted when metadata is successfully set
    ///
    /// # Errors
    /// * `KeyTooLong` - If key exceeds 32 bytes
    /// * `ValueTooLong` - If value exceeds 256 bytes
    /// * `MetadataLimitReached` - If adding new entry would exceed 10 entries
    /// * `Unauthorized` - If caller is not the agent owner
    pub fn set_metadata(
        ctx: Context<SetMetadata>,
        key: String,
        value: Vec<u8>,
    ) -> Result<()> {
        // Validate key length (ERC-8004 adaptation: max 32 bytes)
        require!(
            key.len() <= MetadataEntry::MAX_KEY_LENGTH,
            IdentityError::KeyTooLong
        );

        // Validate value length (ERC-8004 adaptation: max 256 bytes)
        require!(
            value.len() <= MetadataEntry::MAX_VALUE_LENGTH,
            IdentityError::ValueTooLong
        );

        let agent = &mut ctx.accounts.agent_account;

        // Find existing entry or add new one
        if let Some(entry) = agent.find_metadata_mut(&key) {
            // Update existing entry
            entry.value = value.clone();
        } else {
            // Add new entry (max 10 entries)
            require!(
                agent.metadata.len() < AgentAccount::MAX_METADATA_ENTRIES,
                IdentityError::MetadataLimitReached
            );

            agent.metadata.push(MetadataEntry {
                key: key.clone(),
                value: value.clone(),
            });
        }

        // Emit event (ERC-8004 spec: MetadataSet event)
        emit!(MetadataSet {
            agent_id: agent.agent_id,
            key: key.clone(),
            value,
        });

        msg!(
            "Metadata '{}' set for agent {}",
            key,
            agent.agent_id
        );

        Ok(())
    }

    /// Set agent URI (ERC-8004 spec: setAgentUri(agentId, newUri))
    ///
    /// Updates the token URI for an agent. Only the agent owner can call this.
    ///
    /// # Arguments
    /// * `new_uri` - New IPFS/Arweave/HTTP URI (max 200 bytes, can be empty string)
    ///
    /// # Events
    /// * `AgentUriSet` - Emitted when URI is successfully updated
    ///
    /// # Errors
    /// * `UriTooLong` - If new_uri exceeds 200 bytes
    /// * `Unauthorized` - If caller is not the agent owner
    pub fn set_agent_uri(ctx: Context<SetAgentUri>, new_uri: String) -> Result<()> {
        // Validate URI length (ERC-8004 spec: max 200 bytes)
        require!(
            new_uri.len() <= AgentAccount::MAX_URI_LENGTH,
            IdentityError::UriTooLong
        );

        let agent = &mut ctx.accounts.agent_account;
        let old_uri = agent.token_uri.clone();

        // Update URI
        agent.token_uri = new_uri.clone();

        // Emit event
        emit!(AgentUriSet {
            agent_id: agent.agent_id,
            old_uri,
            new_uri,
        });

        msg!(
            "Agent {} URI updated to {}",
            agent.agent_id,
            agent.token_uri
        );

        Ok(())
    }

    /// Sync agent owner after SPL Token transfer
    ///
    /// After transferring the agent NFT via SPL Token standard transfer,
    /// call this instruction to sync the cached owner field in AgentAccount.
    /// This is optional but recommended for query convenience.
    ///
    /// # Arguments
    /// None - new owner is derived from SPL Token account
    ///
    /// # Events
    /// * `AgentOwnerSynced` - Emitted when owner is successfully synced
    ///
    /// # Errors
    /// * `InvalidTokenAccount` - If token account doesn't hold the NFT
    pub fn sync_owner(ctx: Context<SyncOwner>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_account;
        let token_account = &ctx.accounts.token_account;

        // Verify token account holds the agent NFT (amount = 1)
        require!(
            token_account.amount == 1,
            IdentityError::InvalidTokenAccount
        );

        let old_owner = agent.owner;
        let new_owner = token_account.owner;

        // Update cached owner
        agent.owner = new_owner;

        // Emit event
        emit!(AgentOwnerSynced {
            agent_id: agent.agent_id,
            old_owner,
            new_owner,
            agent_mint: agent.agent_mint,
        });

        msg!(
            "Agent {} owner synced: {} -> {}",
            agent.agent_id,
            old_owner,
            new_owner
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

#[derive(Accounts)]
pub struct SetMetadata<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_account.agent_mint.as_ref()],
        bump = agent_account.bump,
        constraint = owner.key() == agent_account.owner @ IdentityError::Unauthorized
    )]
    pub agent_account: Account<'info, AgentAccount>,

    pub owner: Signer<'info>,
}

/// Event emitted when agent metadata is set (ERC-8004 spec: MetadataSet)
#[event]
pub struct MetadataSet {
    pub agent_id: u64,
    pub key: String,
    pub value: Vec<u8>,
}

#[derive(Accounts)]
pub struct SetAgentUri<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_account.agent_mint.as_ref()],
        bump = agent_account.bump,
        constraint = owner.key() == agent_account.owner @ IdentityError::Unauthorized
    )]
    pub agent_account: Account<'info, AgentAccount>,

    pub owner: Signer<'info>,
}

/// Event emitted when agent URI is updated
#[event]
pub struct AgentUriSet {
    pub agent_id: u64,
    pub old_uri: String,
    pub new_uri: String,
}

#[derive(Accounts)]
pub struct SyncOwner<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_account.agent_mint.as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Token account holding the agent NFT (must have amount = 1)
    #[account(
        constraint = token_account.mint == agent_account.agent_mint @ IdentityError::InvalidTokenAccount
    )]
    pub token_account: Account<'info, anchor_spl::token::TokenAccount>,
}

/// Event emitted when agent owner is synced after transfer
#[event]
pub struct AgentOwnerSynced {
    pub agent_id: u64,
    pub old_owner: Pubkey,
    pub new_owner: Pubkey,
    pub agent_mint: Pubkey,
}
