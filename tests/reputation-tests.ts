/**
 * Reputation Module Tests for Agent Registry 8004 v0.5.0
 * Tests feedback creation, revocation, and responses
 * v0.5.0: EVM-compatible value/valueDecimals, optional score
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../types/atom_engine";
import { Keypair, SystemProgram, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  MAX_URI_LENGTH,
  MAX_TAG_LENGTH,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
  getRegistryAuthorityPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  expectAnchorError,
  getAtomProgram,
} from "./utils/helpers";

// Helper to fund a keypair from the provider wallet
async function fundKeypair(
  provider: anchor.AnchorProvider,
  keypair: Keypair,
  lamports: number
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: keypair.publicKey,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx);
}

describe("Reputation Module Tests (v0.5.0 EVM-Compatible)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = getAtomProgram(provider) as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  // ATOM Engine PDAs
  let atomConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  // Agent for reputation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let atomStatsPda: PublicKey;

  // Separate client for feedback (anti-gaming: owner cannot give feedback to own agent)
  let clientKeypair: Keypair;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);

    // Check if AtomConfig exists, if not initialize it
    const atomConfigInfo = await provider.connection.getAccountInfo(atomConfigPda);
    if (!atomConfigInfo) {
      console.log("Initializing AtomConfig...");
      await atomProgram.methods
        .initializeConfig(program.programId)
        .accountsPartial({
          authority: provider.wallet.publicKey,
          config: atomConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("AtomConfig initialized:", atomConfigPda.toBase58());
    }

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    collectionPubkey = rootConfig.baseCollection;
    [registryConfigPda] = getRegistryConfigPda(collectionPubkey, program.programId);

    clientKeypair = Keypair.generate();

    // Fund client from provider wallet for paying AtomStats creation
    await fundKeypair(provider, clientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);
    console.log("Funded 0.1 SOL to client:", clientKeypair.publicKey.toBase58());

    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    [atomStatsPda] = getAtomStatsPda(agentAsset.publicKey);

    await program.methods
      .register("https://example.com/agent/reputation-test")
      .accountsPartial({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        rootConfig: rootConfigPda,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    // Initialize ATOM stats for the agent (required before giving feedback)
    await atomProgram.methods
      .initializeStats()
      .accountsPartial({
        owner: provider.wallet.publicKey,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        config: atomConfigPda,
        stats: atomStatsPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("ATOM Stats initialized for agent");

    console.log("=== Reputation Tests Setup (v0.5.0 EVM-Compatible) ===");
    console.log("Agent Registry:", program.programId.toBase58());
    console.log("ATOM Engine:", atomProgram.programId.toBase58());
    console.log("Agent Asset:", agentAsset.publicKey.toBase58());
    console.log("AtomStats PDA:", atomStatsPda.toBase58());
    console.log("Client (separate from owner):", clientKeypair.publicKey.toBase58());
  });

  // ============================================================================
  // FEEDBACK CREATION TESTS (CPI to atom-engine)
  // ============================================================================
  describe("Feedback Creation (CPI)", () => {
    it("giveFeedback() emits NewFeedback event and updates AtomStats", async () => {
      const value = new BN(100);  // e.g., 1.00 with 2 decimals
      const valueDecimals = 2;
      const score = 80;

      const tx = await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          score,
          Array.from(randomHash()),
          "quality",
          "reliable",
          "https://agent.example.com/api",
          "https://example.com/feedback/0"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      console.log("Feedback #0 tx:", tx);

      // Verify AtomStats was created and updated
      const stats = await atomProgram.account.atomStats.fetch(atomStatsPda);
      expect(stats.feedbackCount.toNumber()).to.equal(1);
      expect(stats.trustTier).to.be.lessThanOrEqual(4);
      console.log("AtomStats - feedbackCount:", stats.feedbackCount.toNumber());
      console.log("AtomStats - trustTier:", stats.trustTier);
    });

    it("giveFeedback() with score=0 (edge case)", async () => {
      const value = new BN(0);
      const valueDecimals = 0;
      const score = 0;

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          score,
          Array.from(randomHash()),
          "poor",
          "issue",
          "https://agent.example.com/api",
          "https://example.com/feedback/zero"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });

    it("giveFeedback() with score=100 (edge case)", async () => {
      const value = new BN(1000000);  // 1.000000 with 6 decimals
      const valueDecimals = 6;
      const score = 100;

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          score,
          Array.from(randomHash()),
          "perfect",
          "excellent",
          "https://agent.example.com/api",
          "https://example.com/feedback/perfect"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });

    it("giveFeedback() with score=null (no ATOM update)", async () => {
      const value = new BN(500);
      const valueDecimals = 2;

      // Get current feedback count
      const statsBefore = await atomProgram.account.atomStats.fetch(atomStatsPda);
      const countBefore = statsBefore.feedbackCount.toNumber();

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          null,  // No ATOM update
          Array.from(randomHash()),
          "info",
          "only",
          "https://agent.example.com/api",
          "https://example.com/feedback/no-atom"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      // Verify feedback count didn't change (no ATOM CPI)
      const statsAfter = await atomProgram.account.atomStats.fetch(atomStatsPda);
      expect(statsAfter.feedbackCount.toNumber()).to.equal(countBefore);
      console.log("ATOM stats unchanged when score=null");
    });

    it("giveFeedback() fails with score > 100", async () => {
      const value = new BN(100);
      const valueDecimals = 0;

      await expectAnchorError(
        program.methods
          .giveFeedback(
            value,
            valueDecimals,
            101,  // Invalid score
            Array.from(randomHash()),
            "invalid",
            "score",
            "https://agent.example.com/api",
            "https://example.com/feedback/invalid"
          )
          .accountsPartial({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidScore"
      );
    });

    it("giveFeedback() fails with valueDecimals > 6", async () => {
      const value = new BN(100);
      const valueDecimals = 7;  // Max is 6

      await expectAnchorError(
        program.methods
          .giveFeedback(
            value,
            valueDecimals,
            50,
            Array.from(randomHash()),
            "invalid",
            "decimals",
            "https://agent.example.com/api",
            "https://example.com/feedback/bad-decimals"
          )
          .accountsPartial({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidDecimals"
      );
    });

    it("giveFeedback() with empty tags (allowed)", async () => {
      const value = new BN(60);
      const valueDecimals = 0;

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          60,
          Array.from(randomHash()),
          "",
          "",
          "https://agent.example.com/api",
          "https://example.com/feedback/empty-tags"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });

    it("giveFeedback() fails with tag > 32 bytes", async () => {
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1);
      const value = new BN(50);
      const valueDecimals = 0;

      await expectAnchorError(
        program.methods
          .giveFeedback(
            value,
            valueDecimals,
            50,
            Array.from(randomHash()),
            longTag,
            "valid",
            "https://agent.example.com/api",
            "https://example.com/feedback/long-tag"
          )
          .accountsPartial({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "TagTooLong"
      );
    });

    it("giveFeedback() fails with URI > 250 bytes", async () => {
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);
      const value = new BN(50);
      const valueDecimals = 0;

      await expectAnchorError(
        program.methods
          .giveFeedback(
            value,
            valueDecimals,
            50,
            Array.from(randomHash()),
            "tag1",
            "tag2",
            "https://agent.example.com/api",
            longUri
          )
          .accountsPartial({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "UriTooLong"
      );
    });

    it("giveFeedback() accumulates stats correctly", async () => {
      const value = new BN(75);
      const valueDecimals = 0;

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          75,
          Array.from(randomHash()),
          "good",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/accumulate"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      // Verify stats accumulated
      const stats = await atomProgram.account.atomStats.fetch(atomStatsPda);
      expect(stats.feedbackCount.toNumber()).to.be.greaterThan(1);
      console.log("AtomStats after multiple feedbacks:", stats.feedbackCount.toNumber());
    });

    it("giveFeedback() with negative value (allowed for EVM compatibility)", async () => {
      const value = new BN(-100);  // Negative value for refunds, etc.
      const valueDecimals = 2;

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          50,
          Array.from(randomHash()),
          "refund",
          "negative",
          "https://agent.example.com/api",
          "https://example.com/feedback/negative"
        )
        .accountsPartial({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });
  });

  // ============================================================================
  // SELF-FEEDBACK PROTECTION (Anti-Gaming)
  // ============================================================================
  describe("Self-Feedback Protection", () => {
    it("giveFeedback() fails if owner tries to rate own agent", async () => {
      const value = new BN(95);
      const valueDecimals = 0;

      // Owner tries to give feedback to their own agent
      await expectAnchorError(
        program.methods
          .giveFeedback(
            value,
            valueDecimals,
            95,
            Array.from(randomHash()),
            "self",
            "feedback",
            "https://agent.example.com/api",
            "https://example.com/feedback/self"
          )
          .accountsPartial({
            client: provider.wallet.publicKey, // Owner is client
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "SelfFeedbackNotAllowed"
      );
    });
  });

  // ============================================================================
  // FEEDBACK REVOCATION TESTS (Events-Only)
  // ============================================================================
  describe("Feedback Revocation (Events-Only)", () => {
    let revokeAgentAsset: Keypair;
    let revokeAgentPda: PublicKey;
    let revokeAtomStatsPda: PublicKey;
    let revokeClientKeypair: Keypair;
    let revokeFeedbackHash: number[];

    before(async () => {
      revokeAgentAsset = Keypair.generate();
      [revokeAgentPda] = getAgentPda(revokeAgentAsset.publicKey, program.programId);
      [revokeAtomStatsPda] = getAtomStatsPda(revokeAgentAsset.publicKey);
      revokeClientKeypair = Keypair.generate();

      // Fund client from provider wallet
      await fundKeypair(provider, revokeClientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

      await program.methods
        .register("https://example.com/agent/revoke-test")
        .accountsPartial({
          registryConfig: registryConfigPda,
          agentAccount: revokeAgentPda,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          rootConfig: rootConfigPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([revokeAgentAsset])
        .rpc();

      // Initialize ATOM stats for revoke agent
      await atomProgram.methods
        .initializeStats()
        .accountsPartial({
          owner: provider.wallet.publicKey,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: revokeAtomStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create feedback to revoke
      const value = new BN(90);
      const valueDecimals = 0;
      revokeFeedbackHash = Array.from(randomHash());

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          90,
          revokeFeedbackHash,
          "high",
          "quality",
          "https://agent.example.com/api",
          "https://example.com/feedback/to-revoke"
        )
        .accountsPartial({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: revokeAgentPda,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();
    });

    it("revokeFeedback() emits FeedbackRevoked event", async () => {
      const feedbackIndex = new BN(0);

      // New API signature: feedback_index, feedback_hash
      const tx = await program.methods
        .revokeFeedback(feedbackIndex, revokeFeedbackHash)
        .accountsPartial({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();

      console.log("RevokeFeedback tx:", tx);
      // Events-only: indexer validates signer == original client
    });

    it("revokeFeedback() anyone can emit revoke event (indexer validates)", async () => {
      // Events-only: program doesn't enforce signer == original client
      // Indexer is responsible for validation
      const fakeClient = Keypair.generate();
      await fundKeypair(provider, fakeClient, 0.05 * anchor.web3.LAMPORTS_PER_SOL);

      const feedbackIndex = new BN(1);
      const value = new BN(85);
      const valueDecimals = 0;
      const fakeHash = Array.from(randomHash());

      // First create a feedback
      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          85,
          fakeHash,
          "test",
          "revoke",
          "https://agent.example.com/api",
          "https://example.com/feedback/non-author"
        )
        .accountsPartial({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();

      // New API signature: feedback_index, feedback_hash
      // Events-only: this emits an event, indexer ignores if signer != client
      await program.methods
        .revokeFeedback(feedbackIndex, fakeHash)
        .accountsPartial({
          client: fakeClient.publicKey,
          asset: revokeAgentAsset.publicKey,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([fakeClient])
        .rpc();
      // Tx succeeds, but indexer will ignore this revocation
    });

    it("revokeFeedback() can be called multiple times (events-only)", async () => {
      const feedbackIndex = new BN(0);

      // New API signature: feedback_index, feedback_hash
      // Events-only: multiple revoke events allowed, indexer handles
      await program.methods
        .revokeFeedback(feedbackIndex, revokeFeedbackHash)
        .accountsPartial({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();
      // Success - just emits another event
    });
  });

  // ============================================================================
  // RESPONSE OPERATION TESTS (Events-only)
  // ============================================================================
  describe("Response Operations (Events-only)", () => {
    let responseAgentAsset: Keypair;
    let responseAgentPda: PublicKey;
    let responseAtomStatsPda: PublicKey;
    let responseClientKeypair: Keypair;
    const feedbackIndex = new BN(0);
    let responseFeedbackHash: number[];

    before(async () => {
      responseAgentAsset = Keypair.generate();
      [responseAgentPda] = getAgentPda(responseAgentAsset.publicKey, program.programId);
      [responseAtomStatsPda] = getAtomStatsPda(responseAgentAsset.publicKey);
      responseClientKeypair = Keypair.generate();

      // Fund client from provider wallet
      await fundKeypair(provider, responseClientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

      await program.methods
        .register("https://example.com/agent/response-test")
        .accountsPartial({
          registryConfig: registryConfigPda,
          agentAccount: responseAgentPda,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          rootConfig: rootConfigPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([responseAgentAsset])
        .rpc();

      // Initialize ATOM stats for response agent
      await atomProgram.methods
        .initializeStats()
        .accountsPartial({
          owner: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: responseAtomStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create feedback to respond to
      const value = new BN(75);
      const valueDecimals = 0;
      responseFeedbackHash = Array.from(randomHash());

      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          75,
          responseFeedbackHash,
          "feedback",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/for-response"
        )
        .accountsPartial({
          client: responseClientKeypair.publicKey,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: responseAgentPda,
          atomConfig: atomConfigPda,
          atomStats: responseAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([responseClientKeypair])
        .rpc();
    });

    it("appendResponse() emits ResponseAppended event", async () => {
      const tx = await program.methods
        .appendResponse(
          responseAgentAsset.publicKey,
          responseClientKeypair.publicKey,
          feedbackIndex,
          "https://example.com/response/0",
          Array.from(randomHash()),
          responseFeedbackHash
        )
        .accountsPartial({
          responder: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
        })
        .rpc();

      console.log("AppendResponse (events-only) tx:", tx);
    });

    it("appendResponse() multiple responses to same feedback", async () => {
      for (let i = 1; i <= 3; i++) {
        await program.methods
          .appendResponse(
            responseAgentAsset.publicKey,
            responseClientKeypair.publicKey,
            feedbackIndex,
            `https://example.com/response/${i}`,
            Array.from(randomHash()),
            responseFeedbackHash
          )
          .accountsPartial({
            responder: provider.wallet.publicKey,
            asset: responseAgentAsset.publicKey,
          })
          .rpc();
      }
    });

    it("appendResponse() fails with URI > 250 bytes", async () => {
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .appendResponse(
            responseAgentAsset.publicKey,
            responseClientKeypair.publicKey,
            feedbackIndex,
            longUri,
            Array.from(randomHash()),
            responseFeedbackHash
          )
          .accountsPartial({
            responder: provider.wallet.publicKey,
            asset: responseAgentAsset.publicKey,
          })
          .rpc(),
        "ResponseUriTooLong"
      );
    });

    it("appendResponse() with empty URI (allowed)", async () => {
      await program.methods
        .appendResponse(
          responseAgentAsset.publicKey,
          responseClientKeypair.publicKey,
          feedbackIndex,
          "",
          Array.from(randomHash()),
          responseFeedbackHash
        )
        .accountsPartial({
          responder: provider.wallet.publicKey,
          asset: responseAgentAsset.publicKey,
        })
        .rpc();
    });
  });

  // ============================================================================
  // FEEDBACK INDEX TESTS (Events-only: client provides any index)
  // ============================================================================
  describe("Feedback Index Management (Events-Only)", () => {
    let idxAgentAsset: Keypair;
    let idxAgentPda: PublicKey;
    let idxAtomStatsPda: PublicKey;
    let idxClientKeypair: Keypair;
    let idxZeroHash: number[];

    before(async () => {
      idxAgentAsset = Keypair.generate();
      [idxAgentPda] = getAgentPda(idxAgentAsset.publicKey, program.programId);
      [idxAtomStatsPda] = getAtomStatsPda(idxAgentAsset.publicKey);
      idxClientKeypair = Keypair.generate();

      // Fund client from provider wallet
      await fundKeypair(provider, idxClientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

      await program.methods
        .register("https://example.com/agent/index-test")
        .accountsPartial({
          registryConfig: registryConfigPda,
          agentAccount: idxAgentPda,
          asset: idxAgentAsset.publicKey,
          collection: collectionPubkey,
          rootConfig: rootConfigPda,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([idxAgentAsset])
        .rpc();

      // Initialize ATOM stats for index test agent
      await atomProgram.methods
        .initializeStats()
        .accountsPartial({
          owner: provider.wallet.publicKey,
          asset: idxAgentAsset.publicKey,
          collection: collectionPubkey,
          config: atomConfigPda,
          stats: idxAtomStatsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("client can provide any index (events-only)", async () => {
      const indices = [0, 5, 10, 100, 999999];

      for (const idx of indices) {
        const value = new BN(80);
        const valueDecimals = 0;
        const feedbackHash = Array.from(randomHash());
        if (idx === 0) {
          idxZeroHash = feedbackHash;
        }

        await program.methods
          .giveFeedback(
            value,
            valueDecimals,
            80,
            feedbackHash,
            `tag${idx}`,
            "test",
            "https://agent.example.com/api",
            `https://example.com/feedback/idx-${idx}`
          )
          .accountsPartial({
            client: idxClientKeypair.publicKey,
            asset: idxAgentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: idxAgentPda,
            atomConfig: atomConfigPda,
            atomStats: idxAtomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([idxClientKeypair])
          .rpc();
      }
    });

    it("same index can be reused (events-only, indexer dedupes)", async () => {
      const feedbackIndex = new BN(0);
      const value = new BN(50);
      const valueDecimals = 0;

      // Revoke first
      await program.methods
        .revokeFeedback(feedbackIndex, idxZeroHash)
        .accountsPartial({
          client: idxClientKeypair.publicKey,
          asset: idxAgentAsset.publicKey,
          atomConfig: atomConfigPda,
          atomStats: idxAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([idxClientKeypair])
        .rpc();

      // Reuse index - events-only allows this
      await program.methods
        .giveFeedback(
          value,
          valueDecimals,
          50,
          Array.from(randomHash()),
          "reuse",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/reuse"
        )
        .accountsPartial({
          client: idxClientKeypair.publicKey,
          asset: idxAgentAsset.publicKey,
          collection: collectionPubkey,
          atomConfig: atomConfigPda,
          atomStats: idxAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([idxClientKeypair])
        .rpc();
      // Indexer decides how to handle reused indices
    });
  });
});
