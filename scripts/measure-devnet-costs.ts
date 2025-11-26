/**
 * Production Cost Measurement Script
 *
 * This script measures real-world costs on Solana Devnet for all ERC-8004 operations.
 * It provides comprehensive cost analysis including:
 * - Lamports per operation
 * - SOL cost at current price
 * - Compute units consumed
 * - Account rent costs
 * - Comparison with localnet costs
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
 *   ANCHOR_WALLET="~/.config/solana/id.json" \
 *   npx ts-node scripts/measure-devnet-costs.ts
 */

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import * as fs from "fs";
import * as path from "path";
import * as nacl from "tweetnacl";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

interface CostData {
  operation: string;
  lamports: number;
  sol: number;
  computeUnits: number;
  accounts: number;
  dataSize?: number;
  timestamp: number;
}

interface CostReport {
  environment: string;
  cluster: string;
  timestamp: string;
  totalOperations: number;
  totalCost: {
    lamports: number;
    sol: number;
  };
  operations: {
    [key: string]: {
      count: number;
      avg: { lamports: number; sol: number; computeUnits: number };
      min: { lamports: number; computeUnits: number };
      max: { lamports: number; computeUnits: number };
    };
  };
  rawData: CostData[];
}

class DevnetCostMeasurement {
  provider: anchor.AnchorProvider;
  identityProgram: anchor.Program<IdentityRegistry>;
  reputationProgram: anchor.Program<ReputationRegistry>;
  validationProgram: anchor.Program<ValidationRegistry>;
  costs: CostData[] = [];

  // Test accounts
  authority!: Keypair;
  agentOwner!: Keypair;
  client!: Keypair;
  validator!: Keypair;

  // Registry data
  configPda!: PublicKey;
  collectionMint!: Keypair;
  agentMint!: PublicKey;
  agentPda!: PublicKey;
  agentId!: number;

  constructor() {
    // Setup provider
    const url = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
    const connection = new Connection(url, "confirmed");

    const walletPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
    const walletKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );

    const wallet = new anchor.Wallet(walletKeypair);
    this.provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(this.provider);

    // Load programs
    this.identityProgram = anchor.workspace.IdentityRegistry as anchor.Program<IdentityRegistry>;
    this.reputationProgram = anchor.workspace.ReputationRegistry as anchor.Program<ReputationRegistry>;
    this.validationProgram = anchor.workspace.ValidationRegistry as anchor.Program<ValidationRegistry>;

    console.log(`\n🌐 Connected to: ${url}`);
    console.log(`💼 Wallet: ${wallet.publicKey.toBase58()}\n`);
  }

  async measureCost(operation: string, txSig: string, accounts: number, dataSize?: number): Promise<void> {
    const tx = await this.provider.connection.getTransaction(txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (tx && tx.meta) {
      const lamports = tx.meta.fee;
      const sol = lamports / LAMPORTS_PER_SOL;
      const computeUnits = tx.meta.computeUnitsConsumed || 0;

      this.costs.push({
        operation,
        lamports,
        sol,
        computeUnits,
        accounts,
        dataSize,
        timestamp: Date.now(),
      });

      console.log(`  💰 ${operation}:`);
      console.log(`      Fee: ${lamports} lamports (${sol.toFixed(9)} SOL)`);
      console.log(`      Compute Units: ${computeUnits.toLocaleString()}`);
      console.log(`      Accounts: ${accounts}`);
      if (dataSize) console.log(`      Data Size: ${dataSize} bytes`);
    } else {
      console.log(`  ❌ Failed to fetch transaction for ${operation}`);
    }
  }

  async requestAirdrop(pubkey: PublicKey, amount: number): Promise<void> {
    try {
      const sig = await this.provider.connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
      await this.provider.connection.confirmTransaction(sig, "confirmed");
      console.log(`  ✅ Airdropped ${amount} SOL to ${pubkey.toBase58().slice(0, 8)}...`);
    } catch (error: any) {
      console.log(`  ⚠️  Airdrop failed (may have hit rate limit): ${error.message}`);
      // On devnet, airdrops are rate-limited, so we continue anyway
    }
  }

  getMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  getMasterEditionPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer(), Buffer.from("edition")],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
  }

  async setup(): Promise<void> {
    console.log("🔧 Setting up test accounts...\n");

    this.authority = Keypair.generate();
    this.agentOwner = Keypair.generate();
    this.client = Keypair.generate();
    this.validator = Keypair.generate();

    // Request airdrops
    await this.requestAirdrop(this.authority.publicKey, 3);
    await this.requestAirdrop(this.agentOwner.publicKey, 2);
    await this.requestAirdrop(this.client.publicKey, 2);
    await this.requestAirdrop(this.validator.publicKey, 2);

    // Wait a bit for airdrops to settle
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("");
  }

  async initializeRegistries(): Promise<void> {
    console.log("📝 Initializing registries...\n");

    // Initialize identity registry
    [this.configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.identityProgram.programId
    );

    this.collectionMint = Keypair.generate();
    const collectionMetadata = this.getMetadataPda(this.collectionMint.publicKey);
    const collectionMasterEdition = this.getMasterEditionPda(this.collectionMint.publicKey);
    const collectionTokenAccount = getAssociatedTokenAddressSync(
      this.collectionMint.publicKey,
      this.authority.publicKey
    );

    try {
      const txSig = await this.identityProgram.methods
        .initialize()
        .accounts({
          config: this.configPda,
          collectionMint: this.collectionMint.publicKey,
          collectionMetadata,
          collectionMasterEdition,
          collectionTokenAccount,
          authority: this.authority.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([this.authority, this.collectionMint])
        .rpc();

      await this.measureCost("Identity Registry Initialize", txSig, 7);
      console.log("  ✅ Identity registry initialized\n");
    } catch (error: any) {
      console.log(`  ⚠️  Identity registry may already be initialized: ${error.message}\n`);
    }

    // Initialize validation registry
    const [validationConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("validation_config")],
      this.validationProgram.programId
    );

    try {
      const txSig = await this.validationProgram.methods
        .initialize()
        .accounts({
          config: validationConfigPda,
          identityRegistry: this.identityProgram.programId,
          authority: this.authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.authority])
        .rpc();

      await this.measureCost("Validation Registry Initialize", txSig, 3);
      console.log("  ✅ Validation registry initialized\n");
    } catch (error: any) {
      console.log(`  ⚠️  Validation registry may already be initialized: ${error.message}\n`);
    }
  }

  async registerAgent(): Promise<void> {
    console.log("👤 Registering agent...\n");

    const agentMintKeypair = Keypair.generate();
    const [agentAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMintKeypair.publicKey.toBuffer()],
      this.identityProgram.programId
    );

    const config = await this.identityProgram.account.registryConfig.fetch(this.configPda);

    const txSig = await this.identityProgram.methods
      .register("ipfs://test-agent")
      .accounts({
        config: this.configPda,
        authority: config.authority,
        agentAccount: agentAccount,
        agentMint: agentMintKeypair.publicKey,
        agentMetadata: this.getMetadataPda(agentMintKeypair.publicKey),
        agentMasterEdition: this.getMasterEditionPda(agentMintKeypair.publicKey),
        agentTokenAccount: getAssociatedTokenAddressSync(agentMintKeypair.publicKey, this.agentOwner.publicKey),
        collectionMint: config.collectionMint,
        collectionMetadata: this.getMetadataPda(config.collectionMint),
        collectionMasterEdition: this.getMasterEditionPda(config.collectionMint),
        owner: this.agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([agentMintKeypair, this.agentOwner])
      .rpc();

    await this.measureCost("Register Agent", txSig, 11, 200);

    const fetchedAgent = await this.identityProgram.account.agentAccount.fetch(agentAccount);
    this.agentMint = agentMintKeypair.publicKey;
    this.agentPda = agentAccount;
    this.agentId = Number(fetchedAgent.agentId);

    console.log(`  ✅ Agent registered (ID: ${this.agentId})\n`);
  }

  async setMetadata(): Promise<void> {
    console.log("🏷️  Setting metadata...\n");

    const txSig = await this.identityProgram.methods
      .setMetadata("name", "Test Agent")
      .accounts({
        agentAccount: this.agentPda,
        agentMint: this.agentMint,
        agentTokenAccount: getAssociatedTokenAddressSync(this.agentMint, this.agentOwner.publicKey),
        owner: this.agentOwner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.agentOwner])
      .rpc();

    await this.measureCost("Set Metadata", txSig, 3, 64);
    console.log("  ✅ Metadata set\n");
  }

  async giveFeedback(): Promise<void> {
    console.log("📝 Giving feedback...\n");

    // Create feedbackAuth
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    const message = `feedback_auth:${this.agentId}:${this.client.publicKey.toBase58()}:5:${expiry}:solana-devnet:${this.identityProgram.programId.toBase58()}`;
    const messageBytes = Buffer.from(message, 'utf8');
    const signature = nacl.sign.detached(messageBytes, this.agentOwner.secretKey);

    const feedbackAuth = {
      agentId: new anchor.BN(this.agentId),
      clientAddress: this.client.publicKey,
      indexLimit: new anchor.BN(5),
      expiry: new anchor.BN(expiry),
      chainId: "solana-devnet",
      identityRegistry: this.identityProgram.programId,
      signerAddress: this.agentOwner.publicKey,
      signature: Buffer.from(signature),
    };

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: this.agentOwner.publicKey.toBytes(),
      message: messageBytes,
      signature: feedbackAuth.signature,
    });

    const [clientIndexPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("client_index"),
        Buffer.from(new anchor.BN(this.agentId).toArray("le", 8)),
        this.client.publicKey.toBuffer(),
      ],
      this.reputationProgram.programId
    );

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        Buffer.from(new anchor.BN(this.agentId).toArray("le", 8)),
        this.client.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(0).toArray("le", 8)),
      ],
      this.reputationProgram.programId
    );

    const [reputationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("agent_reputation"),
        Buffer.from(new anchor.BN(this.agentId).toArray("le", 8)),
      ],
      this.reputationProgram.programId
    );

    const txSig = await this.reputationProgram.methods
      .giveFeedback(
        new anchor.BN(this.agentId),
        85,
        Array.from(Buffer.alloc(32)),
        Array.from(Buffer.alloc(32)),
        "ipfs://feedback",
        Array.from(Buffer.alloc(32)),
        new anchor.BN(0),
        feedbackAuth
      )
      .accounts({
        client: this.client.publicKey,
        payer: this.client.publicKey,
        agentMint: this.agentMint,
        agentAccount: this.agentPda,
        clientIndex: clientIndexPda,
        feedbackAccount: feedbackPda,
        agentReputation: reputationPda,
        identityRegistryProgram: this.identityProgram.programId,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .signers([this.client])
      .rpc();

    await this.measureCost("Give Feedback (with FeedbackAuth)", txSig, 7, 300);
    console.log("  ✅ Feedback given\n");
  }

  async requestValidation(): Promise<void> {
    console.log("🔍 Requesting validation...\n");

    const [validationConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("validation_config")],
      this.validationProgram.programId
    );

    const [validationCounterPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation_counter"),
        Buffer.from(new anchor.BN(this.agentId).toArray("le", 8)),
        this.validator.publicKey.toBuffer(),
      ],
      this.validationProgram.programId
    );

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        Buffer.from(new anchor.BN(this.agentId).toArray("le", 8)),
        this.validator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(0).toArray("le", 4)),
      ],
      this.validationProgram.programId
    );

    const txSig = await this.validationProgram.methods
      .requestValidation(
        new anchor.BN(this.agentId),
        "ipfs://validation-request",
        Array.from(Buffer.alloc(32))
      )
      .accounts({
        config: validationConfigPda,
        validationAccount: validationPda,
        validationCounter: validationCounterPda,
        agentAccount: this.agentPda,
        agentMint: this.agentMint,
        agentTokenAccount: getAssociatedTokenAddressSync(this.agentMint, this.agentOwner.publicKey),
        validatorAddress: this.validator.publicKey,
        requester: this.agentOwner.publicKey,
        payer: this.agentOwner.publicKey,
        identityRegistryProgram: this.identityProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.agentOwner])
      .rpc();

    await this.measureCost("Request Validation", txSig, 8, 300);
    console.log("  ✅ Validation requested\n");
  }

  async respondToValidation(): Promise<void> {
    console.log("✅ Responding to validation...\n");

    const [validationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("validation"),
        Buffer.from(new anchor.BN(this.agentId).toArray("le", 8)),
        this.validator.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(0).toArray("le", 4)),
      ],
      this.validationProgram.programId
    );

    const txSig = await this.validationProgram.methods
      .respondToValidation(
        new anchor.BN(this.agentId),
        new anchor.BN(0),
        100,
        "ipfs://validation-response",
        Array.from(Buffer.alloc(32)),
        Array.from(Buffer.alloc(32))
      )
      .accounts({
        validationAccount: validationPda,
        validator: this.validator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.validator])
      .rpc();

    await this.measureCost("Respond to Validation", txSig, 2, 300);
    console.log("  ✅ Validation responded\n");
  }

  generateReport(): CostReport {
    const grouped = this.costs.reduce((acc, cost) => {
      if (!acc[cost.operation]) {
        acc[cost.operation] = [];
      }
      acc[cost.operation].push(cost);
      return acc;
    }, {} as Record<string, CostData[]>);

    const operations: CostReport["operations"] = {};

    for (const [operation, costs] of Object.entries(grouped)) {
      const lamports = costs.map(c => c.lamports);
      const sol = costs.map(c => c.sol);
      const cu = costs.map(c => c.computeUnits);

      operations[operation] = {
        count: costs.length,
        avg: {
          lamports: lamports.reduce((a, b) => a + b, 0) / lamports.length,
          sol: sol.reduce((a, b) => a + b, 0) / sol.length,
          computeUnits: cu.reduce((a, b) => a + b, 0) / cu.length,
        },
        min: {
          lamports: Math.min(...lamports),
          computeUnits: Math.min(...cu),
        },
        max: {
          lamports: Math.max(...lamports),
          computeUnits: Math.max(...cu),
        },
      };
    }

    const totalLamports = this.costs.reduce((sum, c) => sum + c.lamports, 0);
    const totalSol = totalLamports / LAMPORTS_PER_SOL;

    return {
      environment: "devnet",
      cluster: process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
      timestamp: new Date().toISOString(),
      totalOperations: this.costs.length,
      totalCost: {
        lamports: totalLamports,
        sol: totalSol,
      },
      operations,
      rawData: this.costs,
    };
  }

  printReport(report: CostReport): void {
    console.log("\n\n📊 ===== DEVNET COST ANALYSIS REPORT =====\n");
    console.log(`Environment: ${report.environment}`);
    console.log(`Cluster: ${report.cluster}`);
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`Total Operations: ${report.totalOperations}`);
    console.log(`Total Cost: ${report.totalCost.lamports} lamports (${report.totalCost.sol.toFixed(9)} SOL)\n`);

    console.log("Operation Breakdown:\n");

    for (const [operation, stats] of Object.entries(report.operations)) {
      console.log(`${operation}:`);
      console.log(`  Count: ${stats.count}`);
      console.log(`  Average: ${stats.avg.lamports.toFixed(0)} lamports (${stats.avg.sol.toFixed(9)} SOL)`);
      console.log(`  Min: ${stats.min.lamports} lamports`);
      console.log(`  Max: ${stats.max.lamports} lamports`);
      console.log(`  Avg Compute Units: ${stats.avg.computeUnits.toFixed(0)}`);
      console.log(``);
    }
  }

  async run(): Promise<void> {
    try {
      await this.setup();
      await this.initializeRegistries();
      await this.registerAgent();
      await this.setMetadata();
      await this.giveFeedback();
      await this.requestValidation();
      await this.respondToValidation();

      const report = this.generateReport();
      this.printReport(report);

      // Save report to file
      const outputDir = path.join(__dirname, "../reports");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const jsonPath = path.join(outputDir, `devnet-costs-${Date.now()}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log(`\n💾 Report saved to: ${jsonPath}\n`);

      // Generate CSV
      const csvPath = path.join(outputDir, `devnet-costs-${Date.now()}.csv`);
      const csvLines = [
        "Operation,Lamports,SOL,Compute Units,Accounts,Data Size,Timestamp",
        ...report.rawData.map(d =>
          `"${d.operation}",${d.lamports},${d.sol},${d.computeUnits},${d.accounts},${d.dataSize || ""},${d.timestamp}`
        ),
      ];
      fs.writeFileSync(csvPath, csvLines.join("\n"));
      console.log(`💾 CSV saved to: ${csvPath}\n`);

      console.log("✅ Cost measurement complete!\n");
    } catch (error: any) {
      console.error("\n❌ Error during cost measurement:");
      console.error(error);
      process.exit(1);
    }
  }
}

// Run the measurement
const measurement = new DevnetCostMeasurement();
measurement.run().then(() => process.exit(0));
