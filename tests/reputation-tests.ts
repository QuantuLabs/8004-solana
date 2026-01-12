/**
 * Reputation Module Tests for Agent Registry 8004 v0.4.0
 * Tests feedback creation, revocation, and responses
 * v0.4.0: CPI to atom-engine for reputation stats
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  MAX_URI_LENGTH,
  MAX_TAG_LENGTH,
  getRootConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getAtomStatsPda,
  randomHash,
  uriOfLength,
  stringOfLength,
  expectAnchorError,
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

describe("Reputation Module Tests (v0.4.0 CPI)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomProgram = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;

  // ATOM Engine PDAs
  let atomConfigPda: PublicKey;

  // Agent for reputation tests
  let agentAsset: Keypair;
  let agentPda: PublicKey;
  let atomStatsPda: PublicKey;

  // Separate client for feedback (anti-gaming: owner cannot give feedback to own agent)
  let clientKeypair: Keypair;

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    [atomConfigPda] = getAtomConfigPda();

    // Check if AtomConfig exists, if not initialize it
    const atomConfigInfo = await provider.connection.getAccountInfo(atomConfigPda);
    if (!atomConfigInfo) {
      console.log("Initializing AtomConfig...");
      await atomProgram.methods
        .initializeConfig(program.programId)
        .accounts({
          authority: provider.wallet.publicKey,
          config: atomConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("AtomConfig initialized:", atomConfigPda.toBase58());
    }

    const rootAccountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    const rootConfig = program.coder.accounts.decode("rootConfig", rootAccountInfo!.data);

    registryConfigPda = rootConfig.currentBaseRegistry;
    const registryAccountInfo = await provider.connection.getAccountInfo(registryConfigPda);
    const registryConfig = program.coder.accounts.decode("registryConfig", registryAccountInfo!.data);
    collectionPubkey = registryConfig.collection;

    clientKeypair = Keypair.generate();

    // Fund client from provider wallet for paying AtomStats creation
    await fundKeypair(provider, clientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);
    console.log("Funded 0.1 SOL to client:", clientKeypair.publicKey.toBase58());

    agentAsset = Keypair.generate();
    [agentPda] = getAgentPda(agentAsset.publicKey, program.programId);
    [atomStatsPda] = getAtomStatsPda(agentAsset.publicKey);

    await program.methods
      .register("https://example.com/agent/reputation-test")
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: agentAsset.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([agentAsset])
      .rpc();

    console.log("=== Reputation Tests Setup (v0.4.0 CPI) ===");
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
      const feedbackIndex = new anchor.BN(0);
      const score = 80;

      const tx = await program.methods
        .giveFeedback(
          score,
          "quality",
          "reliable",
          "https://agent.example.com/api",
          "https://example.com/feedback/0",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
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
      const feedbackIndex = new anchor.BN(1);
      const score = 0;

      await program.methods
        .giveFeedback(
          score,
          "poor",
          "issue",
          "https://agent.example.com/api",
          "https://example.com/feedback/zero",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });

    it("giveFeedback() with score=100 (edge case)", async () => {
      const feedbackIndex = new anchor.BN(2);
      const score = 100;

      await program.methods
        .giveFeedback(
          score,
          "perfect",
          "excellent",
          "https://agent.example.com/api",
          "https://example.com/feedback/perfect",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });

    it("giveFeedback() fails with score > 100", async () => {
      const feedbackIndex = new anchor.BN(999);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            101,
            "invalid",
            "score",
            "https://agent.example.com/api",
            "https://example.com/feedback/invalid",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "InvalidScore"
      );
    });

    it("giveFeedback() with empty tags (allowed)", async () => {
      const feedbackIndex = new anchor.BN(3);

      await program.methods
        .giveFeedback(
          60,
          "",
          "",
          "https://agent.example.com/api",
          "https://example.com/feedback/empty-tags",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();
    });

    it("giveFeedback() fails with tag > 32 bytes", async () => {
      const feedbackIndex = new anchor.BN(998);
      const longTag = stringOfLength(MAX_TAG_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            50,
            longTag,
            "valid",
            "https://agent.example.com/api",
            "https://example.com/feedback/long-tag",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "TagTooLong"
      );
    });

    it("giveFeedback() fails with URI > 200 bytes", async () => {
      const feedbackIndex = new anchor.BN(997);
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .giveFeedback(
            50,
            "tag1",
            "tag2",
            "https://agent.example.com/api",
            longUri,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: clientKeypair.publicKey,
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([clientKeypair])
          .rpc(),
        "UriTooLong"
      );
    });

    it("giveFeedback() accumulates stats correctly", async () => {
      const feedbackIndex = new anchor.BN(4);

      await program.methods
        .giveFeedback(
          75,
          "good",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/accumulate",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: clientKeypair.publicKey,
          asset: agentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: atomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([clientKeypair])
        .rpc();

      // Verify stats accumulated
      const stats = await atomProgram.account.atomStats.fetch(atomStatsPda);
      expect(stats.feedbackCount.toNumber()).to.be.greaterThan(1);
      console.log("AtomStats after multiple feedbacks:", stats.feedbackCount.toNumber());
    });
  });

  // ============================================================================
  // SELF-FEEDBACK PROTECTION (Anti-Gaming)
  // ============================================================================
  describe("Self-Feedback Protection", () => {
    it("giveFeedback() fails if owner tries to rate own agent", async () => {
      const feedbackIndex = new anchor.BN(100);

      // Owner tries to give feedback to their own agent
      await expectAnchorError(
        program.methods
          .giveFeedback(
            95,
            "self",
            "feedback",
            "https://agent.example.com/api",
            "https://example.com/feedback/self",
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: provider.wallet.publicKey, // Owner is client
            asset: agentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: agentPda,
            atomConfig: atomConfigPda,
            atomStats: atomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
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

    before(async () => {
      revokeAgentAsset = Keypair.generate();
      [revokeAgentPda] = getAgentPda(revokeAgentAsset.publicKey, program.programId);
      [revokeAtomStatsPda] = getAtomStatsPda(revokeAgentAsset.publicKey);
      revokeClientKeypair = Keypair.generate();

      // Fund client from provider wallet
      await fundKeypair(provider, revokeClientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

      await program.methods
        .register("https://example.com/agent/revoke-test")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: revokeAgentPda,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([revokeAgentAsset])
        .rpc();

      // Create feedback to revoke
      const feedbackIndex = new anchor.BN(0);

      await program.methods
        .giveFeedback(
          90,
          "high",
          "quality",
          "https://agent.example.com/api",
          "https://example.com/feedback/to-revoke",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: revokeAgentPda,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();
    });

    it("revokeFeedback() emits FeedbackRevoked event", async () => {
      const feedbackIndex = new anchor.BN(0);

      const tx = await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
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
      const feedbackIndex = new anchor.BN(1);

      // First create a feedback
      await program.methods
        .giveFeedback(
          85,
          "test",
          "revoke",
          "https://agent.example.com/api",
          "https://example.com/feedback/non-author",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: revokeAgentPda,
          atomConfig: atomConfigPda,
          atomStats: revokeAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([revokeClientKeypair])
        .rpc();

      // Events-only: this emits an event, indexer ignores if signer != client
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: fakeClient.publicKey,
          asset: revokeAgentAsset.publicKey,
        })
        .signers([fakeClient])
        .rpc();
      // Tx succeeds, but indexer will ignore this revocation
    });

    it("revokeFeedback() can be called multiple times (events-only)", async () => {
      const feedbackIndex = new anchor.BN(0);

      // Events-only: multiple revoke events allowed, indexer handles
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: revokeClientKeypair.publicKey,
          asset: revokeAgentAsset.publicKey,
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
    const feedbackIndex = new anchor.BN(0);

    before(async () => {
      responseAgentAsset = Keypair.generate();
      [responseAgentPda] = getAgentPda(responseAgentAsset.publicKey, program.programId);
      [responseAtomStatsPda] = getAtomStatsPda(responseAgentAsset.publicKey);
      responseClientKeypair = Keypair.generate();

      // Fund client from provider wallet
      await fundKeypair(provider, responseClientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

      await program.methods
        .register("https://example.com/agent/response-test")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: responseAgentPda,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([responseAgentAsset])
        .rpc();

      // Create feedback to respond to
      await program.methods
        .giveFeedback(
          75,
          "feedback",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/for-response",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: responseClientKeypair.publicKey,
          asset: responseAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: responseAgentPda,
          atomConfig: atomConfigPda,
          atomStats: responseAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([responseClientKeypair])
        .rpc();
    });

    it("appendResponse() emits ResponseAppended event", async () => {
      const tx = await program.methods
        .appendResponse(
          feedbackIndex,
          "https://example.com/response/0",
          Array.from(randomHash())
        )
        .accounts({
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
            feedbackIndex,
            `https://example.com/response/${i}`,
            Array.from(randomHash())
          )
          .accounts({
            responder: provider.wallet.publicKey,
            asset: responseAgentAsset.publicKey,
          })
          .rpc();
      }
    });

    it("appendResponse() fails with URI > 200 bytes", async () => {
      const longUri = uriOfLength(MAX_URI_LENGTH + 1);

      await expectAnchorError(
        program.methods
          .appendResponse(
            feedbackIndex,
            longUri,
            Array.from(randomHash())
          )
          .accounts({
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
          feedbackIndex,
          "",
          Array.from(randomHash())
        )
        .accounts({
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

    before(async () => {
      idxAgentAsset = Keypair.generate();
      [idxAgentPda] = getAgentPda(idxAgentAsset.publicKey, program.programId);
      [idxAtomStatsPda] = getAtomStatsPda(idxAgentAsset.publicKey);
      idxClientKeypair = Keypair.generate();

      // Fund client from provider wallet
      await fundKeypair(provider, idxClientKeypair, 0.1 * anchor.web3.LAMPORTS_PER_SOL);

      await program.methods
        .register("https://example.com/agent/index-test")
        .accounts({
          registryConfig: registryConfigPda,
          agentAccount: idxAgentPda,
          asset: idxAgentAsset.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([idxAgentAsset])
        .rpc();
    });

    it("client can provide any index (events-only)", async () => {
      const indices = [0, 5, 10, 100, 999999];

      for (const idx of indices) {
        const feedbackIndex = new anchor.BN(idx);

        await program.methods
          .giveFeedback(
            80,
            `tag${idx}`,
            "test",
            "https://agent.example.com/api",
            `https://example.com/feedback/idx-${idx}`,
            Array.from(randomHash()),
            feedbackIndex
          )
          .accounts({
            client: idxClientKeypair.publicKey,
            asset: idxAgentAsset.publicKey,
            collection: collectionPubkey,
            agentAccount: idxAgentPda,
            atomConfig: atomConfigPda,
            atomStats: idxAtomStatsPda,
            atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([idxClientKeypair])
          .rpc();
      }
    });

    it("same index can be reused (events-only, indexer dedupes)", async () => {
      const feedbackIndex = new anchor.BN(0);

      // Revoke first
      await program.methods
        .revokeFeedback(feedbackIndex)
        .accounts({
          client: idxClientKeypair.publicKey,
          asset: idxAgentAsset.publicKey,
        })
        .signers([idxClientKeypair])
        .rpc();

      // Reuse index - events-only allows this
      await program.methods
        .giveFeedback(
          50,
          "reuse",
          "test",
          "https://agent.example.com/api",
          "https://example.com/feedback/reuse",
          Array.from(randomHash()),
          feedbackIndex
        )
        .accounts({
          client: idxClientKeypair.publicKey,
          asset: idxAgentAsset.publicKey,
          collection: collectionPubkey,
          agentAccount: idxAgentPda,
          atomConfig: atomConfigPda,
          atomStats: idxAtomStatsPda,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([idxClientKeypair])
        .rpc();
      // Indexer decides how to handle reused indices
    });
  });
});
