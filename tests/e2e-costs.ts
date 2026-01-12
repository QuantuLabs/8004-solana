/**
 * E2E Cost Measurement Tests for Agent Registry 8004 + ATOM Engine v3.0
 *
 * Measures real SOL costs for all operations:
 * - Identity: register, setMetadataPda, setAgentUri
 * - ATOM Engine: initializeStats, giveFeedback (CPI), revokeFeedback (CPI)
 * - Reputation: appendResponse
 * - Validation: requestValidation, respondToValidation
 *
 * v3.0 Update: AtomStats size increased to 652 bytes (+201 from v2.x)
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
  randomHash,
  uniqueNonce,
} from "./utils/helpers";

// SOL price for USD calculations
const SOL_PRICE_USD = 200;

interface CostRecord {
  action: string;
  solCost: number;
  usdCost: number;
  computeUnits: number;
  accountSize?: number;
  rentCost?: number;
  notes?: string;
}

const costs: CostRecord[] = [];

async function measureCost(
  provider: anchor.AnchorProvider,
  action: string,
  txFn: () => Promise<string>,
  accountSize?: number,
  notes?: string
): Promise<string> {
  const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);
  const sig = await txFn();
  await new Promise(resolve => setTimeout(resolve, 500));
  const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);

  const solCost = (balanceBefore - balanceAfter) / LAMPORTS_PER_SOL;
  const usdCost = solCost * SOL_PRICE_USD;

  let computeUnits = 0;
  try {
    const tx = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (tx?.meta?.computeUnitsConsumed) {
      computeUnits = tx.meta.computeUnitsConsumed;
    }
  } catch (e) {}

  // Calculate rent cost if account size is provided
  let rentCost: number | undefined;
  if (accountSize && accountSize > 0) {
    const rentExempt = await provider.connection.getMinimumBalanceForRentExemption(accountSize);
    rentCost = rentExempt / LAMPORTS_PER_SOL;
  }

  costs.push({ action, solCost, usdCost, computeUnits, accountSize, rentCost, notes });

  const sizeStr = accountSize ? `, ${accountSize} bytes` : '';
  const rentStr = rentCost ? `, rent: ${rentCost.toFixed(6)} SOL` : '';
  console.log(`  ${action}: ${solCost.toFixed(6)} SOL ($${usdCost.toFixed(4)}), ${computeUnits} CU${sizeStr}${rentStr}${notes ? ` (${notes})` : ''}`);

  return sig;
}

function printCostSummary() {
  console.log("\n" + "=".repeat(120));
  console.log(`COST SUMMARY - Agent Registry 8004 + ATOM Engine v3.0 (SOL @ $${SOL_PRICE_USD})`);
  console.log("=".repeat(120));
  console.log(
    "Action".padEnd(50) +
    "SOL Cost".padStart(14) +
    "USD Cost".padStart(12) +
    "CU".padStart(10) +
    "Size".padStart(10) +
    "Rent (SOL)".padStart(14) +
    "Notes".padStart(10)
  );
  console.log("-".repeat(120));

  for (const record of costs) {
    console.log(
      record.action.padEnd(50) +
      record.solCost.toFixed(6).padStart(14) +
      ("$" + record.usdCost.toFixed(4)).padStart(12) +
      record.computeUnits.toString().padStart(10) +
      (record.accountSize ? record.accountSize.toString() : "-").padStart(10) +
      (record.rentCost ? record.rentCost.toFixed(6) : "-").padStart(14) +
      (record.notes || "").padStart(10)
    );
  }

  console.log("-".repeat(120));
  const totalSol = costs.reduce((sum, r) => sum + r.solCost, 0);
  const totalUsd = totalSol * SOL_PRICE_USD;
  console.log(
    "TOTAL (all operations)".padEnd(50) +
    totalSol.toFixed(6).padStart(14) +
    ("$" + totalUsd.toFixed(4)).padStart(12)
  );
  console.log("=".repeat(120));

  // Rent exemption summary
  console.log("\n" + "=".repeat(80));
  console.log("RENT EXEMPTION COSTS (One-time per account)");
  console.log("=".repeat(80));

  const rentRecords = costs.filter(c => c.rentCost && c.rentCost > 0);
  for (const record of rentRecords) {
    const rentUsd = (record.rentCost || 0) * SOL_PRICE_USD;
    console.log(
      `${record.action.padEnd(50)} ${record.accountSize} bytes = ${record.rentCost?.toFixed(6)} SOL ($${rentUsd.toFixed(4)})`
    );
  }
  console.log("=".repeat(80));

  // Per-operation breakdown
  console.log("\n" + "=".repeat(80));
  console.log("OPERATION CATEGORIES");
  console.log("=".repeat(80));

  const categories = {
    "Identity (one-time setup)": costs.filter(c =>
      c.action.includes("register") || c.action.includes("Metadata") || c.action.includes("AgentUri")
    ),
    "ATOM Stats (per-agent)": costs.filter(c =>
      c.action.includes("initializeStats") || c.action.includes("AtomStats")
    ),
    "Feedback (per-interaction)": costs.filter(c =>
      c.action.includes("giveFeedback") || c.action.includes("revokeFeedback")
    ),
    "Response/Validation (events)": costs.filter(c =>
      c.action.includes("appendResponse") || c.action.includes("Validation")
    ),
  };

  for (const [category, records] of Object.entries(categories)) {
    if (records.length > 0) {
      const catTotal = records.reduce((sum, r) => sum + r.solCost, 0);
      const catUsd = catTotal * SOL_PRICE_USD;
      console.log(`\n${category}:`);
      for (const r of records) {
        console.log(`  - ${r.action}: ${r.solCost.toFixed(6)} SOL ($${r.usdCost.toFixed(4)})`);
      }
      console.log(`  SUBTOTAL: ${catTotal.toFixed(6)} SOL ($${catUsd.toFixed(4)})`);
    }
  }
  console.log("=".repeat(80));

  // Quick reference
  console.log("\n" + "=".repeat(80));
  console.log("QUICK REFERENCE - Key Costs");
  console.log("=".repeat(80));

  const keyActions = [
    "register (agent + Core NFT)",
    "initializeStats (AtomStats PDA)",
    "giveFeedback (CPI to ATOM)",
    "revokeFeedback (CPI to ATOM)",
    "appendResponse (events-only)",
  ];

  for (const action of keyActions) {
    const record = costs.find(c => c.action.includes(action.split(" ")[0]));
    if (record) {
      console.log(`${action.padEnd(40)} ${record.solCost.toFixed(6)} SOL ($${record.usdCost.toFixed(4)})`);
    }
  }
  console.log("=".repeat(80));
}

describe("E2E Cost Measurement v3.0 (ATOM Engine)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomEngine = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;

  let agent1Asset: Keypair;
  let agent1Pda: PublicKey;
  let agent1StatsPda: PublicKey;

  const thirdParty = Keypair.generate();
  const client2 = Keypair.generate();
  const client3 = Keypair.generate();

  before(async () => {
    console.log("\n" + "=".repeat(80));
    console.log("E2E Cost Measurement v3.0 - ATOM Engine Integration");
    console.log("=".repeat(80));
    console.log(`SOL Price: $${SOL_PRICE_USD}`);
    console.log(`Program ID: ${program.programId.toBase58()}`);
    console.log(`ATOM Engine: ${atomEngine.programId.toBase58()}`);

    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
    collectionPubkey = registryConfig.collection;

    [atomConfigPda] = getAtomConfigPda(atomEngine.programId);

    console.log(`Collection: ${collectionPubkey.toBase58()}`);
    console.log(`AtomConfig: ${atomConfigPda.toBase58()}`);
    console.log("=".repeat(80) + "\n");

    // Fund test accounts
    for (const kp of [thirdParty, client2, client3]) {
      try {
        const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(sig, "confirmed");
      } catch (e) {}
    }
  });

  after(() => {
    printCostSummary();
  });

  describe("Identity Module Costs", () => {
    it("register() - Create agent + Core NFT", async () => {
      agent1Asset = Keypair.generate();
      [agent1Pda] = getAgentPda(agent1Asset.publicKey, program.programId);
      [agent1StatsPda] = getAtomStatsPda(agent1Asset.publicKey, atomEngine.programId);

      await measureCost(
        provider,
        "register (agent + Core NFT)",
        async () => {
          return program.methods
            .register("https://example.com/agent/cost-test")
            .accountsPartial({
              rootConfig: rootConfigPda,
              registryConfig: registryConfigPda,
              agentAccount: agent1Pda,
              asset: agent1Asset.publicKey,
              collection: collectionPubkey,
              userCollectionAuthority: null,
              owner: provider.wallet.publicKey,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              mplCoreProgram: MPL_CORE_PROGRAM_ID,
            })
            .signers([agent1Asset])
            .rpc();
        },
        undefined,
        "NFT+PDA"
      );
    });

    it("setAgentUri() - Update URI", async () => {
      await measureCost(
        provider,
        "setAgentUri",
        async () => {
          return program.methods
            .setAgentUri("https://example.com/updated-uri")
            .accountsPartial({
              registryConfig: registryConfigPda,
              agentAccount: agent1Pda,
              asset: agent1Asset.publicKey,
              collection: collectionPubkey,
              userCollectionAuthority: null,
              owner: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              mplCoreProgram: MPL_CORE_PROGRAM_ID,
            })
            .rpc();
        },
        undefined,
        "No rent"
      );
    });
  });

  describe("ATOM Engine Costs", () => {
    it("initializeStats() - Create AtomStats PDA (652 bytes)", async () => {
      await measureCost(
        provider,
        "initializeStats (AtomStats PDA)",
        async () => {
          return atomEngine.methods
            .initializeStats()
            .accounts({
              owner: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              collection: collectionPubkey,
              config: atomConfigPda,
              stats: agent1StatsPda,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        },
        652, // v3.0 AtomStats size
        "v3.0"
      );
    });

    it("giveFeedback() - CPI to ATOM Engine (score: 85)", async () => {
      const feedbackIndex = new anchor.BN(0);

      await measureCost(
        provider,
        "giveFeedback (CPI to ATOM, score=85)",
        async () => {
          return program.methods
            .giveFeedback(
              85,
              "quality",
              "reliable",
              "https://api.agent.example.com",
              "https://example.com/feedback",
              Array.from(randomHash()),
              feedbackIndex
            )
            .accountsPartial({
              client: thirdParty.publicKey,
              asset: agent1Asset.publicKey,
              collection: collectionPubkey,
              agentAccount: agent1Pda,
              atomConfig: atomConfigPda,
              atomStats: agent1StatsPda,
              atomEngineProgram: atomEngine.programId,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .signers([thirdParty])
            .rpc();
        },
        undefined,
        "CPI"
      );
    });

    it("giveFeedback() - Second feedback (score: 90)", async () => {
      const feedbackIndex = new anchor.BN(1);

      await measureCost(
        provider,
        "giveFeedback (CPI to ATOM, score=90)",
        async () => {
          return program.methods
            .giveFeedback(
              90,
              "fast",
              "accurate",
              "https://api.agent.example.com",
              "https://example.com/feedback2",
              Array.from(randomHash()),
              feedbackIndex
            )
            .accountsPartial({
              client: client2.publicKey,
              asset: agent1Asset.publicKey,
              collection: collectionPubkey,
              agentAccount: agent1Pda,
              atomConfig: atomConfigPda,
              atomStats: agent1StatsPda,
              atomEngineProgram: atomEngine.programId,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .signers([client2])
            .rpc();
        },
        undefined,
        "2nd"
      );
    });

    it("giveFeedback() - Negative feedback (score: 30)", async () => {
      const feedbackIndex = new anchor.BN(2);

      await measureCost(
        provider,
        "giveFeedback (CPI to ATOM, score=30)",
        async () => {
          return program.methods
            .giveFeedback(
              30,
              "slow",
              "error",
              "https://api.agent.example.com",
              "https://example.com/feedback3",
              Array.from(randomHash()),
              feedbackIndex
            )
            .accountsPartial({
              client: client3.publicKey,
              asset: agent1Asset.publicKey,
              collection: collectionPubkey,
              agentAccount: agent1Pda,
              atomConfig: atomConfigPda,
              atomStats: agent1StatsPda,
              atomEngineProgram: atomEngine.programId,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .signers([client3])
            .rpc();
        },
        undefined,
        "negative"
      );
    });

    it("revokeFeedback() - Revoke feedback (CPI to ATOM)", async () => {
      // First give a feedback to revoke
      const revokeIndex = new anchor.BN(3);

      await program.methods
        .giveFeedback(
          70,
          "test",
          "revoke",
          "https://api.example.com",
          "https://example.com/feedback/revoke",
          Array.from(randomHash()),
          revokeIndex
        )
        .accountsPartial({
          client: thirdParty.publicKey,
          asset: agent1Asset.publicKey,
          collection: collectionPubkey,
          agentAccount: agent1Pda,
          atomConfig: atomConfigPda,
          atomStats: agent1StatsPda,
          atomEngineProgram: atomEngine.programId,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([thirdParty])
        .rpc();

      await measureCost(
        provider,
        "revokeFeedback (CPI to ATOM)",
        async () => {
          return program.methods
            .revokeFeedback(revokeIndex)
            .accountsPartial({
              client: thirdParty.publicKey,
              asset: agent1Asset.publicKey,
              atomConfig: atomConfigPda,
              atomStats: agent1StatsPda,
              atomEngineProgram: atomEngine.programId,
              instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
            })
            .signers([thirdParty])
            .rpc();
        },
        undefined,
        "CPI"
      );
    });
  });

  describe("Events-Only Operations", () => {
    it("appendResponse() - Agent responds to feedback", async () => {
      const feedbackIndex = new anchor.BN(0);

      await measureCost(
        provider,
        "appendResponse (events-only)",
        async () => {
          return program.methods
            .appendResponse(
              feedbackIndex,
              "https://example.com/response",
              Array.from(randomHash())
            )
            .accounts({
              responder: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
            })
            .rpc();
        },
        0,
        "TX only"
      );
    });

    it("requestValidation() - Request validation", async () => {
      const validationNonce = uniqueNonce();

      await measureCost(
        provider,
        "requestValidation (events-only)",
        async () => {
          return program.methods
            .requestValidation(
              thirdParty.publicKey,
              validationNonce,
              "https://example.com/validation/request",
              Array.from(randomHash())
            )
            .accounts({
              requester: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              validator: thirdParty.publicKey,
            })
            .rpc();
        },
        0,
        "TX only"
      );
    });

    it("respondToValidation() - Validator responds", async () => {
      const validationNonce = uniqueNonce();

      // First request
      await program.methods
        .requestValidation(
          thirdParty.publicKey,
          validationNonce,
          "https://example.com/validation/request2",
          Array.from(randomHash())
        )
        .accounts({
          requester: provider.wallet.publicKey,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
          validator: thirdParty.publicKey,
        })
        .rpc();

      await measureCost(
        provider,
        "respondToValidation (events-only)",
        async () => {
          return program.methods
            .respondToValidation(
              validationNonce,
              95,
              "https://example.com/validation/response",
              Array.from(randomHash()),
              "approved"
            )
            .accounts({
              validator: thirdParty.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
            })
            .signers([thirdParty])
            .rpc();
        },
        0,
        "TX only"
      );
    });
  });

  describe("Display AtomStats After Operations", () => {
    it("Show current AtomStats", async () => {
      const stats = await atomEngine.account.atomStats.fetch(agent1StatsPda);

      console.log("\n" + "=".repeat(60));
      console.log("AtomStats After All Operations");
      console.log("=".repeat(60));
      console.log(`  feedbackCount:    ${stats.feedbackCount}`);
      console.log(`  qualityScore:     ${stats.qualityScore} (0-10000)`);
      console.log(`  trustTier:        ${stats.trustTier} (0=Unrated, 1=Bronze, 2=Silver, 3=Gold, 4=Platinum)`);
      console.log(`  confidence:       ${stats.confidence} (0-10000)`);
      console.log(`  riskScore:        ${stats.riskScore} (0-100)`);
      console.log(`  diversityRatio:   ${stats.diversityRatio} (0-255)`);
      console.log(`  burstPressure:    ${stats.burstPressure}`);
      console.log(`  evictionCursor:   ${stats.evictionCursor}`);
      console.log(`  hllSalt:          ${stats.hllSalt.toString()}`);
      console.log("=".repeat(60));
    });
  });
});
