/**
 * E2E Test: FeedbackAuth with SDK on Devnet
 *
 * Tests feedbackAuth Ed25519 validation using the 8004-solana-ts SDK
 * against deployed programs on devnet.
 *
 * Usage:
 *   npx ts-node tests/e2e/feedbackauth-sdk-devnet.ts
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SolanaSDK } from "../../../agent0-ts-solana/src/index.js";
import * as fs from "fs";

const DEVNET_RPC = "https://api.devnet.solana.com";

// Load keypair
function loadKeypair(): Keypair {
  const keypairPath = process.env.AGENT_OWNER_KEYPAIR ||
                      `${process.env.HOME}/.config/solana/id.json`;
  console.log(`📂 Loading keypair from: ${keypairPath}`);
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

async function main() {
  console.log("\n🚀 FeedbackAuth SDK E2E Test on Devnet\n");
  console.log("=".repeat(60));

  // Setup connection
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const agentOwner = loadKeypair();

  console.log(`\n✅ Connected to devnet`);
  console.log(`👤 Agent owner: ${agentOwner.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(agentOwner.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error("❌ Insufficient balance. Need at least 0.1 SOL for testing.");
    console.log("💡 Get devnet SOL: solana airdrop 1 --url devnet");
    process.exit(1);
  }

  // Initialize SDK
  console.log(`\n🔧 Initializing SDK...`);
  const sdk = new SolanaSDK({
    connection,
    wallet: agentOwner,
    network: "devnet"
  });

  console.log(`✅ SDK initialized`);
  console.log(`   Identity Registry: ${sdk.identityRegistryProgram.programId.toBase58()}`);
  console.log(`   Reputation Registry: ${sdk.reputationRegistryProgram.programId.toBase58()}`);

  // For this test, we need an existing agent on devnet
  // Let's use agent ID 1 as an example (you'll need to adjust based on actual agents)
  const agentId = 1;
  console.log(`\n🤖 Using agent ID: ${agentId}`);

  // Create test client
  const client = Keypair.generate();
  console.log(`\n👥 Test client: ${client.publicKey.toBase58()}`);

  // Airdrop SOL to client
  console.log(`💸 Requesting airdrop for client...`);
  try {
    const airdropSig = await connection.requestAirdrop(
      client.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log(`✅ Airdrop confirmed`);
  } catch (err) {
    console.error("❌ Airdrop failed:", err);
    process.exit(1);
  }

  // Create feedbackAuth using SDK
  console.log(`\n🔐 Creating FeedbackAuth with SDK...`);
  const feedbackAuth = sdk.createFeedbackAuth(
    agentId,
    client.publicKey,
    10, // index_limit
    3600, // 1 hour expiry
    agentOwner // signer
  );

  console.log(`✅ FeedbackAuth created`);
  console.log(`   Agent ID: ${agentId}`);
  console.log(`   Client: ${client.publicKey.toBase58()}`);
  console.log(`   Index Limit: 10`);
  console.log(`   Signer: ${agentOwner.publicKey.toBase58()}`);

  // Submit feedback using SDK
  console.log(`\n📝 Submitting feedback with SDK...`);
  try {
    const agentMintStr = agentOwner.publicKey.toBase58(); // Mock - adjust for real agent

    const txSig = await sdk.giveFeedback(
      agentMintStr,
      85, // score
      "quality",
      "responsive",
      "ipfs://QmDevnetTest123",
      client,
      client, // payer
      feedbackAuth
    );

    console.log(`✅ Feedback submitted successfully!`);
    console.log(`   Transaction: ${txSig}`);
  } catch (err: any) {
    console.error("❌ Feedback submission failed:", err.message || err);
    if (err.logs) {
      console.error("   Program logs:", err.logs);
    }
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`\n✅ E2E Test Complete!`);
  console.log(`\n🎉 FeedbackAuth working with SDK on devnet!\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  });
