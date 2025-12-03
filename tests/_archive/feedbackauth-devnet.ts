/**
 * E2E Test: FeedbackAuth Ed25519 Validation on Devnet
 *
 * This test validates the feedbackAuth Ed25519 signature verification
 * using the deployed reputation-registry program on devnet with real
 * agents from the identity-registry.
 *
 * Usage:
 *   AGENT_OWNER_KEYPAIR=/path/to/keypair.json npx ts-node tests/e2e/feedbackauth-devnet.ts
 *
 * Requirements:
 * - Devnet SOL for transactions
 * - An agent registered in identity-registry on devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import * as fs from "fs";
import * as nacl from "tweetnacl";
import { ReputationRegistry } from "../../target/types/reputation_registry";
import { IdentityRegistry } from "../../target/types/identity_registry";

// Devnet configuration
const DEVNET_RPC = "https://api.devnet.solana.com";
const IDENTITY_PROGRAM_ID = new PublicKey("2dtvC4hyb7M6fKwNx1C6h4SrahYvor3xW11eH6uLNvSZ");
const REPUTATION_PROGRAM_ID = new PublicKey("9Ugqviy6fxvdkrojvvDR6dAq2W4LPchxHTQiNXzMpS3h");

// Load keypair from environment or default
function loadKeypair(): Keypair {
  const keypairPath = process.env.AGENT_OWNER_KEYPAIR ||
                      `${process.env.HOME}/.config/solana/id.json`;

  console.log(`📂 Loading keypair from: ${keypairPath}`);
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

// Helper: Derive agent PDA from mint
function getAgentPda(agentMint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentMint.toBuffer()],
    programId
  );
}

// Helper: Derive feedback PDAs
function getFeedbackPda(
  agentId: number,
  client: PublicKey,
  feedbackIndex: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback"),
      Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
      client.toBuffer(),
      Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
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
      Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
      client.toBuffer(),
    ],
    programId
  );
}

function getAgentReputationPda(agentId: number, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_reputation"), Buffer.from(new anchor.BN(agentId).toArray("le", 8))],
    programId
  );
}

// Helper: Create FeedbackAuth with Ed25519 signature
function createFeedbackAuth(
  agentId: number,
  clientAddress: PublicKey,
  indexLimit: number,
  expiryOffset: number, // seconds from now
  signerKeypair: Keypair,
  identityProgramId: PublicKey
): any {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + expiryOffset;

  // Construct message to sign (matches Rust implementation)
  const message = `feedback_auth:${agentId}:${clientAddress.toBase58()}:${indexLimit}:${expiry}:solana-devnet:${identityProgramId.toBase58()}`;
  const messageBytes = Buffer.from(message, "utf8");

  // Sign with Ed25519 using nacl
  const signature = nacl.sign.detached(messageBytes, signerKeypair.secretKey);

  return {
    agentId: new anchor.BN(agentId),
    clientAddress: clientAddress,
    indexLimit: new anchor.BN(indexLimit),
    expiry: new anchor.BN(expiry),
    chainId: "solana-devnet",
    identityRegistry: identityProgramId,
    signerAddress: signerKeypair.publicKey,
    signature: Buffer.from(signature),
    // Store message bytes for Ed25519 instruction
    _messageBytes: messageBytes,
  };
}

// Helper: Create Ed25519Program verification instruction
function createEd25519Instruction(feedbackAuth: any): anchor.web3.TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: feedbackAuth.signerAddress.toBytes(),
    message: feedbackAuth._messageBytes,
    signature: feedbackAuth.signature,
  });
}

async function main() {
  console.log("\n🚀 FeedbackAuth E2E Test on Devnet\n");
  console.log("=" .repeat(60));

  // Setup connection and provider
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const agentOwner = loadKeypair();
  const wallet = new Wallet(agentOwner);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log(`\n✅ Connected to devnet`);
  console.log(`👤 Agent owner: ${agentOwner.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(agentOwner.publicKey);
  console.log(`💰 Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
    console.error("❌ Insufficient balance. Need at least 0.1 SOL for testing.");
    console.log("💡 Get devnet SOL: solana airdrop 1 --url devnet");
    process.exit(1);
  }

  // Load programs
  const reputationProgram = new Program(
    require("../../target/idl/reputation_registry.json") as anchor.Idl,
    REPUTATION_PROGRAM_ID,
    provider
  ) as Program<ReputationRegistry>;

  const identityProgram = new Program(
    require("../../target/idl/identity_registry.json") as anchor.Idl,
    IDENTITY_PROGRAM_ID,
    provider
  ) as Program<IdentityRegistry>;

  console.log(`\n📋 Programs loaded:`);
  console.log(`   Identity Registry: ${IDENTITY_PROGRAM_ID.toBase58()}`);
  console.log(`   Reputation Registry: ${REPUTATION_PROGRAM_ID.toBase58()}`);

  // Find an agent owned by this wallet
  console.log(`\n🔍 Searching for agents owned by ${agentOwner.publicKey.toBase58()}...`);

  // For this test, we'll use the first agent mint owned by the wallet
  // In a real scenario, you'd query the identity registry or use a known agent mint
  const agentMint = agentOwner.publicKey; // Simplified: using owner pubkey as mock mint
  const [agentPda] = getAgentPda(agentMint, IDENTITY_PROGRAM_ID);

  // Try to fetch agent account
  let agentId: number;
  try {
    const agentAccount = await connection.getAccountInfo(agentPda);
    if (!agentAccount) {
      console.error("❌ No agent found at PDA. Please register an agent first.");
      console.log("💡 Use the identity registry to register an agent on devnet.");
      process.exit(1);
    }

    // Parse agent_id from account data (offset 8-16)
    agentId = Number(new anchor.BN(agentAccount.data.slice(8, 16), "le"));
    console.log(`✅ Found agent: ID=${agentId}, PDA=${agentPda.toBase58()}`);
    console.log(`   Mint: ${agentMint.toBase58()}`);
  } catch (err) {
    console.error("❌ Error fetching agent:", err);
    process.exit(1);
  }

  // Create test client
  const client = Keypair.generate();
  console.log(`\n👥 Test client: ${client.publicKey.toBase58()}`);

  // Airdrop SOL to client
  console.log(`💸 Requesting airdrop for client...`);
  try {
    const airdropSig = await connection.requestAirdrop(
      client.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log(`✅ Airdrop confirmed`);
  } catch (err) {
    console.error("❌ Airdrop failed:", err);
    process.exit(1);
  }

  // Create feedbackAuth
  console.log(`\n🔐 Creating FeedbackAuth with Ed25519 signature...`);
  const feedbackAuth = createFeedbackAuth(
    agentId,
    client.publicKey,
    10, // index_limit
    3600, // 1 hour expiry
    agentOwner, // signer (agent owner)
    IDENTITY_PROGRAM_ID
  );

  console.log(`✅ FeedbackAuth created:`);
  console.log(`   Agent ID: ${agentId}`);
  console.log(`   Client: ${client.publicKey.toBase58()}`);
  console.log(`   Index Limit: 10`);
  console.log(`   Signer: ${agentOwner.publicKey.toBase58()}`);
  console.log(`   Chain ID: solana-devnet`);

  // Derive PDAs for feedback submission
  const feedbackIndex = 0;
  const [feedbackPda] = getFeedbackPda(agentId, client.publicKey, feedbackIndex, REPUTATION_PROGRAM_ID);
  const [clientIndexPda] = getClientIndexPda(agentId, client.publicKey, REPUTATION_PROGRAM_ID);
  const [reputationPda] = getAgentReputationPda(agentId, REPUTATION_PROGRAM_ID);

  // Prepare feedback data
  const score = 85;
  const tag1 = Buffer.alloc(32);
  tag1.write("quality");
  const tag2 = Buffer.alloc(32);
  tag2.write("responsive");
  const fileUri = "ipfs://QmDevnetTest123";
  const fileHash = Buffer.alloc(32);

  // Create Ed25519 verification instruction
  const ed25519Ix = createEd25519Instruction(feedbackAuth);

  // Submit feedback with Ed25519 validation
  console.log(`\n📝 Submitting feedback with Ed25519 validation...`);
  try {
    const tx = await reputationProgram.methods
      .giveFeedback(
        new anchor.BN(agentId),
        score,
        Array.from(tag1),
        Array.from(tag2),
        fileUri,
        Array.from(fileHash),
        new anchor.BN(feedbackIndex),
        feedbackAuth
      )
      .accounts({
        client: client.publicKey,
        payer: client.publicKey,
        agentMint: agentMint,
        agentAccount: agentPda,
        clientIndex: clientIndexPda,
        feedbackAccount: feedbackPda,
        agentReputation: reputationPda,
        identityRegistryProgram: IDENTITY_PROGRAM_ID,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix]) // Prepend Ed25519 verification
      .signers([client])
      .rpc();

    console.log(`✅ Feedback submitted successfully!`);
    console.log(`   Transaction: ${tx}`);
    console.log(`   Feedback PDA: ${feedbackPda.toBase58()}`);
  } catch (err: any) {
    console.error("❌ Feedback submission failed:", err.message || err);
    if (err.logs) {
      console.error("   Program logs:", err.logs);
    }
    process.exit(1);
  }

  // Verify feedback account
  console.log(`\n🔍 Verifying feedback account...`);
  try {
    const feedbackAccount = await reputationProgram.account.feedbackAccount.fetch(feedbackPda);
    console.log(`✅ Feedback verified:`);
    console.log(`   Agent ID: ${feedbackAccount.agentId.toNumber()}`);
    console.log(`   Client: ${feedbackAccount.clientAddress.toBase58()}`);
    console.log(`   Score: ${feedbackAccount.score}`);
    console.log(`   Feedback Index: ${feedbackAccount.feedbackIndex.toNumber()}`);
    console.log(`   File URI: ${feedbackAccount.fileUri}`);
    console.log(`   Revoked: ${feedbackAccount.isRevoked}`);
  } catch (err) {
    console.error("❌ Failed to fetch feedback account:", err);
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`\n✅ E2E Test Complete!`);
  console.log(`\n🎉 FeedbackAuth Ed25519 validation working on devnet!\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  });
