/**
 * E2E Cost Measurement Tests for Agent Registry 8004 v2.0.0
 * Events-Only Architecture
 *
 * Measures real SOL costs for all operations:
 * - Identity: register, setMetadataPda, setAgentUri
 * - Reputation: giveFeedback (events-only), revokeFeedback, appendResponse
 * - Validation: requestValidation, respondToValidation (all events-only)
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getMetadataEntryPda,
  computeKeyHash,
  randomHash,
  uniqueNonce,
} from "./utils/helpers";

interface CostRecord {
  action: string;
  solCost: number;
  computeUnits: number;
  accountSize?: number;
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

  costs.push({ action, solCost, computeUnits, accountSize, notes });
  console.log(`  ${action}: ${solCost.toFixed(6)} SOL, ${computeUnits} CU${accountSize ? `, ${accountSize} bytes` : ''}${notes ? ` (${notes})` : ''}`);

  return sig;
}

function printCostSummary() {
  console.log("\n" + "=".repeat(100));
  console.log("v2.0.0 COST SUMMARY - Events-Only Architecture");
  console.log("=".repeat(100));
  console.log(
    "Action".padEnd(45) +
    "SOL Cost".padStart(12) +
    "USD (~$150/SOL)".padStart(16) +
    "CU".padStart(10) +
    "Notes".padStart(17)
  );
  console.log("-".repeat(100));

  for (const record of costs) {
    const usdCost = record.solCost * 150;
    console.log(
      record.action.padEnd(45) +
      record.solCost.toFixed(6).padStart(12) +
      ("$" + usdCost.toFixed(4)).padStart(16) +
      record.computeUnits.toString().padStart(10) +
      (record.notes || "").padStart(17)
    );
  }

  console.log("-".repeat(100));
  const totalSol = costs.reduce((sum, r) => sum + r.solCost, 0);
  const totalUsd = totalSol * 150;
  console.log(
    "TOTAL".padEnd(45) +
    totalSol.toFixed(6).padStart(12) +
    ("$" + totalUsd.toFixed(4)).padStart(16)
  );
  console.log("=".repeat(100));

  console.log("\n" + "=".repeat(100));
  console.log("v2.0.0 EVENTS-ONLY SAVINGS");
  console.log("=".repeat(100));

  const feedback = costs.find(c => c.action.includes("giveFeedback"));
  const response = costs.find(c => c.action.includes("appendResponse"));
  const validation = costs.find(c => c.action.includes("requestValidation"));

  if (feedback) {
    const oldCost = 0.00150;
    const savings = ((oldCost - feedback.solCost) / oldCost * 100);
    console.log(`giveFeedback:       ${feedback.solCost.toFixed(6)} SOL vs ~0.00150 SOL (v0.3 PDA) = ${savings > 0 ? savings.toFixed(0) + '% savings' : 'similar'}`);
  }
  if (response) {
    const oldCost = 0.00180;
    const savings = ((oldCost - response.solCost) / oldCost * 100);
    console.log(`appendResponse:     ${response.solCost.toFixed(6)} SOL vs ~0.00180 SOL (v0.3 PDA) = ${savings > 0 ? savings.toFixed(0) + '% savings' : 'similar'} (events-only!)`);
  }
  if (validation) {
    const oldCost = 0.00200;
    const savings = ((oldCost - validation.solCost) / oldCost * 100);
    console.log(`requestValidation:  ${validation.solCost.toFixed(6)} SOL vs ~0.00200 SOL (v0.3 PDA) = ${savings > 0 ? savings.toFixed(0) + '% savings' : 'similar'} (events-only!)`);
  }

  console.log("\nKey insight: Events-only = TX fee only (~0.00001 SOL)");
  console.log("No rent required for reputation/validation PDAs");
  console.log("=".repeat(100));
}

describe("E2E Cost Measurement v2.0.0 (Events-Only)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  let agent1Asset: Keypair;
  let agent1Pda: PublicKey;

  const thirdParty = Keypair.generate();

  before(async () => {
    console.log("\n=== E2E Cost Measurement v2.0.0 ===");
    console.log("Program ID:", program.programId.toBase58());

    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
    collectionPubkey = registryConfig.collection;

    console.log("Collection:", collectionPubkey.toBase58());

    try {
      const sig = await provider.connection.requestAirdrop(thirdParty.publicKey, LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    } catch (e) {}
  });

  after(() => {
    printCostSummary();
  });

  describe("Identity Module Costs", () => {
    it("register() - Create agent", async () => {
      agent1Asset = Keypair.generate();
      [agent1Pda] = getAgentPda(agent1Asset.publicKey, program.programId);

      await measureCost(
        provider,
        "register (agent + Core NFT)",
        async () => {
          return program.methods
            .register("https://example.com/agent/cost-test")
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
            .signers([agent1Asset])
            .rpc();
        },
        undefined,
        "NFT + AgentPDA"
      );
    });

    it("setMetadataPda() - Small value", async () => {
      const key = "type";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agent1Asset.publicKey, keyHash, program.programId);
      const value = Buffer.from("assistant");

      await measureCost(
        provider,
        "setMetadataPda (small: 9 bytes)",
        async () => {
          return program.methods
            .setMetadataPda(
              Array.from(keyHash),
              key,
              value,
              false
            )
            .accountsPartial({
              owner: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              metadataEntry: metadataPda,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        },
        undefined,
        "Dynamic sizing"
      );
    });

    it("setMetadataPda() - Large value (256 bytes)", async () => {
      const key = "config";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agent1Asset.publicKey, keyHash, program.programId);
      const value = Buffer.alloc(256).fill(0x42);

      await measureCost(
        provider,
        "setMetadataPda (large: 256 bytes)",
        async () => {
          return program.methods
            .setMetadataPda(
              Array.from(keyHash),
              key,
              value,
              false
            )
            .accountsPartial({
              owner: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              metadataEntry: metadataPda,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        },
        338,
        "Max size"
      );
    });

    it("deleteMetadataPda() - Recover rent", async () => {
      const key = "deletable";
      const keyHash = computeKeyHash(key);
      const [metadataPda] = getMetadataEntryPda(agent1Asset.publicKey, keyHash, program.programId);

      await program.methods
        .setMetadataPda(Array.from(keyHash), key, Buffer.from("temp"), false)
        .accountsPartial({
          owner: provider.wallet.publicKey,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
          metadataEntry: metadataPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await measureCost(
        provider,
        "deleteMetadataPda (rent back)",
        async () => {
          return program.methods
            .deleteMetadataPda(Array.from(keyHash))
            .accountsPartial({
              owner: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              metadataEntry: metadataPda,
            })
            .rpc();
        },
        undefined,
        "Negative=refund"
      );
    });

    it("setAgentUri()", async () => {
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
        "No rent change"
      );
    });
  });

  describe("Reputation Module Costs (Events-Only)", () => {
    it("giveFeedback() - Events only, no PDA", async () => {
      const feedbackIndex = new anchor.BN(0);

      await measureCost(
        provider,
        "giveFeedback (events-only v2.0)",
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
            .accounts({
              client: thirdParty.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
            })
            .signers([thirdParty])
            .rpc();
        },
        0,
        "TX fee only!"
      );
    });

    it("appendResponse() - Events only", async () => {
      const feedbackIndex = new anchor.BN(0);

      await measureCost(
        provider,
        "appendResponse (events-only v2.0)",
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
        "TX fee only!"
      );
    });

    it("appendResponse() - Multiple responses (still cheap)", async () => {
      const feedbackIndex = new anchor.BN(0);

      await measureCost(
        provider,
        "appendResponse (2nd response)",
        async () => {
          return program.methods
            .appendResponse(
              feedbackIndex,
              "https://example.com/response2",
              Array.from(randomHash())
            )
            .accounts({
              responder: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
            })
            .rpc();
        },
        0,
        "Events-only"
      );
    });

    it("revokeFeedback() - Events only", async () => {
      const revokeIndex = new anchor.BN(1);

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
        .accounts({
          client: thirdParty.publicKey,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
        })
        .signers([thirdParty])
        .rpc();

      await measureCost(
        provider,
        "revokeFeedback (events-only)",
        async () => {
          return program.methods
            .revokeFeedback(revokeIndex)
            .accounts({
              client: thirdParty.publicKey,
              asset: agent1Asset.publicKey,
            })
            .signers([thirdParty])
            .rpc();
        },
        undefined,
        "TX fee only"
      );
    });
  });

  describe("Validation Module Costs (Events-Only)", () => {
    let validationNonce: number;

    before(() => {
      validationNonce = uniqueNonce();
    });

    it("requestValidation() - Events only, no PDA", async () => {
      const validator = thirdParty.publicKey;

      await measureCost(
        provider,
        "requestValidation (events-only v2.0)",
        async () => {
          return program.methods
            .requestValidation(
              validator,
              validationNonce,
              "https://example.com/validation/request",
              Array.from(randomHash())
            )
            .accounts({
              requester: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              validator: validator,
            })
            .rpc();
        },
        0,
        "TX fee only!"
      );
    });

    it("respondToValidation() - Events only", async () => {
      const validator = thirdParty.publicKey;

      await measureCost(
        provider,
        "respondToValidation (events-only v2.0)",
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
        "TX fee only!"
      );
    });
  });

  describe("Anti-Gaming Protection", () => {
    it("REJECT: Self-feedback", async () => {
      try {
        await program.methods
          .giveFeedback(
            100,
            "self",
            "feedback",
            "https://example.com",
            "https://example.com/self",
            Array.from(randomHash()),
            new anchor.BN(999)
          )
          .accounts({
            client: provider.wallet.publicKey,
            asset: agent1Asset.publicKey,
            agentAccount: agent1Pda,
          })
          .rpc();
        throw new Error("Should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("SelfFeedbackNotAllowed");
        console.log("  PASS: Self-feedback rejected");
      }
    });

    it("REJECT: Self-validation", async () => {
      try {
        await program.methods
          .requestValidation(
            provider.wallet.publicKey,
            uniqueNonce(),
            "https://example.com/self",
            Array.from(randomHash())
          )
          .accounts({
            requester: provider.wallet.publicKey,
            asset: agent1Asset.publicKey,
            agentAccount: agent1Pda,
            validator: provider.wallet.publicKey,
          })
          .rpc();
        throw new Error("Should have rejected");
      } catch (e: any) {
        expect(e.message).to.include("SelfValidationNotAllowed");
        console.log("  PASS: Self-validation rejected");
      }
    });
  });
});
