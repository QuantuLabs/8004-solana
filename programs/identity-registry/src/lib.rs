use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::Metadata,
    token::{self, Mint, MintTo, Token, TokenAccount},
};
use mpl_token_metadata::{
    instructions::{CreateV1CpiBuilder, SetAndVerifyCollectionCpiBuilder},
    types::{Collection, PrintSupply, TokenStandard},
};

declare_id!("AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR");

mod state;
mod error;

use state::*;
use error::*;

#[program]
pub mod identity_registry {
    use super::*;

    /// Initialize the identity registry (ERC-8004 spec)
    ///
    /// Creates the global RegistryConfig account and the Metaplex Collection NFT.
    /// All agents will be minted as part of this collection (like ERC-721 on Ethereum).
    ///
    /// Equivalent to: ERC-721 contract deployment
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;

        config.authority = ctx.accounts.authority.key();
        config.next_agent_id = 0;
        config.total_agents = 0;
        config.collection_mint = ctx.accounts.collection_mint.key();
        config.bump = ctx.bumps.config;

        // Mint 1 collection NFT to authority
        token::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.collection_mint.to_account_info(),
                    to: ctx.accounts.collection_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            1,
        )?;

        // Create Metaplex Collection NFT metadata + master edition
        CreateV1CpiBuilder::new(&ctx.accounts.token_metadata_program.to_account_info())
            .metadata(&ctx.accounts.collection_metadata)
            .master_edition(Some(&ctx.accounts.collection_master_edition))
            .mint(&ctx.accounts.collection_mint.to_account_info(), false)
            .authority(&ctx.accounts.authority.to_account_info())
            .payer(&ctx.accounts.authority.to_account_info())
            .update_authority(&ctx.accounts.authority.to_account_info(), true)
            .system_program(&ctx.accounts.system_program.to_account_info())
            .sysvar_instructions(&ctx.accounts.sysvar_instructions)
            .spl_token_program(Some(&ctx.accounts.token_program.to_account_info()))
            .name("ERC-8004 Agent Registry".to_string())
            .uri("https://erc8004.org/collection.json".to_string())
            .seller_fee_basis_points(0)
            .token_standard(TokenStandard::NonFungible)
            .print_supply(PrintSupply::Zero)
            .invoke()?;

        msg!(
            "Identity Registry initialized with collection mint: {}",
            config.collection_mint
        );

        Ok(())
    }

    /// Register a new agent with empty URI (ERC-8004 spec: register())
    ///
    /// Creates an agent with empty token URI and assigns a sequential agent ID.
    /// The contract creates and mints the NFT to the caller as part of the collection.
    ///
    /// # Events
    /// * `AgentRegistered` - Emitted when agent is successfully registered
    ///
    /// # Errors
    /// * `Overflow` - If agent ID counter overflows
    pub fn register_empty(ctx: Context<Register>) -> Result<()> {
        register_internal(ctx, String::new(), vec![])
    }

    /// Register a new agent with URI (ERC-8004 spec: register(tokenURI))
    ///
    /// Creates an agent with the provided token URI and assigns a sequential agent ID.
    /// The contract creates and mints the NFT to the caller as part of the collection.
    ///
    /// # Arguments
    /// * `token_uri` - IPFS/Arweave/HTTP URI (max 200 bytes, can be empty string)
    ///
    /// # Events
    /// * `AgentRegistered` - Emitted when agent is successfully registered
    ///
    /// # Errors
    /// * `UriTooLong` - If token_uri exceeds 200 bytes
    /// * `Overflow` - If agent ID counter overflows
    pub fn register(ctx: Context<Register>, token_uri: String) -> Result<()> {
        register_internal(ctx, token_uri, vec![])
    }

    /// Register a new agent with URI and initial metadata (ERC-8004 spec: register(tokenURI, metadata[]))
    ///
    /// Creates an agent with URI and batch-sets initial metadata entries.
    /// More gas-efficient than calling setMetadata multiple times.
    /// The contract creates and mints the NFT to the caller as part of the collection.
    ///
    /// # Arguments
    /// * `token_uri` - IPFS/Arweave/HTTP URI (max 200 bytes, can be empty string)
    /// * `metadata` - Initial metadata entries (max 10 entries)
    ///
    /// # Events
    /// * `AgentRegistered` - Emitted when agent is successfully registered
    /// * `MetadataSet` - Emitted for each metadata entry
    ///
    /// # Errors
    /// * `UriTooLong` - If token_uri exceeds 200 bytes
    /// * `KeyTooLong` - If any key exceeds 32 bytes
    /// * `ValueTooLong` - If any value exceeds 256 bytes
    /// * `MetadataLimitReached` - If more than 10 entries provided
    /// * `Overflow` - If agent ID counter overflows
    pub fn register_with_metadata(
        ctx: Context<Register>,
        token_uri: String,
        metadata: Vec<MetadataEntry>,
    ) -> Result<()> {
        register_internal(ctx, token_uri, metadata)
    }

    /// Internal registration logic shared by all register functions
    ///
    /// NOTE: This function is exposed in the IDL due to Anchor limitations,
    /// but it should NOT be called directly. Use register(), register_empty(),
    /// or register_with_metadata() instead.
    #[doc(hidden)]
    pub fn register_internal(
        mut ctx: Context<Register>,
        token_uri: String,
        metadata: Vec<MetadataEntry>,
    ) -> Result<()> {
        // Validate token URI length (ERC-8004 spec: max 200 bytes)
        require!(
            token_uri.len() <= AgentAccount::MAX_URI_LENGTH,
            IdentityError::UriTooLong
        );

        // Validate metadata
        require!(
            metadata.len() <= AgentAccount::MAX_METADATA_ENTRIES,
            IdentityError::MetadataLimitReached
        );

        for entry in &metadata {
            require!(
                entry.key.len() <= MetadataEntry::MAX_KEY_LENGTH,
                IdentityError::KeyTooLong
            );
            require!(
                entry.value.len() <= MetadataEntry::MAX_VALUE_LENGTH,
                IdentityError::ValueTooLong
            );
        }

        let config = &mut ctx.accounts.config;
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

        // Mint 1 agent NFT to owner
        token::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.agent_mint.to_account_info(),
                    to: ctx.accounts.agent_token_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            1,
        )?;

        // Create Metaplex NFT metadata + master edition WITH collection reference
        let agent_name = format!("Agent #{}", agent_id);
        let metadata_uri = if token_uri.is_empty() {
            String::new()
        } else {
            token_uri.clone()
        };

        CreateV1CpiBuilder::new(&ctx.accounts.token_metadata_program.to_account_info())
            .metadata(&ctx.accounts.agent_metadata)
            .master_edition(Some(&ctx.accounts.agent_master_edition))
            .mint(&ctx.accounts.agent_mint.to_account_info(), true)
            .authority(&ctx.accounts.owner.to_account_info())
            .payer(&ctx.accounts.owner.to_account_info())
            .update_authority(&ctx.accounts.owner.to_account_info(), true)
            .system_program(&ctx.accounts.system_program.to_account_info())
            .sysvar_instructions(&ctx.accounts.sysvar_instructions)
            .spl_token_program(Some(&ctx.accounts.token_program.to_account_info()))
            .name(agent_name)
            .uri(metadata_uri)
            .seller_fee_basis_points(0)
            .token_standard(TokenStandard::NonFungible)
            .print_supply(PrintSupply::Zero)
            .collection(Collection {
                verified: false,
                key: config.collection_mint,
            })
            .invoke()?;

        // Verify collection membership (requires collection authority)
        SetAndVerifyCollectionCpiBuilder::new(
            &ctx.accounts.token_metadata_program.to_account_info(),
        )
        .metadata(&ctx.accounts.agent_metadata)
        .collection_authority(&ctx.accounts.authority.to_account_info())
        .payer(&ctx.accounts.owner.to_account_info())
        .update_authority(&ctx.accounts.owner.to_account_info())
        .collection_mint(&ctx.accounts.collection_mint.to_account_info())
        .collection(&ctx.accounts.collection_metadata)
        .collection_master_edition_account(&ctx.accounts.collection_master_edition)
        .invoke()?;

        // Initialize agent account
        let agent = &mut ctx.accounts.agent_account;
        agent.agent_id = agent_id;
        agent.owner = ctx.accounts.owner.key();
        agent.agent_mint = ctx.accounts.agent_mint.key();
        agent.token_uri = token_uri.clone();
        agent.metadata = metadata.clone();
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent_account;

        // Emit registration event (ERC-8004 spec: Registered event)
        emit!(Registered {
            agent_id,
            token_uri,
            owner: ctx.accounts.owner.key(),
            agent_mint: ctx.accounts.agent_mint.key(),
        });

        // Emit metadata events if any
        for entry in &metadata {
            emit!(MetadataSet {
                agent_id,
                indexed_key: entry.key.clone(),
                key: entry.key.clone(),
                value: entry.value.clone(),
            });
        }

        msg!(
            "Agent {} registered with mint {} in collection {}",
            agent_id,
            agent.agent_mint,
            config.collection_mint
        );

        // Note: Mint authority is automatically transferred to the Master Edition account
        // by Metaplex when creating the master edition. This makes the NFT truly immutable
        // with supply = 1 forever. No additional action needed.

        Ok(())
    }

    /// Get agent metadata value by key (ERC-8004 spec: getMetadata(agentId, key))
    ///
    /// Returns the metadata value for the given key, or empty bytes if not found.
    /// This is a view function that doesn't modify state.
    ///
    /// # Arguments
    /// * `key` - Metadata key to look up
    ///
    /// # Returns
    /// * Metadata value as Vec<u8>, or empty vec if key not found
    pub fn get_metadata(ctx: Context<GetMetadata>, key: String) -> Result<Vec<u8>> {
        let agent = &ctx.accounts.agent_account;

        // Find metadata entry
        if let Some(entry) = agent.metadata.iter().find(|e| e.key == key) {
            Ok(entry.value.clone())
        } else {
            Ok(Vec::new())
        }
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
            indexed_key: key.clone(),
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

        // Emit event (ERC-8004 spec: UriUpdated event)
        emit!(UriUpdated {
            agent_id: agent.agent_id,
            new_uri,
            updated_by: ctx.accounts.owner.key(),
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

    /// Create a metadata extension PDA for additional metadata storage
    ///
    /// Allows storing more than 10 metadata entries by creating extension accounts.
    /// Each extension can hold 10 additional entries.
    ///
    /// # Arguments
    /// * `extension_index` - Index of the extension (0, 1, 2, ...)
    ///
    /// # Events
    /// * None (creation only)
    ///
    /// # Errors
    /// * `InvalidExtensionIndex` - If extension index > 255
    pub fn create_metadata_extension(
        ctx: Context<CreateMetadataExtension>,
        extension_index: u8,
    ) -> Result<()> {
        let extension = &mut ctx.accounts.metadata_extension;
        extension.agent_mint = ctx.accounts.agent_mint.key();
        extension.extension_index = extension_index;
        extension.metadata = Vec::new();
        extension.bump = ctx.bumps.metadata_extension;

        msg!(
            "Created metadata extension {} for agent mint {}",
            extension_index,
            extension.agent_mint
        );

        Ok(())
    }

    /// Set metadata in an extension PDA
    ///
    /// # Arguments
    /// * `extension_index` - Which extension to use
    /// * `key` - Metadata key (max 32 bytes)
    /// * `value` - Metadata value (max 256 bytes)
    ///
    /// # Events
    /// * `MetadataSet` - Emitted when metadata is set
    ///
    /// # Errors
    /// * `KeyTooLong` - If key exceeds 32 bytes
    /// * `ValueTooLong` - If value exceeds 256 bytes
    /// * `MetadataLimitReached` - If extension already has 10 entries
    pub fn set_metadata_extended(
        ctx: Context<SetMetadataExtended>,
        _extension_index: u8,
        key: String,
        value: Vec<u8>,
    ) -> Result<()> {
        // Validate key and value lengths
        require!(
            key.len() <= MetadataEntry::MAX_KEY_LENGTH,
            IdentityError::KeyTooLong
        );
        require!(
            value.len() <= MetadataEntry::MAX_VALUE_LENGTH,
            IdentityError::ValueTooLong
        );

        let extension = &mut ctx.accounts.metadata_extension;

        // Check if metadata key already exists, update it
        if let Some(entry) = extension.find_metadata_mut(&key) {
            entry.value = value.clone();
        } else {
            // Add new entry if under limit
            require!(
                extension.metadata.len() < MetadataExtension::MAX_METADATA_ENTRIES,
                IdentityError::MetadataLimitReached
            );
            extension.metadata.push(MetadataEntry { key: key.clone(), value: value.clone() });
        }

        // Emit event
        emit!(MetadataSet {
            agent_id: ctx.accounts.agent_account.agent_id,
            indexed_key: key.clone(),
            key,
            value,
        });

        Ok(())
    }

    /// Get metadata from an extension PDA
    ///
    /// # Arguments
    /// * `extension_index` - Which extension to read from
    /// * `key` - Metadata key to retrieve
    ///
    /// # Returns
    /// * Metadata value if found, empty Vec otherwise
    pub fn get_metadata_extended(
        ctx: Context<GetMetadataExtended>,
        _extension_index: u8,
        key: String,
    ) -> Result<Vec<u8>> {
        let extension = &ctx.accounts.metadata_extension;
        if let Some(entry) = extension.find_metadata(&key) {
            Ok(entry.value.clone())
        } else {
            Ok(Vec::new())
        }
    }

    /// Transfer agent NFT to new owner with automatic owner sync
    ///
    /// This is a convenience function that combines SPL Token transfer + sync_owner
    /// in a single instruction.
    ///
    /// # Events
    /// * `AgentOwnerSynced` - Emitted after successful transfer
    ///
    /// # Errors
    /// * `TransferToSelf` - If destination is same as source
    pub fn transfer_agent(ctx: Context<TransferAgent>) -> Result<()> {
        // Prevent self-transfer
        require!(
            ctx.accounts.from_token_account.key() != ctx.accounts.to_token_account.key(),
            IdentityError::TransferToSelf
        );

        // Step 1: SPL Token transfer via CPI
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.from_token_account.to_account_info(),
            to: ctx.accounts.to_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
            ),
            1, // NFT amount
        )?;

        // Step 2: Automatic sync_owner
        let agent = &mut ctx.accounts.agent_account;
        let old_owner = agent.owner;
        let new_owner = ctx.accounts.to_token_account.owner;
        agent.owner = new_owner;

        emit!(AgentOwnerSynced {
            agent_id: agent.agent_id,
            old_owner,
            new_owner,
            agent_mint: agent.agent_mint,
        });

        msg!(
            "Agent {} transferred: {} -> {}",
            agent.agent_id,
            old_owner,
            new_owner
        );

        Ok(())
    }
}

// ============================================================================
// Account Contexts
// ============================================================================

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

    /// Collection NFT mint (created during initialization)
    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = authority.key(),
        mint::freeze_authority = authority.key(),
    )]
    pub collection_mint: Account<'info, Mint>,

    /// Metaplex Collection metadata account
    /// CHECK: Created by Metaplex CPI
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// Metaplex Collection master edition account
    /// CHECK: Created by Metaplex CPI
    #[account(mut)]
    pub collection_master_edition: UncheckedAccount<'info>,

    /// Token account to hold the collection NFT
    #[account(
        init,
        payer = authority,
        associated_token::mint = collection_mint,
        associated_token::authority = authority,
    )]
    pub collection_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,

    /// Metaplex Token Metadata program
    pub token_metadata_program: Program<'info, Metadata>,

    /// Sysvar Instructions
    /// CHECK: Sysvar account
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    /// Registry authority (needed to verify collection)
    /// CHECK: Must match config.authority
    #[account(constraint = authority.key() == config.authority)]
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentAccount::MAX_SIZE,
        seeds = [b"agent", agent_mint.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Agent NFT mint (created by this instruction, part of collection)
    #[account(
        init,
        payer = owner,
        mint::decimals = 0,
        mint::authority = owner.key(),
        mint::freeze_authority = owner.key(),
    )]
    pub agent_mint: Account<'info, Mint>,

    /// Metaplex metadata account for the agent NFT
    /// CHECK: Created by Metaplex CPI
    #[account(mut)]
    pub agent_metadata: UncheckedAccount<'info>,

    /// Metaplex master edition account for the agent NFT
    /// CHECK: Created by Metaplex CPI
    #[account(mut)]
    pub agent_master_edition: UncheckedAccount<'info>,

    /// Token account to receive the agent NFT
    #[account(
        init,
        payer = owner,
        associated_token::mint = agent_mint,
        associated_token::authority = owner,
    )]
    pub agent_token_account: Account<'info, TokenAccount>,

    // Collection accounts (for verification)
    #[account(constraint = collection_mint.key() == config.collection_mint)]
    pub collection_mint: Account<'info, Mint>,

    /// CHECK: Checked by Metaplex
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// CHECK: Checked by Metaplex
    pub collection_master_edition: UncheckedAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,

    /// Metaplex Token Metadata program
    pub token_metadata_program: Program<'info, Metadata>,

    /// Sysvar Instructions
    /// CHECK: Sysvar account
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GetMetadata<'info> {
    #[account(
        seeds = [b"agent", agent_account.agent_mint.as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,
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
    pub token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
#[instruction(extension_index: u8)]
pub struct CreateMetadataExtension<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + MetadataExtension::MAX_SIZE,
        seeds = [b"metadata_ext", agent_mint.key().as_ref(), &[extension_index]],
        bump
    )]
    pub metadata_extension: Account<'info, MetadataExtension>,

    /// Agent NFT mint (for PDA derivation)
    pub agent_mint: Account<'info, Mint>,

    /// Agent account (to verify ownership)
    #[account(
        seeds = [b"agent", agent_mint.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner == owner.key() @ IdentityError::Unauthorized
    )]
    pub agent_account: Account<'info, AgentAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(extension_index: u8)]
pub struct SetMetadataExtended<'info> {
    #[account(
        mut,
        seeds = [b"metadata_ext", agent_mint.key().as_ref(), &[extension_index]],
        bump = metadata_extension.bump
    )]
    pub metadata_extension: Account<'info, MetadataExtension>,

    /// Agent NFT mint (for PDA derivation)
    pub agent_mint: Account<'info, Mint>,

    /// Agent account (to verify ownership)
    #[account(
        seeds = [b"agent", agent_mint.key().as_ref()],
        bump = agent_account.bump,
        constraint = agent_account.owner == owner.key() @ IdentityError::Unauthorized
    )]
    pub agent_account: Account<'info, AgentAccount>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(extension_index: u8)]
pub struct GetMetadataExtended<'info> {
    #[account(
        seeds = [b"metadata_ext", agent_mint.key().as_ref(), &[extension_index]],
        bump = metadata_extension.bump
    )]
    pub metadata_extension: Account<'info, MetadataExtension>,

    /// Agent NFT mint (for PDA derivation)
    pub agent_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct TransferAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_account.agent_mint.as_ref()],
        bump = agent_account.bump
    )]
    pub agent_account: Account<'info, AgentAccount>,

    /// Source token account
    #[account(
        mut,
        constraint = from_token_account.mint == agent_account.agent_mint @ IdentityError::InvalidTokenAccount,
        constraint = from_token_account.owner == owner.key() @ IdentityError::Unauthorized,
        constraint = from_token_account.amount == 1 @ IdentityError::InvalidTokenAccount
    )]
    pub from_token_account: Account<'info, TokenAccount>,

    /// Destination token account
    #[account(
        mut,
        constraint = to_token_account.mint == agent_account.agent_mint @ IdentityError::InvalidTokenAccount
    )]
    pub to_token_account: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ============================================================================
// Events
// ============================================================================

/// Event emitted when a new agent is registered (ERC-8004 spec: Registered)
#[event]
pub struct Registered {
    pub agent_id: u64,
    pub token_uri: String,
    pub owner: Pubkey,
    pub agent_mint: Pubkey, // Solana-specific: SPL Token mint address
}

/// Event emitted when agent metadata is set (ERC-8004 spec: MetadataSet)
#[event]
pub struct MetadataSet {
    pub agent_id: u64,
    pub indexed_key: String, // Duplicate for indexing (like Ethereum)
    pub key: String,
    pub value: Vec<u8>,
}

/// Event emitted when agent URI is updated (ERC-8004 spec: UriUpdated)
#[event]
pub struct UriUpdated {
    pub agent_id: u64,
    pub new_uri: String,
    pub updated_by: Pubkey, // Who performed the update
}

/// Event emitted when agent owner is synced after transfer
#[event]
pub struct AgentOwnerSynced {
    pub agent_id: u64,
    pub old_owner: Pubkey,
    pub new_owner: Pubkey,
    pub agent_mint: Pubkey,
}
