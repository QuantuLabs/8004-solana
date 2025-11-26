/**
 * SDK E2E Test Suite - ERC-8004 Solana Implementation
 *
 * This test validates the TypeScript SDK against the deployed Solana programs.
 * Unlike e2e-complete-system.ts which uses Anchor directly, this test uses:
 * - IdentityTransactionBuilder, ReputationTransactionBuilder, ValidationTransactionBuilder (WRITE)
 * - Borsh schemas (AgentAccount, FeedbackAccount, etc.) for READ/verification
 * - PDAHelpers for address derivation
 *
 * Constraints:
 * - Uses Anchor wallet (~/.config/solana/id.json)
 * - NO airdrop - funds test wallets via transfers
 * - Saves keypairs for crash recovery
 * - Recovers all funds at the end
 */

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { assert } from "chai";

// SDK imports
import {
  // Transaction Builders (WRITE operations)
  IdentityTransactionBuilder,
  ReputationTransactionBuilder,
  ValidationTransactionBuilder,
  // PDA Helpers
  PDAHelpers,
  IDENTITY_PROGRAM_ID,
  REPUTATION_PROGRAM_ID,
  VALIDATION_PROGRAM_ID,
  // Borsh Schemas (READ operations)
  RegistryConfig,
  AgentAccount,
  FeedbackAccount,
  AgentReputationAccount,
  ClientIndexAccount,
  ResponseAccount,
  ResponseIndexAccount,
  ValidationConfig,
  ValidationRequest,
  MetadataExtensionAccount,
} from "../../agent0-ts-solana/src/index.js";

// Utils
import { saveTestWallets, loadTestWallets, deleteTestWallets } from "./utils/test-wallets";

/**
 * SDK E2E Test Suite
 * Validates SDK against deployed Solana programs on devnet
 */
describe("SDK E2E Test Suite", () => {
  // Connection and provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  // Test wallets
  let anchorWallet: Keypair;
  let agentOwner1: Keypair;
  let agentOwner2: Keypair;
  let client1: Keypair;
  let client2: Keypair;
  let validator1: Keypair;

  // State from tests
  let agent1Mint: PublicKey;
  let agent1Id: bigint;
  let agent2Mint: PublicKey;
  let agent2Id: bigint;

  // SDK Transaction Builders
  let identityBuilder1: IdentityTransactionBuilder;
  let identityBuilder2: IdentityTransactionBuilder;
  let reputationBuilder1: ReputationTransactionBuilder;
  let reputationBuilder2: ReputationTransactionBuilder;
  let validationBuilder1: ValidationTransactionBuilder;
  let validationBuilderV1: ValidationTransactionBuilder;

  // Funding amount per wallet
  const FUND_AMOUNT = 0.2;

  /**
   * Fund a wallet from anchor wallet (NO airdrop)
   */
  async function fundWallet(to: PublicKey, amount: number): Promise<void> {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: anchorWallet.publicKey,
        toPubkey: to,
        lamports: amount * LAMPORTS_PER_SOL,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [anchorWallet]);
  }

  /**
   * Recover SOL from test wallets back to anchor wallet
   */
  async function recoverFunds(wallets: Keypair[]): Promise<number> {
    let totalRecovered = 0;

    for (const wallet of wallets) {
      try {
        const balance = await connection.getBalance(wallet.publicKey);
        if (balance > 5000) {
          const transferAmount = balance - 5000;
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: anchorWallet.publicKey,
              lamports: transferAmount,
            })
          );
          await sendAndConfirmTransaction(connection, tx, [wallet]);
          totalRecovered += transferAmount;
        }
      } catch (err) {
        // Ignore errors (wallet might be empty)
      }
    }

    return totalRecovered;
  }

  before(async () => {
    console.log("\n=== SDK E2E Test Suite ===\n");
    console.log("Testing SDK classes against deployed Solana programs\n");

    // Use provider wallet as anchor wallet
    anchorWallet = provider.wallet.payer;
    console.log(`Anchor wallet: ${anchorWallet.publicKey.toBase58()}`);

    // Try loading existing wallets first (crash recovery)
    const savedWallets = loadTestWallets();
    if (savedWallets) {
      console.log("Reusing saved test wallets...");
      agentOwner1 = savedWallets.agentOwner1;
      agentOwner2 = savedWallets.agentOwner2;
      client1 = savedWallets.client1;
      client2 = savedWallets.client2;
      validator1 = savedWallets.validator1;
    } else {
      console.log("Generating new test wallets...");
      agentOwner1 = Keypair.generate();
      agentOwner2 = Keypair.generate();
      client1 = Keypair.generate();
      client2 = Keypair.generate();
      validator1 = Keypair.generate();

      // Save immediately after generation
      saveTestWallets({
        agentOwner1,
        agentOwner2,
        client1,
        client2,
        validator1,
      });
    }

    // Fund wallets if needed
    const walletsToFund = [
      { kp: agentOwner1, name: "agentOwner1" },
      { kp: agentOwner2, name: "agentOwner2" },
      { kp: client1, name: "client1" },
      { kp: client2, name: "client2" },
      { kp: validator1, name: "validator1" },
    ];

    for (const { kp, name } of walletsToFund) {
      const balance = await connection.getBalance(kp.publicKey);
      const neededLamports = FUND_AMOUNT * LAMPORTS_PER_SOL;
      if (balance < neededLamports * 0.5) {
        console.log(`Funding ${name}...`);
        await fundWallet(kp.publicKey, FUND_AMOUNT);
      } else {
        console.log(`${name} already funded: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }
    }

    console.log("\nAll wallets funded\n");

    // Initialize SDK Transaction Builders
    identityBuilder1 = new IdentityTransactionBuilder(connection, "devnet", agentOwner1);
    identityBuilder2 = new IdentityTransactionBuilder(connection, "devnet", agentOwner2);
    reputationBuilder1 = new ReputationTransactionBuilder(connection, "devnet", client1);
    reputationBuilder2 = new ReputationTransactionBuilder(connection, "devnet", client2);
    validationBuilder1 = new ValidationTransactionBuilder(connection, "devnet", agentOwner1);
    validationBuilderV1 = new ValidationTransactionBuilder(connection, "devnet", validator1);

    console.log("SDK Transaction Builders initialized\n");
  });

  after(async () => {
    console.log("\n=== Cleanup ===\n");

    // Recover all SOL from test wallets
    const testWallets = [agentOwner1, agentOwner2, client1, client2, validator1].filter(
      (kp) => kp !== undefined
    );

    const totalRecovered = await recoverFunds(testWallets);
    console.log(`Recovered ${(totalRecovered / LAMPORTS_PER_SOL).toFixed(6)} SOL from test wallets`);

    // Delete wallets file after successful recovery
    deleteTestWallets();

    console.log("\n=== SDK E2E Tests Complete ===\n");
  });

  describe("0. Config Reads", () => {
    it("should read Identity Registry config using SDK Borsh schema", async () => {
      const [configPda] = await PDAHelpers.getRegistryConfigPDA();
      const accountInfo = await connection.getAccountInfo(configPda);

      assert.isNotNull(accountInfo, "Config account should exist");

      // Deserialize using SDK Borsh schema
      const config = RegistryConfig.deserialize(accountInfo!.data);

      console.log(`Registry Config:`);
      console.log(`  Authority: ${config.getAuthorityPublicKey().toBase58()}`);
      console.log(`  Collection Mint: ${config.getCollectionMintPublicKey().toBase58()}`);
      console.log(`  Next Agent ID: ${config.next_agent_id}`);
      console.log(`  Total Agents: ${config.total_agents}`);

      assert.isTrue(config.next_agent_id >= BigInt(0), "next_agent_id should be valid");
    });

    it("should read Validation Registry config using SDK Borsh schema", async () => {
      const [configPda] = await PDAHelpers.getValidationConfigPDA();
      const accountInfo = await connection.getAccountInfo(configPda);

      assert.isNotNull(accountInfo, "Validation config should exist");

      // Deserialize using SDK Borsh schema
      const config = ValidationConfig.deserialize(accountInfo!.data);

      console.log(`Validation Config:`);
      console.log(`  Authority: ${config.getAuthorityPublicKey().toBase58()}`);
      console.log(`  Identity Registry: ${config.getIdentityRegistryPublicKey().toBase58()}`);
      console.log(`  Total Requests: ${config.total_requests}`);
      console.log(`  Total Responses: ${config.total_responses}`);

      assert.isTrue(config.total_requests >= BigInt(0), "total_requests should be valid");
    });
  });

  describe("1. Identity Registry", () => {
    it("1.1: should register agent using SDK IdentityTransactionBuilder", async () => {
      console.log("\nRegistering agent using SDK...");

      const result = await identityBuilder1.registerAgent(
        "ipfs://sdk-test-agent-1",
        [{ key: "name", value: "SDK Test Agent 1" }]
      );

      assert.isTrue(result.success, `Registration failed: ${result.error}`);
      assert.isDefined(result.agentId, "agentId should be defined");
      assert.isDefined(result.agentMint, "agentMint should be defined");

      agent1Mint = result.agentMint!;
      agent1Id = result.agentId!;

      console.log(`Agent 1 registered:`);
      console.log(`  ID: ${agent1Id}`);
      console.log(`  Mint: ${agent1Mint.toBase58()}`);
      console.log(`  Signature: ${result.signature}`);

      // Verify using SDK Borsh schema
      const [agentPda] = await PDAHelpers.getAgentPDA(agent1Mint);
      const accountInfo = await connection.getAccountInfo(agentPda);
      assert.isNotNull(accountInfo, "Agent account should exist");

      const agent = AgentAccount.deserialize(accountInfo!.data);
      assert.equal(agent.agent_uri, "ipfs://sdk-test-agent-1");
      assert.equal(agent.agent_id, agent1Id);
      assert.equal(agent.getOwnerPublicKey().toBase58(), agentOwner1.publicKey.toBase58());

      console.log(`Verified agent using SDK Borsh schema`);
    });

    it("1.2: should update agent URI using SDK", async () => {
      const newUri = "ipfs://sdk-test-agent-1-updated";

      const result = await identityBuilder1.setAgentUri(agent1Mint, newUri);

      assert.isTrue(result.success, `setAgentUri failed: ${result.error}`);

      // Verify using SDK Borsh schema
      const [agentPda] = await PDAHelpers.getAgentPDA(agent1Mint);
      const accountInfo = await connection.getAccountInfo(agentPda);
      const agent = AgentAccount.deserialize(accountInfo!.data);

      assert.equal(agent.agent_uri, newUri);
      console.log(`URI updated to: ${agent.agent_uri}`);
    });

    it("1.3: should set inline metadata using SDK", async () => {
      const result = await identityBuilder1.setMetadataByMint(
        agent1Mint,
        "description",
        "A test agent created by the SDK E2E test suite"
      );

      assert.isTrue(result.success, `setMetadata failed: ${result.error}`);

      // Verify using SDK Borsh schema
      const [agentPda] = await PDAHelpers.getAgentPDA(agent1Mint);
      const accountInfo = await connection.getAccountInfo(agentPda);
      const agent = AgentAccount.deserialize(accountInfo!.data);

      // Find the description metadata
      const descEntry = agent.metadata.find((m) => m.metadata_key === "description");
      assert.isDefined(descEntry, "description metadata should exist");
      console.log(`Metadata set: ${descEntry!.metadata_key} = ${descEntry!.getValueString()}`);
    });

    it("1.4: should register agent 2 for transfer test", async () => {
      // Register a second agent with agentOwner2
      const result = await identityBuilder2.registerAgent(
        "ipfs://sdk-test-agent-2",
        [{ key: "name", value: "SDK Test Agent 2" }]
      );

      assert.isTrue(result.success, `Agent 2 registration failed: ${result.error}`);

      agent2Mint = result.agentMint!;
      agent2Id = result.agentId!;

      console.log(`Agent 2 registered: ID=${agent2Id}, Mint=${agent2Mint.toBase58()}`);
    });
  });

  describe("2. Reputation Registry", () => {
    it("2.1: should give feedback using SDK ReputationTransactionBuilder", async () => {
      console.log("\nGiving feedback using SDK...");

      const fileHash = Buffer.alloc(32);

      const result = await reputationBuilder1.giveFeedback(
        agent1Mint,
        agent1Id,
        85, // score
        "quality", // tag1
        "helpful", // tag2
        "ipfs://sdk-feedback-1", // fileUri
        fileHash
      );

      assert.isTrue(result.success, `giveFeedback failed: ${result.error}`);
      assert.isDefined(result.feedbackIndex, "feedbackIndex should be returned");

      console.log(`Feedback given:`);
      console.log(`  Feedback Index: ${result.feedbackIndex}`);
      console.log(`  Signature: ${result.signature}`);

      // Verify using SDK Borsh schema
      const [feedbackPda] = await PDAHelpers.getFeedbackPDA(
        agent1Id,
        client1.publicKey,
        result.feedbackIndex!
      );
      const accountInfo = await connection.getAccountInfo(feedbackPda);
      assert.isNotNull(accountInfo, "Feedback account should exist");

      const feedback = FeedbackAccount.deserialize(accountInfo!.data);
      assert.equal(feedback.score, 85);
      assert.equal(feedback.tag1, "quality");
      assert.equal(feedback.tag2, "helpful");
      assert.equal(feedback.file_uri, "ipfs://sdk-feedback-1");
      assert.isFalse(feedback.is_revoked);

      console.log(`Verified feedback using SDK Borsh schema`);
    });

    it("2.2: should read agent reputation summary using SDK", async () => {
      const [reputationPda] = await PDAHelpers.getAgentReputationPDA(agent1Id);
      const accountInfo = await connection.getAccountInfo(reputationPda);

      assert.isNotNull(accountInfo, "Reputation account should exist");

      const reputation = AgentReputationAccount.deserialize(accountInfo!.data);

      console.log(`Agent Reputation:`);
      console.log(`  Agent ID: ${reputation.agent_id}`);
      console.log(`  Total Feedbacks: ${reputation.total_feedbacks}`);
      console.log(`  Total Score Sum: ${reputation.total_score_sum}`);
      console.log(`  Average Score: ${reputation.average_score}`);

      assert.equal(reputation.agent_id, agent1Id);
      assert.isTrue(reputation.total_feedbacks >= BigInt(1));
    });

    it("2.3: should give second feedback from client2", async () => {
      const fileHash = Buffer.alloc(32);

      const result = await reputationBuilder2.giveFeedback(
        agent1Mint,
        agent1Id,
        90,
        "reliable",
        "fast",
        "ipfs://sdk-feedback-2",
        fileHash
      );

      assert.isTrue(result.success, `Second feedback failed: ${result.error}`);
      console.log(`Second feedback given: index=${result.feedbackIndex}`);

      // Verify reputation updated
      const [reputationPda] = await PDAHelpers.getAgentReputationPDA(agent1Id);
      const accountInfo = await connection.getAccountInfo(reputationPda);
      const reputation = AgentReputationAccount.deserialize(accountInfo!.data);

      console.log(`Updated reputation: total=${reputation.total_feedbacks}, avg=${reputation.average_score}`);
    });

    it("2.4: should append response to feedback using SDK", async () => {
      // Get feedback index from client1
      const [clientIndexPda] = await PDAHelpers.getClientIndexPDA(agent1Id, client1.publicKey);
      const clientIndexInfo = await connection.getAccountInfo(clientIndexPda);
      const clientIndex = ClientIndexAccount.deserialize(clientIndexInfo!.data);

      // Use identityBuilder1 (agent owner) to respond
      const responseHash = Buffer.alloc(32);
      const responseBuilder = new ReputationTransactionBuilder(connection, "devnet", agentOwner1);

      const result = await responseBuilder.appendResponse(
        agent1Id,
        client1.publicKey,
        BigInt(0), // feedback index 0
        "ipfs://sdk-response-1",
        responseHash
      );

      assert.isTrue(result.success, `appendResponse failed: ${result.error}`);
      console.log(`Response appended: index=${result.responseIndex}`);

      // Verify using SDK Borsh schema
      const [responsePda] = await PDAHelpers.getResponsePDA(
        agent1Id,
        client1.publicKey,
        BigInt(0),
        result.responseIndex!
      );
      const responseInfo = await connection.getAccountInfo(responsePda);
      assert.isNotNull(responseInfo, "Response account should exist");

      const response = ResponseAccount.deserialize(responseInfo!.data);
      assert.equal(response.response_uri, "ipfs://sdk-response-1");
      console.log(`Response verified: uri=${response.response_uri}`);
    });

    it("2.5: should revoke feedback using SDK", async () => {
      // Client1 revokes their feedback
      const result = await reputationBuilder1.revokeFeedback(agent1Id, BigInt(0));

      assert.isTrue(result.success, `revokeFeedback failed: ${result.error}`);
      console.log(`Feedback revoked`);

      // Verify using SDK Borsh schema
      const [feedbackPda] = await PDAHelpers.getFeedbackPDA(agent1Id, client1.publicKey, BigInt(0));
      const accountInfo = await connection.getAccountInfo(feedbackPda);
      const feedback = FeedbackAccount.deserialize(accountInfo!.data);

      assert.isTrue(feedback.is_revoked, "Feedback should be revoked");
      console.log(`Verified feedback is_revoked=${feedback.is_revoked}`);
    });
  });

  describe("3. Validation Registry", () => {
    const nonce = Math.floor(Math.random() * 1000000); // Random nonce to avoid conflicts

    it("3.1: should request validation using SDK ValidationTransactionBuilder", async () => {
      console.log("\nRequesting validation using SDK...");

      const requestHash = Buffer.alloc(32);

      const result = await validationBuilder1.requestValidation(
        agent1Mint,
        agent1Id,
        validator1.publicKey,
        nonce,
        "ipfs://sdk-validation-request",
        requestHash
      );

      assert.isTrue(result.success, `requestValidation failed: ${result.error}`);
      console.log(`Validation requested:`);
      console.log(`  Nonce: ${nonce}`);
      console.log(`  Signature: ${result.signature}`);

      // Verify using SDK Borsh schema
      const [validationPda] = await PDAHelpers.getValidationRequestPDA(
        agent1Id,
        validator1.publicKey,
        nonce
      );
      const accountInfo = await connection.getAccountInfo(validationPda);
      assert.isNotNull(accountInfo, "Validation request should exist");

      const validation = ValidationRequest.deserialize(accountInfo!.data);
      assert.equal(validation.agent_id, agent1Id);
      assert.equal(validation.nonce, nonce);
      assert.isTrue(validation.isPending(), "Validation should be pending");

      console.log(`Verified validation request using SDK Borsh schema`);
    });

    it("3.2: should respond to validation using SDK", async () => {
      const responseHash = Buffer.alloc(32);

      const result = await validationBuilderV1.respondToValidation(
        agent1Id,
        nonce,
        80, // response score
        "ipfs://sdk-validation-response",
        responseHash,
        "oasf-v0.8.0"
      );

      assert.isTrue(result.success, `respondToValidation failed: ${result.error}`);
      console.log(`Validation responded: signature=${result.signature}`);

      // Verify using SDK Borsh schema
      const [validationPda] = await PDAHelpers.getValidationRequestPDA(
        agent1Id,
        validator1.publicKey,
        nonce
      );
      const accountInfo = await connection.getAccountInfo(validationPda);
      const validation = ValidationRequest.deserialize(accountInfo!.data);

      assert.equal(validation.response, 80);
      assert.isTrue(validation.hasResponse(), "Validation should have response");
      console.log(`Verified response: score=${validation.response}`);
    });

    it("3.3: should update validation using SDK", async () => {
      const responseHash = Buffer.alloc(32);

      // Progressive update: 80 -> 95
      const result = await validationBuilderV1.updateValidation(
        agent1Id,
        nonce,
        95, // updated score
        "ipfs://sdk-validation-response-updated",
        responseHash,
        "oasf-v0.8.0-final"
      );

      assert.isTrue(result.success, `updateValidation failed: ${result.error}`);
      console.log(`Validation updated: signature=${result.signature}`);

      // Verify using SDK Borsh schema
      const [validationPda] = await PDAHelpers.getValidationRequestPDA(
        agent1Id,
        validator1.publicKey,
        nonce
      );
      const accountInfo = await connection.getAccountInfo(validationPda);
      const validation = ValidationRequest.deserialize(accountInfo!.data);

      assert.equal(validation.response, 95);
      console.log(`Verified updated score: ${validation.response}`);
    });

    it("3.4: should close validation and recover rent using SDK", async () => {
      // Use authority to close (provider wallet is authority)
      const closeBuilder = new ValidationTransactionBuilder(connection, "devnet", provider.wallet.payer);

      const result = await closeBuilder.closeValidation(
        agent1Id,
        validator1.publicKey,
        nonce,
        agentOwner1.publicKey // rent goes to agent owner
      );

      assert.isTrue(result.success, `closeValidation failed: ${result.error}`);
      console.log(`Validation closed: signature=${result.signature}`);

      // Verify account is closed
      const [validationPda] = await PDAHelpers.getValidationRequestPDA(
        agent1Id,
        validator1.publicKey,
        nonce
      );
      const accountInfo = await connection.getAccountInfo(validationPda);
      assert.isNull(accountInfo, "Validation account should be closed");
      console.log(`Verified validation account is closed`);
    });
  });

  describe("4. PDA Helpers Verification", () => {
    it("should derive correct PDAs using SDK PDAHelpers", async () => {
      console.log("\nVerifying PDA derivations...");

      // Registry Config PDA
      const [configPda] = await PDAHelpers.getRegistryConfigPDA();
      const configInfo = await connection.getAccountInfo(configPda);
      assert.isNotNull(configInfo, "Config PDA should be valid");
      console.log(`Registry Config PDA: ${configPda.toBase58()}`);

      // Agent PDA
      const [agentPda] = await PDAHelpers.getAgentPDA(agent1Mint);
      const agentInfo = await connection.getAccountInfo(agentPda);
      assert.isNotNull(agentInfo, "Agent PDA should be valid");
      console.log(`Agent PDA: ${agentPda.toBase58()}`);

      // Agent Reputation PDA
      const [reputationPda] = await PDAHelpers.getAgentReputationPDA(agent1Id);
      const repInfo = await connection.getAccountInfo(reputationPda);
      assert.isNotNull(repInfo, "Reputation PDA should be valid");
      console.log(`Reputation PDA: ${reputationPda.toBase58()}`);

      // Validation Config PDA
      const [valConfigPda] = await PDAHelpers.getValidationConfigPDA();
      const valConfigInfo = await connection.getAccountInfo(valConfigPda);
      assert.isNotNull(valConfigInfo, "Validation Config PDA should be valid");
      console.log(`Validation Config PDA: ${valConfigPda.toBase58()}`);

      console.log(`\nAll PDA derivations verified`);
    });
  });

  describe("5. SDK Summary", () => {
    it("should summarize SDK test results", async () => {
      console.log("\n=== SDK E2E Test Summary ===\n");

      // Read final state
      const [agentPda] = await PDAHelpers.getAgentPDA(agent1Mint);
      const agentInfo = await connection.getAccountInfo(agentPda);
      const agent = AgentAccount.deserialize(agentInfo!.data);

      const [reputationPda] = await PDAHelpers.getAgentReputationPDA(agent1Id);
      const repInfo = await connection.getAccountInfo(reputationPda);
      const reputation = AgentReputationAccount.deserialize(repInfo!.data);

      console.log("Agent 1 Final State:");
      console.log(`  ID: ${agent.agent_id}`);
      console.log(`  URI: ${agent.agent_uri}`);
      console.log(`  Owner: ${agent.getOwnerPublicKey().toBase58()}`);
      console.log(`  Metadata entries: ${agent.metadata.length}`);
      console.log(`  Total feedbacks: ${reputation.total_feedbacks}`);
      console.log(`  Average score: ${reputation.average_score}`);

      console.log("\nSDK Classes Validated:");
      console.log("  - IdentityTransactionBuilder: registerAgent, setAgentUri, setMetadataByMint");
      console.log("  - ReputationTransactionBuilder: giveFeedback, appendResponse, revokeFeedback");
      console.log("  - ValidationTransactionBuilder: requestValidation, respondToValidation, updateValidation, closeValidation");
      console.log("  - PDAHelpers: getRegistryConfigPDA, getAgentPDA, getFeedbackPDA, getAgentReputationPDA, getValidationRequestPDA, etc.");
      console.log("  - Borsh Schemas: RegistryConfig, AgentAccount, FeedbackAccount, AgentReputationAccount, ValidationRequest, etc.");

      console.log("\nAll SDK classes validated successfully against deployed Solana programs!");
    });
  });
});
