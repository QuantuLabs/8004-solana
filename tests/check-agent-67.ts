/**
 * Quick script to check agent 67 on-chain reputation data
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey('HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp');

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const agentId = BigInt(67);

  // Get reputation PDA
  const agentIdBuffer = Buffer.alloc(8);
  agentIdBuffer.writeBigUInt64LE(agentId);

  const [reputationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('agent_reputation'), agentIdBuffer],
    PROGRAM_ID
  );

  console.log('Agent 67 Reputation PDA:', reputationPda.toBase58());

  const info = await provider.connection.getAccountInfo(reputationPda);

  if (info) {
    // Parse: discriminator(8) + agent_id(8) + next_feedback_index(8) + total_feedbacks(8) + total_score_sum(8) + average_score(1) + last_updated(8) + bump(1)
    const data = info.data;
    let offset = 8; // skip discriminator
    const agentIdRead = data.readBigUInt64LE(offset); offset += 8;
    const nextFeedbackIndex = data.readBigUInt64LE(offset); offset += 8;
    const totalFeedbacks = data.readBigUInt64LE(offset); offset += 8;
    const totalScoreSum = data.readBigUInt64LE(offset); offset += 8;
    const averageScore = data[offset]; offset += 1;
    const lastUpdated = data.readBigInt64LE(offset); offset += 8;
    const bump = data[offset];

    console.log('\n=== ON-CHAIN DATA for Agent 67 ===');
    console.log('agent_id:', agentIdRead.toString());
    console.log('next_feedback_index:', nextFeedbackIndex.toString());
    console.log('total_feedbacks:', totalFeedbacks.toString());
    console.log('total_score_sum:', totalScoreSum.toString());
    console.log('average_score:', averageScore);
    console.log('last_updated:', new Date(Number(lastUpdated) * 1000).toISOString());
    console.log('bump:', bump);
  } else {
    console.log('No reputation account found for agent 67');
  }
}

main().catch(console.error);
