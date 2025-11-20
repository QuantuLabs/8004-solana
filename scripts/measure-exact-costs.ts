/**
 * Measure EXACT transaction costs by analyzing transaction signatures
 * Runs on localnet for accurate measurements
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program;
  const validationProgram = anchor.workspace.ValidationRegistry as Program;

  const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  const payer = provider.wallet.publicKey;
  let agentMint: Keypair;
  let agentId: anchor.BN;
  let collectionMint: PublicKey;

  console.log("\n=========================================");
  console.log("💰 EXACT COST MEASUREMENT - LOCALNET");
  console.log("=========================================");
  console.log(`Wallet: ${payer.toBase58()}`);

  // 0. Initialize Identity Registry
  console.log("\n[0️⃣] Initialize Identity Registry");
  const collectionMintKp = Keypair.generate();
  collectionMint = collectionMintKp.publicKey;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    identityProgram.programId
  );

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

  let preBalance = await provider.connection.getBalance(payer);
  let sig = await identityProgram.methods
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
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .signers([collectionMintKp])
    .rpc();

  await measureCost("Initialize Registry", preBalance, sig, provider.connection);

  // 1. Register Agent
  console.log("\n[1️⃣] Register Agent");
  agentMint = Keypair.generate();

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

  preBalance = await provider.connection.getBalance(payer);
  sig = await identityProgram.methods
    .register("ipfs://QmTest123")
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
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .signers([agentMint])
    .rpc();

  await measureCost("Register Agent", preBalance, sig, provider.connection);

  const agentAccountData: any = await (identityProgram.account as any).agentAccount.fetch(agentAccount);
  agentId = agentAccountData.agentId;

  // 2. Set Metadata
  console.log("\n[2️⃣] Set Metadata");
  const key = "description";
  const [metadataEntry] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      agentId.toArrayLike(Buffer, "le", 8),
      Buffer.from(key.padEnd(32, "\0")),
    ],
    identityProgram.programId
  );

  preBalance = await provider.connection.getBalance(payer);
  sig = await identityProgram.methods
    .setMetadata(agentId, key.padEnd(32, "\0"), "Test agent description")
    .accounts({
      agentAccount,
      metadataEntry,
      owner: payer,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await measureCost("Set Metadata", preBalance, sig, provider.connection);

  // 3. Set Agent URI
  console.log("\n[3️⃣] Set Agent URI");
  preBalance = await provider.connection.getBalance(payer);
  sig = await identityProgram.methods
    .setAgentUri("ipfs://QmUpdated456")
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

  // 4. Give Feedback (first time)
  console.log("\n[4️⃣] Give Feedback (first time)");
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

  preBalance = await provider.connection.getBalance(payer);
  sig = await reputationProgram.methods
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

  await measureCost("Give Feedback (first)", preBalance, sig, provider.connection);

  // 5. Give Feedback (second time)
  console.log("\n[5️⃣] Give Feedback (second time)");
  const feedbackIndex2 = new anchor.BN(1);

  const [feedbackAccount2] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("feedback"),
      agentId.toArrayLike(Buffer, "le", 8),
      payer.toBuffer(),
      feedbackIndex2.toArrayLike(Buffer, "le", 8),
    ],
    reputationProgram.programId
  );

  preBalance = await provider.connection.getBalance(payer);
  sig = await reputationProgram.methods
    .giveFeedback(
      agentId,
      92,
      Buffer.alloc(32),
      Buffer.alloc(32),
      "ipfs://QmFeedback2",
      Buffer.alloc(32),
      feedbackIndex2
    )
    .accounts({
      client: payer,
      payer: payer,
      agentMint: agentMint.publicKey,
      agentAccount,
      clientIndex,
      feedbackAccount: feedbackAccount2,
      agentReputation,
      identityRegistryProgram: identityProgram.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await measureCost("Give Feedback (second)", preBalance, sig, provider.connection);

  // 6. Initialize Validation Registry
  console.log("\n[6️⃣] Initialize Validation Registry");
  const [valConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    validationProgram.programId
  );

  preBalance = await provider.connection.getBalance(payer);
  sig = await validationProgram.methods
    .initialize()
    .accounts({
      config: valConfigPda,
      authority: payer,
      identityRegistryProgram: identityProgram.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await measureCost("Initialize Validation Registry", preBalance, sig, provider.connection);

  // 7. Request Validation
  console.log("\n[7️⃣] Request Validation");
  const validator = Keypair.generate();
  const nonce = 12345;
  const requestHash = Buffer.alloc(32, 1);

  const [validationRequest] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("validation"),
      agentId.toArrayLike(Buffer, "le", 8),
      validator.publicKey.toBuffer(),
      Buffer.from(new Uint8Array(new Uint32Array([nonce]).buffer)),
    ],
    validationProgram.programId
  );

  preBalance = await provider.connection.getBalance(payer);
  sig = await validationProgram.methods
    .requestValidation(agentId, nonce, requestHash)
    .accounts({
      config: valConfigPda,
      agent: payer,
      agentAccount,
      agentMint: agentMint.publicKey,
      validator: validator.publicKey,
      validationRequest,
      identityRegistryProgram: identityProgram.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await measureCost("Request Validation", preBalance, sig, provider.connection);

  // 8. Respond to Validation
  console.log("\n[8️⃣] Respond to Validation");
  // Airdrop some SOL to validator
  const airdropSig = await provider.connection.requestAirdrop(validator.publicKey, 1e9);
  await provider.connection.confirmTransaction(airdropSig);

  const responseHash = Buffer.alloc(32, 2);
  const response = 100; // Passed

  // Get validator balance
  preBalance = await provider.connection.getBalance(validator.publicKey);
  sig = await validationProgram.methods
    .respondToValidation(agentId, nonce, responseHash, response)
    .accounts({
      validator: validator.publicKey,
      validationRequest,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([validator])
    .rpc();

  await measureCost("Respond to Validation", preBalance, sig, provider.connection);

  // Generate Final Report
  console.log("\n\n=========================================");
  console.log("📊 FINAL COST REPORT");
  console.log("=========================================\n");

  console.log(
    "Operation                          | Cost (SOL)     | Fee (SOL)      | Compute Units"
  );
  console.log(
    "---------------------------------- | -------------- | -------------- | -------------"
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
      `${cost.operation.padEnd(34)} | ${costSOL} | ${feeSOL} | ${cu}`
    );

    totalCost += cost.cost;
    totalFee += cost.fee;
  }

  console.log(
    "---------------------------------- | -------------- | -------------- | -------------"
  );
  console.log(
    `${"TOTAL".padEnd(34)} | ${(totalCost / 1e9)
      .toFixed(9)
      .padStart(14)} | ${(totalFee / 1e9).toFixed(9).padStart(14)} |`
  );

  console.log(
    `\n💰 Total Rent Paid: ${((totalCost - totalFee) / 1e9).toFixed(9)} SOL`
  );
  console.log(`💸 Total Transaction Fees: ${(totalFee / 1e9).toFixed(9)} SOL`);

  const report = {
    timestamp: new Date().toISOString(),
    cluster: "localnet",
    wallet: payer.toBase58(),
    measurements: costs,
    summary: {
      totalCost: totalCost / 1e9,
      totalFee: totalFee / 1e9,
      totalRent: (totalCost - totalFee) / 1e9,
    },
  };

  fs.writeFileSync(
    "/tmp/exact-costs-final.json",
    JSON.stringify(report, null, 2)
  );
  console.log("\n✅ Full report saved to: /tmp/exact-costs-final.json\n");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
