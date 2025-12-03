/**
 * Full Agent Registry 8004 Test Suite
 * Tests all three modules: Identity, Reputation, and Validation
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

describe("Agent Registry 8004 - Full Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  // Shared state
  let configPda: PublicKey;
  let collectionPubkey: PublicKey;
  let validationStatsPda: PublicKey;

  // Agent 1 (owner)
  const asset1Keypair = Keypair.generate();
  let agent1Pda: PublicKey;
  let agent1Id: anchor.BN;
  let agent1ReputationPda: PublicKey;

  // Agent 2 (validator)
  const asset2Keypair = Keypair.generate();
  let agent2Pda: PublicKey;
  let agent2Id: anchor.BN;

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    [validationStatsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("validation_config")],
      program.programId
    );

    // Fetch existing config
    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    agent1Id = config.nextAgentId;
    agent2Id = new anchor.BN(agent1Id.toNumber() + 1);

    [agent1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), asset1Keypair.publicKey.toBuffer()],
      program.programId
    );

    [agent2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), asset2Keypair.publicKey.toBuffer()],
      program.programId
    );

    [agent1ReputationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_reputation"), agent1Id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    console.log("=== Test Setup ===");
    console.log("Program ID:", program.programId.toBase58());
    console.log("Collection:", collectionPubkey.toBase58());
    console.log("Agent 1 ID:", agent1Id.toNumber());
    console.log("Agent 2 ID:", agent2Id.toNumber());
  });

  // ============================================================================
  // IDENTITY MODULE TESTS
  // ============================================================================
  describe("Identity Module", () => {
    it("Register first agent with URI", async () => {
      const tx = await program.methods
        .register("https://example.com/agent/1")
        .accounts({
          config: configPda,
          agentAccount: agent1Pda,
          asset: asset1Keypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset1Keypair])
        .rpc();

      console.log("Register agent 1 tx:", tx);

      const agent = await program.account.agentAccount.fetch(agent1Pda);
      expect(agent.agentId.toNumber()).to.equal(agent1Id.toNumber());
      expect(agent.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agent.agentUri).to.equal("https://example.com/agent/1");
    });

    it("Register second agent (validator)", async () => {
      const tx = await program.methods
        .register("https://example.com/agent/2")
        .accounts({
          config: configPda,
          agentAccount: agent2Pda,
          asset: asset2Keypair.publicKey,
          collection: collectionPubkey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset2Keypair])
        .rpc();

      console.log("Register agent 2 tx:", tx);

      const agent = await program.account.agentAccount.fetch(agent2Pda);
      expect(agent.agentId.toNumber()).to.equal(agent2Id.toNumber());
    });

    it("Set agent metadata", async () => {
      const key = "version";
      const value = Buffer.from("1.0.0");

      const tx = await program.methods
        .setMetadata(key, value)
        .accounts({
          asset: asset1Keypair.publicKey,
          agentAccount: agent1Pda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Set metadata tx:", tx);

      const agent = await program.account.agentAccount.fetch(agent1Pda);
      const entry = agent.metadata.find(m => m.metadataKey === key);
      expect(entry).to.exist;
      expect(Buffer.from(entry!.metadataValue).toString()).to.equal("1.0.0");
    });
  });

  // ============================================================================
  // REPUTATION MODULE TESTS
  // ============================================================================
  describe("Reputation Module", () => {
    it("Give feedback with global index 0", async () => {
      const feedbackIndex = new anchor.BN(0);
      const score = 85;

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const tx = await program.methods
        .giveFeedback(
          agent1Id,
          score,
          "quality",
          "reliable",
          "https://example.com/feedback/0",
          Array.from(new Uint8Array(32).fill(1)),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset1Keypair.publicKey,
          agentAccount: agent1Pda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Feedback #0 tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.feedbackIndex.toNumber()).to.equal(0);
      expect(feedback.score).to.equal(85);

      const reputation = await program.account.agentReputationMetadata.fetch(agent1ReputationPda);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(1);
      expect(reputation.averageScore).to.equal(85);
    });

    it("Give second feedback with global index 1", async () => {
      const feedbackIndex = new anchor.BN(1);
      const score = 95;

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const tx = await program.methods
        .giveFeedback(
          agent1Id,
          score,
          "fast",
          "accurate",
          "https://example.com/feedback/1",
          Array.from(new Uint8Array(32).fill(2)),
          feedbackIndex
        )
        .accounts({
          client: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset1Keypair.publicKey,
          agentAccount: agent1Pda,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Feedback #1 tx:", tx);

      const reputation = await program.account.agentReputationMetadata.fetch(agent1ReputationPda);
      expect(reputation.nextFeedbackIndex.toNumber()).to.equal(2);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(2);
      expect(reputation.averageScore).to.equal(90); // (85+95)/2
    });

    it("Append response to feedback", async () => {
      const feedbackIndex = new anchor.BN(0);
      const responseIndex = new anchor.BN(0);

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [responseIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response_index"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [responsePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
          responseIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const tx = await program.methods
        .appendResponse(
          agent1Id,
          feedbackIndex,
          "https://example.com/response/0",
          Array.from(new Uint8Array(32).fill(3))
        )
        .accounts({
          responder: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          responseIndex: responseIndexPda,
          responseAccount: responsePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Response tx:", tx);

      const response = await program.account.responseAccount.fetch(responsePda);
      expect(response.responseIndex.toNumber()).to.equal(0);
    });

    it("Revoke feedback", async () => {
      const feedbackIndex = new anchor.BN(0);

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          feedbackIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const tx = await program.methods
        .revokeFeedback(agent1Id, feedbackIndex)
        .accounts({
          client: provider.wallet.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: agent1ReputationPda,
        })
        .rpc();

      console.log("Revoke tx:", tx);

      const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
      expect(feedback.isRevoked).to.equal(true);

      const reputation = await program.account.agentReputationMetadata.fetch(agent1ReputationPda);
      expect(reputation.totalFeedbacks.toNumber()).to.equal(1);
      expect(reputation.averageScore).to.equal(95); // Only feedback #1 remains
    });
  });

  // ============================================================================
  // VALIDATION MODULE TESTS
  // ============================================================================
  describe("Validation Module", () => {
    const nonce = Math.floor(Math.random() * 1000000);
    let validationRequestPda: PublicKey;

    before(() => {
      // Seeds: ["validation", agent_id, validator_address, nonce]
      [validationRequestPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          agent1Id.toArrayLike(Buffer, "le", 8),
          provider.wallet.publicKey.toBuffer(),
          new anchor.BN(nonce).toArrayLike(Buffer, "le", 4),
        ],
        program.programId
      );
    });

    it("Request validation", async () => {
      const tx = await program.methods
        .requestValidation(
          agent1Id,
          provider.wallet.publicKey, // validator = owner for this test
          nonce,
          "https://example.com/validation/request",
          Array.from(new Uint8Array(32).fill(4))
        )
        .accounts({
          validationStats: validationStatsPda,
          requester: provider.wallet.publicKey,
          payer: provider.wallet.publicKey,
          asset: asset1Keypair.publicKey,
          agentAccount: agent1Pda,
          validationRequest: validationRequestPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Request validation tx:", tx);

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.agentId.toNumber()).to.equal(agent1Id.toNumber());
      expect(request.respondedAt.toNumber()).to.equal(0); // Not responded yet
    });

    it("Respond to validation", async () => {
      const tx = await program.methods
        .respondToValidation(
          1, // Response value (1-100)
          "https://example.com/validation/response",
          Array.from(new Uint8Array(32).fill(5)),
          "verified"
        )
        .accounts({
          validationStats: validationStatsPda,
          validator: provider.wallet.publicKey,
          validationRequest: validationRequestPda,
        })
        .rpc();

      console.log("Respond to validation tx:", tx);

      const request = await program.account.validationRequest.fetch(validationRequestPda);
      expect(request.response).to.equal(1);
      expect(request.respondedAt.toNumber()).to.be.greaterThan(0);
    });

    it("Close validation request", async () => {
      const balanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);

      const tx = await program.methods
        .closeValidation()
        .accounts({
          config: configPda,
          closer: provider.wallet.publicKey,
          asset: asset1Keypair.publicKey,
          agentAccount: agent1Pda,
          validationRequest: validationRequestPda,
          rentReceiver: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Close validation tx:", tx);

      const balanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      // Balance should increase (rent recovered) minus tx fee
      console.log("Rent recovered:", (balanceAfter - balanceBefore + 5000) / 1e9, "SOL");
    });
  });

  // ============================================================================
  // CROSS-MODULE INTEGRATION
  // ============================================================================
  describe("Cross-Module Integration", () => {
    it("Verify config state after all operations", async () => {
      const config = await program.account.registryConfig.fetch(configPda);
      expect(config.totalAgents.toNumber()).to.be.greaterThanOrEqual(2);
      console.log("Total agents registered:", config.totalAgents.toNumber());
    });

    it("Verify agent state consistency", async () => {
      const agent = await program.account.agentAccount.fetch(agent1Pda);
      expect(agent.agentId.toNumber()).to.equal(agent1Id.toNumber());
      expect(agent.metadata.length).to.be.greaterThanOrEqual(1);
      console.log("Agent metadata entries:", agent.metadata.length);
    });

    it("Verify validation stats", async () => {
      const stats = await program.account.validationStats.fetch(validationStatsPda);
      expect(stats.totalRequests.toNumber()).to.be.greaterThanOrEqual(1);
      expect(stats.totalResponses.toNumber()).to.be.greaterThanOrEqual(1);
      console.log("Total validation requests:", stats.totalRequests.toNumber());
      console.log("Total validation responses:", stats.totalResponses.toNumber());
    });
  });
});
