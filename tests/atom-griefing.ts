/**
 * ATOM Engine - Asymmetric Griefing Attack Test
 *
 * Tests the vulnerability where negative feedback has 5x more impact than positive.
 *
 * Attack Vector:
 * - ALPHA_QUALITY_UP = 5 (slow improvement)
 * - ALPHA_QUALITY_DOWN = 25 (fast penalty)
 * - 1 negative feedback = 5 positive feedbacks to undo
 * - Attacker can cheaply suppress competitor agents
 *
 * Current Protections:
 * - Tier Shield: Gold+ agents get alpha_down / 2 (still 2.5:1 ratio)
 * - Newcomer Shield: First 20 feedbacks get capped alpha_down
 * - Volatility Shield: High volatility dampens alpha_down
 * - Entropy Gate: (Actually helps attackers - see entropy-backfire test)
 *
 * Cost: ~0.0002 SOL for 20 negative feedbacks to neutralize 100 positives
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
} from "./utils/helpers";
import { generateClientHash, generateDistinctFingerprintKeypairs } from "./utils/attack-helpers";

// Constants from atom-engine/src/params.rs
const ALPHA_QUALITY_UP = 5;
const ALPHA_QUALITY_DOWN = 25;
const TIER_SHIELD_DAMPENING = 2;
const TIER_GOLD_QUALITY = 5000;

describe("ATOM Asymmetric Griefing", () => {
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
    registryConfigPda = rootConfig.baseRegistry;

    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== Asymmetric Griefing Attack Test ===");
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
      .register(`https://grief-test.local/${name}`)
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
        "grief",
        "test",
        "https://grief-test.local/api",
        `https://grief-test.local/fb/${index}`,
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

  describe("Phase 1: Demonstrate Base Asymmetry", () => {
    let owner: Keypair;
    let agent: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let positiveClients: Keypair[];
    let negativeClients: Keypair[];

    before(async () => {
      owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      agent = await createAgent(owner, "base-asymmetry");

      // Generate clients
      positiveClients = generateDistinctFingerprintKeypairs(50);
      negativeClients = generateDistinctFingerprintKeypairs(10);
      await fundKeypairs(provider, positiveClients, FUND_AMOUNT);
      await fundKeypairs(provider, negativeClients, FUND_AMOUNT);
      allFundedKeypairs.push(...positiveClients, ...negativeClients);
    });

    it("should show 5:1 asymmetry in quality score impact", async () => {
      console.log("\n=== Base Asymmetry Test ===");
      console.log(`ALPHA_QUALITY_UP = ${ALPHA_QUALITY_UP}`);
      console.log(`ALPHA_QUALITY_DOWN = ${ALPHA_QUALITY_DOWN}`);
      console.log(`Expected ratio: ${ALPHA_QUALITY_DOWN / ALPHA_QUALITY_UP}:1`);

      // First, give 10 positive feedbacks to establish baseline
      console.log("\nGiving 10 positive feedbacks (score=100)...");
      for (let i = 0; i < 10; i++) {
        await giveFeedback(positiveClients[i], agent.agent.publicKey, agent.agentPda, agent.statsPda, 100, i);
      }

      const statsAfterPositive = await getStats(agent.statsPda);
      console.log(`Quality after 10 positives: ${statsAfterPositive.qualityScore}`);

      // Give 2 negative feedbacks
      console.log("\nGiving 2 negative feedbacks (score=0)...");
      for (let i = 0; i < 2; i++) {
        await giveFeedback(negativeClients[i], agent.agent.publicKey, agent.agentPda, agent.statsPda, 0, 10 + i);
      }

      const statsAfterNegative = await getStats(agent.statsPda);
      const qualityDrop = statsAfterPositive.qualityScore - statsAfterNegative.qualityScore;
      console.log(`Quality after 2 negatives: ${statsAfterNegative.qualityScore}`);
      console.log(`Quality drop: -${qualityDrop}`);

      // Now give more positives to recover
      console.log("\nGiving positives to recover...");
      let recoveryCount = 0;
      let feedbackIdx = 12;

      while (
        statsAfterNegative.qualityScore < statsAfterPositive.qualityScore &&
        recoveryCount < 20
      ) {
        await giveFeedback(
          positiveClients[10 + recoveryCount],
          agent.agent.publicKey,
          agent.agentPda,
          agent.statsPda,
          100,
          feedbackIdx++
        );
        recoveryCount++;

        const currentStats = await getStats(agent.statsPda);
        console.log(`  After ${recoveryCount} positives: quality=${currentStats.qualityScore}`);

        if (currentStats.qualityScore >= statsAfterPositive.qualityScore) {
          break;
        }
      }

      console.log(`\n=== RESULT ===`);
      console.log(`2 negative feedbacks required ${recoveryCount} positive feedbacks to recover`);
      console.log(`Effective ratio: ${recoveryCount / 2}:1 (expected ~5:1)`);

      // VULNERABILITY: High asymmetry enables cheap griefing
      if (recoveryCount >= 8) {
        console.log("\n[!] VULNERABILITY CONFIRMED: 2 negatives needed 8+ positives to recover");
        console.log("[!] Griefing is 4-5x more effective than positive reputation building");
      }
    });
  });

  describe("Phase 2: Tier Shield Effectiveness", () => {
    let owner: Keypair;
    let goldAgent: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let attackers: Keypair[];

    before(async () => {
      owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      goldAgent = await createAgent(owner, "gold-agent");

      // Build agent to Gold tier with many positive feedbacks
      console.log("\nBuilding agent to Gold tier...");
      const builders = generateDistinctFingerprintKeypairs(50);
      await fundKeypairs(provider, builders, FUND_AMOUNT);
      allFundedKeypairs.push(...builders);

      for (let i = 0; i < 50; i++) {
        await giveFeedback(builders[i], goldAgent.agent.publicKey, goldAgent.agentPda, goldAgent.statsPda, 100, i);
      }

      const stats = await getStats(goldAgent.statsPda);
      console.log(`Built to: quality=${stats.qualityScore}, tier=${stats.trustTier}`);

      // Generate attackers
      attackers = generateDistinctFingerprintKeypairs(20);
      await fundKeypairs(provider, attackers, FUND_AMOUNT);
      allFundedKeypairs.push(...attackers);
    });

    it("should show tier shield reduces but doesn't prevent griefing", async () => {
      console.log("\n=== Tier Shield Test ===");

      const statsBefore = await getStats(goldAgent.statsPda);
      console.log(`Before attack: quality=${statsBefore.qualityScore}, tier=${statsBefore.trustTier}`);

      // Calculate expected shielded alpha
      const shieldedAlphaDown = Math.floor(ALPHA_QUALITY_DOWN / TIER_SHIELD_DAMPENING);
      console.log(`Expected shielded alpha_down: ${shieldedAlphaDown} (base ${ALPHA_QUALITY_DOWN} / ${TIER_SHIELD_DAMPENING})`);

      // Attack with 20 negative feedbacks
      console.log("\nAttacking with 20 negative feedbacks...");
      const qualityHistory: number[] = [statsBefore.qualityScore];

      for (let i = 0; i < 20; i++) {
        await giveFeedback(attackers[i], goldAgent.agent.publicKey, goldAgent.agentPda, goldAgent.statsPda, 0, 50 + i);

        const stats = await getStats(goldAgent.statsPda);
        qualityHistory.push(stats.qualityScore);

        if ((i + 1) % 5 === 0) {
          console.log(`  After ${i + 1} attacks: quality=${stats.qualityScore}, tier=${stats.trustTier}`);
        }
      }

      const statsAfter = await getStats(goldAgent.statsPda);
      const totalDrop = statsBefore.qualityScore - statsAfter.qualityScore;

      console.log(`\n=== RESULT ===`);
      console.log(`Quality: ${statsBefore.qualityScore} -> ${statsAfter.qualityScore} (drop: -${totalDrop})`);
      console.log(`Tier: ${statsBefore.trustTier} -> ${statsAfter.trustTier}`);

      // Calculate effective ratio with tier shield
      // With shield: alpha_down = 12.5 vs alpha_up = 5, ratio = 2.5:1
      console.log(`\nWith Tier Shield (TIER_SHIELD_DAMPENING = ${TIER_SHIELD_DAMPENING}):`);
      console.log(`  Effective alpha_down = ${shieldedAlphaDown}`);
      console.log(`  Effective ratio = ${shieldedAlphaDown / ALPHA_QUALITY_UP}:1`);

      if (statsAfter.trustTier < statsBefore.trustTier) {
        console.log("\n[!] Agent was demoted from Gold tier!");
        console.log("[!] Tier shield reduces impact but doesn't prevent tier demotion");
      }

      // Calculate cost of attack
      const txCost = 0.00001; // SOL per tx
      const attackCost = 20 * txCost;
      console.log(`\n=== Attack Cost Analysis ===`);
      console.log(`Total attack cost: ${attackCost} SOL (~$${(attackCost * 150).toFixed(4)} at $150/SOL)`);
      console.log(`Quality destroyed: ${totalDrop} points`);
      console.log(`Cost per quality point: ${(attackCost / totalDrop * 10000).toFixed(6)} SOL`);
    });
  });

  describe("Phase 3: Competitor Suppression Scenario", () => {
    let ownerA: Keypair;
    let ownerB: Keypair;
    let agentA: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };
    let agentB: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey };

    before(async () => {
      ownerA = Keypair.generate();
      ownerB = Keypair.generate();
      await fundKeypairs(provider, [ownerA, ownerB], FUND_AMOUNT);
      allFundedKeypairs.push(ownerA, ownerB);

      agentA = await createAgent(ownerA, "competitor-a");
      agentB = await createAgent(ownerB, "competitor-b");

      // Both agents get the same organic growth
      console.log("\nBuilding both agents with equal organic growth...");
      const clients = generateDistinctFingerprintKeypairs(80);
      await fundKeypairs(provider, clients, FUND_AMOUNT);
      allFundedKeypairs.push(...clients);

      for (let i = 0; i < 40; i++) {
        await giveFeedback(clients[i], agentA.agent.publicKey, agentA.agentPda, agentA.statsPda, 100, i);
        await giveFeedback(clients[40 + i], agentB.agent.publicKey, agentB.agentPda, agentB.statsPda, 100, i);
      }

      const statsA = await getStats(agentA.statsPda);
      const statsB = await getStats(agentB.statsPda);
      console.log(`Agent A: quality=${statsA.qualityScore}, tier=${statsA.trustTier}`);
      console.log(`Agent B: quality=${statsB.qualityScore}, tier=${statsB.trustTier}`);
    });

    it("should demonstrate competitor suppression economics", async () => {
      console.log("\n=== Competitor Suppression Scenario ===");
      console.log("Agent A (attacker) wants to suppress Agent B (competitor)");

      const statsBBefore = await getStats(agentB.statsPda);
      console.log(`\nAgent B before: quality=${statsBBefore.qualityScore}, tier=${statsBBefore.trustTier}`);

      // Agent A generates Sybil wallets to attack Agent B
      console.log("\nAgent A generates 15 Sybil wallets and attacks Agent B...");
      const sybils = generateDistinctFingerprintKeypairs(15);
      await fundKeypairs(provider, sybils, FUND_AMOUNT);
      allFundedKeypairs.push(...sybils);

      let attackCost = 0;
      for (let i = 0; i < 15; i++) {
        await giveFeedback(sybils[i], agentB.agent.publicKey, agentB.agentPda, agentB.statsPda, 0, 40 + i);
        attackCost += 0.00001; // tx fee
      }

      const statsBAfter = await getStats(agentB.statsPda);
      console.log(`Agent B after: quality=${statsBAfter.qualityScore}, tier=${statsBAfter.trustTier}`);

      const qualityDrop = statsBBefore.qualityScore - statsBAfter.qualityScore;
      const tierDrop = statsBBefore.trustTier - statsBAfter.trustTier;

      console.log(`\n=== Attack Impact ===`);
      console.log(`Quality drop: -${qualityDrop}`);
      console.log(`Tier drop: -${tierDrop}`);
      console.log(`Attack cost: ${attackCost.toFixed(5)} SOL`);

      // Calculate recovery cost for Agent B
      const recoveryFeedbacksNeeded = Math.ceil(qualityDrop / (ALPHA_QUALITY_UP * 100 / 100));
      const recoveryCost = recoveryFeedbacksNeeded * 0.00001;

      console.log(`\n=== Recovery Cost for Agent B ===`);
      console.log(`Positive feedbacks needed: ~${recoveryFeedbacksNeeded}`);
      console.log(`Recovery cost: ~${recoveryCost.toFixed(5)} SOL`);
      console.log(`Recovery/Attack ratio: ${(recoveryCost / attackCost).toFixed(1)}x`);

      console.log(`\n[!] VULNERABILITY: Attacker can suppress competitor at ${(recoveryCost / attackCost).toFixed(1)}x lower cost`);
      console.log("[!] This creates perverse incentives to attack rather than compete");
    });
  });

  describe("Phase 4: Proposed Mitigations", () => {
    it("should document proposed fixes", () => {
      console.log("\n=== Proposed Mitigations ===");

      console.log("\n1. Increase TIER_SHIELD_DAMPENING for Gold+ tiers");
      console.log("   Current: 2 (effective ratio 2.5:1)");
      console.log("   Proposed: 3-4 (effective ratio 1.7:1 to 1.25:1)");

      console.log("\n2. Add rate limiting per client");
      console.log("   Max 1 feedback per agent per epoch (~2.5 days)");
      console.log("   Prevents rapid-fire griefing attacks");

      console.log("\n3. Require small stake for negative feedback");
      console.log("   0.001 SOL stake, refunded if not disputed");
      console.log("   Makes griefing 100x more expensive");

      console.log("\n4. Increase alpha_up for high-diversity agents");
      console.log("   If diversity_ratio > 128: alpha_up * 1.5");
      console.log("   Rewards organic growth, disadvantages Sybils");

      console.log("\n5. Cross-agent reputation tracking");
      console.log("   Track clients who give many negative feedbacks");
      console.log("   Apply dampening to known griefers");
    });
  });
});
