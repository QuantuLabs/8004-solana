import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import { saveTestWallets, loadTestWallets, deleteTestWallets } from "./utils/test-wallets";

/**
 * E2E COMPLETE SYSTEM TESTS - ERC-8004 Solana Implementation
 *
 * This test suite provides comprehensive end-to-end testing of the entire
 * ERC-8004 Solana implementation, including:
 * - Identity Registry (agent registration, metadata, NFT transfers)
 * - Reputation Registry (feedback, revoke, responses, feedbackAuth)
 * - Validation Registry (requests, responses, progressive validation, close)
 * - Cost measurement for all operations
 * - Multi-agent and multi-client scenarios
 * - Edge cases and failure modes
 */

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

interface CostMeasurement {
  operation: string;
  lamports: number;
  sol: number;
  computeUnits?: number;
  accounts: number;
  dataSize?: number;
}

describe("E2E Complete System Tests with Cost Measurement", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;
  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;

  // Test wallets
  let authority: Keypair;
  let agentOwner1: Keypair;
  let agentOwner2: Keypair;
  let agentOwner3: Keypair;
  let client1: Keypair;
  let client2: Keypair;
  let client3: Keypair;
  let client4: Keypair;
  let client5: Keypair;
  let validator1: Keypair;
  let validator2: Keypair;
  let payer: Keypair;

  // Collection & config
  let configPda: PublicKey;
  let collectionMint: Keypair | { publicKey: PublicKey };

  // Agents
  let agent1Mint: PublicKey;
  let agent1Pda: PublicKey;
  let agent1Id: number;

  let agent2Mint: PublicKey;
  let agent2Pda: PublicKey;
  let agent2Id: number;

  let agent3Mint: PublicKey;
  let agent3Pda: PublicKey;
  let agent3Id: number;

  // Cost tracking
  const costMeasurements: CostMeasurement[] = [];

  // Helpers
  function getMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  function getMasterEditionPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  function getAgentPda(agentMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );
  }

  function getCollectionAuthorityPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("collection_authority")],
      identityProgram.programId
    );
  }

  function getClientIndexPda(agentId: number, client: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("client_index"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        client.toBuffer(),
      ],
      reputationProgram.programId
    );
  }

  function getFeedbackPda(agentId: number, client: PublicKey, feedbackIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        client.toBuffer(),
        Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  function getAgentReputationPda(agentId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("agent_reputation"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
      ],
      reputationProgram.programId
    );
  }

  function getValidationPda(agentId: number, validator: PublicKey, nonce: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        validator.toBuffer(),
        Buffer.from(new anchor.BN(nonce).toArray("le", 4)),
      ],
      validationProgram.programId
    );
  }

  function getValidationCounterPda(agentId: number, validator: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation_counter"),
        Buffer.from(new anchor.BN(agentId).toArray("le", 8)),
        validator.toBuffer(),
      ],
      validationProgram.programId
    );
  }

  function getValidationConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      validationProgram.programId
    );
  }

  // Note: FeedbackAuth removed from ERC-8004 specs for "Less DevEx friction"
  // createFeedbackAuth and createEd25519Instruction helpers no longer needed

  // Fund test wallets directly from provider wallet (no airdrop to avoid rate limits)
  async function fundWallet(pubkey: PublicKey, amount: number) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: pubkey,
        lamports: amount * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx);
  }

  // Recover SOL from test wallets back to provider wallet
  async function recoverSol(keypairs: Keypair[]) {
    const providerPubkey = provider.wallet.publicKey;
    let totalRecovered = 0;

    for (const kp of keypairs) {
      try {
        const balance = await provider.connection.getBalance(kp.publicKey);
        if (balance > 5000) { // Leave min for rent
          const transferAmount = balance - 5000;
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: kp.publicKey,
              toPubkey: providerPubkey,
              lamports: transferAmount,
            })
          );
          await provider.sendAndConfirm(tx, [kp]);
          totalRecovered += transferAmount;
        }
      } catch (err) {
        // Ignore errors (wallet might be empty or closed)
      }
    }

    if (totalRecovered > 0) {
      console.log(`💰 Recovered ${(totalRecovered / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL from test wallets`);
    }
  }

  async function measureCost(
    operation: string,
    txSig: string,
    accounts: number,
    dataSize?: number
  ): Promise<void> {
    const tx = await provider.connection.getTransaction(txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (tx && tx.meta) {
      const lamports = tx.meta.fee;
      const sol = lamports / anchor.web3.LAMPORTS_PER_SOL;

      costMeasurements.push({
        operation,
        lamports,
        sol,
        computeUnits: tx.meta.computeUnitsConsumed,
        accounts,
        dataSize,
      });

      console.log(`💰 ${operation}: ${lamports} lamports (${sol.toFixed(9)} SOL), ${tx.meta.computeUnitsConsumed} CU`);
    }
  }

  before(async () => {
    console.log("\n🚀 Setting up E2E test environment...\n");

    // Use provider wallet as authority (for devnet compatibility)
    authority = provider.wallet.payer;

    // Try loading existing wallets first (for crash recovery)
    const savedWallets = loadTestWallets();
    if (savedWallets) {
      console.log("♻️  Reusing saved test wallets...");
      agentOwner1 = savedWallets.agentOwner1;
      agentOwner2 = savedWallets.agentOwner2;
      agentOwner3 = savedWallets.agentOwner3;
      client1 = savedWallets.client1;
      client2 = savedWallets.client2;
      client3 = savedWallets.client3;
      client4 = savedWallets.client4;
      client5 = savedWallets.client5;
      validator1 = savedWallets.validator1;
      validator2 = savedWallets.validator2;
      payer = savedWallets.payer;
    } else {
      console.log("🔑 Generating new test wallets...");
      agentOwner1 = Keypair.generate();
      agentOwner2 = Keypair.generate();
      agentOwner3 = Keypair.generate();
      client1 = Keypair.generate();
      client2 = Keypair.generate();
      client3 = Keypair.generate();
      client4 = Keypair.generate();
      client5 = Keypair.generate();
      validator1 = Keypair.generate();
      validator2 = Keypair.generate();
      payer = Keypair.generate();

      // SAVE IMMEDIATELY after generation to prevent fund loss on crash
      saveTestWallets({
        agentOwner1, agentOwner2, agentOwner3,
        client1, client2, client3, client4, client5,
        validator1, validator2, payer
      });
    }

    // Check balances and fund if needed
    const walletsToFund: Array<{ kp: Keypair; amount: number }> = [
      { kp: agentOwner1, amount: 0.05 },  // Agent registration ~0.024 SOL
      { kp: agentOwner2, amount: 0.05 },
      { kp: agentOwner3, amount: 0.05 },
      { kp: client1, amount: 0.02 },       // Feedback accounts + fees
      { kp: client2, amount: 0.02 },
      { kp: client3, amount: 0.02 },
      { kp: client4, amount: 0.02 },
      { kp: client5, amount: 0.02 },
      { kp: validator1, amount: 0.02 },
      { kp: validator2, amount: 0.02 },
      { kp: payer, amount: 0.03 },
    ];

    // Fund wallets that need more SOL (sequentially to avoid nonce issues)
    for (const { kp, amount } of walletsToFund) {
      const balance = await provider.connection.getBalance(kp.publicKey);
      const neededLamports = amount * anchor.web3.LAMPORTS_PER_SOL;
      if (balance < neededLamports * 0.5) { // Refund if less than half the target
        await fundWallet(kp.publicKey, amount);
      }
    }

    console.log("✅ All wallets funded");

    // Initialize identity registry (if not already initialized)
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      identityProgram.programId
    );

    try {
      const config = await identityProgram.account.registryConfig.fetch(configPda);
      console.log("✅ Identity registry already initialized");
      console.log(`   Collection: ${config.collectionMint.toBase58()}`);
      console.log(`   Authority: ${authority.publicKey.toBase58()}`);
      collectionMint = { publicKey: config.collectionMint };
    } catch (err) {
      // Not initialized, initialize it
      collectionMint = Keypair.generate();
      const collectionMetadata = getMetadataPda(collectionMint.publicKey);
      const collectionMasterEdition = getMasterEditionPda(collectionMint.publicKey);
      const collectionTokenAccount = getAssociatedTokenAddressSync(
        collectionMint.publicKey,
        authority.publicKey
      );

      const txSig = await identityProgram.methods
        .initialize()
        .accounts({
          config: configPda,
          collectionMint: collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          collectionTokenAccount,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([authority, collectionMint])
        .rpc();

      await measureCost("Identity Registry Initialize", txSig, 7);
      console.log("✅ Identity registry initialized");
    }

    // Initialize validation registry (if not already initialized)
    const [validationConfigPda] = getValidationConfigPda();
    try {
      await validationProgram.account.validationConfig.fetch(validationConfigPda);
      console.log("✅ Validation registry already initialized");
    } catch (err) {
      // Not initialized, initialize it
      const valTxSig = await validationProgram.methods
        .initialize(identityProgram.programId)
        .accounts({
          config: validationConfigPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      await measureCost("Validation Registry Initialize", valTxSig, 3);
      console.log("✅ Validation registry initialized");
    }

    console.log("\n🎯 Test environment ready!\n");
  });

  after(async () => {
    // Recover SOL from test wallets before reporting
    console.log("\n🔄 Recovering SOL from test wallets...");
    const testWallets = [
      agentOwner1, agentOwner2, agentOwner3,
      client1, client2, client3, client4, client5,
      validator1, validator2, payer
    ].filter(kp => kp !== undefined);
    await recoverSol(testWallets);

    // Delete wallets file only after successful recovery
    deleteTestWallets();

    console.log("\n\n📊 ===== COST ANALYSIS REPORT =====\n");

    // Group by operation type
    const grouped = costMeasurements.reduce((acc, cost) => {
      if (!acc[cost.operation]) {
        acc[cost.operation] = [];
      }
      acc[cost.operation].push(cost);
      return acc;
    }, {} as Record<string, CostMeasurement[]>);

    // Calculate statistics
    for (const [operation, costs] of Object.entries(grouped)) {
      const lamports = costs.map(c => c.lamports);
      const sol = costs.map(c => c.sol);
      const cu = costs.map(c => c.computeUnits || 0);

      const avgLamports = lamports.reduce((a, b) => a + b, 0) / lamports.length;
      const avgSol = sol.reduce((a, b) => a + b, 0) / sol.length;
      const avgCU = cu.reduce((a, b) => a + b, 0) / cu.length;
      const minLamports = Math.min(...lamports);
      const maxLamports = Math.max(...lamports);

      console.log(`${operation}:`);
      console.log(`  Count: ${costs.length}`);
      console.log(`  Average: ${avgLamports.toFixed(0)} lamports (${avgSol.toFixed(9)} SOL)`);
      console.log(`  Min: ${minLamports} lamports`);
      console.log(`  Max: ${maxLamports} lamports`);
      console.log(`  Avg Compute Units: ${avgCU.toFixed(0)}`);
      console.log(``);
    }

    // Total costs
    const totalLamports = costMeasurements.reduce((sum, c) => sum + c.lamports, 0);
    const totalSol = totalLamports / anchor.web3.LAMPORTS_PER_SOL;

    console.log(`📈 TOTAL COSTS:`);
    console.log(`  Operations: ${costMeasurements.length}`);
    console.log(`  Total: ${totalLamports} lamports (${totalSol.toFixed(9)} SOL)`);
    console.log(`  Avg per operation: ${(totalLamports / costMeasurements.length).toFixed(0)} lamports\n`);
  });

  describe("Scenario 1: Complete Agent Lifecycle", () => {
    it("1.1: Register agent with metadata", async () => {
      const agentMintKeypair = Keypair.generate();
      const [agentAccount] = getAgentPda(agentMintKeypair.publicKey);
      const agentMetadata = getMetadataPda(agentMintKeypair.publicKey);
      const agentMasterEdition = getMasterEditionPda(agentMintKeypair.publicKey);
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMintKeypair.publicKey,
        agentOwner1.publicKey
      );

      const config = await identityProgram.account.registryConfig.fetch(configPda);
      const collectionMetadata = getMetadataPda(config.collectionMint);
      const collectionMasterEdition = getMasterEditionPda(config.collectionMint);
      const [collectionAuthorityPda] = getCollectionAuthorityPda();

      // Request 300k compute units (VerifyCollection uses ~200k CUs)
      const txSig = await identityProgram.methods
        .register("ipfs://agent1-metadata")
        .accounts({
          config: configPda,
          collectionAuthorityPda: collectionAuthorityPda,
          agentAccount: agentAccount,
          agentMint: agentMintKeypair.publicKey,
          agentMetadata: agentMetadata,
          agentMasterEdition: agentMasterEdition,
          agentTokenAccount: agentTokenAccount,
          collectionMint: config.collectionMint,
          collectionMetadata,
          collectionMasterEdition,
          owner: agentOwner1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
        ])
        .signers([agentMintKeypair, agentOwner1])
        .rpc();

      await measureCost("Register Agent", txSig, 11, 200);

      const fetchedAgent = await identityProgram.account.agentAccount.fetch(agentAccount);
      agent1Mint = agentMintKeypair.publicKey;
      agent1Pda = agentAccount;
      agent1Id = Number(fetchedAgent.agentId);

      assert.equal(fetchedAgent.agentUri, "ipfs://agent1-metadata");
      console.log(`✅ Agent 1 registered (ID: ${agent1Id})`);
    });

    it("1.2: Set agent metadata", async () => {
      // setMetadata takes (key: String, value: Vec<u8>)
      const txSig = await identityProgram.methods
        .setMetadata("name", Buffer.from("Agent One"))
        .accounts({
          agentAccount: agent1Pda,
          owner: agentOwner1.publicKey,
        })
        .signers([agentOwner1])
        .rpc();

      await measureCost("Set Metadata", txSig, 3, 64);

      const agent = await identityProgram.account.agentAccount.fetch(agent1Pda);
      assert.equal(agent.metadata[0].metadataKey, "name");
      console.log("✅ Metadata set");
    });

    it("1.3: Give feedback from multiple clients", async () => {
      // FeedbackAuth removed from specs - direct feedback without authorization
      const [clientIndexPda] = getClientIndexPda(agent1Id, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agent1Id, client1.publicKey, 0);
      const [reputationPda] = getAgentReputationPda(agent1Id);

      const txSig = await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agent1Id),
          85,                           // score
          "quality",                    // tag1 (string, not bytes)
          "helpful",                    // tag2 (string, not bytes)
          "ipfs://feedback1",           // file_uri
          Array.from(Buffer.alloc(32)), // file_hash
          new anchor.BN(0)              // feedback_index
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agent1Mint,
          agentAccount: agent1Pda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      await measureCost("Give Feedback", txSig, 8, 300);
      console.log("✅ Feedback given");
    });

    it("1.4: Request validation", async () => {
      const [validationPda] = getValidationPda(agent1Id, validator1.publicKey, 0);
      const [validationConfigPda] = getValidationConfigPda();

      const requestHash = Buffer.alloc(32);
      const txSig = await validationProgram.methods
        .requestValidation(
          new anchor.BN(agent1Id),
          validator1.publicKey,       // validator_address
          0,                           // nonce (u32)
          "ipfs://validation-request", // request_uri
          Array.from(requestHash)     // request_hash
        )
        .accounts({
          config: validationConfigPda,
          requester: agentOwner1.publicKey,
          payer: agentOwner1.publicKey,
          agentMint: agent1Mint,
          agentAccount: agent1Pda,
          validationRequest: validationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([agentOwner1])
        .rpc();

      await measureCost("Request Validation", txSig, 8, 300);
      console.log("✅ Validation requested");
    });

    it("1.5: Respond to validation", async () => {
      const [validationPda] = getValidationPda(agent1Id, validator1.publicKey, 0);
      const [validationConfigPda] = getValidationConfigPda();

      const responseHash = Buffer.alloc(32);

      const txSig = await validationProgram.methods
        .respondToValidation(
          100,                             // response score (u8)
          "ipfs://validation-response",    // response_uri
          Array.from(responseHash),        // response_hash
          "oasf-v0.8.0"                    // tag (String, max 32 bytes)
        )
        .accounts({
          config: validationConfigPda,
          validator: validator1.publicKey,
          validationRequest: validationPda,
        })
        .signers([validator1])
        .rpc();

      await measureCost("Respond to Validation", txSig, 2, 300);
      console.log("✅ Validation responded");
    });

    it("1.6: Revoke feedback", async () => {
      const [feedbackPda] = getFeedbackPda(agent1Id, client1.publicKey, 0);
      const [reputationPda] = getAgentReputationPda(agent1Id);

      const txSig = await reputationProgram.methods
        .revokeFeedback(
          new anchor.BN(agent1Id),
          new anchor.BN(0)
        )
        .accounts({
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          client: client1.publicKey,
        })
        .signers([client1])
        .rpc();

      await measureCost("Revoke Feedback", txSig, 2);
      console.log("✅ Feedback revoked");
    });

    it("1.7: Append response to feedback", async () => {
      const [feedbackPda] = getFeedbackPda(agent1Id, client1.publicKey, 0);

      // Response index PDA tracks next response index for this feedback
      const [responseIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response_index"),
          Buffer.from(new anchor.BN(agent1Id).toArray("le", 8)),
          client1.publicKey.toBuffer(),
          Buffer.from(new anchor.BN(0).toArray("le", 8)),  // feedback_index
        ],
        reputationProgram.programId
      );

      // Response account PDA for the first response (index 0)
      const [responseAccountPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response"),
          Buffer.from(new anchor.BN(agent1Id).toArray("le", 8)),
          client1.publicKey.toBuffer(),
          Buffer.from(new anchor.BN(0).toArray("le", 8)),  // feedback_index
          Buffer.from(new anchor.BN(0).toArray("le", 8)),  // response_index (starts at 0)
        ],
        reputationProgram.programId
      );

      const responseHash = Buffer.alloc(32);
      // Use authority (main wallet) as payer since agentOwner1 may not have enough SOL
      const txSig = await reputationProgram.methods
        .appendResponse(
          new anchor.BN(agent1Id),
          client1.publicKey,               // client_address
          new anchor.BN(0),                // feedback_index
          "ipfs://response",               // response_uri
          Array.from(responseHash)         // response_hash
        )
        .accounts({
          responder: agentOwner1.publicKey,
          payer: authority.publicKey,       // Main wallet as payer
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responseAccountPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([agentOwner1])  // Only responder needs to sign, payer is the provider wallet
        .rpc();

      await measureCost("Append Response", txSig, 4, 200);
      console.log("✅ Response appended");
    });

    it("1.8: Close validation and recover rent", async () => {
      const [validationPda] = getValidationPda(agent1Id, validator1.publicKey, 0);
      const [validationConfigPda] = getValidationConfigPda();

      // closeValidation allows either agent owner OR program authority to close
      // Using program authority here (provider wallet) since it's easier to sign
      // The program validates that closer is either agent owner OR authority
      const txSig = await validationProgram.methods
        .closeValidation()
        .accounts({
          config: validationConfigPda,
          closer: authority.publicKey,     // Use authority (has signing capabilities via provider)
          agentMint: agent1Mint,
          agentAccount: agent1Pda,
          validationRequest: validationPda,
          identityRegistryProgram: identityProgram.programId,
          rentReceiver: agentOwner1.publicKey,  // Rent still goes to agent owner
        })
        // No signers needed - authority is provider.wallet which auto-signs
        .rpc();

      await measureCost("Close Validation", txSig, 6);
      console.log("✅ Validation closed");
    });

    it("1.9: Transfer agent NFT", async () => {
      const newOwner = Keypair.generate();
      await fundWallet(newOwner.publicKey, 0.01);

      const fromTokenAccount = getAssociatedTokenAddressSync(agent1Mint, agentOwner1.publicKey);
      const toTokenAccount = getAssociatedTokenAddressSync(agent1Mint, newOwner.publicKey);
      const agentMetadata = getMetadataPda(agent1Mint);

      // Create destination token account first
      const createAtaTx = new Transaction();
      const createAtaIx = await (await import("@solana/spl-token")).createAssociatedTokenAccountInstruction(
        agentOwner1.publicKey,
        toTokenAccount,
        newOwner.publicKey,
        agent1Mint
      );
      createAtaTx.add(createAtaIx);

      await provider.sendAndConfirm(createAtaTx, [agentOwner1]);

      // Transfer NFT
      const transferIx = await (await import("@solana/spl-token")).createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        agentOwner1.publicKey,
        1
      );

      const transferTx = new Transaction().add(transferIx);
      const txSig = await provider.sendAndConfirm(transferTx, [agentOwner1]);

      await measureCost("Transfer Agent NFT", txSig, 4);
      console.log("✅ Agent NFT transferred");

      // Sync owner - OLD owner must sign to transfer update_authority
      const syncTxSig = await identityProgram.methods
        .syncOwner()
        .accounts({
          agentAccount: agent1Pda,
          tokenAccount: toTokenAccount,         // Token account holding the NFT (new owner's)
          agentMetadata: agentMetadata,
          agentMint: agent1Mint,
          oldOwnerSigner: agentOwner1.publicKey, // OLD owner must sign
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([agentOwner1])  // Old owner signs
        .rpc();

      await measureCost("Sync Owner", syncTxSig, 6);
      console.log("✅ Owner synced");
    });
  });

  describe("Scenario 2: Multi-Agent Multi-Client Scale Test", () => {
    before(async () => {
      // Register agents 2 and 3 with compute budget for VerifyCollection
      const config = await identityProgram.account.registryConfig.fetch(configPda);
      const [collectionAuthorityPda] = getCollectionAuthorityPda();

      // Agent 2
      const agent2MintKeypair = Keypair.generate();
      const [agent2Account] = getAgentPda(agent2MintKeypair.publicKey);

      await identityProgram.methods
        .register("ipfs://agent2-metadata")
        .accounts({
          config: configPda,
          collectionAuthorityPda: collectionAuthorityPda,
          agentAccount: agent2Account,
          agentMint: agent2MintKeypair.publicKey,
          agentMetadata: getMetadataPda(agent2MintKeypair.publicKey),
          agentMasterEdition: getMasterEditionPda(agent2MintKeypair.publicKey),
          agentTokenAccount: getAssociatedTokenAddressSync(agent2MintKeypair.publicKey, agentOwner2.publicKey),
          collectionMint: config.collectionMint,
          collectionMetadata: getMetadataPda(config.collectionMint),
          collectionMasterEdition: getMasterEditionPda(config.collectionMint),
          owner: agentOwner2.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
        ])
        .signers([agent2MintKeypair, agentOwner2])
        .rpc();

      const fetchedAgent2 = await identityProgram.account.agentAccount.fetch(agent2Account);
      agent2Mint = agent2MintKeypair.publicKey;
      agent2Pda = agent2Account;
      agent2Id = Number(fetchedAgent2.agentId);

      // Agent 3
      const agent3MintKeypair = Keypair.generate();
      const [agent3Account] = getAgentPda(agent3MintKeypair.publicKey);

      await identityProgram.methods
        .register("ipfs://agent3-metadata")
        .accounts({
          config: configPda,
          collectionAuthorityPda: collectionAuthorityPda,
          agentAccount: agent3Account,
          agentMint: agent3MintKeypair.publicKey,
          agentMetadata: getMetadataPda(agent3MintKeypair.publicKey),
          agentMasterEdition: getMasterEditionPda(agent3MintKeypair.publicKey),
          agentTokenAccount: getAssociatedTokenAddressSync(agent3MintKeypair.publicKey, agentOwner3.publicKey),
          collectionMint: config.collectionMint,
          collectionMetadata: getMetadataPda(config.collectionMint),
          collectionMasterEdition: getMasterEditionPda(config.collectionMint),
          owner: agentOwner3.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
        ])
        .signers([agent3MintKeypair, agentOwner3])
        .rpc();

      const fetchedAgent3 = await identityProgram.account.agentAccount.fetch(agent3Account);
      agent3Mint = agent3MintKeypair.publicKey;
      agent3Pda = agent3Account;
      agent3Id = Number(fetchedAgent3.agentId);

      console.log(`✅ Agent 2 & 3 registered (IDs: ${agent2Id}, ${agent3Id})`);
    });

    it("2.1: 5 clients give feedback to each of 3 agents", async () => {
      const clients = [client1, client2, client3, client4, client5];
      // Only use agents 2 and 3 (newly registered) to avoid conflicts with agent 1 feedback from Scenario 1
      const agents = [
        { id: agent2Id, mint: agent2Mint, pda: agent2Pda, owner: agentOwner2 },
        { id: agent3Id, mint: agent3Mint, pda: agent3Pda, owner: agentOwner3 },
      ];

      let totalCost = 0;
      let count = 0;

      for (const agent of agents) {
        for (const client of clients) {
          // FeedbackAuth removed from specs - direct feedback
          // Use index 0 for fresh agents 2 and 3
          const [clientIndexPda] = getClientIndexPda(agent.id, client.publicKey);
          const [feedbackPda] = getFeedbackPda(agent.id, client.publicKey, 0);
          const [reputationPda] = getAgentReputationPda(agent.id);

          const txSig = await reputationProgram.methods
            .giveFeedback(
              new anchor.BN(agent.id),
              Math.floor(Math.random() * 50) + 50, // Random score 50-100
              "test-tag1",                          // tag1 (string)
              "test-tag2",                          // tag2 (string)
              "",                                    // file_uri
              Array.from(Buffer.alloc(32)),         // file_hash
              new anchor.BN(0)                      // feedback_index
            )
            .accounts({
              client: client.publicKey,
              payer: authority.publicKey,           // Use authority as payer (has more SOL)
              agentMint: agent.mint,
              agentAccount: agent.pda,
              clientIndex: clientIndexPda,
              feedbackAccount: feedbackPda,
              agentReputation: reputationPda,
              identityRegistryProgram: identityProgram.programId,
              systemProgram: SystemProgram.programId,
            })
            .signers([client])
            .rpc();

          const tx = await provider.connection.getTransaction(txSig, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          });

          if (tx && tx.meta) {
            totalCost += tx.meta.fee;
            count++;
          }
        }
      }

      const avgCost = totalCost / count;
      console.log(`✅ ${count} feedbacks given`);
      console.log(`💰 Total cost: ${totalCost} lamports`);
      console.log(`💰 Average cost per feedback: ${avgCost.toFixed(0)} lamports`);
    });

    it("2.2: 2 validators validate each of 3 agents", async () => {
      const validators = [validator1, validator2];
      // Only use agents 2 and 3 to avoid conflicts with validations from Scenario 1
      const agents = [
        { id: agent2Id, mint: agent2Mint, pda: agent2Pda, owner: agentOwner2 },
        { id: agent3Id, mint: agent3Mint, pda: agent3Pda, owner: agentOwner3 },
      ];

      const [validationConfigPda] = getValidationConfigPda();

      for (const agent of agents) {
        for (let v = 0; v < validators.length; v++) {
          const validator = validators[v];
          const nonce = v;  // Use validator index as nonce

          // Use correct validation PDA with nonce
          const [validationPda] = getValidationPda(agent.id, validator.publicKey, nonce);

          const requestHash = Buffer.alloc(32);
          // Request validation with correct interface
          await validationProgram.methods
            .requestValidation(
              new anchor.BN(agent.id),
              validator.publicKey,       // validator_address
              nonce,                       // nonce (u32)
              "ipfs://validation-req",    // request_uri
              Array.from(requestHash)     // request_hash
            )
            .accounts({
              config: validationConfigPda,
              requester: agent.owner.publicKey,
              payer: authority.publicKey,   // Use authority as payer
              agentMint: agent.mint,
              agentAccount: agent.pda,
              validationRequest: validationPda,
              identityRegistryProgram: identityProgram.programId,
              systemProgram: SystemProgram.programId,
            })
            .signers([agent.owner])
            .rpc();

          // Respond to validation with correct interface
          const responseHash = Buffer.alloc(32);

          await validationProgram.methods
            .respondToValidation(
              Math.floor(Math.random() * 50) + 50,  // response score (u8)
              "ipfs://validation-resp",              // response_uri
              Array.from(responseHash),              // response_hash
              "oasf-v0.8.0"                          // tag (String)
            )
            .accounts({
              config: validationConfigPda,
              validator: validator.publicKey,
              validationRequest: validationPda,
            })
            .signers([validator])
            .rpc();
        }
      }

      console.log(`✅ ${agents.length * validators.length} validations completed (${validators.length} validators × ${agents.length} agents)`);
    });
  });

  describe("Scenario 3: Progressive Validation Updates", () => {
    it("3.1: Progressive updates (30 → 50 → 80 → 100)", async () => {
      // Create new agent for this test - use authority as owner to avoid lamport issues
      const agentMintKeypair = Keypair.generate();
      const [agentAccount] = getAgentPda(agentMintKeypair.publicKey);
      const config = await identityProgram.account.registryConfig.fetch(configPda);
      const [collectionAuthorityPda] = getCollectionAuthorityPda();

      // Use register() with compute budget (VerifyCollection uses ~200k CUs)
      // Use authority as owner since agentOwner1 may not have enough lamports
      await identityProgram.methods
        .register("ipfs://progressive-test-agent")
        .accounts({
          config: configPda,
          collectionAuthorityPda: collectionAuthorityPda,
          agentAccount: agentAccount,
          agentMint: agentMintKeypair.publicKey,
          agentMetadata: getMetadataPda(agentMintKeypair.publicKey),
          agentMasterEdition: getMasterEditionPda(agentMintKeypair.publicKey),
          agentTokenAccount: getAssociatedTokenAddressSync(agentMintKeypair.publicKey, authority.publicKey),
          collectionMint: config.collectionMint,
          collectionMetadata: getMetadataPda(config.collectionMint),
          collectionMasterEdition: getMasterEditionPda(config.collectionMint),
          owner: authority.publicKey,  // Use authority as owner (has enough SOL)
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
        ])
        .signers([agentMintKeypair])  // Only mint keypair needs to sign, authority is provider
        .rpc();

      const fetchedAgent = await identityProgram.account.agentAccount.fetch(agentAccount);
      const testAgentId = Number(fetchedAgent.agentId);

      // Request validation with correct interface
      const [validationConfigPda] = getValidationConfigPda();
      const [validationPda] = getValidationPda(testAgentId, validator1.publicKey, 0);
      const requestHash = Buffer.alloc(32);

      // Use authority as requester since it's the owner of this agent
      await validationProgram.methods
        .requestValidation(
          new anchor.BN(testAgentId),
          validator1.publicKey,       // validator_address
          0,                           // nonce (u32)
          "ipfs://progressive-request", // request_uri
          Array.from(requestHash)     // request_hash
        )
        .accounts({
          config: validationConfigPda,
          requester: authority.publicKey,  // Authority owns this agent
          payer: authority.publicKey,
          agentMint: agentMintKeypair.publicKey,
          agentAccount: agentAccount,
          validationRequest: validationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        // No signers needed - authority is provider wallet
        .rpc();

      // Progressive updates using updateValidation (same as respondToValidation)
      const responses = [30, 50, 80, 100];
      for (const response of responses) {
        const responseHash = Buffer.alloc(32);
        const txSig = await validationProgram.methods
          .updateValidation(
            response,                         // response score (u8)
            `ipfs://update-${response}`,     // response_uri
            Array.from(responseHash),        // response_hash
            `progress-${response}`           // tag (String)
          )
          .accounts({
            config: validationConfigPda,
            validator: validator1.publicKey,
            validationRequest: validationPda,
          })
          .signers([validator1])
          .rpc();

        await measureCost(`Progressive Update (${response})`, txSig, 2, 200);
      }

      const validation = await validationProgram.account.validationRequest.fetch(validationPda);
      assert.equal(validation.response, 100);
      console.log("✅ Progressive validation complete");
    });
  });

  describe("Scenario 4: Maximum Load Testing", () => {
    it("4.1: Feedback with maximum data size", async () => {
      const maxUri = "x".repeat(200); // Max URI length
      const maxTag1 = "t".repeat(32); // Max tag length (string, not bytes)
      const maxTag2 = "s".repeat(32); // Max tag length (string, not bytes)
      const maxHash = Buffer.alloc(32, 0xFF);

      // FeedbackAuth removed from specs - direct feedback
      const [clientIndexPda] = getClientIndexPda(agent2Id, client1.publicKey);
      const [feedbackPda] = getFeedbackPda(agent2Id, client1.publicKey, 1); // Index 1
      const [reputationPda] = getAgentReputationPda(agent2Id);

      const txSig = await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agent2Id),
          100,
          maxTag1,                       // tag1 (string, max 32 chars)
          maxTag2,                       // tag2 (string, max 32 chars)
          maxUri,                        // file_uri
          Array.from(maxHash),           // file_hash
          new anchor.BN(1)               // feedback_index
        )
        .accounts({
          client: client1.publicKey,
          payer: client1.publicKey,
          agentMint: agent2Mint,
          agentAccount: agent2Pda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client1])
        .rpc();

      await measureCost("Max Size Feedback", txSig, 8, 400);
      console.log("✅ Maximum size feedback submitted");
    });

    it("4.2: Multiple responses to same feedback", async () => {
      const feedbackIndex = 1; // From test 4.1
      const [feedbackPda] = getFeedbackPda(agent2Id, client1.publicKey, feedbackIndex);

      for (let i = 0; i < 3; i++) {
        // Response index PDA tracks next response index for this feedback
        const [responseIndexPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("response_index"),
            Buffer.from(new anchor.BN(agent2Id).toArray("le", 8)),
            client1.publicKey.toBuffer(),
            Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
          ],
          reputationProgram.programId
        );

        // Response account PDA for response i
        const [responseAccountPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("response"),
            Buffer.from(new anchor.BN(agent2Id).toArray("le", 8)),
            client1.publicKey.toBuffer(),
            Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
            Buffer.from(new anchor.BN(i).toArray("le", 8)),  // response_index
          ],
          reputationProgram.programId
        );

        const responseHash = Buffer.alloc(32);
        const txSig = await reputationProgram.methods
          .appendResponse(
            new anchor.BN(agent2Id),
            client1.publicKey,               // client_address
            new anchor.BN(feedbackIndex),    // feedback_index
            `ipfs://response-${i}`,          // response_uri
            Array.from(responseHash)         // response_hash
          )
          .accounts({
            responder: agentOwner2.publicKey,
            payer: authority.publicKey,       // Use authority as payer
            feedbackAccount: feedbackPda,
            responseIndex: responseIndexPda,
            responseAccount: responseAccountPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([agentOwner2])
          .rpc();

        await measureCost(`Append Response ${i + 1}`, txSig, 4, 200);
      }

      // Check responses count via response index
      const [responseIndexPdaCheck] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response_index"),
          Buffer.from(new anchor.BN(agent2Id).toArray("le", 8)),
          client1.publicKey.toBuffer(),
          Buffer.from(new anchor.BN(feedbackIndex).toArray("le", 8)),
        ],
        reputationProgram.programId
      );
      const responseIndexAccount = await reputationProgram.account.responseIndexAccount.fetch(responseIndexPdaCheck);
      assert.equal(Number(responseIndexAccount.nextIndex), 3);
      console.log("✅ Multiple responses appended");
    });
  });

  describe("Scenario 5: Sponsorship & Different Payer", () => {
    it("5.1: Client gives feedback, different payer pays", async () => {
      // FeedbackAuth removed from specs - direct feedback with sponsorship
      // Use index 1 since index 0 was used in Scenario 2
      const feedbackIndex = 1;
      const [clientIndexPda] = getClientIndexPda(agent3Id, client2.publicKey);
      const [feedbackPda] = getFeedbackPda(agent3Id, client2.publicKey, feedbackIndex);
      const [reputationPda] = getAgentReputationPda(agent3Id);

      const txSig = await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agent3Id),
          75,
          "sponsored",                   // tag1 (string)
          "feedback",                    // tag2 (string)
          "",                            // file_uri
          Array.from(Buffer.alloc(32)), // file_hash
          new anchor.BN(feedbackIndex)  // feedback_index (use 1 to avoid conflict)
        )
        .accounts({
          client: client2.publicKey,
          payer: payer.publicKey, // Different payer!
          agentMint: agent3Mint,
          agentAccount: agent3Pda,
          clientIndex: clientIndexPda,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([client2, payer]) // Both sign
        .rpc();

      await measureCost("Feedback with Sponsor", txSig, 8, 300);
      console.log("✅ Sponsored feedback submitted");
    });
  });
});
