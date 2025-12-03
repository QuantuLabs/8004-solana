/**
 * Real cost measurement on devnet - executes actual transactions
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

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
  await connection.confirmTransaction(signature, "confirmed");

  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
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
    computeUnits,
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

describe("💰 Real Cost Measurement on Devnet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program;

  const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  const payer = provider.wallet.publicKey;
  let agentMint: Keypair;
  let agentId: anchor.BN;
  let collectionMint: PublicKey;

  console.log("\n=========================================");
  console.log("💰 REAL COST MEASUREMENT - DEVNET");
  console.log("=========================================");
  console.log(`Wallet: ${payer.toBase58()}`);

  it("0️⃣ Initialize Registry", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      identityProgram.programId
    );

    const collectionMintKp = Keypair.generate();
    collectionMint = collectionMintKp.publicKey;

    const [collectionMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const collectionTokenAccount = anchor.utils.token.associatedAddress({
      mint: collectionMint,
      owner: payer,
    });

    const preBalance = await provider.connection.getBalance(payer);

    const sig = await identityProgram.methods
      .initialize()
      .accounts({
        config: configPda,
        authority: payer,
        collectionMint,
        collectionMetadata,
        collectionMasterEdition,
        collectionTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([collectionMintKp])
      .rpc();

    await measureCost("Initialize Registry", preBalance, sig, provider.connection);
  });

  it("1️⃣ Measure: Register Agent", async () => {
    agentMint = Keypair.generate();

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      identityProgram.programId
    );

    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.publicKey.toBuffer()],
      identityProgram.programId
    );

    const [agentMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        agentMint.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const [agentMasterEdition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        agentMint.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const agentTokenAccount = anchor.utils.token.associatedAddress({
      mint: agentMint.publicKey,
      owner: payer,
    });

    const [collectionMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const preBalance = await provider.connection.getBalance(payer);

    const sig = await identityProgram.methods
      .register("ipfs://QmCostMeasurement123")
      .accounts({
        config: configPda,
        authority: payer,
        agentAccount,
        agentMint: agentMint.publicKey,
        agentMetadata,
        agentMasterEdition,
        agentTokenAccount,
        collectionMint,
        collectionMetadata,
        collectionMasterEdition,
        owner: payer,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([agentMint])
      .rpc();

    await measureCost("Register Agent", preBalance, sig, provider.connection);

    const agentAccountData = await identityProgram.account.agentAccount.fetch(
      agentAccount
    );
    agentId = agentAccountData.agentId;
  });

  it("2️⃣ Measure: Set Metadata", async () => {
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.publicKey.toBuffer()],
      identityProgram.programId
    );

    const key = "description";
    const [metadataEntry] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        agentId.toArrayLike(Buffer, "le", 8),
        Buffer.from(key.padEnd(32, "\0")),
      ],
      identityProgram.programId
    );

    const preBalance = await provider.connection.getBalance(payer);

    const sig = await identityProgram.methods
      .setMetadata(agentId, key.padEnd(32, "\0"), "Cost measurement test agent")
      .accounts({
        agentAccount,
        metadataEntry,
        owner: payer,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await measureCost("Set Metadata", preBalance, sig, provider.connection);
  });

  it("3️⃣ Measure: Set Agent URI", async () => {
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.publicKey.toBuffer()],
      identityProgram.programId
    );

    const [agentMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        agentMint.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const preBalance = await provider.connection.getBalance(payer);

    const sig = await identityProgram.methods
      .setAgentUri("ipfs://QmUpdatedURI456")
      .accounts({
        agentAccount,
        agentMint: agentMint.publicKey,
        agentMetadata,
        owner: payer,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .rpc();

    await measureCost("Set Agent URI", preBalance, sig, provider.connection);
  });

  it("4️⃣ Measure: Give Feedback (first time)", async () => {
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.publicKey.toBuffer()],
      identityProgram.programId
    );

    const feedbackIndex = new anchor.BN(0);

    const [clientIndex] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("client_index"),
        agentId.toArrayLike(Buffer, "le", 8),
        payer.toBuffer(),
      ],
      reputationProgram.programId
    );

    const [feedbackAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        payer.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgram.programId
    );

    const [agentReputation] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
      reputationProgram.programId
    );

    const preBalance = await provider.connection.getBalance(payer);

    const sig = await reputationProgram.methods
      .giveFeedback(
        agentId,
        85,
        Buffer.alloc(32),
        Buffer.alloc(32),
        "ipfs://QmFeedback1",
        Buffer.alloc(32),
        feedbackIndex
      )
      .accounts({
        client: payer,
        payer: payer,
        agentMint: agentMint.publicKey,
        agentAccount,
        clientIndex,
        feedbackAccount,
        agentReputation,
        identityRegistryProgram: identityProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await measureCost(
      "Give Feedback (first)",
      preBalance,
      sig,
      provider.connection
    );
  });

  it("5️⃣ Measure: Give Feedback (second time)", async () => {
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.publicKey.toBuffer()],
      identityProgram.programId
    );

    const feedbackIndex = new anchor.BN(1);

    const [clientIndex] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("client_index"),
        agentId.toArrayLike(Buffer, "le", 8),
        payer.toBuffer(),
      ],
      reputationProgram.programId
    );

    const [feedbackAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        payer.toBuffer(),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      reputationProgram.programId
    );

    const [agentReputation] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
      reputationProgram.programId
    );

    const preBalance = await provider.connection.getBalance(payer);

    const sig = await reputationProgram.methods
      .giveFeedback(
        agentId,
        92,
        Buffer.alloc(32),
        Buffer.alloc(32),
        "ipfs://QmFeedback2",
        Buffer.alloc(32),
        feedbackIndex
      )
      .accounts({
        client: payer,
        payer: payer,
        agentMint: agentMint.publicKey,
        agentAccount,
        clientIndex,
        feedbackAccount,
        agentReputation,
        identityRegistryProgram: identityProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await measureCost(
      "Give Feedback (second)",
      preBalance,
      sig,
      provider.connection
    );
  });

  after(async () => {
    console.log("\n\n=========================================");
    console.log("📊 FINAL COST REPORT");
    console.log("=========================================\n");

    console.log(
      "Operation                    | Cost (SOL)     | Fee (SOL)      | Compute Units"
    );
    console.log(
      "---------------------------- | -------------- | -------------- | -------------"
    );

    let totalCost = 0;
    let totalFee = 0;

    for (const cost of costs) {
      const costSOL = (cost.cost / 1e9).toFixed(9).padStart(14);
      const feeSOL = (cost.fee / 1e9).toFixed(9).padStart(14);
      const cu = cost.computeUnits
        ? cost.computeUnits.toLocaleString().padStart(13)
        : "N/A".padStart(13);

      console.log(
        `${cost.operation.padEnd(28)} | ${costSOL} | ${feeSOL} | ${cu}`
      );

      totalCost += cost.cost;
      totalFee += cost.fee;
    }

    console.log(
      "---------------------------- | -------------- | -------------- | -------------"
    );
    console.log(
      `${"TOTAL".padEnd(28)} | ${(totalCost / 1e9)
        .toFixed(9)
        .padStart(14)} | ${(totalFee / 1e9).toFixed(9).padStart(14)} |`
    );

    console.log(
      `\n💰 Total Rent Paid: ${((totalCost - totalFee) / 1e9).toFixed(9)} SOL`
    );

    const report = {
      timestamp: new Date().toISOString(),
      cluster: "devnet",
      wallet: payer.toBase58(),
      measurements: costs,
      summary: {
        totalCost: totalCost / 1e9,
        totalFee: totalFee / 1e9,
        totalRent: (totalCost - totalFee) / 1e9,
      },
    };

    const fs = require("fs");
    fs.writeFileSync(
      "/tmp/real-costs-devnet-FINAL.json",
      JSON.stringify(report, null, 2)
    );
    console.log(
      "\n✅ Full report saved to: /tmp/real-costs-devnet-FINAL.json\n"
    );
  });
});
