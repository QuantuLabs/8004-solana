/**
 * Real E2E Test: FeedbackAuth with SDK on Devnet
 *
 * This script uses the agent0-ts-solana SDK to:
 * 1. Create a real agent on devnet
 * 2. Submit feedback with feedbackAuth + Ed25519 validation
 * 3. Measure real transaction costs
 *
 * Usage:
 *   npx ts-node tests/e2e/feedbackauth-real-sdk.ts
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { SolanaSDK } from '../../../agent0-ts-solana/src/index.js';
import { createFeedbackAuth } from '../../../agent0-ts-solana/src/core/feedback-auth.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';

interface CostMeasurement {
  operation: string;
  signature: string;
  cost: number;
  computeUnits?: number;
}

function loadKeypair(): Keypair {
  const keypairPath = process.env.AGENT_OWNER_KEYPAIR ||
                      `${process.env.HOME}/.config/solana/id.json`;
  console.log(`📂 Loading keypair from: ${keypairPath}`);
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

async function getCostFromSignature(
  connection: Connection,
  signature: string
): Promise<{ cost: number; computeUnits?: number }> {
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return { cost: 0 };
  }

  const cost = tx.meta?.fee || 0;

  // Extract compute units from logs
  let computeUnits: number | undefined;
  if (tx.meta?.logMessages) {
    for (const log of tx.meta.logMessages) {
      const match = log.match(/consumed (\d+) of/);
      if (match) {
        computeUnits = parseInt(match[1]);
        break;
      }
    }
  }

  return { cost, computeUnits };
}

async function main() {
  console.log('\n🚀 FeedbackAuth Real E2E Test with SDK\n');
  console.log('='.repeat(70));

  // Setup
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const agentOwner = loadKeypair();

  console.log(`\n✅ Connected to devnet`);
  console.log(`👤 Agent owner: ${agentOwner.publicKey.toBase58()}`);

  const balanceBefore = await connection.getBalance(agentOwner.publicKey);
  console.log(`💰 Balance before: ${balanceBefore / LAMPORTS_PER_SOL} SOL`);

  if (balanceBefore < 0.1 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance. Need at least 0.1 SOL.');
    console.log('💡 Get devnet SOL: solana airdrop 1 --url devnet');
    process.exit(1);
  }

  // Initialize SDK with signer
  const sdk = new SolanaSDK({
    cluster: 'devnet',
    rpcUrl: DEVNET_RPC,
    signer: agentOwner,
  });

  const costs: CostMeasurement[] = [];

  // Step 1: Register a real agent
  console.log(`\n\n📝 STEP 1: Register Agent`);
  console.log('─'.repeat(70));

  let agentId: bigint;
  let agentMint: PublicKey;

  try {
    console.log(`🆕 Registering new agent...`);

    const result = await sdk.identity.registerAgent(
      'ipfs://QmTestFeedbackAuthAgent',
      [
        { key: 'name', value: 'FeedbackAuth Test Agent' },
        { key: 'description', value: 'Test agent for measuring feedbackAuth costs' },
      ]
    );

    if (!result.success || !result.agentId || !result.agentMint) {
      throw new Error(`Agent registration failed: ${result.error}`);
    }

    agentId = result.agentId;
    agentMint = result.agentMint;

    console.log(`✅ Agent registered!`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Agent Mint: ${agentMint.toBase58()}`);
    console.log(`   Signatures: ${result.signatures?.join(', ')}`);

    // Calculate costs for all signatures
    if (result.signatures) {
      for (const sig of result.signatures) {
        const costData = await getCostFromSignature(connection, sig);
        costs.push({
          operation: 'Register Agent',
          signature: sig,
          cost: costData.cost,
          computeUnits: costData.computeUnits,
        });
        console.log(`   Cost (${sig.slice(0, 8)}...): ${costData.cost / LAMPORTS_PER_SOL} SOL (${costData.cost} lamports)`);
        if (costData.computeUnits) {
          console.log(`   Compute Units: ${costData.computeUnits.toLocaleString()}`);
        }
      }
    }

    // Wait for confirmation
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (err: any) {
    console.error('❌ Agent registration failed:', err.message || err);
    process.exit(1);
  }

  // Step 2: Create client
  console.log(`\n\n📝 STEP 2: Client Setup`);
  console.log('─'.repeat(70));

  const client = Keypair.generate();
  console.log(`👥 Client: ${client.publicKey.toBase58()}`);

  console.log(`💸 Requesting airdrop for client...`);
  try {
    const airdropSig = await connection.requestAirdrop(
      client.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log(`✅ Airdrop confirmed`);
  } catch (err) {
    console.error('❌ Airdrop failed:', err);
    process.exit(1);
  }

  // Step 3: Create FeedbackAuth
  console.log(`\n\n📝 STEP 3: Submit Feedback with FeedbackAuth`);
  console.log('─'.repeat(70));

  try {
    // Create feedbackAuth with Ed25519 signature
    console.log(`🔐 Creating feedbackAuth...`);

    const feedbackAuth = createFeedbackAuth({
      agentId,
      clientAddress: client.publicKey,
      indexLimit: 10,
      expirySeconds: 3600, // 1 hour
      signerKeypair: agentOwner,
      cluster: 'devnet',
    });

    console.log(`✅ FeedbackAuth created:`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Client: ${client.publicKey.toBase58()}`);
    console.log(`   Index Limit: 10`);
    console.log(`   Expiry: ${feedbackAuth.expiry}`);
    console.log(`   Signer: ${agentOwner.publicKey.toBase58()}`);

    // Submit feedback using SDK (which should include Ed25519 validation)
    console.log(`\n📤 Submitting feedback with feedbackAuth...`);

    // Initialize SDK for client
    const clientSdk = new SolanaSDK({
      cluster: 'devnet',
      rpcUrl: DEVNET_RPC,
      signer: client,
    });

    const feedbackResult = await clientSdk.reputation.giveFeedback(
      agentId,
      85, // score
      'ipfs://QmTestFeedback',
      Buffer.alloc(32), // fileHash
      Buffer.from('quality'.padEnd(32, '\0')), // tag1
      Buffer.from('responsive'.padEnd(32, '\0')), // tag2
      feedbackAuth
    );

    if (!feedbackResult.success) {
      throw new Error(`Feedback submission failed: ${feedbackResult.error}`);
    }

    console.log(`✅ Feedback submitted!`);
    console.log(`   TX: ${feedbackResult.signature}`);

    // Calculate cost
    const feedbackCost = await getCostFromSignature(connection, feedbackResult.signature);
    costs.push({
      operation: 'Give Feedback (with FeedbackAuth + Ed25519)',
      signature: feedbackResult.signature,
      cost: feedbackCost.cost,
      computeUnits: feedbackCost.computeUnits,
    });

    console.log(`   Cost: ${feedbackCost.cost / LAMPORTS_PER_SOL} SOL (${feedbackCost.cost} lamports)`);
    if (feedbackCost.computeUnits) {
      console.log(`   Compute Units: ${feedbackCost.computeUnits.toLocaleString()}`);
    }

  } catch (err: any) {
    console.error('❌ Feedback submission failed:', err.message || err);
    if (err.logs) {
      console.error('   Logs:', err.logs);
    }
    process.exit(1);
  }

  // Final balance
  const balanceAfter = await connection.getBalance(agentOwner.publicKey);
  const totalSpent = balanceBefore - balanceAfter;

  // Cost summary
  console.log(`\n\n💰 COST SUMMARY`);
  console.log('='.repeat(70));

  let totalTxCost = 0;
  for (const cost of costs) {
    console.log(`\n${cost.operation}:`);
    console.log(`  Signature: ${cost.signature}`);
    console.log(`  Cost: ${cost.cost / LAMPORTS_PER_SOL} SOL (${cost.cost} lamports)`);
    if (cost.computeUnits) {
      console.log(`  Compute Units: ${cost.computeUnits.toLocaleString()}`);
    }
    totalTxCost += cost.cost;
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Total Transaction Costs: ${totalTxCost / LAMPORTS_PER_SOL} SOL (${totalTxCost} lamports)`);
  console.log(`Wallet Balance Change: ${totalSpent / LAMPORTS_PER_SOL} SOL (${totalSpent} lamports)`);
  console.log(`Account Rent (estimated): ${(totalSpent - totalTxCost) / LAMPORTS_PER_SOL} SOL`);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`\n✅ Real E2E Test Complete with Cost Measurement!\n`);
  console.log(`🎉 FeedbackAuth working on devnet with real agent!\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });
