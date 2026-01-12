# Metaplex Integration Guide

**Purpose**: Document how we integrate Metaplex Token Metadata for NFT management in ERC-8004 implementation.

## Overview

Our implementation uses **Metaplex Token Metadata** to manage NFT metadata while the **program controls minting** (as required by ERC-8004 spec). This follows the standard Solana NFT pattern.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Identity Registry Program               │
│  (Controls minting per ERC-8004 spec)               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. Mint NFT via SPL Token                          │
│     token::mint_to() → 1 token                      │
│                                                      │
│  2. Create Metaplex Metadata                        │
│     CreateV1CpiBuilder → metadata account           │
│                                                      │
│  3. Verify Collection (optional)                    │
│     SetAndVerifyCollectionCpiBuilder                │
│                                                      │
└─────────────────────────────────────────────────────┘
         │                            │
         ▼                            ▼
┌──────────────────┐        ┌──────────────────┐
│   SPL Token      │        │  Metaplex Token  │
│   (Minting)      │        │  Metadata        │
└──────────────────┘        └──────────────────┘
```

## Why This Design?

### ERC-8004 Requirement
The ERC-8004 spec explicitly states:
```solidity
function register(string tokenURI) returns (uint256 agentId)
```

**"New agents can be minted by calling one of these functions"** - the contract MUST control minting, not the user.

### Solana Best Practice
On Solana, the standard pattern is:
1. **Program mints the NFT** via `token::mint_to()`
2. **Metaplex manages metadata** via `CreateV1`

This is exactly what we do!

## Implementation Details

### 1. Collection NFT (Initialize)

Created once during registry initialization:

```rust
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    // Step 1: Mint 1 collection NFT to authority
    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.collection_mint.to_account_info(),
                to: ctx.accounts.collection_token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        1, // Amount = 1 (NFT)
    )?;

    // Step 2: Create Metaplex Collection metadata
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

    Ok(())
}
```

**Result**:
- ✅ Collection NFT minted (supply = 1)
- ✅ Metaplex metadata created
- ✅ Master edition for uniqueness
- ✅ Zero print supply (no copies)

### 2. Agent NFTs (Register)

Created for each agent registration:

```rust
pub fn register_internal(
    mut ctx: Context<Register>,
    token_uri: String,
    metadata: Vec<MetadataEntry>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let agent_id = config.next_agent_id;

    // Step 1: Mint 1 agent NFT to owner
    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.agent_mint.to_account_info(),
                to: ctx.accounts.agent_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        1, // Amount = 1 (NFT)
    )?;

    // Step 2: Create Metaplex NFT metadata WITH collection reference
    let agent_name = format!("Agent #{}", agent_id);

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
        .name(agent_name) // "Agent #0", "Agent #1", etc.
        .uri(token_uri.clone()) // IPFS/Arweave URI
        .seller_fee_basis_points(0)
        .token_standard(TokenStandard::NonFungible)
        .print_supply(PrintSupply::Zero)
        .collection(Collection {
            verified: false, // Will be verified in next step
            key: config.collection_mint,
        })
        .invoke()?;

    // Step 3: Verify collection membership (requires collection authority)
    // IMPORTANT: update_authority must match the NFT's update authority set in CreateV1
    SetAndVerifyCollectionCpiBuilder::new(
        &ctx.accounts.token_metadata_program.to_account_info(),
    )
    .metadata(&ctx.accounts.agent_metadata)
    .collection_authority(&ctx.accounts.authority.to_account_info())
    .payer(&ctx.accounts.owner.to_account_info())
    .update_authority(&ctx.accounts.owner.to_account_info())  // Must be owner (NFT's update authority)
    .collection_mint(&ctx.accounts.collection_mint.to_account_info())
    .collection(&ctx.accounts.collection_metadata)
    .collection_master_edition_account(&ctx.accounts.collection_master_edition)
    .invoke()?;

    // Step 4: Store agent data in our custom account
    let agent = &mut ctx.accounts.agent_account;
    agent.agent_id = agent_id;
    agent.owner = ctx.accounts.owner.key();
    agent.agent_mint = ctx.accounts.agent_mint.key();
    agent.token_uri = token_uri.clone();
    agent.metadata = metadata.clone();
    // ...

    Ok(())
}
```

**Result**:
- ✅ Agent NFT minted (supply = 1)
- ✅ Metaplex metadata with name "Agent #X"
- ✅ Master edition for uniqueness
- ✅ **Linked to collection** (verified)
- ✅ Custom AgentAccount with ERC-8004 data

## Metaplex Builder Parameters Explained

### `.mint(account, is_mutable)`

```rust
.mint(&ctx.accounts.agent_mint.to_account_info(), true)
```

- **First param**: The mint account (already created)
- **Second param**: Whether mint account is mutable
  - `true` = Mint authority can be changed later
  - `false` = Mint authority is immutable

**Important**: This does NOT control minting! Minting is done separately via `token::mint_to()`.

### `.authority()`

```rust
.authority(&ctx.accounts.owner.to_account_info())
```

The account that has authority over the mint. This is for Metaplex metadata creation, not for minting tokens.

### `.collection()`

```rust
.collection(Collection {
    verified: false,
    key: config.collection_mint,
})
```

Links the NFT to a collection. Must call `SetAndVerifyCollectionCpiBuilder` afterwards to set `verified: true`.

## Collection Structure

```
ERC-8004 Agent Registry (Collection NFT)
├── Agent #0 (NFT)
├── Agent #1 (NFT)
├── Agent #2 (NFT)
└── Agent #3 (NFT)
```

All agents are part of the "ERC-8004 Agent Registry" collection, making them easily discoverable and verifiable.

## Benefits of This Approach

### 1. ERC-8004 Compliance
✅ Program controls minting (required by spec)
✅ Sequential agent IDs
✅ Owner-controlled metadata

### 2. Metaplex Standard
✅ NFT metadata follows Metaplex standard
✅ Compatible with wallets (Phantom, Solflare, etc.)
✅ Compatible with marketplaces (Magic Eden, Tensor, etc.)
✅ Collection support for discoverability

### 3. Solana Best Practice
✅ Program mints via SPL Token (standard)
✅ Metaplex manages metadata (standard)
✅ Master editions prevent duplicates
✅ Verified collections for authenticity

## Common Questions

### Q: Why not let Metaplex handle minting?

**A**: Metaplex `CreateV1` does NOT mint tokens - it only creates metadata. Minting must be done separately via `token::mint_to()`, which is exactly what we do.

### Q: Why do we need both SPL Token and Metaplex?

**A**:
- **SPL Token**: Handles the token itself (minting, transferring, burning)
- **Metaplex**: Handles the metadata (name, URI, collection, royalties)

This separation is standard on Solana.

### Q: Is this the same as Ethereum ERC-721?

**A**: Yes! On Ethereum, the ERC-721 contract handles both token and metadata. On Solana, we use:
- SPL Token (like ERC-721 token logic)
- Metaplex (like ERC-721 metadata/URI)
- Our program (like ERC-721 contract)

### Q: Can we use this with Metaplex Candy Machine?

**A**: No - Candy Machine is for pre-minting NFT collections. Our program mints on-demand per the ERC-8004 spec (like Ethereum).

## Testing

Our test suite verifies:
- ✅ Collection NFT is created correctly
- ✅ Agent NFTs are minted with correct supply (supply = 1)
- ✅ Collection membership is verified
- ✅ Metadata is created with correct name/URI
- ✅ Transfer updates work correctly
- ✅ Owner sync after SPL Token transfers

**Status**: All 32 tests passing locally

## Next Steps

When deploying to devnet/mainnet:
1. Deploy the Identity Registry program
2. Call `initialize()` to create the collection NFT
3. Users call `register()` to mint their agent NFTs
4. All agents automatically linked to collection

## References

- **Metaplex Token Metadata**: https://docs.metaplex.com/token-metadata
- **ERC-8004 Spec**: https://eips.ethereum.org/EIPS/eip-8004
- **SPL Token**: https://spl.solana.com/token
- **Our Implementation**: `programs/identity-registry/src/lib.rs`
