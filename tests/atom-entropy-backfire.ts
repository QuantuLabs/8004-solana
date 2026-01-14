/**
 * ATOM Engine - Entropy Gate Backfire Test
 *
 * Tests the vulnerability where the Entropy Gate protection actually HELPS attackers.
 *
 * The Bug:
 * - Entropy Gate was designed to dampen alpha_down when HLL stagnates
 * - When same client attacks repeatedly, HLL doesn't change
 * - updates_since_hll_change grows
 * - entropy_dampener = (1 + updates_since_hll_change / 3).min(4)
 * - alpha_down gets DIVIDED by entropy_dampener (up to 4x reduction!)
 *
 * Result: Repeat attackers have LESS impact, not more!
 *
 * Expected behavior: Repeat attackers should have MORE impact (amplified penalty)
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomStatsPda,
  getAtomConfigPda,
  getRegistryAuthorityPda,
  fundKeypair,
  fundKeypairs,
  returnFunds,
  sleep,
} from "./utils/helpers";
import { generateClientHash, generateDistinctFingerprintKeypairs } from "./utils/attack-helpers";

// Constants from atom-engine/src/params.rs
const ENTROPY_GATE_DIVISOR = 3;
const ENTROPY_GATE_MAX_DAMPENING = 4;
const ALPHA_QUALITY_DOWN = 25;

describe("ATOM Entropy Gate Backfire", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  const allFundedKeypairs: Keypair[] = [];
  const FUND_AMOUNT = 0.05 * LAMPORTS_PER_SOL;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    if (!rootAccountInfo) {
      throw new Error("Root config not initialized. Run init-localnet.ts first");
    }

    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo.data);
    registryConfigPda = rootConfig.currentBaseRegistry;

    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== Entropy Gate Backfire Test ===");
    console.log("Collection:", collectionPubkey.toBase58());
  });

  after(async () => {
    if (allFundedKeypairs.length > 0) {
      console.log(`\nReturning funds from ${allFundedKeypairs.length} test wallets...`);
      const returned = await returnFunds(provider, allFundedKeypairs);
      console.log(`Returned ${(returned / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  });

  // Helper to create and register an agent
  async function createAgent(owner: Keypair, name: string): Promise<{ agent: Keypair; agentPda: PublicKey; statsPda: PublicKey }> {
    const agent = Keypair.generate();
    const [agentPda] = getAgentPda(agent.publicKey, program.programId);
    const [statsPda] = getAtomStatsPda(agent.publicKey);

    await program.methods
      .register(`https://entropy-test.local/${name}`)
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agent.publicKey,
        collection: collectionPubkey,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agent, owner])
      .rpc();

    await atomProgram.methods
      .initializeStats()
      .accounts({
        owner: owner.publicKey,
        asset: agent.publicKey,
        collection: collectionPubkey,
        config: atomConfigPda,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return { agent, agentPda, statsPda };
  }

  // Helper to give feedback
  async function giveFeedback(
    client: Keypair,
    asset: PublicKey,
    agentPda: PublicKey,
    statsPda: PublicKey,
    score: number,
    index: number
  ): Promise<void> {
    const clientHash = generateClientHash(client);

    await program.methods
      .giveFeedback(
        score,
        "entropy",
        "test",
        "https://entropy-test.local/api",
        `https://entropy-test.local/fb/${index}`,
        Array.from(clientHash),
        new anchor.BN(index)
      )
      .accounts({
        client: client.publicKey,
        asset: asset,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: statsPda,
        atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();
  }

  // Helper to get stats
  async function getStats(statsPda: PublicKey): Promise<any> {
    return await atomProgram.account.atomStats.fetch(statsPda);
  }

  describe("Phase 1: Demonstrate Entropy Gate Backfire", () => {
    let owner: Keypair;
    let agentA: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let agentB: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let uniqueAttackers: Keypair[];
    let singleAttacker: Keypair;

    before(async () => {
      // Create owner
      owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT * 2);
      allFundedKeypairs.push(owner);

      // Create two identical agents for comparison
      agentA = await createAgent(owner, "agent-unique-attackers");
      agentB = await createAgent(owner, "agent-single-attacker");

      // Generate 20 unique attackers for agent A
      console.log("Generating 20 unique attacker wallets...");
      uniqueAttackers = generateDistinctFingerprintKeypairs(20);
      await fundKeypairs(provider, uniqueAttackers, FUND_AMOUNT);
      allFundedKeypairs.push(...uniqueAttackers);

      // Single attacker for agent B
      singleAttacker = Keypair.generate();
      await fundKeypair(provider, singleAttacker, FUND_AMOUNT);
      allFundedKeypairs.push(singleAttacker);

      // First, build both agents to Gold tier with 30 positive feedbacks each
      console.log("\nBuilding agents to Gold tier...");
      const positiveClients = generateDistinctFingerprintKeypairs(60);
      await fundKeypairs(provider, positiveClients, FUND_AMOUNT);
      allFundedKeypairs.push(...positiveClients);

      for (let i = 0; i < 30; i++) {
        await giveFeedback(positiveClients[i], agentA.agent.publicKey, agentA.agentPda, agentA.statsPda, 100, i);
        await giveFeedback(positiveClients[30 + i], agentB.agent.publicKey, agentB.agentPda, agentB.statsPda, 100, i);
      }

      const statsA = await getStats(agentA.statsPda);
      const statsB = await getStats(agentB.statsPda);
      console.log(`Agent A: quality=${statsA.qualityScore}, tier=${statsA.trustTier}`);
      console.log(`Agent B: quality=${statsB.qualityScore}, tier=${statsB.trustTier}`);
    });

    it("should show unique attackers have HIGHER impact than repeat attacker", async () => {
      console.log("\n=== Comparing Attack Impact ===");

      const statsABefore = await getStats(agentA.statsPda);
      const statsBBefore = await getStats(agentB.statsPda);

      console.log(`\nBefore attacks:`);
      console.log(`  Agent A: quality=${statsABefore.qualityScore}, hll_stagnation=${statsABefore.updatesSinceHllChange}`);
      console.log(`  Agent B: quality=${statsBBefore.qualityScore}, hll_stagnation=${statsBBefore.updatesSinceHllChange}`);

      // Attack Agent A with 20 UNIQUE attackers (each gives score=0)
      console.log("\nAttacking Agent A with 20 UNIQUE wallets (score=0)...");
      const qualityDropsA: number[] = [];
      let prevQualityA = statsABefore.qualityScore;

      for (let i = 0; i < 20; i++) {
        await giveFeedback(
          uniqueAttackers[i],
          agentA.agent.publicKey,
          agentA.agentPda,
          agentA.statsPda,
          0,
          30 + i
        );

        const stats = await getStats(agentA.statsPda);
        const drop = prevQualityA - stats.qualityScore;
        qualityDropsA.push(drop);
        console.log(`  Attack ${i+1}: quality=${stats.qualityScore} (drop: -${drop}), hll_stagnation=${stats.updatesSinceHllChange}`);
        prevQualityA = stats.qualityScore;
      }

      // Attack Agent B with SAME wallet 20 times (each gives score=0)
      console.log("\nAttacking Agent B with SAME wallet 20 times (score=0)...");
      const qualityDropsB: number[] = [];
      let prevQualityB = statsBBefore.qualityScore;

      for (let i = 0; i < 20; i++) {
        await giveFeedback(
          singleAttacker,
          agentB.agent.publicKey,
          agentB.agentPda,
          agentB.statsPda,
          0,
          30 + i
        );

        const stats = await getStats(agentB.statsPda);
        const drop = prevQualityB - stats.qualityScore;
        qualityDropsB.push(drop);
        console.log(`  Attack ${i+1}: quality=${stats.qualityScore} (drop: -${drop}), hll_stagnation=${stats.updatesSinceHllChange}`);
        prevQualityB = stats.qualityScore;
      }

      const statsAAfter = await getStats(agentA.statsPda);
      const statsBAfter = await getStats(agentB.statsPda);

      const totalDropA = statsABefore.qualityScore - statsAAfter.qualityScore;
      const totalDropB = statsBBefore.qualityScore - statsBAfter.qualityScore;

      console.log("\n=== RESULTS ===");
      console.log(`Agent A (20 unique attackers): ${statsABefore.qualityScore} -> ${statsAAfter.qualityScore} (total drop: -${totalDropA})`);
      console.log(`Agent B (1 repeat attacker): ${statsBBefore.qualityScore} -> ${statsBAfter.qualityScore} (total drop: -${totalDropB})`);

      // Calculate theoretical entropy gate dampening
      console.log("\n=== Entropy Gate Analysis ===");
      console.log("For repeat attacker (Agent B):");
      console.log("  - updates_since_hll_change grows each time (no new HLL registers)");
      console.log("  - entropy_dampener = min(1 + stagnation/3, 4)");
      console.log("  - alpha_down gets DIVIDED by entropy_dampener");

      for (let i = 0; i < 20; i++) {
        const stagnation = i + 1; // Approximate
        const dampener = Math.min(1 + Math.floor(stagnation / ENTROPY_GATE_DIVISOR), ENTROPY_GATE_MAX_DAMPENING);
        const effectiveAlpha = Math.floor(ALPHA_QUALITY_DOWN / dampener);
        console.log(`  Attack ${i+1}: stagnation=${stagnation}, dampener=${dampener}, effective_alpha=${effectiveAlpha}/${ALPHA_QUALITY_DOWN}`);
      }

      // VULNERABILITY: Repeat attacker has LESS total impact
      if (totalDropB < totalDropA) {
        console.log("\n[!] VULNERABILITY CONFIRMED!");
        console.log(`[!] Repeat attacker caused LESS damage (${totalDropB}) than unique attackers (${totalDropA})`);
        console.log("[!] Entropy Gate is HELPING attackers, not stopping them!");
        console.log("[!] This is backwards - repeat attackers should be PENALIZED more");
      } else {
        console.log("\n[+] No vulnerability - unique attackers have more impact (as expected)");
      }

      // Even if total is similar, check per-attack dampening
      const avgDropA = qualityDropsA.reduce((a, b) => a + b, 0) / qualityDropsA.length;
      const avgDropB = qualityDropsB.reduce((a, b) => a + b, 0) / qualityDropsB.length;
      const lastDropA = qualityDropsA[19];
      const lastDropB = qualityDropsB[19];

      console.log("\n=== Per-Attack Analysis ===");
      console.log(`Average drop per attack: A=${avgDropA.toFixed(1)}, B=${avgDropB.toFixed(1)}`);
      console.log(`Last attack drop: A=${lastDropA}, B=${lastDropB}`);

      if (lastDropB < lastDropA) {
        console.log("\n[!] By attack #20, repeat attacker has REDUCED impact!");
        console.log("[!] Entropy Gate is dampening alpha_down for repeat attacks");
      }
    });

    it("should show stagnation counter behavior", async () => {
      console.log("\n=== Stagnation Counter Analysis ===");

      // Create a fresh agent
      const freshAgent = await createAgent(owner, "agent-stagnation-test");

      // Submit feedbacks from same wallet and track stagnation
      const stagnationTracker = Keypair.generate();
      await fundKeypair(provider, stagnationTracker, FUND_AMOUNT);
      allFundedKeypairs.push(stagnationTracker);

      console.log("Tracking updates_since_hll_change with same wallet:");

      for (let i = 0; i < 15; i++) {
        await giveFeedback(
          stagnationTracker,
          freshAgent.agent.publicKey,
          freshAgent.agentPda,
          freshAgent.statsPda,
          50,
          i
        );

        const stats = await getStats(freshAgent.statsPda);
        const expectedDampener = Math.min(1 + Math.floor(stats.updatesSinceHllChange / ENTROPY_GATE_DIVISOR), ENTROPY_GATE_MAX_DAMPENING);

        console.log(`  Feedback ${i+1}: stagnation=${stats.updatesSinceHllChange}, dampener=${expectedDampener}x`);
      }

      console.log("\n[!] Stagnation counter grows with repeat wallet");
      console.log("[!] This increases entropy_dampener");
      console.log("[!] Which REDUCES alpha_down (helping attackers)");
    });
  });

  describe("Phase 2: Proposed Fix Verification", () => {
    it("should document the fix", () => {
      console.log("\n=== Proposed Fix ===");
      console.log("\nCurrent (WRONG):");
      console.log("  let entropy_dampener = (1 + updates_since_hll_change / 3).min(4);");
      console.log("  let alpha_with_entropy = alpha_with_volatility / entropy_dampener;");
      console.log("  // Repeat attackers get REDUCED penalty!");

      console.log("\nProposed (CORRECT):");
      console.log("  let entropy_amplifier = (1 + updates_since_hll_change / 3).min(3);");
      console.log("  let alpha_with_entropy = (alpha_with_volatility * entropy_amplifier).min(100);");
      console.log("  // Repeat attackers get AMPLIFIED penalty!");

      console.log("\nEffect:");
      console.log("  - First attack from new wallet: normal alpha_down (25)");
      console.log("  - After 3 repeats: alpha_down * 2 = 50");
      console.log("  - After 6 repeats: alpha_down * 3 = 75 (capped)");
      console.log("  - This makes repeat attacks MORE costly, discouraging griefing");
    });
  });
});
