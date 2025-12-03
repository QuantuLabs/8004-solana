/**
 * Test to measure REAL transaction costs on devnet
 * Captures transaction signatures and analyzes actual costs
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";

interface CostMeasurement {
  operation: string;
  signature: string;
  preBalance: number;
  postBalance: number;
  cost: number;
  fee: number;
  computeUnits: number | null;
}

const costs: CostMeasurement[] = [];

async function measureCost(
  operation: string,
  preBalance: number,
  signature: string,
  connection: anchor.web3.Connection
): Promise<CostMeasurement> {
  // Wait for confirmation
  await connection.confirmTransaction(signature, "confirmed");

  // Get transaction details
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  const postBalance = tx?.meta?.postBalances[0] || preBalance;
  const fee = tx?.meta?.fee || 0;
  const computeUnits = tx?.meta?.computeUnitsConsumed || null;
  const cost = preBalance - postBalance;

  const measurement: CostMeasurement = {
    operation,
    signature,
    preBalance,
    postBalance,
    cost,
    fee,
    computeUnits
  };

  costs.push(measurement);

  console.log(`\n📊 ${operation}`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Fee: ${(fee / 1e9).toFixed(9)} SOL (${fee} lamports)`);
  console.log(`   Cost: ${(cost / 1e9).toFixed(9)} SOL (${cost} lamports)`);
  if (computeUnits) {
    console.log(`   Compute Units: ${computeUnits.toLocaleString()}`);
  }

  return measurement;
}

describe("Cost Measurement on Devnet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program;
  const validationProgram = anchor.workspace.ValidationRegistry as Program;

  const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

  let agentMint: PublicKey;
  let agentOwner: Keypair;
  let agentTokenAccount: PublicKey;
  let agentId: anchor.BN;

  console.log("\n=========================================");
  console.log("COST MEASUREMENT - DEVNET");
  console.log("=========================================\n");

  it("💰 Measure: Register Agent", async () => {
    agentOwner = Keypair.generate();

    // Airdrop to agent owner
    const airdropSig = await provider.connection.requestAirdrop(
      agentOwner.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create NFT mint
    const mintKeypair = Keypair.generate();
    agentMint = mintKeypair.publicKey;

    await createMint(
      provider.connection,
      agentOwner,
      agentOwner.publicKey,
      agentOwner.publicKey,
      0,
      mintKeypair
    );

    // Create token account
    agentTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      agentOwner,
      agentMint,
      agentOwner.publicKey
    );

    // Mint 1 NFT
    await mintTo(
      provider.connection,
      agentOwner,
      agentMint,
      agentTokenAccount,
      agentOwner.publicKey,
      1
    );

    // Derive PDAs
    const [registryState] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_state")],
      identityProgram.programId
    );

    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );

    const [agentMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        agentMint.toBuffer()
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const [collectionMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection_mint")],
      identityProgram.programId
    );

    const [collectionMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer()
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
        Buffer.from("edition")
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    // Measure register cost
    const preBalance = await provider.connection.getBalance(agentOwner.publicKey);

    const registerSig = await identityProgram.methods
      .register("ipfs://QmTestAgent123")
      .accounts({
        registryState,
        agentAccount,
        agentMint,
        agentMetadata,
        tokenAccount: agentTokenAccount,
        collectionMint,
        collectionMetadata,
        collectionMasterEdition,
        owner: agentOwner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      })
      .signers([agentOwner])
      .rpc();

    await measureCost("Register Agent", preBalance, registerSig, provider.connection);

    // Get agent ID
    const agentAccountData = await identityProgram.account.agentAccount.fetch(agentAccount);
    agentId = agentAccountData.agentId;
  });

  it("💰 Measure: Set Metadata", async () => {
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );

    const [metadataEntry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        agentId.toArrayLike(Buffer, "le", 8),
        Buffer.from("description".padEnd(32, "\0"))
      ],
      identityProgram.programId
    );

    const preBalance = await provider.connection.getBalance(agentOwner.publicKey);

    const setSig = await identityProgram.methods
      .setMetadata(
        agentId,
        "description".padEnd(32, "\0"),
        "AI agent for ERC-8004 testing"
      )
      .accounts({
        agentAccount,
        metadataEntry,
        owner: agentOwner.publicKey,
      })
      .signers([agentOwner])
      .rpc();

    await measureCost("Set Metadata", preBalance, setSig, provider.connection);
  });

  it("💰 Measure: Give Feedback", async () => {
    const client = Keypair.generate();

    // Airdrop to client
    const airdropSig = await provider.connection.requestAirdrop(
      client.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );

    const feedbackIndex = new anchor.BN(0);

    const [clientIndex] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("client_index"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer()
      ],
      reputationProgram.programId
    );

    const [feedbackAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        client.publicKey.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8)
      ],
      reputationProgram.programId
    );

    const [agentReputation] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
      reputationProgram.programId
    );

    const preBalance = await provider.connection.getBalance(client.publicKey);

    const feedbackSig = await reputationProgram.methods
      .giveFeedback(
        agentId,
        85,
        Buffer.alloc(32),
        Buffer.alloc(32),
        "ipfs://QmFeedback123",
        Buffer.alloc(32),
        feedbackIndex
      )
      .accounts({
        client: client.publicKey,
        payer: client.publicKey,
        agentMint,
        agentAccount,
        clientIndex,
        feedbackAccount,
        agentReputation,
        identityRegistryProgram: identityProgram.programId,
      })
      .signers([client])
      .rpc();

    await measureCost("Give Feedback (first)", preBalance, feedbackSig, provider.connection);
  });

  after(async () => {
    console.log("\n\n=========================================");
    console.log("COST MEASUREMENT RESULTS");
    console.log("=========================================\n");

    console.log("Operation                | Cost (SOL)     | Fee (SOL)      | Compute Units");
    console.log("------------------------ | -------------- | -------------- | -------------");

    let totalCost = 0;
    let totalFee = 0;

    for (const cost of costs) {
      const costSOL = (cost.cost / 1e9).toFixed(9).padStart(14);
      const feeSOL = (cost.fee / 1e9).toFixed(9).padStart(14);
      const cu = cost.computeUnits ? cost.computeUnits.toLocaleString().padStart(13) : "N/A".padStart(13);

      console.log(`${cost.operation.padEnd(24)} | ${costSOL} | ${feeSOL} | ${cu}`);

      totalCost += cost.cost;
      totalFee += cost.fee;
    }

    console.log("------------------------ | -------------- | -------------- | -------------");
    console.log(`${"TOTAL".padEnd(24)} | ${(totalCost / 1e9).toFixed(9).padStart(14)} | ${(totalFee / 1e9).toFixed(9).padStart(14)} |`);

    // Save to file
    const report = {
      timestamp: new Date().toISOString(),
      cluster: "devnet",
      measurements: costs,
      summary: {
        totalCost: totalCost / 1e9,
        totalFee: totalFee / 1e9,
        totalRent: (totalCost - totalFee) / 1e9
      }
    };

    fs.writeFileSync("/tmp/cost-measurements-devnet.json", JSON.stringify(report, null, 2));
    console.log("\n✅ Full report saved to: /tmp/cost-measurements-devnet.json\n");
  });
});
