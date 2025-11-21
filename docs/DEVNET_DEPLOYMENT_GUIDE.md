# Devnet Deployment Guide - ERC-8004 Solana

## Overview

This guide provides step-by-step instructions for deploying ERC-8004 programs to Solana Devnet and running E2E tests.

**Prerequisites**:
- Solana CLI installed (v1.18+)
- Anchor CLI installed (v0.32+)
- Node.js v18+ and npm
- SOL tokens on devnet (airdrop available)

---

## Pre-Deployment Checklist

### 1. Environment Setup

```bash
# Verify Solana installation
solana --version
# Expected: solana-cli 1.18.x or higher

# Verify Anchor installation
anchor --version
# Expected: anchor-cli 0.32.1 or higher

# Set Solana to devnet
solana config set --url https://api.devnet.solana.com

# Verify network
solana config get
# Expected: RPC URL: https://api.devnet.solana.com
```

### 2. Wallet Setup

```bash
# Check current wallet
solana address

# Check SOL balance
solana balance

# If balance is low, request airdrop
solana airdrop 2

# Verify balance again
solana balance
# Expected: At least 5 SOL for deployment
```

### 3. Build Programs

```bash
cd /Users/true/Documents/Pipeline/CasterCorp/8004-solana

# Clean previous builds
anchor clean

# Build all programs
anchor build

# Verify build success
ls -la target/deploy/*.so
# Expected: identity_registry.so, reputation_registry.so, validation_registry.so
```

---

## Deployment Steps

### Step 1: Deploy Identity Registry

```bash
# Deploy identity-registry program
anchor deploy --provider.cluster devnet --program-name identity_registry

# Expected output:
# Program Id: <IDENTITY_PROGRAM_ID>
# Signature: <TX_SIGNATURE>
```

**Save the Program ID** - you'll need it for configuration.

### Step 2: Deploy Reputation Registry

```bash
# Deploy reputation-registry program
anchor deploy --provider.cluster devnet --program-name reputation_registry

# Expected output:
# Program Id: <REPUTATION_PROGRAM_ID>
# Signature: <TX_SIGNATURE>
```

**Save the Program ID** for configuration.

### Step 3: Deploy Validation Registry

```bash
# Deploy validation-registry program
anchor deploy --provider.cluster devnet --program-name validation_registry

# Expected output:
# Program Id: <VALIDATION_PROGRAM_ID>
# Signature: <TX_SIGNATURE>
```

**Save the Program ID**.

### Step 4: Update Anchor.toml

Update `Anchor.toml` with the deployed program IDs:

```toml
[programs.devnet]
identity_registry = "<IDENTITY_PROGRAM_ID>"
reputation_registry = "<REPUTATION_PROGRAM_ID>"
validation_registry = "<VALIDATION_PROGRAM_ID>"

[provider]
cluster = "Devnet"
wallet = "/Users/true/.config/solana/id.json"
```

### Step 5: Verify Deployments

```bash
# Verify identity-registry
solana program show <IDENTITY_PROGRAM_ID>

# Verify reputation-registry
solana program show <REPUTATION_PROGRAM_ID>

# Verify validation-registry
solana program show <VALIDATION_PROGRAM_ID>
```

Expected output for each:
```
Program Id: <PROGRAM_ID>
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: <DATA_ADDRESS>
Authority: <YOUR_WALLET>
Last Deployed Slot: <SLOT>
Data Length: <SIZE> bytes
```

---

## Initialize Programs

### Initialize Validation Registry

```bash
# Run initialization script
anchor run init-validation --provider.cluster devnet

# Or manually via TypeScript:
npx ts-node scripts/init-validation-devnet.ts
```

**Create `scripts/init-validation-devnet.ts`**:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ValidationRegistry } from "../target/types/validation_registry";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const validationProgramId = program.programId;

  const [globalStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("validation_state")],
    validationProgramId
  );

  try {
    await program.methods
      .initialize()
      .accounts({
        globalState: globalStatePda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Validation Registry initialized successfully");
    console.log("Global State PDA:", globalStatePda.toString());
  } catch (err) {
    if (err.toString().includes("already in use")) {
      console.log("✅ Validation Registry already initialized");
    } else {
      throw err;
    }
  }
}

main().catch(console.error);
```

---

## E2E Testing on Devnet

### Test 1: Register Agent

```bash
# Run E2E test script
npx ts-node scripts/e2e-register-agent-devnet.ts
```

**Create `scripts/e2e-register-agent-devnet.ts`**:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IdentityRegistry } from "../target/types/identity_registry";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;

  const agentUri = "ipfs://QmDevnetTestAgent";
  const metadataUri = "ipfs://QmDevnetTestMetadata";
  const fileHash = Buffer.alloc(32, 1);

  console.log("Registering agent on devnet...");

  const tx = await identityProgram.methods
    .registerAgent(agentUri, metadataUri, fileHash)
    .accounts({
      agent: null,
      owner: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Agent registered successfully");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  // Get agent ID
  const events = await identityProgram.account.agent.all();
  const agentAccount = events[events.length - 1].account;
  console.log("Agent ID:", agentAccount.agentId.toString());
  console.log("Agent Mint:", agentAccount.agentMint.toString());
}

main().catch(console.error);
```

### Test 2: Give Feedback with feedbackAuth

```bash
npx ts-node scripts/e2e-give-feedback-devnet.ts
```

**Create `scripts/e2e-give-feedback-devnet.ts`**:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ReputationRegistry } from "../target/types/reputation_registry";
import * as nacl from "tweetnacl";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;

  // Get latest agent
  const events = await identityProgram.account.agent.all();
  const agentAccount = events[events.length - 1].account;
  const agentId = agentAccount.agentId;

  console.log("Giving feedback for agent:", agentId.toString());

  // Create feedbackAuth
  const now = Math.floor(Date.now() / 1000);
  const feedbackAuth = {
    agentId,
    clientAddress: provider.wallet.publicKey,
    indexLimit: new BN(10),
    expiry: new BN(now + 3600),
    chainId: "solana-devnet",
    identityRegistry: identityProgram.programId,
    signerAddress: provider.wallet.publicKey,
    signature: Buffer.alloc(64, 0),
  };

  // TODO: Implement proper Ed25519 signing

  const tag1 = Buffer.alloc(32, 1);
  const tag2 = Buffer.alloc(32, 2);
  const fileUri = "ipfs://QmDevnetFeedback";
  const fileHash = Buffer.alloc(32, 3);
  const feedbackIndex = new BN(0);

  const [feedbackPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback"),
      agentId.toArrayLike(Buffer, "le", 8),
      provider.wallet.publicKey.toBuffer(),
      feedbackIndex.toArrayLike(Buffer, "le", 8),
    ],
    reputationProgram.programId
  );

  const [agentPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentId.toArrayLike(Buffer, "le", 8)],
    identityProgram.programId
  );

  const [aggregatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("aggregate"),
      agentId.toArrayLike(Buffer, "le", 8),
      identityProgram.programId.toBuffer(),
    ],
    reputationProgram.programId
  );

  const tx = await reputationProgram.methods
    .giveFeedback(agentId, 85, tag1, tag2, fileUri, fileHash, feedbackIndex, feedbackAuth)
    .accounts({
      feedback: feedbackPda,
      aggregate: aggregatePda,
      agent: agentPda,
      client: provider.wallet.publicKey,
      identityRegistry: identityProgram.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Feedback submitted successfully");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
}

main().catch(console.error);
```

### Test 3: Request Validation

```bash
npx ts-node scripts/e2e-request-validation-devnet.ts
```

**Create `scripts/e2e-request-validation-devnet.ts`**:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ValidationRegistry } from "../target/types/validation_registry";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;

  // Get latest agent
  const events = await identityProgram.account.agent.all();
  const agentAccount = events[events.length - 1].account;
  const agentId = agentAccount.agentId;
  const agentMint = agentAccount.agentMint;

  console.log("Requesting validation for agent:", agentId.toString());

  const [agentPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentId.toArrayLike(Buffer, "le", 8)],
    identityProgram.programId
  );

  // Create validator (can be any address)
  const validator = anchor.web3.Keypair.generate();

  // Airdrop to validator
  const airdropSig = await provider.connection.requestAirdrop(
    validator.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropSig);

  const nonce = 0;
  const [validationPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("validation"),
      agentMint.toBuffer(),
      validator.publicKey.toBuffer(),
      new BN(nonce).toArrayLike(Buffer, "le", 8),
    ],
    validationProgram.programId
  );

  const [globalStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("validation_state")],
    validationProgram.programId
  );

  const tx = await validationProgram.methods
    .requestValidation("ipfs://QmDevnetValidation", nonce)
    .accounts({
      validation: validationPda,
      agent: agentPda,
      validator: validator.publicKey,
      agentOwner: provider.wallet.publicKey,
      globalState: globalStatePda,
      identityRegistry: identityProgram.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Validation requested successfully");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
}

main().catch(console.error);
```

---

## Run Full Test Suite on Devnet

```bash
# Set environment for devnet
export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
export ANCHOR_WALLET="/Users/true/.config/solana/id.json"

# Run tests (skip build since already deployed)
anchor test --skip-build --skip-deploy

# Expected output:
# ✓ All tests passing on devnet
```

---

## Monitoring & Verification

### 1. Transaction Explorer

Visit https://explorer.solana.com/?cluster=devnet and search for:
- Program IDs
- Transaction signatures
- Account addresses

### 2. Check Program Accounts

```bash
# List all agents
solana program show <IDENTITY_PROGRAM_ID> --accounts

# Get account data
solana account <AGENT_PDA_ADDRESS>
```

### 3. Query On-Chain Data

```typescript
// Get all agents
const agents = await identityProgram.account.agent.all();
console.log("Total agents:", agents.length);

// Get all feedbacks
const feedbacks = await reputationProgram.account.feedback.all();
console.log("Total feedbacks:", feedbacks.length);

// Get all validations
const validations = await validationProgram.account.validationAccount.all();
console.log("Total validations:", validations.length);
```

---

## Cost Analysis on Devnet

Run cost measurement after deployment:

```bash
# Measure actual devnet costs
npx ts-node scripts/measure-devnet-costs.ts
```

**Create `scripts/measure-devnet-costs.ts`**:

```typescript
import * as anchor from "@coral-xyz/anchor";

async function main() {
  const provider = anchor.AnchorProvider.env();
  const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

  // Perform various operations...
  // (register agent, give feedback, request validation)

  const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
  const totalCost = (balanceBefore - balanceAfter) / anchor.web3.LAMPORTS_PER_SOL;

  console.log("Total cost:", totalCost, "SOL");
  console.log("USD equivalent (at $100/SOL):", totalCost * 100);
}

main().catch(console.error);
```

---

## Troubleshooting

### Issue: Insufficient SOL

**Solution**:
```bash
solana airdrop 5
```

### Issue: Program Already Deployed

**Solution**:
```bash
# Upgrade existing program
anchor upgrade target/deploy/identity_registry.so --program-id <PROGRAM_ID> --provider.cluster devnet
```

### Issue: Transaction Failed

**Solutions**:
1. Check Solana Explorer for error details
2. Verify account PDAs are correct
3. Ensure sufficient SOL for rent
4. Check program logs:
```bash
solana logs <PROGRAM_ID>
```

### Issue: Tests Timeout

**Solution**:
```bash
# Increase timeout in test config
# Or run individual tests
anchor test --skip-build --skip-deploy -- --grep "Register Agent"
```

---

## Cleanup (Optional)

### Close Test Accounts

```bash
# Close validation accounts to recover rent
npx ts-node scripts/close-devnet-accounts.ts
```

### Revoke Program Authority

**Warning**: Only do this if you're done testing

```bash
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <NEW_AUTHORITY>
```

---

## Next Steps After Devnet

### 1. Production Checklist

- [ ] Complete Ed25519 signature verification
- [ ] Security audit (optional but recommended)
- [ ] Load testing on devnet
- [ ] Documentation review
- [ ] Community feedback

### 2. Mainnet Preparation

- [ ] Update Anchor.toml for mainnet
- [ ] Secure deployment wallet
- [ ] Prepare upgrade authority
- [ ] Plan versioning strategy
- [ ] Set up monitoring

### 3. Mainnet Deployment

```bash
# Switch to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Deploy programs (same process as devnet)
anchor deploy --provider.cluster mainnet-beta

# IMPORTANT: Save program IDs and upgrade authority keys
```

---

## Support

**Issues**: https://github.com/QuantumAgentic/erc8004-solana/issues
**Documentation**: README.md, IMPLEMENTATION_SUMMARY.md
**Devnet Explorer**: https://explorer.solana.com/?cluster=devnet

---

**Document Version**: 1.0
**Last Updated**: 2025-01-20
**Status**: Ready for Deployment
