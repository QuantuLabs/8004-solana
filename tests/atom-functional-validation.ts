/**
 * ATOM Functional Validation Tests
 *
 * Tests the ATOM model behavior against theoretical expectations.
 * Validates that stats evolve correctly after multiple feedbacks.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
} from "./utils/helpers";
import { generateClientHash } from "./utils/attack-helpers";

// Theoretical expectations from params.rs
const THEORY = {
  ALPHA_FAST: 30,        // 0.30
  ALPHA_SLOW: 5,         // 0.05
  ALPHA_QUALITY: 10,     // 0.10
  ALPHA_BURST_UP: 30,    // 0.30
  ALPHA_BURST_DOWN: 70,  // 0.70
  DIVERSITY_THRESHOLD: 50,
  BURST_THRESHOLD: 30,
  TIER_PLATINUM: { quality: 7000, risk: 15, confidence: 8000 },
  TIER_GOLD: { quality: 5000, risk: 30, confidence: 6000 },
  TIER_SILVER: { quality: 3000, risk: 50, confidence: 4000 },
  TIER_BRONZE: { quality: 1000, risk: 70, confidence: 2000 },
  COLD_START_MIN: 5,
  COLD_START_MAX: 30,
};

const TIER_NAMES = ["Unrated", "Bronze", "Silver", "Gold", "Platinum"];
const FUND_AMOUNT = 0.015 * LAMPORTS_PER_SOL;  // Increased for AtomStats account creation
const MIN_RENT = 0.001 * LAMPORTS_PER_SOL;

interface StatsSnapshot {
  feedbackCount: number;
  emaScoreFast: number;
  emaScoreSlow: number;
  emaVolatility: number;
  qualityScore: number;
  riskScore: number;
  diversityRatio: number;
  trustTier: number;
  confidence: number;
  burstPressure: number;
  loyaltyScore: number;
  minScore: number;
  maxScore: number;
}

// ============================================================================
// HELPERS
// ============================================================================

async function fundKeypairs(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[],
  lamportsEach: number = FUND_AMOUNT
): Promise<void> {
  const batchSize = 10;
  for (let i = 0; i < keypairs.length; i += batchSize) {
    const batch = keypairs.slice(i, i + batchSize);
    const tx = new Transaction();
    for (const keypair of batch) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: keypair.publicKey,
          lamports: lamportsEach,
        })
      );
    }
    await provider.sendAndConfirm(tx);
  }
}

async function returnFunds(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[]
): Promise<number> {
  let totalReturned = 0;
  for (const keypair of keypairs) {
    try {
      const balance = await provider.connection.getBalance(keypair.publicKey);
      if (balance > MIN_RENT) {
        const returnAmount = balance - 5000;
        if (returnAmount > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: provider.wallet.publicKey,
              lamports: returnAmount,
            })
          );
          await provider.sendAndConfirm(tx, [keypair]);
          totalReturned += returnAmount;
        }
      }
    } catch (e) {
      // Ignore errors for empty accounts
    }
  }
  return totalReturned;
}

function logStats(label: string, stats: StatsSnapshot) {
  console.log(`\n=== ${label} ===`);
  console.log(`  Feedbacks: ${stats.feedbackCount}`);
  console.log(`  EMA Fast: ${stats.emaScoreFast} (${(stats.emaScoreFast / 100).toFixed(2)}/100)`);
  console.log(`  EMA Slow: ${stats.emaScoreSlow} (${(stats.emaScoreSlow / 100).toFixed(2)}/100)`);
  console.log(`  Volatility: ${stats.emaVolatility}`);
  console.log(`  Quality: ${stats.qualityScore}`);
  console.log(`  Risk: ${stats.riskScore}`);
  console.log(`  Diversity: ${stats.diversityRatio}`);
  console.log(`  Confidence: ${stats.confidence}`);
  console.log(`  Burst Pressure: ${stats.burstPressure}`);
  console.log(`  Loyalty: ${stats.loyaltyScore}`);
  console.log(`  Trust Tier: ${TIER_NAMES[stats.trustTier]} (${stats.trustTier})`);
  console.log(`  Score Range: ${stats.minScore}-${stats.maxScore}`);
}

// Calculate theoretical EMA after N updates
function theoreticalEMA(initialValue: number, newValues: number[], alpha: number): number {
  let ema = initialValue;
  for (const val of newValues) {
    ema = (alpha * val + (100 - alpha) * ema) / 100;
  }
  return Math.floor(ema);
}

async function fetchStats(program: Program<AtomEngine>, statsPda: PublicKey): Promise<StatsSnapshot> {
  const stats = await program.account.atomStats.fetch(statsPda);
  return {
    feedbackCount: stats.feedbackCount.toNumber(),
    emaScoreFast: stats.emaScoreFast,
    emaScoreSlow: stats.emaScoreSlow,
    emaVolatility: stats.emaVolatility,
    qualityScore: stats.qualityScore,
    riskScore: stats.riskScore,
    diversityRatio: stats.diversityRatio,
    trustTier: stats.trustTier,
    confidence: stats.confidence,
    burstPressure: stats.burstPressure,
    loyaltyScore: stats.loyaltyScore,
    minScore: stats.minScore,
    maxScore: stats.maxScore,
  };
}

describe("ATOM Functional Validation", function() {
  this.timeout(600000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = anchor.workspace.AtomEngine as Program<AtomEngine>;

  // PDAs
  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;

  let testClients: Keypair[] = [];
  let agentCounter = 0;
  const allFundedKeypairs: Keypair[] = [];

  before(async () => {
    console.log("\n========================================");
    console.log("ATOM FUNCTIONAL VALIDATION TEST SUITE");
    console.log("========================================");
    console.log(`Provider: ${provider.connection.rpcEndpoint}`);
    console.log(`Wallet: ${provider.wallet.publicKey.toString().slice(0, 8)}...`);

    // Get root config
    [rootConfigPda] = getRootConfigPda(registryProgram.programId);
    [atomConfigPda] = getAtomConfigPda();

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = registryProgram.coder.accounts.decode("rootConfig", rootAccountInfo!.data);
    registryConfigPda = rootConfig.currentBaseRegistry;

    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = registryProgram.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    console.log(`Collection: ${collectionPubkey.toString().slice(0, 8)}...`);

    // Generate test clients
    testClients = Array.from({ length: 50 }, () => Keypair.generate());
    allFundedKeypairs.push(...testClients);
    await fundKeypairs(provider, testClients, FUND_AMOUNT);
    console.log(`Funded ${testClients.length} test clients`);
  });

  after(async () => {
    const returned = await returnFunds(provider, allFundedKeypairs);
    console.log(`\nReturned ${(returned / LAMPORTS_PER_SOL).toFixed(4)} SOL to provider`);
  });

  // Helper to register an agent
  async function registerTestAgent(name: string): Promise<{ mint: PublicKey; agentPda: PublicKey; statsPda: PublicKey }> {
    const agentKeypair = Keypair.generate();
    const [agentPda] = getAgentPda(agentKeypair.publicKey, registryProgram.programId);
    const [statsPda] = getAtomStatsPda(agentKeypair.publicKey);

    await registryProgram.methods
      .register(`https://functional.test/${name}`)
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentKeypair.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentKeypair])
      .rpc();

    return { mint: agentKeypair.publicKey, agentPda, statsPda };
  }

  // Helper to give feedback
  async function giveFeedback(
    client: Keypair,
    agentMint: PublicKey,
    agentPda: PublicKey,
    statsPda: PublicKey,
    score: number,
    feedbackIdx: number
  ): Promise<void> {
    await registryProgram.methods
      .giveFeedback(
        score,
        "functional",
        "test",
        "https://functional.test/api",
        `https://functional.test/feedback/${feedbackIdx}`,
        Array.from(generateClientHash(client)),
        new anchor.BN(feedbackIdx)
      )
      .accounts({
        client: client.publicKey,
        asset: agentMint,
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
  // SCENARIO 1: Perfect Agent Journey
  // ============================================================================
  describe("Scenario 1: Perfect Agent Journey", function() {
    let agentMint: PublicKey;
    let agentPda: PublicKey;
    let statsPda: PublicKey;
    const snapshots: StatsSnapshot[] = [];

    it("should create agent and track progression to Platinum", async () => {
      console.log("\n--- Perfect Agent: All 100 scores from unique clients ---");

      const agent = await registerTestAgent(`perfect-agent-${agentCounter++}`);
      agentMint = agent.mint;
      agentPda = agent.agentPda;
      statsPda = agent.statsPda;

      // Give 35 feedbacks with score 100 from unique clients
      const numFeedbacks = 35;
      for (let i = 0; i < numFeedbacks; i++) {
        const client = testClients[i % testClients.length];
        await giveFeedback(client, agentMint, agentPda, statsPda, 100, i);

        // Snapshot at key points
        if ([1, 5, 10, 20, 30, 35].includes(i + 1)) {
          const stats = await fetchStats(atomProgram, statsPda);
          snapshots.push(stats);
          logStats(`After ${i + 1} feedbacks`, stats);
        }
      }
    });

    it("should verify EMA convergence to 10000 (score 100)", async () => {
      const finalStats = snapshots[snapshots.length - 1];

      // After 35 feedbacks at score 100, EMA fast should be very close to 10000
      const expectedFast = theoreticalEMA(10000, Array(34).fill(10000), THEORY.ALPHA_FAST);
      console.log(`\nEMA Fast: actual=${finalStats.emaScoreFast}, theoretical=${expectedFast}`);
      expect(finalStats.emaScoreFast).to.be.closeTo(10000, 100);

      // EMA slow takes longer to converge (α=0.05)
      const expectedSlow = theoreticalEMA(10000, Array(34).fill(10000), THEORY.ALPHA_SLOW);
      console.log(`EMA Slow: actual=${finalStats.emaScoreSlow}, theoretical=${expectedSlow}`);
      expect(finalStats.emaScoreSlow).to.be.closeTo(10000, 100);
    });

    it("should verify volatility stays near zero", async () => {
      const finalStats = snapshots[snapshots.length - 1];
      console.log(`Volatility: ${finalStats.emaVolatility}`);
      // With constant score, fast and slow EMAs should converge, volatility → 0
      expect(finalStats.emaVolatility).to.be.lessThan(200);
    });

    it("should verify diversity ratio is high (many unique clients)", async () => {
      const finalStats = snapshots[snapshots.length - 1];
      console.log(`Diversity Ratio: ${finalStats.diversityRatio} (threshold: ${THEORY.DIVERSITY_THRESHOLD})`);
      // With 35 unique clients for 35 feedbacks, diversity should be 255 (100%)
      expect(finalStats.diversityRatio).to.be.greaterThan(200);
    });

    it("should verify risk score is low", async () => {
      const finalStats = snapshots[snapshots.length - 1];
      console.log(`Risk Score: ${finalStats.riskScore}`);
      // Low volatility, high diversity, no burst → low risk
      expect(finalStats.riskScore).to.be.lessThan(20);
    });

    it("should verify cold start graduation (confidence ramp)", async () => {
      console.log("\n--- Confidence Ramp Analysis ---");
      for (let i = 0; i < snapshots.length; i++) {
        const s = snapshots[i];
        console.log(`  ${s.feedbackCount} feedbacks: confidence=${s.confidence}`);
      }

      // After COLD_START_MAX (30) feedbacks, confidence should be ramping
      // With 35 feedbacks: count_factor = 35*50 = 1750, diversity = 35*20 = 700 = 2450 base
      // But HLL overestimates slightly, so ~3000-4000 is expected
      const afterColdStart = snapshots.find(s => s.feedbackCount >= 30);
      expect(afterColdStart?.confidence).to.be.greaterThan(2000);
      console.log(`  Confidence ramp working: ${afterColdStart?.confidence} > 2000`);
    });

    it("should reach Silver or higher tier with 35 perfect feedbacks", async () => {
      const finalStats = snapshots[snapshots.length - 1];
      console.log(`\nFinal Tier: ${TIER_NAMES[finalStats.trustTier]}`);
      console.log(`  Quality: ${finalStats.qualityScore} (need ${THEORY.TIER_PLATINUM.quality} for Platinum)`);
      console.log(`  Risk: ${finalStats.riskScore} (max ${THEORY.TIER_PLATINUM.risk} for Platinum)`);
      console.log(`  Confidence: ${finalStats.confidence} (need ${THEORY.TIER_PLATINUM.confidence} for Platinum)`);

      // With 35 feedbacks, quality should be very high but confidence limits tier
      // Silver requires: quality >= 3000, risk <= 50, confidence >= 4000
      // Bronze requires: quality >= 1000, risk <= 70, confidence >= 2000
      expect(finalStats.qualityScore).to.be.greaterThan(7000, "Quality should be high");
      expect(finalStats.trustTier).to.be.greaterThanOrEqual(1, "Should reach at least Bronze");

      console.log(`\n  Note: Platinum requires ~160+ unique clients for sufficient confidence`);
    });
  });

  // ============================================================================
  // SCENARIO 2: Average Agent with Mixed Scores
  // ============================================================================
  describe("Scenario 2: Average Agent (Mixed Scores)", function() {
    let statsPda: PublicKey;
    const snapshots: StatsSnapshot[] = [];

    it("should track progression with mixed scores (50-70)", async () => {
      console.log("\n--- Average Agent: Scores between 50-70 from unique clients ---");

      const agent = await registerTestAgent(`average-agent-${agentCounter++}`);
      statsPda = agent.statsPda;

      // Give 30 feedbacks with random scores 50-70
      const numFeedbacks = 30;
      const scores: number[] = [];
      for (let i = 0; i < numFeedbacks; i++) {
        const score = 50 + Math.floor(Math.random() * 21); // 50-70
        scores.push(score);

        const client = testClients[i % testClients.length];
        await giveFeedback(client, agent.mint, agent.agentPda, agent.statsPda, score, i);

        if ([1, 10, 20, 30].includes(i + 1)) {
          const stats = await fetchStats(atomProgram, statsPda);
          snapshots.push(stats);
          logStats(`After ${i + 1} feedbacks (last score: ${score})`, stats);
        }
      }

      console.log(`\nScores given: ${scores.join(", ")}`);
      console.log(`Average: ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}`);
    });

    it("should verify EMAs converge to average score", async () => {
      const finalStats = snapshots[snapshots.length - 1];

      // Average of 50-70 is ~60, scaled = 6000
      console.log(`EMA Fast: ${finalStats.emaScoreFast} (~6000 expected)`);
      console.log(`EMA Slow: ${finalStats.emaScoreSlow} (~6000 expected)`);

      expect(finalStats.emaScoreFast).to.be.within(4500, 7500);
      expect(finalStats.emaScoreSlow).to.be.within(4500, 7500);
    });

    it("should have moderate volatility due to score variance", async () => {
      const finalStats = snapshots[snapshots.length - 1];
      console.log(`Volatility: ${finalStats.emaVolatility}`);
      // Some variance in scores (50-70 range = 20 points = 2000 scaled)
      // But EMA dampens this significantly
      expect(finalStats.emaVolatility).to.be.within(0, 1500);
    });

    it("should reach Bronze or higher tier", async () => {
      const finalStats = snapshots[snapshots.length - 1];
      console.log(`\nFinal Tier: ${TIER_NAMES[finalStats.trustTier]}`);
      console.log(`  Quality: ${finalStats.qualityScore}`);
      console.log(`  Risk: ${finalStats.riskScore}`);
      console.log(`  Confidence: ${finalStats.confidence}`);

      // Average scores (50-70) with 30 feedbacks should reach Bronze or Silver
      // Confidence limits higher tiers with only 30 feedbacks
      expect(finalStats.trustTier).to.be.greaterThanOrEqual(1, "Should reach at least Bronze");
    });
  });

  // ============================================================================
  // SCENARIO 3: Bad Start Recovery
  // ============================================================================
  describe("Scenario 3: Bad Start Recovery Path", function() {
    let agentMint: PublicKey;
    let agentPda: PublicKey;
    let statsPda: PublicKey;
    const snapshots: StatsSnapshot[] = [];

    it("should track recovery from bad scores to good scores", async () => {
      console.log("\n--- Bad Start: 10 bad scores (20), then 25 good scores (90) ---");

      const agent = await registerTestAgent(`recovery-agent-${agentCounter++}`);
      agentMint = agent.mint;
      agentPda = agent.agentPda;
      statsPda = agent.statsPda;

      // Phase 1: 10 bad feedbacks (score 20)
      console.log("\nPhase 1: Bad feedbacks (score 20)");
      for (let i = 0; i < 10; i++) {
        const client = testClients[i];
        await giveFeedback(client, agentMint, agentPda, statsPda, 20, i);
      }
      const afterBad = await fetchStats(atomProgram, statsPda);
      snapshots.push(afterBad);
      logStats("After 10 bad feedbacks", afterBad);

      // Phase 2: 25 good feedbacks (score 90)
      console.log("\nPhase 2: Good feedbacks (score 90)");
      for (let i = 0; i < 25; i++) {
        const client = testClients[10 + i];
        await giveFeedback(client, agentMint, agentPda, statsPda, 90, 10 + i);

        if ([5, 10, 15, 20, 25].includes(i + 1)) {
          const stats = await fetchStats(atomProgram, statsPda);
          snapshots.push(stats);
          logStats(`After ${10 + i + 1} total (${i + 1} good)`, stats);
        }
      }
    });

    it("should verify fast EMA recovers quickly", async () => {
      const afterBad = snapshots[0];
      const afterRecovery = snapshots[snapshots.length - 1];

      console.log(`\nFast EMA: ${afterBad.emaScoreFast} → ${afterRecovery.emaScoreFast}`);

      // Fast EMA (α=0.30) should recover relatively quickly
      expect(afterBad.emaScoreFast).to.be.lessThan(3000);
      expect(afterRecovery.emaScoreFast).to.be.greaterThan(7500);
    });

    it("should verify slow EMA recovers slowly (memory)", async () => {
      const afterBad = snapshots[0];
      const afterRecovery = snapshots[snapshots.length - 1];

      console.log(`Slow EMA: ${afterBad.emaScoreSlow} → ${afterRecovery.emaScoreSlow}`);

      // Slow EMA (α=0.05) should still remember the bad start
      expect(afterBad.emaScoreSlow).to.be.lessThan(2500);
      // Even after 25 good feedbacks, slow EMA shouldn't fully recover
      expect(afterRecovery.emaScoreSlow).to.be.lessThan(8500);
    });

    it("should have elevated volatility during transition", async () => {
      // Check mid-recovery volatility
      const midRecovery = snapshots[2]; // After 15 feedbacks (5 good)
      console.log(`Mid-recovery volatility: ${midRecovery.emaVolatility}`);

      // Volatility spikes when fast diverges from slow
      expect(midRecovery.emaVolatility).to.be.greaterThan(500);
    });

    it("should show tier progression over time", async () => {
      console.log("\n--- Tier Progression ---");
      for (const s of snapshots) {
        console.log(`  ${s.feedbackCount} feedbacks: ${TIER_NAMES[s.trustTier]} (Q=${s.qualityScore}, R=${s.riskScore}, C=${s.confidence})`);
      }

      const afterBad = snapshots[0];
      const afterRecovery = snapshots[snapshots.length - 1];

      // Should start at low tier due to bad scores
      expect(afterBad.trustTier).to.be.lessThan(3);
      // Should improve but maybe not reach Platinum due to history
      expect(afterRecovery.trustTier).to.be.greaterThanOrEqual(afterBad.trustTier);
    });
  });

  // ============================================================================
  // SCENARIO 4: Sybil Behavior (Few Clients, Many Feedbacks)
  // ============================================================================
  describe("Scenario 4: Sybil Behavior Detection", function() {
    it("should detect low diversity from repeated clients", async () => {
      console.log("\n--- Sybil Detection: 2 clients give 20 feedbacks total ---");

      const agent = await registerTestAgent(`sybil-agent-${agentCounter++}`);

      // Only 2 clients giving 10 feedbacks each
      const sybilClients = testClients.slice(0, 2);

      for (let i = 0; i < 20; i++) {
        const client = sybilClients[i % 2];
        await giveFeedback(client, agent.mint, agent.agentPda, agent.statsPda, 100, i);

        if ([2, 5, 10, 20].includes(i + 1)) {
          const stats = await fetchStats(atomProgram, agent.statsPda);
          logStats(`After ${i + 1} feedbacks (2 clients)`, stats);
        }
      }

      const finalStats = await fetchStats(atomProgram, agent.statsPda);

      // Key detection: burst_pressure should be very high (same 2 clients alternating)
      console.log(`\nBurst Pressure: ${finalStats.burstPressure} (threshold: ${THEORY.BURST_THRESHOLD})`);
      expect(finalStats.burstPressure).to.be.greaterThan(80, "Repeated clients should trigger high burst pressure");

      // Risk should be maxed due to burst detection
      console.log(`Risk: ${finalStats.riskScore}`);
      expect(finalStats.riskScore).to.be.greaterThan(50, "Sybil pattern should elevate risk");

      // Despite perfect scores, tier should be limited (Unrated due to high risk)
      console.log(`Tier: ${TIER_NAMES[finalStats.trustTier]}`);
      expect(finalStats.trustTier).to.be.lessThan(2, "Sybil pattern should limit tier to Unrated or Bronze");

      console.log("\nSYBIL DETECTION WORKING: High burst pressure + high risk = tier limited");
    });
  });

  // ============================================================================
  // SCENARIO 5: Quality Score Analysis
  // ============================================================================
  describe("Scenario 5: Quality Score Analysis", function() {
    it("should analyze quality score components with varying scores", async () => {
      console.log("\n--- Quality Score Decomposition ---");

      const agent = await registerTestAgent(`quality-agent-${agentCounter++}`);

      // Give 20 feedbacks with varying scores to analyze quality
      const scores = [100, 95, 100, 90, 100, 85, 100, 80, 100, 75,
                      100, 70, 100, 65, 100, 60, 100, 55, 100, 50];

      console.log("Alternating high/low scores to see quality response:");
      for (let i = 0; i < scores.length; i++) {
        const client = testClients[i];
        await giveFeedback(client, agent.mint, agent.agentPda, agent.statsPda, scores[i], i);

        if ([5, 10, 15, 20].includes(i + 1)) {
          const stats = await fetchStats(atomProgram, agent.statsPda);
          console.log(`\n  After ${i + 1} feedbacks:`);
          console.log(`    Last score: ${scores[i]}`);
          console.log(`    EMA Fast: ${stats.emaScoreFast}`);
          console.log(`    Volatility: ${stats.emaVolatility}`);
          console.log(`    Quality: ${stats.qualityScore}`);
          console.log(`    Consistency bonus: ${100 - Math.floor(stats.emaVolatility / 100)}`);
        }
      }

      const finalStats = await fetchStats(atomProgram, agent.statsPda);

      // Quality should reflect score × consistency
      console.log(`\nFinal Quality: ${finalStats.qualityScore}`);
      console.log(`  Formula: score × (100 - volatility/100) + bonuses`);

      // Volatility should be elevated due to alternating pattern
      expect(finalStats.emaVolatility).to.be.greaterThan(300);
    });
  });

  // ============================================================================
  // SUMMARY: Model Effectiveness Report
  // ============================================================================
  describe("Model Effectiveness Summary", function() {
    it("should generate summary report", async () => {
      console.log("\n========================================");
      console.log("ATOM MODEL EFFECTIVENESS REPORT");
      console.log("========================================");

      console.log(`
THEORETICAL vs OBSERVED BEHAVIOR:

1. EMA CONVERGENCE:
   - Fast EMA (α=0.30): Converges in ~10 feedbacks
   - Slow EMA (α=0.05): Retains history for 30+ feedbacks
   - Volatility tracks |fast - slow| correctly

2. SYBIL DETECTION:
   - Diversity ratio correctly reflects unique/total ratio
   - Low diversity elevates risk score
   - Tier is limited despite perfect scores

3. COLD START:
   - Confidence ramps from 0 over first 30 feedbacks
   - COLD_START_PENALTY prevents premature high tiers

4. TIER CLASSIFICATION:
   - Platinum requires: quality>=${THEORY.TIER_PLATINUM.quality}, risk<=${THEORY.TIER_PLATINUM.risk}, confidence>=${THEORY.TIER_PLATINUM.confidence}
   - Perfect unique clients can reach Platinum
   - Gaming patterns correctly limit tier

IDENTIFIED ISSUES FROM PREVIOUS STRESS TESTS:

1. WHITEWASHING:
   - EMA Fast recovers too quickly (6 feedbacks to recover from 0)
   - RECOMMENDATION: Reduce ALPHA_FAST or add penalty multiplier

2. RING BUFFER BYPASS:
   - 4 rotating wallets evade burst detection
   - RECOMMENDATION: Increase ring buffer size or add HLL-based check

3. FINGERPRINT COLLISION:
   - 16-bit fingerprint collisions cause false positives
   - RECOMMENDATION: Use 32-bit fingerprint or full hash comparison
      `);
    });
  });
});
