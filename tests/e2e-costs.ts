/**
 * E2E Cost Measurement Tests for Agent Registry 8004
 * Covers all instructions and measures SOL costs + compute units
 * Updated for multi-collection architecture
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getAgentReputationPda,
  getFeedbackPda,
  getFeedbackTagsPda,
  getResponseIndexPda,
  getResponsePda,
  getValidationStatsPda,
  getValidationRequestPda,
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
  await new Promise(resolve => setTimeout(resolve, 500)); // Wait for confirmation
  const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);

  const solCost = (balanceBefore - balanceAfter) / LAMPORTS_PER_SOL;

  // Get compute units from transaction
  let computeUnits = 0;
  try {
    const tx = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (tx?.meta?.computeUnitsConsumed) {
      computeUnits = tx.meta.computeUnitsConsumed;
    }
  } catch (e) {
    // Ignore errors getting compute units
  }

  costs.push({ action, solCost, computeUnits, accountSize, notes });
  console.log(`  ${action}: ${solCost.toFixed(6)} SOL, ${computeUnits} CU${accountSize ? `, ${accountSize} bytes` : ''}`);

  return sig;
}

function printCostSummary() {
  console.log("\n" + "=".repeat(80));
  console.log("COST SUMMARY");
  console.log("=".repeat(80));
  console.log(
    "Action".padEnd(35) +
    "SOL Cost".padStart(12) +
    "Compute Units".padStart(15) +
    "Account Size".padStart(14) +
    "Notes".padStart(20)
  );
  console.log("-".repeat(96));

  for (const record of costs) {
    console.log(
      record.action.padEnd(35) +
      record.solCost.toFixed(6).padStart(12) +
      record.computeUnits.toString().padStart(15) +
      (record.accountSize ? `${record.accountSize} bytes` : "-").padStart(14) +
      (record.notes || "").padStart(20)
    );
  }

  console.log("-".repeat(96));
  const totalSol = costs.reduce((sum, r) => sum + r.solCost, 0);
  const totalCU = costs.reduce((sum, r) => sum + r.computeUnits, 0);
  console.log(
    "TOTAL".padEnd(35) +
    totalSol.toFixed(6).padStart(12) +
    totalCU.toString().padStart(15)
  );
  console.log("=".repeat(80));
}

describe("E2E Cost Measurement Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let validationStatsPda: PublicKey;

  // Test agents
  let agent1Asset: Keypair;
  let agent1Pda: PublicKey;
  let agent1Id: anchor.BN;

  let agent2Asset: Keypair;
  let agent2Pda: PublicKey;
  let agent2Id: anchor.BN;

  // Third party for feedback/validation
  const thirdParty = Keypair.generate();

  before(async () => {
    console.log("\n=== E2E Cost Measurement Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Provider:", provider.wallet.publicKey.toBase58());

    [rootConfigPda] = getRootConfigPda(program.programId);
    [validationStatsPda] = getValidationStatsPda(program.programId);

    // Fetch root config to get current base registry
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    console.log("Root Config PDA:", rootConfigPda.toBase58());
    console.log("Current Base Registry:", rootConfig.currentBaseRegistry.toBase58());

    // Fetch the registry config
    const registryConfig = await program.account.registryConfig.fetch(rootConfig.currentBaseRegistry);
    registryConfigPda = rootConfig.currentBaseRegistry;
    collectionPubkey = registryConfig.collection;

    console.log("Registry Config PDA:", registryConfigPda.toBase58());
    console.log("Collection:", collectionPubkey.toBase58());
    console.log("Next Agent ID:", registryConfig.nextAgentId.toNumber());

    // Airdrop to third party for testing
    try {
      const sig = await provider.connection.requestAirdrop(thirdParty.publicKey, LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    } catch (e) {
      // May fail on devnet due to rate limits
    }
  });

  after(() => {
    printCostSummary();
  });

  // ============================================================================
  // IDENTITY MODULE
  // ============================================================================
  describe("Identity Module Costs", () => {
    it("register() - Create agent with NFT", async () => {
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      agent1Id = registryConfig.nextAgentId;
      agent1Asset = Keypair.generate();
      [agent1Pda] = getAgentPda(agent1Asset.publicKey, program.programId);

      await measureCost(
        provider,
        "register (agent + NFT)",
        async () => {
          return program.methods
            .register("https://example.com/agent/cost-test-1")
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
        "NFT + PDA"
      );

      // Verify
      const agent = await program.account.agentAccount.fetch(agent1Pda);
      expect(agent.agentId.toNumber()).to.equal(agent1Id.toNumber());
    });

    it("register() - Second agent", async () => {
      const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
      agent2Id = registryConfig.nextAgentId;
      agent2Asset = Keypair.generate();
      [agent2Pda] = getAgentPda(agent2Asset.publicKey, program.programId);

      await measureCost(
        provider,
        "register (2nd agent)",
        async () => {
          return program.methods
            .register("https://example.com/agent/cost-test-2")
            .accountsPartial({
              registryConfig: registryConfigPda,
              agentAccount: agent2Pda,
              asset: agent2Asset.publicKey,
              collection: collectionPubkey,
              userCollectionAuthority: null,
              owner: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              mplCoreProgram: MPL_CORE_PROGRAM_ID,
            })
            .signers([agent2Asset])
            .rpc();
        }
      );
    });

    it("setMetadataPda() - Add custom metadata", async () => {
      const metadataKey = "website";
      const keyHash = computeKeyHash(metadataKey);
      const [metadataPda] = getMetadataEntryPda(agent1Id, keyHash, program.programId);

      await measureCost(
        provider,
        "setMetadataPda",
        async () => {
          return program.methods
            .setMetadataPda(
              Array.from(keyHash),
              metadataKey,
              Buffer.from("https://myagent.ai"),
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
        "~300 bytes"
      );
    });

    it("setAgentUri() - Update agent URI", async () => {
      await measureCost(
        provider,
        "setAgentUri",
        async () => {
          return program.methods
            .setAgentUri("https://example.com/agent/cost-test-updated")
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

  // ============================================================================
  // REPUTATION MODULE
  // ============================================================================
  describe("Reputation Module Costs", () => {
    let feedbackIndex: anchor.BN;
    let agentReputationPda: PublicKey;
    let firstFeedbackIndex: anchor.BN;

    before(async () => {
      [agentReputationPda] = getAgentReputationPda(agent1Id, program.programId);

      // Get the next available feedback index from reputation metadata
      try {
        const repMeta = await program.account.agentReputationMetadata.fetch(agentReputationPda);
        feedbackIndex = repMeta.nextFeedbackIndex;
      } catch {
        // Account doesn't exist yet, start from 0
        feedbackIndex = new anchor.BN(0);
      }
      firstFeedbackIndex = feedbackIndex;
      console.log(`    Starting feedback index: ${feedbackIndex.toString()}`);
    });

    it("giveFeedback() - First feedback (creates reputation PDA)", async () => {
      const [feedbackPda] = getFeedbackPda(agent1Id, feedbackIndex, program.programId);

      await measureCost(
        provider,
        "giveFeedback (1st, +repPDA)",
        async () => {
          return program.methods
            .giveFeedback(
              agent1Id,
              85, // score
              "quality",
              "reliable",
              "https://agent.example.com/api",
              "https://example.com/feedback/0",
              Array.from(randomHash()),
              feedbackIndex
            )
            .accountsPartial({
              client: thirdParty.publicKey,
              payer: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              feedbackAccount: feedbackPda,
              agentReputation: agentReputationPda,
              systemProgram: SystemProgram.programId,
            })
            .signers([thirdParty])
            .rpc();
        },
        67, // FeedbackAccount size after optimization
        "Creates 2 PDAs"
      );

      feedbackIndex = feedbackIndex.addn(1);
    });

    it("giveFeedback() - Subsequent feedback", async () => {
      const [feedbackPda] = getFeedbackPda(agent1Id, feedbackIndex, program.programId);

      await measureCost(
        provider,
        "giveFeedback (subsequent)",
        async () => {
          return program.methods
            .giveFeedback(
              agent1Id,
              90,
              "fast",
              "accurate",
              "https://agent.example.com/api",
              "https://example.com/feedback/1",
              Array.from(randomHash()),
              feedbackIndex
            )
            .accountsPartial({
              client: thirdParty.publicKey,
              payer: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              feedbackAccount: feedbackPda,
              agentReputation: agentReputationPda,
              systemProgram: SystemProgram.programId,
            })
            .signers([thirdParty])
            .rpc();
        },
        67,
        "Only feedback PDA"
      );
    });

    it("setFeedbackTags() - Add tags to feedback", async () => {
      const [feedbackPda] = getFeedbackPda(agent1Id, firstFeedbackIndex, program.programId);
      const [feedbackTagsPda] = getFeedbackTagsPda(agent1Id, firstFeedbackIndex, program.programId);

      await measureCost(
        provider,
        "setFeedbackTags",
        async () => {
          return program.methods
            .setFeedbackTags(agent1Id, firstFeedbackIndex, "excellent", "recommended")
            .accountsPartial({
              client: thirdParty.publicKey,
              payer: provider.wallet.publicKey,
              feedbackAccount: feedbackPda,
              feedbackTags: feedbackTagsPda,
              systemProgram: SystemProgram.programId,
            })
            .signers([thirdParty])
            .rpc();
        },
        97, // FeedbackTagsPda size
        "Optional PDA"
      );
    });

    it("appendResponse() - First response to feedback", async () => {
      const [feedbackPda] = getFeedbackPda(agent1Id, firstFeedbackIndex, program.programId);
      const [responseIndexPda] = getResponseIndexPda(agent1Id, firstFeedbackIndex, program.programId);

      // Get the next response index
      let responseIdx: anchor.BN;
      try {
        const respIndex = await program.account.responseIndexAccount.fetch(responseIndexPda);
        responseIdx = respIndex.nextIndex;
      } catch {
        responseIdx = new anchor.BN(0);
      }

      const [responsePda] = getResponsePda(agent1Id, firstFeedbackIndex, responseIdx, program.programId);

      await measureCost(
        provider,
        "appendResponse (1st)",
        async () => {
          return program.methods
            .appendResponse(
              agent1Id,
              firstFeedbackIndex,
              "https://example.com/response/0",
              Array.from(randomHash())
            )
            .accountsPartial({
              responder: provider.wallet.publicKey,
              payer: provider.wallet.publicKey,
              feedbackAccount: feedbackPda,
              responseIndex: responseIndexPda,
              responseAccount: responsePda,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        },
        73, // ResponseAccount size after optimization
        "Creates 2 PDAs"
      );
    });

    it("revokeFeedback() - Revoke feedback", async () => {
      // Get current index for new feedback
      const repMeta = await program.account.agentReputationMetadata.fetch(agentReputationPda);
      const revokeFeedbackIndex = repMeta.nextFeedbackIndex;
      const [feedbackPda] = getFeedbackPda(agent1Id, revokeFeedbackIndex, program.programId);

      // First create the feedback
      await program.methods
        .giveFeedback(
          agent1Id,
          70,
          "test",
          "revoke",
          "https://agent.example.com/api",
          "https://example.com/feedback/revoke",
          Array.from(randomHash()),
          revokeFeedbackIndex
        )
        .accountsPartial({
          client: thirdParty.publicKey,
          payer: provider.wallet.publicKey,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
          feedbackAccount: feedbackPda,
          agentReputation: agentReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([thirdParty])
        .rpc();

      await measureCost(
        provider,
        "revokeFeedback",
        async () => {
          return program.methods
            .revokeFeedback(agent1Id, revokeFeedbackIndex)
            .accountsPartial({
              client: thirdParty.publicKey,
              feedbackAccount: feedbackPda,
              agentReputation: agentReputationPda,
            })
            .signers([thirdParty])
            .rpc();
        },
        undefined,
        "No rent change"
      );
    });
  });

  // ============================================================================
  // VALIDATION MODULE
  // ============================================================================
  describe("Validation Module Costs", () => {
    let validationNonce: number;

    before(() => {
      validationNonce = uniqueNonce();
    });

    it("requestValidation() - Create validation request", async () => {
      const validator = thirdParty.publicKey;
      const [validationRequestPda] = getValidationRequestPda(
        agent1Id,
        validator,
        validationNonce,
        program.programId
      );

      await measureCost(
        provider,
        "requestValidation",
        async () => {
          return program.methods
            .requestValidation(
              agent1Id,
              validator,
              validationNonce,
              "https://example.com/validation/request",
              Array.from(randomHash())
            )
            .accountsPartial({
              validationStats: validationStatsPda,
              requester: provider.wallet.publicKey,
              payer: provider.wallet.publicKey,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
              validationRequest: validationRequestPda,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        },
        134, // ValidationRequest size
        "Creates request PDA"
      );
    });

    it("respondToValidation() - Validator responds", async () => {
      const validator = thirdParty.publicKey;
      const [validationRequestPda] = getValidationRequestPda(
        agent1Id,
        validator,
        validationNonce,
        program.programId
      );

      await measureCost(
        provider,
        "respondToValidation",
        async () => {
          return program.methods
            .respondToValidation(
              95, // response score
              "https://example.com/validation/response",
              Array.from(randomHash()),
              "approved"
            )
            .accountsPartial({
              validator: thirdParty.publicKey,
              validationStats: validationStatsPda,
              validationRequest: validationRequestPda,
              asset: agent1Asset.publicKey,
              agentAccount: agent1Pda,
            })
            .signers([thirdParty])
            .rpc();
        },
        undefined,
        "Updates existing"
      );
    });

    it("closeValidation() - Close validation request", async () => {
      // Create new validation to close
      const closeNonce = uniqueNonce();
      const validator = thirdParty.publicKey;
      const [validationRequestPda] = getValidationRequestPda(
        agent1Id,
        validator,
        closeNonce,
        program.programId
      );

      // Create
      await program.methods
        .requestValidation(
          agent1Id,
          validator,
          closeNonce,
          "https://example.com/validation/close",
          Array.from(randomHash())
        )
        .accountsPartial({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Respond first
      await program.methods
        .respondToValidation(
          80,
          "https://example.com/validation/response",
          Array.from(randomHash()),
          "done"
        )
        .accountsPartial({
          validator: thirdParty.publicKey,
          validationStats: validationStatsPda,
          validationRequest: validationRequestPda,
          asset: agent1Asset.publicKey,
          agentAccount: agent1Pda,
        })
        .signers([thirdParty])
        .rpc();

      await measureCost(
        provider,
        "closeValidation",
        async () => {
          return program.methods
            .closeValidation()
            .accountsPartial({
              validator: thirdParty.publicKey,
              validationRequest: validationRequestPda,
            })
            .signers([thirdParty])
            .rpc();
        },
        undefined,
        "Returns rent"
      );
    });
  });

  // ============================================================================
  // ANTI-GAMING TESTS
  // ============================================================================
  describe("Anti-Gaming Protection", () => {
    it("REJECT: Self-feedback (owner giving feedback to own agent)", async () => {
      const feedbackIndex = new anchor.BN(99);
      const [feedbackPda] = getFeedbackPda(agent1Id, feedbackIndex, program.programId);
      const [agentReputationPda] = getAgentReputationPda(agent1Id, program.programId);

      try {
        await program.methods
          .giveFeedback(
            agent1Id,
            100,
            "self",
            "feedback",
            "https://example.com",
            "https://example.com/self",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accountsPartial({
            client: provider.wallet.publicKey, // Owner trying to give feedback
            payer: provider.wallet.publicKey,
            asset: agent1Asset.publicKey,
            agentAccount: agent1Pda,
            feedbackAccount: feedbackPda,
            agentReputation: agentReputationPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have rejected self-feedback");
      } catch (e: any) {
        expect(e.message).to.include("SelfFeedbackNotAllowed");
        console.log("  PASS: Self-feedback correctly rejected");
      }
    });

    it("REJECT: Self-validation (owner validating own agent)", async () => {
      const nonce = uniqueNonce();
      const [validationRequestPda] = getValidationRequestPda(
        agent1Id,
        provider.wallet.publicKey,
        nonce,
        program.programId
      );

      try {
        await program.methods
          .requestValidation(
            agent1Id,
            provider.wallet.publicKey, // Owner as validator
            nonce,
            "https://example.com/self-validation",
            Array.from(randomHash())
          )
          .accountsPartial({
            validationStats: validationStatsPda,
            requester: provider.wallet.publicKey,
            payer: provider.wallet.publicKey,
            asset: agent1Asset.publicKey,
            agentAccount: agent1Pda,
            validationRequest: validationRequestPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have rejected self-validation");
      } catch (e: any) {
        expect(e.message).to.include("SelfValidationNotAllowed");
        console.log("  PASS: Self-validation correctly rejected");
      }
    });
  });
});
