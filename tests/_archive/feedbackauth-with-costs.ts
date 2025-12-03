/**
 * E2E Test: FeedbackAuth with Cost Measurement on Devnet
 *
 * This script creates an agent (if needed) and tests feedbackAuth with real cost tracking
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as nacl from "tweetnacl";
import { ReputationRegistry } from "../../target/types/reputation_registry";
import { IdentityRegistry } from "../../target/types/identity_registry";

// Devnet configuration
const DEVNET_RPC = "https://api.devnet.solana.com";
const IDENTITY_PROGRAM_ID = new PublicKey("2dtvC4hyb7M6fKwNx1C6h4SrahYvor3xW11eH6uLNvSZ");
const REPUTATION_PROGRAM_ID = new PublicKey("9Ugqviy6fxvdkrojvvDR6dAq2W4LPchxHTQiNXzMpS3h");

interface CostSummary {
  operation: string;
  signature: string;
  cost: number;
  computeUnits?: number;
}

function loadKeypair(): Keypair {
  const keypairPath = process.env.AGENT_OWNER_KEYPAIR ||
                      `${process.env.HOME}/.config/solana/id.json`;
  console.log(`📂 Loading keypair from: ${keypairPath}`);
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

function getAgentPda(agentMint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentMint.toBuffer()],
    programId
  );
}

function getGlobalStatePda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("global_state")], programId);
}

function getFeedbackPda(
  agentId: number,
  client: PublicKey,
  feedbackIndex: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback"),
      Buffer.from(new BN(agentId).toArray("le", 8)),
      client.toBuffer(),
      Buffer.from(new BN(feedbackIndex).toArray("le", 8)),
    ],
    programId
  );
}

function getClientIndexPda(
  agentId: number,
  client: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("client_index"),
      Buffer.from(new BN(agentId).toArray("le", 8)),
      client.toBuffer(),
    ],
    programId
  );
}

function getAgentReputationPda(agentId: number, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_reputation"), Buffer.from(new BN(agentId).toArray("le", 8))],
    programId
  );
}

function createFeedbackAuth(
  agentId: number,
  clientAddress: PublicKey,
  indexLimit: number,
  expiryOffset: number,
  signerKeypair: Keypair,
  identityProgramId: PublicKey
): any {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + expiryOffset;
  const message = `feedback_auth:${agentId}:${clientAddress.toBase58()}:${indexLimit}:${expiry}:solana-devnet:${identityProgramId.toBase58()}`;
  const messageBytes = Buffer.from(message, "utf8");
  const signature = nacl.sign.detached(messageBytes, signerKeypair.secretKey);

  return {
    agentId: new BN(agentId),
    clientAddress: clientAddress,
    indexLimit: new BN(indexLimit),
    expiry: new BN(expiry),
    chainId: "solana-devnet",
    identityRegistry: identityProgramId,
    signerAddress: signerKeypair.publicKey,
    signature: Buffer.from(signature),
    _messageBytes: messageBytes,
  };
}

function createEd25519Instruction(feedbackAuth: any): anchor.web3.TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: feedbackAuth.signerAddress.toBytes(),
    message: feedbackAuth._messageBytes,
    signature: feedbackAuth.signature,
  });
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

  // Try to extract compute units used
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
  console.log("\n🚀 FeedbackAuth E2E Test with Cost Measurement\n");
  console.log("=".repeat(70));

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const agentOwner = loadKeypair();
  const wallet = new Wallet(agentOwner);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log(`\n✅ Connected to devnet`);
  console.log(`👤 Wallet: ${agentOwner.publicKey.toBase58()}`);

  const balanceBefore = await connection.getBalance(agentOwner.publicKey);
  console.log(`💰 Balance: ${balanceBefore / LAMPORTS_PER_SOL} SOL`);

  if (balanceBefore < 0.1 * LAMPORTS_PER_SOL) {
    console.error("❌ Insufficient balance. Need at least 0.1 SOL.");
    console.log("💡 Get devnet SOL: solana airdrop 1 --url devnet");
    process.exit(1);
  }

  // Load programs
  const reputationProgram = new Program(
    require("../../target/idl/reputation_registry.json"),
    REPUTATION_PROGRAM_ID,
    provider
  ) as Program<ReputationRegistry>;

  const identityProgram = new Program(
    require("../../target/idl/identity_registry.json"),
    IDENTITY_PROGRAM_ID,
    provider
  ) as Program<IdentityRegistry>;

  console.log(`\n📋 Programs:`);
  console.log(`   Identity: ${IDENTITY_PROGRAM_ID.toBase58()}`);
  console.log(`   Reputation: ${REPUTATION_PROGRAM_ID.toBase58()}`);

  const costs: CostSummary[] = [];

  // Step 1: Create or find an agent
  console.log(`\n\n📝 STEP 1: Agent Registration`);
  console.log("─".repeat(70));

  const agentMint = Keypair.generate();
  const [agentPda] = getAgentPda(agentMint.publicKey, IDENTITY_PROGRAM_ID);
  const [globalStatePda] = getGlobalStatePda(IDENTITY_PROGRAM_ID);

  console.log(`🆕 Creating new agent...`);
  console.log(`   Mint: ${agentMint.publicKey.toBase58()}`);
  console.log(`   PDA: ${agentPda.toBase58()}`);

  try {
    const agentTx = await identityProgram.methods
      .createAgent("ipfs://QmTestAgent123", "Test Agent for FeedbackAuth")
      .accounts({
        agent: agentPda,
        agentMint: agentMint.publicKey,
        authority: agentOwner.publicKey,
        payer: agentOwner.publicKey,
        globalState: globalStatePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([agentMint])
      .rpc();

    console.log(`✅ Agent created!`);
    console.log(`   TX: ${agentTx}`);

    const agentCost = await getCostFromSignature(connection, agentTx);
    costs.push({
      operation: "Create Agent",
      signature: agentTx,
      cost: agentCost.cost,
      computeUnits: agentCost.computeUnits,
    });

    console.log(`   Cost: ${agentCost.cost / LAMPORTS_PER_SOL} SOL (${agentCost.cost} lamports)`);
    if (agentCost.computeUnits) {
      console.log(`   Compute Units: ${agentCost.computeUnits.toLocaleString()}`);
    }

    // Wait for confirmation
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (err: any) {
    console.error("❌ Agent creation failed:", err.message || err);
    if (err.logs) {
      console.error("   Logs:", err.logs);
    }
    process.exit(1);
  }

  // Fetch agent ID
  const agentAccount = await connection.getAccountInfo(agentPda);
  if (!agentAccount) {
    console.error("❌ Agent account not found after creation");
    process.exit(1);
  }

  const agentId = Number(new BN(agentAccount.data.slice(8, 16), "le"));
  console.log(`   Agent ID: ${agentId}`);

  // Step 2: Create client and airdrop
  console.log(`\n\n📝 STEP 2: Client Setup`);
  console.log("─".repeat(70));

  const client = Keypair.generate();
  console.log(`👥 Client: ${client.publicKey.toBase58()}`);

  console.log(`💸 Requesting airdrop...`);
  try {
    const airdropSig = await connection.requestAirdrop(
      client.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log(`✅ Airdrop confirmed`);
    console.log(`   TX: ${airdropSig}`);
  } catch (err) {
    console.error("❌ Airdrop failed:", err);
    process.exit(1);
  }

  // Step 3: Submit feedback with feedbackAuth
  console.log(`\n\n📝 STEP 3: Submit Feedback with FeedbackAuth`);
  console.log("─".repeat(70));

  const feedbackAuth = createFeedbackAuth(
    agentId,
    client.publicKey,
    10,
    3600,
    agentOwner,
    IDENTITY_PROGRAM_ID
  );

  console.log(`🔐 FeedbackAuth created:`);
  console.log(`   Agent ID: ${agentId}`);
  console.log(`   Client: ${client.publicKey.toBase58()}`);
  console.log(`   Index Limit: 10`);
  console.log(`   Signer: ${agentOwner.publicKey.toBase58()}`);

  const feedbackIndex = 0;
  const [feedbackPda] = getFeedbackPda(agentId, client.publicKey, feedbackIndex, REPUTATION_PROGRAM_ID);
  const [clientIndexPda] = getClientIndexPda(agentId, client.publicKey, REPUTATION_PROGRAM_ID);
  const [reputationPda] = getAgentReputationPda(agentId, REPUTATION_PROGRAM_ID);

  const score = 85;
  const tag1 = Buffer.alloc(32);
  tag1.write("quality");
  const tag2 = Buffer.alloc(32);
  tag2.write("responsive");
  const fileUri = "ipfs://QmDevnetTest123";
  const fileHash = Buffer.alloc(32);

  const ed25519Ix = createEd25519Instruction(feedbackAuth);

  console.log(`\n📤 Submitting feedback...`);
  try {
    const feedbackTx = await reputationProgram.methods
      .giveFeedback(
        new BN(agentId),
        score,
        Array.from(tag1),
        Array.from(tag2),
        fileUri,
        Array.from(fileHash),
        new BN(feedbackIndex),
        feedbackAuth
      )
      .accounts({
        client: client.publicKey,
        payer: client.publicKey,
        agentMint: agentMint.publicKey,
        agentAccount: agentPda,
        clientIndex: clientIndexPda,
        feedbackAccount: feedbackPda,
        agentReputation: reputationPda,
        identityRegistryProgram: IDENTITY_PROGRAM_ID,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .signers([client])
      .rpc();

    console.log(`✅ Feedback submitted!`);
    console.log(`   TX: ${feedbackTx}`);
    console.log(`   Feedback PDA: ${feedbackPda.toBase58()}`);

    const feedbackCost = await getCostFromSignature(connection, feedbackTx);
    costs.push({
      operation: "Give Feedback (with FeedbackAuth + Ed25519)",
      signature: feedbackTx,
      cost: feedbackCost.cost,
      computeUnits: feedbackCost.computeUnits,
    });

    console.log(`   Cost: ${feedbackCost.cost / LAMPORTS_PER_SOL} SOL (${feedbackCost.cost} lamports)`);
    if (feedbackCost.computeUnits) {
      console.log(`   Compute Units: ${feedbackCost.computeUnits.toLocaleString()}`);
    }
  } catch (err: any) {
    console.error("❌ Feedback submission failed:", err.message || err);
    if (err.logs) {
      console.error("   Logs:", err.logs);
    }
    process.exit(1);
  }

  // Verify feedback
  console.log(`\n🔍 Verifying feedback account...`);
  try {
    const feedbackAccount = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
    console.log(`✅ Feedback verified:`);
    console.log(`   Agent ID: ${feedbackAccount.agentId.toNumber()}`);
    console.log(`   Client: ${feedbackAccount.clientAddress.toBase58()}`);
    console.log(`   Score: ${feedbackAccount.score}`);
    console.log(`   Feedback Index: ${feedbackAccount.feedbackIndex.toNumber()}`);
  } catch (err) {
    console.error("❌ Failed to fetch feedback:", err);
  }

  // Final balance
  const balanceAfter = await connection.getBalance(agentOwner.publicKey);
  const totalSpent = balanceBefore - balanceAfter;

  // Cost summary
  console.log(`\n\n💰 COST SUMMARY`);
  console.log("=".repeat(70));

  let totalCost = 0;
  for (const cost of costs) {
    console.log(`\n${cost.operation}:`);
    console.log(`  Signature: ${cost.signature}`);
    console.log(`  Cost: ${cost.cost / LAMPORTS_PER_SOL} SOL (${cost.cost} lamports)`);
    if (cost.computeUnits) {
      console.log(`  Compute Units: ${cost.computeUnits.toLocaleString()}`);
    }
    totalCost += cost.cost;
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Total Transaction Costs: ${totalCost / LAMPORTS_PER_SOL} SOL (${totalCost} lamports)`);
  console.log(`Wallet Balance Change: ${totalSpent / LAMPORTS_PER_SOL} SOL (${totalSpent} lamports)`);
  console.log(`Account Rent (estimated): ${(totalSpent - totalCost) / LAMPORTS_PER_SOL} SOL`);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`\n✅ E2E Test Complete with Cost Measurement!\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  });
