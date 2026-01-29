/**
 * ATOM Engine Massive Scale Tests
 * Tests with 1000s of feedbacks, 100s of agents, and edge case scenarios
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomStatsPda,
  getAtomConfigPda,
  fundKeypair,
  fundKeypairs,
  returnFunds,
} from "./utils/helpers";
import { generateClientHash } from "./utils/attack-helpers";

describe("ATOM Massive Scale Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;

  const allFundedKeypairs: Keypair[] = [];
  const FUND_AMOUNT = 0.05 * LAMPORTS_PER_SOL;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);
    registryConfigPda = rootConfig.baseRegistry;

    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log("=== ATOM Massive Scale Tests ===");
    console.log("Provider:", provider.wallet.publicKey.toBase58());
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
  async function createAgent(owner: Keypair): Promise<{ agent: Keypair; agentPda: PublicKey; statsPda: PublicKey }> {
    const agent = Keypair.generate();
    const [agentPda] = getAgentPda(agent.publicKey, program.programId);
    const [statsPda] = getAtomStatsPda(agent.publicKey);

    await program.methods
      .register(`https://scale.test/agent/${agent.publicKey.toBase58().slice(0, 8)}`)
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
    agentAsset: PublicKey,
    agentPda: PublicKey,
    statsPda: PublicKey,
    score: number,
    index: number
  ): Promise<void> {
    await program.methods
      .giveFeedback(
        score,
        "scale",
        "test",
        "https://scale.test/api",
        `https://scale.test/fb/${index}`,
        Array.from(generateClientHash(client)),
        new anchor.BN(index)
      )
      .accounts({
        client: client.publicKey,
        asset: agentAsset,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: statsPda,
        atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();
  }

  // ============================================================================
  // 1. SINGLE AGENT MASSIVE FEEDBACKS
  // ============================================================================
  describe("Single Agent - 500 Feedbacks", () => {
    it("tracks reputation accurately over 500 feedbacks from unique clients", async () => {
      console.log("\n=== Test: 500 Feedbacks from Unique Clients ===");
      const startTime = Date.now();

      // Create owner and agent
      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);
      console.log("Agent created:", agent.publicKey.toBase58());

      // Create 500 unique clients
      const NUM_FEEDBACKS = 500;
      const BATCH_SIZE = 50;
      const clients: Keypair[] = [];

      for (let batch = 0; batch < NUM_FEEDBACKS / BATCH_SIZE; batch++) {
        const batchClients = Array.from({ length: BATCH_SIZE }, () => Keypair.generate());
        clients.push(...batchClients);
        allFundedKeypairs.push(...batchClients);
        await fundKeypairs(provider, batchClients, FUND_AMOUNT / 10);

        // Give feedbacks in this batch
        for (let i = 0; i < BATCH_SIZE; i++) {
          const idx = batch * BATCH_SIZE + i;
          const score = 70 + Math.floor(Math.random() * 30); // 70-99 range
          await giveFeedback(batchClients[i], agent.publicKey, agentPda, statsPda, score, idx);
        }

        // Progress update
        const stats = await atomProgram.account.atomStats.fetch(statsPda);
        console.log(`Batch ${batch + 1}: feedbacks=${stats.feedbackCount}, tier=${stats.trustTier}, quality=${stats.qualityScore}, diversity=${stats.diversityRatio}`);
      }

      const finalStats = await atomProgram.account.atomStats.fetch(statsPda);
      const elapsed = (Date.now() - startTime) / 1000;

      console.log("\n=== 500 Feedbacks Results ===");
      console.log(`Time elapsed: ${elapsed.toFixed(1)}s`);
      console.log(`Feedback count: ${finalStats.feedbackCount}`);
      console.log(`Trust tier: ${finalStats.trustTier}`);
      console.log(`Quality score: ${finalStats.qualityScore}`);
      console.log(`Risk score: ${finalStats.riskScore}`);
      console.log(`Confidence: ${finalStats.confidence}`);
      console.log(`Diversity ratio: ${finalStats.diversityRatio}`);
      console.log(`EMA fast: ${finalStats.emaScoreFast}`);
      console.log(`EMA slow: ${finalStats.emaScoreSlow}`);

      // Assertions
      expect(finalStats.feedbackCount.toNumber()).to.equal(NUM_FEEDBACKS);
      expect(finalStats.trustTier).to.be.greaterThanOrEqual(2); // Should reach Silver+
      expect(finalStats.diversityRatio).to.be.greaterThan(200); // High diversity
      expect(finalStats.confidence).to.be.greaterThan(5000);
    });
  });

  // ============================================================================
  // 2. MANY AGENTS SCALE TEST
  // ============================================================================
  describe("Scale - 100 Agents", () => {
    it("creates 100 agents with varying reputations", async () => {
      console.log("\n=== Test: 100 Agents Scale ===");
      const startTime = Date.now();

      const NUM_AGENTS = 100;
      const FEEDBACKS_PER_AGENT = 10;

      // Create shared pool of clients
      const clients: Keypair[] = [];
      for (let i = 0; i < 50; i++) {
        const client = Keypair.generate();
        clients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, clients, FUND_AMOUNT);

      const agents: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey; owner: Keypair }[] = [];

      // Create agents in batches
      console.log("Creating agents...");
      for (let i = 0; i < NUM_AGENTS; i++) {
        const owner = Keypair.generate();
        await fundKeypair(provider, owner, FUND_AMOUNT); // Full amount for rent + fees
        allFundedKeypairs.push(owner);

        const agentData = await createAgent(owner);
        agents.push({ ...agentData, owner });

        if ((i + 1) % 20 === 0) {
          console.log(`Created ${i + 1} agents`);
        }
      }

      // Give feedbacks to all agents
      console.log("\nGiving feedbacks...");
      for (let i = 0; i < NUM_AGENTS; i++) {
        const { agent, agentPda, statsPda } = agents[i];

        // Vary the scores based on agent index to create different tiers
        const baseScore = 40 + Math.floor((i / NUM_AGENTS) * 60); // 40-100 range

        for (let j = 0; j < FEEDBACKS_PER_AGENT; j++) {
          const client = clients[(i * FEEDBACKS_PER_AGENT + j) % clients.length];
          const score = Math.min(100, baseScore + Math.floor(Math.random() * 10));
          await giveFeedback(client, agent.publicKey, agentPda, statsPda, score, j);
        }

        if ((i + 1) % 20 === 0) {
          console.log(`Feedbacks given to ${i + 1} agents`);
        }
      }

      // Analyze tier distribution
      const tierCounts = [0, 0, 0, 0, 0]; // Unrated, Bronze, Silver, Gold, Platinum
      let totalQuality = 0;
      let totalRisk = 0;

      for (const { statsPda } of agents) {
        const stats = await atomProgram.account.atomStats.fetch(statsPda);
        tierCounts[stats.trustTier]++;
        totalQuality += stats.qualityScore;
        totalRisk += stats.riskScore;
      }

      const elapsed = (Date.now() - startTime) / 1000;

      console.log("\n=== 100 Agents Results ===");
      console.log(`Time elapsed: ${elapsed.toFixed(1)}s`);
      console.log(`Tier distribution:`);
      console.log(`  Unrated: ${tierCounts[0]}`);
      console.log(`  Bronze: ${tierCounts[1]}`);
      console.log(`  Silver: ${tierCounts[2]}`);
      console.log(`  Gold: ${tierCounts[3]}`);
      console.log(`  Platinum: ${tierCounts[4]}`);
      console.log(`Avg quality: ${(totalQuality / NUM_AGENTS).toFixed(0)}`);
      console.log(`Avg risk: ${(totalRisk / NUM_AGENTS).toFixed(0)}`);

      // Expect some distribution across tiers
      expect(tierCounts[0] + tierCounts[1]).to.be.greaterThan(0); // Some low-tier
    });
  });

  // ============================================================================
  // 3. SLOW SYBIL ATTACK (DRIP ATTACK)
  // ============================================================================
  describe("Slow Sybil - Drip Attack", () => {
    it("detects slow-rate Sybil from many wallets", async () => {
      console.log("\n=== Test: Slow Sybil Drip Attack ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);
      console.log("Agent:", agent.publicKey.toBase58());

      // Create 30 Sybil wallets (controlled by attacker)
      const sybilWallets: Keypair[] = [];
      for (let i = 0; i < 30; i++) {
        const wallet = Keypair.generate();
        sybilWallets.push(wallet);
        allFundedKeypairs.push(wallet);
      }
      await fundKeypairs(provider, sybilWallets, FUND_AMOUNT / 10);

      // Drip attack: 1 feedback per wallet, perfect scores
      console.log("Executing drip attack (30 wallets, 1 feedback each)...");
      for (let i = 0; i < sybilWallets.length; i++) {
        await giveFeedback(sybilWallets[i], agent.publicKey, agentPda, statsPda, 100, i);

        if ((i + 1) % 10 === 0) {
          const stats = await atomProgram.account.atomStats.fetch(statsPda);
          console.log(`After ${i + 1} feedbacks: tier=${stats.trustTier}, quality=${stats.qualityScore}, confidence=${stats.confidence}`);
        }
      }

      const finalStats = await atomProgram.account.atomStats.fetch(statsPda);

      console.log("\n=== Drip Attack Results ===");
      console.log(`Feedback count: ${finalStats.feedbackCount}`);
      console.log(`Trust tier: ${finalStats.trustTier}`);
      console.log(`Quality score: ${finalStats.qualityScore}`);
      console.log(`Risk score: ${finalStats.riskScore}`);
      console.log(`Confidence: ${finalStats.confidence}`);
      console.log(`Diversity ratio: ${finalStats.diversityRatio}`);

      // With 30 unique wallets and perfect scores, agent should progress
      // but risk detection from burst patterns should limit tier
      if (finalStats.trustTier >= 3) {
        console.log("\nWARNING: Drip attack reached Gold tier - may need rate limiting");
      } else {
        console.log("\nPROTECTION: Drip attack limited to tier " + finalStats.trustTier);
      }
    });
  });

  // ============================================================================
  // 4. REPUTATION NUKING (GRIEFING)
  // ============================================================================
  describe("Reputation Nuking - Griefing Attack", () => {
    it("measures how quickly a good agent can be nuked", async () => {
      console.log("\n=== Test: Reputation Nuking Attack ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Phase 1: Build up good reputation with 50 feedbacks
      console.log("Phase 1: Building legitimate reputation...");
      const goodClients: Keypair[] = [];
      for (let i = 0; i < 50; i++) {
        const client = Keypair.generate();
        goodClients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, goodClients, FUND_AMOUNT / 20);

      for (let i = 0; i < 50; i++) {
        await giveFeedback(goodClients[i], agent.publicKey, agentPda, statsPda, 90, i);
      }

      let stats = await atomProgram.account.atomStats.fetch(statsPda);
      console.log(`After 50 good feedbacks: tier=${stats.trustTier}, quality=${stats.qualityScore}`);
      const preTier = stats.trustTier;
      const preQuality = stats.qualityScore;

      // Phase 2: Griefing attack - 10 wallets send score 0
      console.log("\nPhase 2: Griefing attack (10 wallets, score 0)...");
      const griefWallets: Keypair[] = [];
      for (let i = 0; i < 10; i++) {
        const wallet = Keypair.generate();
        griefWallets.push(wallet);
        allFundedKeypairs.push(wallet);
      }
      await fundKeypairs(provider, griefWallets, FUND_AMOUNT / 20);

      for (let i = 0; i < griefWallets.length; i++) {
        await giveFeedback(griefWallets[i], agent.publicKey, agentPda, statsPda, 0, 50 + i);

        stats = await atomProgram.account.atomStats.fetch(statsPda);
        console.log(`After grief ${i + 1}: tier=${stats.trustTier}, quality=${stats.qualityScore}`);
      }

      const finalStats = await atomProgram.account.atomStats.fetch(statsPda);

      console.log("\n=== Griefing Results ===");
      console.log(`Pre-attack: tier=${preTier}, quality=${preQuality}`);
      console.log(`Post-attack: tier=${finalStats.trustTier}, quality=${finalStats.qualityScore}`);
      console.log(`Quality drop: ${preQuality - finalStats.qualityScore} (${((preQuality - finalStats.qualityScore) / preQuality * 100).toFixed(1)}%)`);
      console.log(`Tier drop: ${preTier} → ${finalStats.trustTier}`);

      if (finalStats.trustTier === 0 && preTier >= 2) {
        console.log("\nVULNERABILITY: Agent completely nuked from " + preTier + " to 0 with just 10 bad feedbacks");
      } else {
        console.log("\nRESILIENCE: Agent maintained some reputation after griefing");
      }
    });
  });

  // ============================================================================
  // 5. MIXED SCORE VOLATILITY
  // ============================================================================
  describe("Mixed Score Volatility", () => {
    it("handles highly volatile score patterns", async () => {
      console.log("\n=== Test: Volatile Score Patterns ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Create clients
      const clients: Keypair[] = [];
      for (let i = 0; i < 40; i++) {
        const client = Keypair.generate();
        clients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, clients, FUND_AMOUNT / 20);

      // Pattern: alternating high/low scores
      console.log("Sending alternating 100/0 scores...");
      for (let i = 0; i < 40; i++) {
        const score = i % 2 === 0 ? 100 : 0;
        await giveFeedback(clients[i], agent.publicKey, agentPda, statsPda, score, i);

        if ((i + 1) % 10 === 0) {
          const stats = await atomProgram.account.atomStats.fetch(statsPda);
          console.log(`After ${i + 1}: tier=${stats.trustTier}, quality=${stats.qualityScore}, volatility=${stats.emaVolatility}`);
        }
      }

      const finalStats = await atomProgram.account.atomStats.fetch(statsPda);

      console.log("\n=== Volatility Results ===");
      console.log(`Feedback count: ${finalStats.feedbackCount}`);
      console.log(`Trust tier: ${finalStats.trustTier}`);
      console.log(`Quality score: ${finalStats.qualityScore}`);
      console.log(`EMA volatility: ${finalStats.emaVolatility}`);
      console.log(`Risk score: ${finalStats.riskScore}`);

      // High volatility should result in low tier and high risk
      // Note: 500+ is significant volatility for alternating 0/100 scores
      expect(finalStats.emaVolatility).to.be.greaterThan(500);
      if (finalStats.trustTier >= 2) {
        console.log("\nWARNING: High volatility agent reached Silver - volatility detection weak");
      } else {
        console.log("\nPROTECTION: Volatile agent limited to low tier");
      }
    });
  });

  // ============================================================================
  // 6. TIER BOUNDARY HYSTERESIS
  // ============================================================================
  describe("Tier Boundary Hysteresis", () => {
    it("tests tier stability at boundaries", async () => {
      console.log("\n=== Test: Tier Boundary Hysteresis ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Create clients
      const clients: Keypair[] = [];
      for (let i = 0; i < 80; i++) {
        const client = Keypair.generate();
        clients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, clients, FUND_AMOUNT / 25);

      // Build to Silver tier first
      console.log("Building to Silver tier...");
      for (let i = 0; i < 40; i++) {
        await giveFeedback(clients[i], agent.publicKey, agentPda, statsPda, 85, i);
      }

      let stats = await atomProgram.account.atomStats.fetch(statsPda);
      console.log(`After 40 good: tier=${stats.trustTier}, quality=${stats.qualityScore}`);

      // Try to oscillate at boundary
      console.log("\nOscillating at tier boundary...");
      const tierHistory: number[] = [];

      for (let i = 40; i < 80; i++) {
        // Alternate between pushing up and down
        const score = i % 4 < 2 ? 90 : 50;
        await giveFeedback(clients[i], agent.publicKey, agentPda, statsPda, score, i);

        stats = await atomProgram.account.atomStats.fetch(statsPda);
        tierHistory.push(stats.trustTier);

        if ((i - 39) % 10 === 0) {
          console.log(`After ${i + 1}: tier=${stats.trustTier}, quality=${stats.qualityScore}`);
        }
      }

      // Count tier changes
      let tierChanges = 0;
      for (let i = 1; i < tierHistory.length; i++) {
        if (tierHistory[i] !== tierHistory[i - 1]) {
          tierChanges++;
        }
      }

      console.log("\n=== Hysteresis Results ===");
      console.log(`Tier changes during oscillation: ${tierChanges}`);
      console.log(`Tier history sample: [${tierHistory.slice(0, 20).join(", ")}...]`);

      if (tierChanges > 5) {
        console.log("\nWARNING: Tier oscillating frequently - hysteresis may be too weak");
      } else {
        console.log("\nSTABILITY: Tier hysteresis preventing rapid oscillation");
      }
    });
  });

  // ============================================================================
  // 7. CONCURRENT STRESS TEST
  // ============================================================================
  describe("Concurrent Stress", () => {
    it("handles 50 concurrent feedbacks", async () => {
      console.log("\n=== Test: 50 Concurrent Feedbacks ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Create 50 clients
      const clients: Keypair[] = [];
      for (let i = 0; i < 50; i++) {
        const client = Keypair.generate();
        clients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, clients, FUND_AMOUNT / 20);

      console.log("Sending 50 feedbacks concurrently...");
      const startTime = Date.now();

      // Send all feedbacks in parallel
      const promises = clients.map((client, i) =>
        giveFeedback(client, agent.publicKey, agentPda, statsPda, 80 + (i % 20), i)
          .catch(e => ({ error: e, index: i }))
      );

      const results = await Promise.all(promises);
      const errors = results.filter(r => r && typeof r === 'object' && 'error' in r);
      const elapsed = Date.now() - startTime;

      const stats = await atomProgram.account.atomStats.fetch(statsPda);

      console.log("\n=== Concurrent Results ===");
      console.log(`Time for 50 feedbacks: ${elapsed}ms`);
      console.log(`Successful: ${50 - errors.length}`);
      console.log(`Failed: ${errors.length}`);
      console.log(`Feedback count: ${stats.feedbackCount}`);
      console.log(`Trust tier: ${stats.trustTier}`);

      if (errors.length > 10) {
        console.log("\nWARNING: High failure rate under concurrent load");
      } else {
        console.log("\nSTABLE: System handled concurrent load well");
      }
    });
  });

  // ============================================================================
  // 8. LONG-TERM DECAY SIMULATION
  // ============================================================================
  describe("Long-term Decay", () => {
    it("simulates epoch decay over time", async () => {
      console.log("\n=== Test: Long-term Decay Simulation ===");
      console.log("Note: This tests the decay logic but cannot simulate real time passage");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Build initial reputation
      const clients: Keypair[] = [];
      for (let i = 0; i < 30; i++) {
        const client = Keypair.generate();
        clients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, clients, FUND_AMOUNT / 10);

      console.log("Building initial reputation...");
      for (let i = 0; i < 30; i++) {
        await giveFeedback(clients[i], agent.publicKey, agentPda, statsPda, 90, i);
      }

      const initialStats = await atomProgram.account.atomStats.fetch(statsPda);
      console.log(`Initial: tier=${initialStats.trustTier}, quality=${initialStats.qualityScore}, confidence=${initialStats.confidence}`);

      // Note: In production, confidence decays when slot_delta > EPOCH_SLOTS
      // We can't easily simulate this in tests without waiting real time
      console.log("\n=== Decay Notes ===");
      console.log("Inactive decay triggers when slot_delta > 432,000 slots (~2.5 days)");
      console.log("Confidence decays by 500 per inactive epoch");
      console.log("Max inactive epochs considered: 10");
    });
  });

  // ============================================================================
  // 9. SLEEPER CELL ATTACK (LONG-CON)
  // ============================================================================
  describe("Sleeper Cell Attack", () => {
    it("tests if a single malicious act is detected after long good behavior", async () => {
      console.log("\n=== Test: Sleeper Cell (Long-Con) Attack ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Create clients for long-term good behavior
      const goodClients: Keypair[] = [];
      for (let i = 0; i < 60; i++) {
        const client = Keypair.generate();
        goodClients.push(client);
        allFundedKeypairs.push(client);
      }
      await fundKeypairs(provider, goodClients, FUND_AMOUNT / 20);

      // Phase 1: Build excellent reputation over 50 feedbacks
      console.log("Phase 1: Building Platinum reputation over 50 feedbacks...");
      for (let i = 0; i < 50; i++) {
        await giveFeedback(goodClients[i], agent.publicKey, agentPda, statsPda, 100, i);
      }

      let stats = await atomProgram.account.atomStats.fetch(statsPda);
      const preMaliciousTier = stats.trustTier;
      const preMaliciousQuality = stats.qualityScore;
      console.log(`After 50 perfect feedbacks: tier=${preMaliciousTier}, quality=${preMaliciousQuality}`);

      // Phase 2: One malicious act (score 0)
      console.log("\nPhase 2: Single malicious feedback (score 0)...");
      await giveFeedback(goodClients[50], agent.publicKey, agentPda, statsPda, 0, 50);

      stats = await atomProgram.account.atomStats.fetch(statsPda);
      const postMaliciousTier = stats.trustTier;
      const postMaliciousQuality = stats.qualityScore;
      console.log(`After malicious feedback: tier=${postMaliciousTier}, quality=${postMaliciousQuality}`);

      // Phase 3: Resume good behavior (10 more good feedbacks)
      console.log("\nPhase 3: Resuming good behavior (10 feedbacks)...");
      for (let i = 51; i < 60; i++) {
        await giveFeedback(goodClients[i], agent.publicKey, agentPda, statsPda, 100, i);
      }

      stats = await atomProgram.account.atomStats.fetch(statsPda);
      const finalTier = stats.trustTier;
      const finalQuality = stats.qualityScore;

      console.log("\n=== Sleeper Cell Results ===");
      console.log(`Pre-attack: tier=${preMaliciousTier}, quality=${preMaliciousQuality}`);
      console.log(`Post-attack: tier=${postMaliciousTier}, quality=${postMaliciousQuality}`);
      console.log(`After recovery: tier=${finalTier}, quality=${finalQuality}`);

      // Analysis
      const qualityDropFromMalicious = preMaliciousQuality - postMaliciousQuality;
      const qualityDropPct = (qualityDropFromMalicious / preMaliciousQuality * 100).toFixed(1);
      console.log(`\nQuality drop from single attack: ${qualityDropFromMalicious} (${qualityDropPct}%)`);

      if (postMaliciousTier < preMaliciousTier - 1) {
        console.log("WARNING: Single attack dropped tier by more than 1 level");
      } else if (postMaliciousTier >= preMaliciousTier) {
        console.log("PROTECTION: Tier shielding prevented tier drop");
      } else {
        console.log("BALANCED: Minor tier adjustment from single attack");
      }

      // Tier should not drop by more than 1 from a single attack on established agent
      expect(preMaliciousTier - postMaliciousTier).to.be.lessThanOrEqual(1);
    });
  });

  // ============================================================================
  // 10. CIRCULAR CABAL ATTACK (COLLUSION)
  // ============================================================================
  describe("Circular Cabal Attack", () => {
    it("tests collusion detection via diversity metrics", async () => {
      console.log("\n=== Test: Circular Cabal (Collusion) Attack ===");

      // Create 3 agents that will collude
      const owners: Keypair[] = [];
      const agents: { agent: Keypair; agentPda: PublicKey; statsPda: PublicKey }[] = [];

      for (let i = 0; i < 3; i++) {
        const owner = Keypair.generate();
        await fundKeypair(provider, owner, FUND_AMOUNT);
        allFundedKeypairs.push(owner);
        owners.push(owner);

        const agentData = await createAgent(owner);
        agents.push(agentData);
      }

      console.log("Created 3 agents: A, B, C");
      console.log(`Agent A: ${agents[0].agent.publicKey.toBase58().slice(0, 8)}`);
      console.log(`Agent B: ${agents[1].agent.publicKey.toBase58().slice(0, 8)}`);
      console.log(`Agent C: ${agents[2].agent.publicKey.toBase58().slice(0, 8)}`);

      // Colluding pattern: A rates B, B rates C, C rates A (100 cycles)
      console.log("\nExecuting collusion pattern (50 cycles): A→B→C→A...");

      for (let cycle = 0; cycle < 50; cycle++) {
        // Owner 0 rates Agent 1
        await giveFeedback(owners[0], agents[1].agent.publicKey, agents[1].agentPda, agents[1].statsPda, 100, cycle);
        // Owner 1 rates Agent 2
        await giveFeedback(owners[1], agents[2].agent.publicKey, agents[2].agentPda, agents[2].statsPda, 100, cycle);
        // Owner 2 rates Agent 0
        await giveFeedback(owners[2], agents[0].agent.publicKey, agents[0].agentPda, agents[0].statsPda, 100, cycle);

        if ((cycle + 1) % 10 === 0) {
          console.log(`Cycle ${cycle + 1} complete`);
        }
      }

      // Analyze results
      console.log("\n=== Cabal Analysis ===");
      for (let i = 0; i < 3; i++) {
        const stats = await atomProgram.account.atomStats.fetch(agents[i].statsPda);
        console.log(`Agent ${String.fromCharCode(65 + i)}: tier=${stats.trustTier}, quality=${stats.qualityScore}, diversity=${stats.diversityRatio}, feedback_count=${stats.feedbackCount}`);
      }

      const stats0 = await atomProgram.account.atomStats.fetch(agents[0].statsPda);

      // With only 1 unique client per agent (cabal member), diversity should be very low
      console.log("\n=== Collusion Detection ===");
      if (stats0.diversityRatio < 50) {
        console.log("DETECTED: Low diversity ratio indicates single-source feedback");
        console.log("System correctly flags concentrated feedback source");
      } else if (stats0.trustTier <= 2) {
        console.log("PARTIAL: Tier capped despite high scores (confidence/diversity limits)");
      } else {
        console.log("WARNING: Cabal achieved high tier - collusion not fully detected");
      }

      // Each agent should have exactly 1 unique client (the cabal member rating them)
      // This should result in low diversity
      expect(stats0.feedbackCount.toNumber()).to.equal(50);
    });
  });

  // ============================================================================
  // 11. FLASH SPAM ATTACK (SAME SLOT)
  // ============================================================================
  describe("Flash Spam Attack", () => {
    it("tests burst detection against rapid-fire feedbacks", async () => {
      console.log("\n=== Test: Flash Spam Attack ===");

      const owner = Keypair.generate();
      await fundKeypair(provider, owner, FUND_AMOUNT);
      allFundedKeypairs.push(owner);

      const { agent, agentPda, statsPda } = await createAgent(owner);

      // Create 20 spam wallets
      const spamWallets: Keypair[] = [];
      for (let i = 0; i < 20; i++) {
        const wallet = Keypair.generate();
        spamWallets.push(wallet);
        allFundedKeypairs.push(wallet);
      }
      await fundKeypairs(provider, spamWallets, FUND_AMOUNT / 20);

      console.log("Executing flash spam: 20 feedbacks as fast as possible...");
      const startTime = Date.now();

      // Send all feedbacks as fast as possible (no await between, then await all)
      const promises = spamWallets.map((wallet, i) =>
        giveFeedback(wallet, agent.publicKey, agentPda, statsPda, 100, i)
      );

      const results = await Promise.allSettled(promises);
      const elapsed = Date.now() - startTime;

      const succeeded = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;

      console.log(`\nFlash spam completed in ${elapsed}ms`);
      console.log(`Succeeded: ${succeeded}`);
      console.log(`Failed: ${failed}`);

      const stats = await atomProgram.account.atomStats.fetch(statsPda);

      console.log("\n=== Flash Spam Results ===");
      console.log(`Feedback count: ${stats.feedbackCount}`);
      console.log(`Trust tier: ${stats.trustTier}`);
      console.log(`Quality score: ${stats.qualityScore}`);
      console.log(`Burst pressure: ${stats.burstPressure}`);
      console.log(`Risk score: ${stats.riskScore}`);
      console.log(`Diversity ratio: ${stats.diversityRatio}`);

      // Even with 20 unique wallets, flash spam should trigger burst detection
      // or at least result in lower quality due to risk penalties
      if (stats.riskScore > 20) {
        console.log("\nDETECTED: High risk score from flash spam pattern");
      } else if (stats.trustTier <= 2) {
        console.log("\nCONTAINED: Tier limited despite spam");
      } else {
        console.log("\nWARNING: Flash spam achieved high tier");
      }

      // Should have processed most if not all feedbacks
      expect(stats.feedbackCount.toNumber()).to.be.greaterThan(10);
    });
  });
});
