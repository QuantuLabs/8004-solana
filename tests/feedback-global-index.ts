import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

describe("Feedback Global Index Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  // Generate new asset for this test run
  const assetKeypair = Keypair.generate();
  let configPda: PublicKey;
  let collectionPubkey: PublicKey;
  let agentPda: PublicKey;
  let agentId: anchor.BN;
  let agentReputationPda: PublicKey;

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Fetch existing config to get collection and next_agent_id
    const config = await program.account.registryConfig.fetch(configPda);
    collectionPubkey = config.collection;
    agentId = config.nextAgentId;

    [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), assetKeypair.publicKey.toBuffer()],
      program.programId
    );

    [agentReputationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_reputation"), agentId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    console.log("Program ID:", program.programId.toBase58());
    console.log("Config PDA:", configPda.toBase58());
    console.log("Collection:", collectionPubkey.toBase58());
    console.log("Asset:", assetKeypair.publicKey.toBase58());
    console.log("Next Agent ID:", agentId.toNumber());
  });

  it("Register agent", async () => {
    const tx = await program.methods
      .register("https://example.com/agent/feedback-test")
      .accounts({
        config: configPda,
        agentAccount: agentPda,
        asset: assetKeypair.publicKey,
        collection: collectionPubkey,
        owner: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([assetKeypair])
      .rpc();

    console.log("Register tx:", tx);

    const agent = await program.account.agentAccount.fetch(agentPda);
    console.log(`Agent #${agent.agentId.toNumber()} registered`);
  });

  it("Give first feedback (index 0)", async () => {
    const feedbackIndex = new anchor.BN(0);
    const score = 85;
    const tag1 = "quality";
    const tag2 = "reliable";
    const fileUri = "https://example.com/feedback/0";
    const fileHash = new Uint8Array(32).fill(1);

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .giveFeedback(agentId, score, tag1, tag2, fileUri, Array.from(fileHash), feedbackIndex)
      .accounts({
        client: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        asset: assetKeypair.publicKey,
        agentAccount: agentPda,
        feedbackAccount: feedbackPda,
        agentReputation: agentReputationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Feedback #0 tx:", tx);

    // Verify feedback
    const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
    expect(feedback.feedbackIndex.toNumber()).to.equal(0);
    expect(feedback.score).to.equal(85);
    expect(feedback.clientAddress.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    console.log("Feedback #0 created with client:", feedback.clientAddress.toBase58());

    // Verify reputation metadata
    const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    expect(reputation.nextFeedbackIndex.toNumber()).to.equal(1);
    expect(reputation.totalFeedbacks.toNumber()).to.equal(1);
    expect(reputation.averageScore).to.equal(85);
    console.log("Next feedback index:", reputation.nextFeedbackIndex.toNumber());
  });

  it("Give second feedback (index 1) from same client", async () => {
    const feedbackIndex = new anchor.BN(1);
    const score = 90;
    const tag1 = "fast";
    const tag2 = "accurate";
    const fileUri = "https://example.com/feedback/1";
    const fileHash = new Uint8Array(32).fill(2);

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .giveFeedback(agentId, score, tag1, tag2, fileUri, Array.from(fileHash), feedbackIndex)
      .accounts({
        client: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        asset: assetKeypair.publicKey,
        agentAccount: agentPda,
        feedbackAccount: feedbackPda,
        agentReputation: agentReputationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Feedback #1 tx:", tx);

    // Verify
    const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
    expect(feedback.feedbackIndex.toNumber()).to.equal(1);
    expect(feedback.score).to.equal(90);
    console.log("Feedback #1 created");

    // Verify reputation updated
    const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    expect(reputation.nextFeedbackIndex.toNumber()).to.equal(2);
    expect(reputation.totalFeedbacks.toNumber()).to.equal(2);
    expect(reputation.averageScore).to.equal(87); // (85+90)/2 = 87.5 -> 87
    console.log("Average score:", reputation.averageScore);
    console.log("Next feedback index:", reputation.nextFeedbackIndex.toNumber());
  });

  it("Revoke feedback #0", async () => {
    const feedbackIndex = new anchor.BN(0);

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .revokeFeedback(agentId, feedbackIndex)
      .accounts({
        client: provider.wallet.publicKey,
        feedbackAccount: feedbackPda,
        agentReputation: agentReputationPda,
      })
      .rpc();

    console.log("Revoke tx:", tx);

    // Verify revoked
    const feedback = await program.account.feedbackAccount.fetch(feedbackPda);
    expect(feedback.isRevoked).to.equal(true);
    console.log("Feedback #0 revoked");

    // Verify reputation updated
    const reputation = await program.account.agentReputationMetadata.fetch(agentReputationPda);
    expect(reputation.totalFeedbacks.toNumber()).to.equal(1); // Now only 1 active
    expect(reputation.averageScore).to.equal(90); // Only feedback #1 remains
    console.log("Average score after revoke:", reputation.averageScore);
  });

  it("Append response to feedback #1", async () => {
    const feedbackIndex = new anchor.BN(1);
    const responseUri = "https://example.com/response/0";
    const responseHash = new Uint8Array(32).fill(3);

    const [feedbackPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("feedback"),
        agentId.toArrayLike(Buffer, "le", 8),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const [responseIndexPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("response_index"),
        agentId.toArrayLike(Buffer, "le", 8),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // First response will be index 0
    const responseIndex = new anchor.BN(0);
    const [responsePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("response"),
        agentId.toArrayLike(Buffer, "le", 8),
        feedbackIndex.toArrayLike(Buffer, "le", 8),
        responseIndex.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .appendResponse(agentId, feedbackIndex, responseUri, Array.from(responseHash))
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

    // Verify response
    const response = await program.account.responseAccount.fetch(responsePda);
    expect(response.feedbackIndex.toNumber()).to.equal(1);
    expect(response.responseIndex.toNumber()).to.equal(0);
    expect(response.responseUri).to.equal(responseUri);
    console.log("Response #0 appended to feedback #1");
  });
});
