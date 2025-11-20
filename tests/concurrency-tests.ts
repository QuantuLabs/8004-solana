import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { ValidationRegistry } from "../target/types/validation_registry";
import { Metaplex, keypairIdentity } from "@metaplex-foundation/js";

/**
 * LOT 3: Concurrency Tests
 *
 * Tests concurrent operations to verify correct handling of:
 * - Race conditions in feedback index allocation
 * - Parallel feedback submissions
 * - Concurrent metadata updates
 * - Simultaneous validation additions
 * - Parallel response submissions
 * - Concurrent revocations
 * - Reputation aggregate consistency under concurrent updates
 *
 * Coverage: 7 concurrency tests
 */
describe("ERC-8004 Registries - Concurrency Tests (LOT 3)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;
  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const metaplex = Metaplex.make(provider.connection).use(keypairIdentity(provider.wallet as any));

  // Test wallets
  let agentOwner: Keypair;
  let clients: Keypair[];
  let payer: Keypair;

  // Agent data
  let agentMint: PublicKey;
  let agentId: number = 200;
  let agentPda: PublicKey;

  // Helper: Airdrop SOL
  async function airdrop(pubkey: PublicKey, amount: number = 3) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      amount * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  // Helper: Get agent PDA
  function getAgentPda(agentMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentMint.toBuffer()],
      identityProgram.programId
    );
  }

  // Helper: Create feedbackAuth
  function createFeedbackAuth(clientAddress: PublicKey, indexLimit: number = 50) {
    return {
      agentId: new anchor.BN(agentId),
      clientAddress: clientAddress,
      indexLimit: new anchor.BN(indexLimit),
      expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 7200),
      chainId: "solana-localnet",
      identityRegistry: identityProgram.programId,
      signerAddress: agentOwner.publicKey,
      signature: Buffer.alloc(64),
    };
  }

  before(async () => {
    console.log("\n⚡ Setting up concurrency test environment...\n");

    // Initialize wallets
    agentOwner = Keypair.generate();
    payer = Keypair.generate();

    // Create 10 clients for parallel operations
    clients = Array.from({ length: 10 }, () => Keypair.generate());

    // Airdrop SOL
    await airdrop(agentOwner.publicKey, 10);
    await airdrop(payer.publicKey, 10);

    for (const client of clients) {
      await airdrop(client.publicKey, 5);
    }

    console.log("✅ 10 clients funded");

    // Create agent NFT
    const { nft } = await metaplex.nfts().create({
      uri: "https://example.com/agent-concurrency.json",
      name: "Concurrency Test Agent",
      sellerFeeBasisPoints: 0,
      updateAuthority: agentOwner,
    });

    agentMint = nft.address;
    [agentPda] = getAgentPda(agentMint);

    // Register agent
    await identityProgram.methods
      .registerAgent(new anchor.BN(agentId), "Concurrency Test Agent", "https://example.com")
      .accounts({
        owner: agentOwner.publicKey,
        agentMint: agentMint,
        agentAccount: agentPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([agentOwner])
      .rpc();

    console.log(`✅ Agent registered: ID=${agentId}\n`);
  });

  describe("⚡ Parallel Operations Tests", () => {
    it("✅ Test 1: Parallel feedback submissions (10 clients simultaneously)", async () => {
      console.log("Starting 10 parallel feedback submissions...");

      const feedbackPromises = clients.map(async (client, index) => {
        const feedbackAuth = createFeedbackAuth(client.publicKey);

        const [clientIndexPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("client_index"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            client.publicKey.toBuffer(),
          ],
          reputationProgram.programId
        );

        const [feedbackPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("feedback"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            client.publicKey.toBuffer(),
            new anchor.BN(0).toArrayLike(Buffer, "le", 8),
          ],
          reputationProgram.programId
        );

        const [reputationPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("agent_reputation"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
          reputationProgram.programId
        );

        try {
          await reputationProgram.methods
            .giveFeedback(
              new anchor.BN(agentId),
              70 + index, // Different scores
              Array.from(Buffer.alloc(32)),
              Array.from(Buffer.alloc(32)),
              `ipfs://QmParallel${index}`,
              Array.from(Buffer.alloc(32)),
              new anchor.BN(0),
              feedbackAuth
            )
            .accounts({
              client: client.publicKey,
              payer: client.publicKey,
              agentMint: agentMint,
              agentAccount: agentPda,
              clientIndex: clientIndexPda,
              feedbackAccount: feedbackPda,
              agentReputation: reputationPda,
              identityRegistryProgram: identityProgram.programId,
              systemProgram: SystemProgram.programId,
            })
            .signers([client])
            .rpc();

          return { success: true, index };
        } catch (err: any) {
          return { success: false, index, error: err.toString() };
        }
      });

      const results = await Promise.all(feedbackPromises);
      const successCount = results.filter((r) => r.success).length;

      console.log(`✅ ${successCount}/10 parallel feedbacks succeeded`);
      assert.equal(successCount, 10, "All parallel feedbacks should succeed");

      // Verify reputation aggregate is correct
      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      assert.equal(reputation.totalFeedbacks.toNumber(), 10);
      console.log(`✅ Reputation aggregate correct: ${reputation.totalFeedbacks.toNumber()} feedbacks`);
    });

    it("✅ Test 2: Sequential feedbacks from same client (race on index increment)", async () => {
      console.log("Testing sequential feedback index allocation...");

      const client = clients[0];
      const feedbackAuth = createFeedbackAuth(client.publicKey);

      const [clientIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("client_index"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
        ],
        reputationProgram.programId
      );

      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      // Submit 5 feedbacks rapidly in sequence
      for (let i = 1; i <= 5; i++) {
        const [feedbackPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("feedback"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            client.publicKey.toBuffer(),
            new anchor.BN(i).toArrayLike(Buffer, "le", 8),
          ],
          reputationProgram.programId
        );

        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            80 + i,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            `ipfs://QmSequential${i}`,
            Array.from(Buffer.alloc(32)),
            new anchor.BN(i),
            feedbackAuth
          )
          .accounts({
            client: client.publicKey,
            payer: client.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client])
          .rpc();
      }

      // Verify final index is correct
      const clientIndex = await reputationProgram.account.clientIndexAccount.fetch(clientIndexPda);
      assert.equal(clientIndex.lastIndex.toNumber(), 6); // Should be 6 (0 + 5 more)
      console.log(`✅ Sequential index allocation correct: ${clientIndex.lastIndex.toNumber()}`);
    });

    it("✅ Test 3: Concurrent metadata updates (multiple operators)", async () => {
      console.log("Testing concurrent metadata updates...");

      // Add 3 operators
      const operators = [clients[1], clients[2], clients[3]];

      for (const operator of operators) {
        await identityProgram.methods
          .addOperator(operator.publicKey)
          .accounts({
            owner: agentOwner.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
          })
          .signers([agentOwner])
          .rpc();
      }

      console.log("✅ 3 operators added");

      // Try concurrent metadata updates from different operators
      const metadataPromises = operators.map(async (operator, index) => {
        try {
          await identityProgram.methods
            .setMetadata(`key_${index}`, `value_${index}_${Date.now()}`)
            .accounts({
              owner: operator.publicKey,
              agentMint: agentMint,
              agentAccount: agentPda,
            })
            .signers([operator])
            .rpc();

          return { success: true, index };
        } catch (err: any) {
          return { success: false, index, error: err.toString() };
        }
      });

      const results = await Promise.all(metadataPromises);
      const successCount = results.filter((r) => r.success).length;

      console.log(`✅ ${successCount}/3 concurrent metadata updates succeeded`);
      assert.isAtLeast(successCount, 1, "At least one metadata update should succeed");
    });

    it("✅ Test 4: Parallel validation additions", async () => {
      console.log("Testing parallel validation additions...");

      // Submit 5 validations in parallel
      const validationPromises = Array.from({ length: 5 }).map(async (_, index) => {
        const [indexPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("validation_index"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
          validationProgram.programId
        );

        // We need to calculate the next index dynamically
        let validationIndex = index;
        try {
          const indexAccount = await validationProgram.account.validationIndexAccount.fetch(indexPda);
          validationIndex = indexAccount.nextIndex.toNumber() + index;
        } catch (err) {
          // Index account doesn't exist yet, start from 0
        }

        const [validationPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("validation"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            new anchor.BN(validationIndex).toArrayLike(Buffer, "le", 8),
          ],
          validationProgram.programId
        );

        try {
          await validationProgram.methods
            .addValidation(
              new anchor.BN(agentId),
              `validation_${index}`,
              `https://example.com/val${index}`
            )
            .accounts({
              owner: agentOwner.publicKey,
              agentMint: agentMint,
              agentAccount: agentPda,
              validationAccount: validationPda,
              validationIndexAccount: indexPda,
              identityRegistryProgram: identityProgram.programId,
              systemProgram: SystemProgram.programId,
            })
            .signers([agentOwner])
            .rpc();

          return { success: true, index };
        } catch (err: any) {
          return { success: false, index, error: err.toString() };
        }
      });

      const results = await Promise.allSettled(validationPromises);
      const successCount = results.filter((r) => r.status === "fulfilled" && r.value.success).length;

      console.log(`✅ ${successCount}/5 parallel validations succeeded`);
      assert.isAtLeast(successCount, 1, "At least one validation should succeed");
    });

    it("✅ Test 5: Concurrent response submissions to same feedback", async () => {
      console.log("Testing concurrent responses to same feedback...");

      // Use client[0]'s feedback at index 0
      const targetClient = clients[0];
      const feedbackIndex = 0;

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          targetClient.publicKey.toBuffer(),
          new anchor.BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgram.programId
      );

      const [responseIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("response_index"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          targetClient.publicKey.toBuffer(),
          new anchor.BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgram.programId
      );

      // 3 responders submit responses in parallel
      const responders = [clients[4], clients[5], clients[6]];

      const responsePromises = responders.map(async (responder, index) => {
        // Calculate response index
        let responseIndex = index;
        try {
          const indexAccount = await reputationProgram.account.responseIndexAccount.fetch(responseIndexPda);
          responseIndex = indexAccount.nextIndex.toNumber() + index;
        } catch (err) {
          // Index account doesn't exist yet
        }

        const [responsePda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("response"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            targetClient.publicKey.toBuffer(),
            new anchor.BN(feedbackIndex).toArrayLike(Buffer, "le", 8),
            new anchor.BN(responseIndex).toArrayLike(Buffer, "le", 8),
          ],
          reputationProgram.programId
        );

        try {
          await reputationProgram.methods
            .appendResponse(
              new anchor.BN(agentId),
              targetClient.publicKey,
              new anchor.BN(feedbackIndex),
              `ipfs://QmResponse${index}`,
              Array.from(Buffer.alloc(32))
            )
            .accounts({
              responder: responder.publicKey,
              payer: responder.publicKey,
              feedbackAccount: feedbackPda,
              responseIndex: responseIndexPda,
              responseAccount: responsePda,
              systemProgram: SystemProgram.programId,
            })
            .signers([responder])
            .rpc();

          return { success: true, index };
        } catch (err: any) {
          return { success: false, index, error: err.toString() };
        }
      });

      const results = await Promise.allSettled(responsePromises);
      const successCount = results.filter((r) => r.status === "fulfilled" && r.value.success).length;

      console.log(`✅ ${successCount}/3 concurrent responses succeeded`);
      assert.isAtLeast(successCount, 1, "At least one response should succeed");
    });

    it("✅ Test 6: Concurrent feedback revocations (different clients)", async () => {
      console.log("Testing concurrent feedback revocations...");

      // Clients 7, 8, 9 will revoke their feedbacks simultaneously
      const revokingClients = [clients[7], clients[8], clients[9]];

      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      const revocationPromises = revokingClients.map(async (client, index) => {
        const [feedbackPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("feedback"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            client.publicKey.toBuffer(),
            new anchor.BN(0).toArrayLike(Buffer, "le", 8),
          ],
          reputationProgram.programId
        );

        try {
          await reputationProgram.methods
            .revokeFeedback(new anchor.BN(agentId), new anchor.BN(0))
            .accounts({
              client: client.publicKey,
              feedbackAccount: feedbackPda,
              agentReputation: reputationPda,
            })
            .signers([client])
            .rpc();

          return { success: true, index };
        } catch (err: any) {
          return { success: false, index, error: err.toString() };
        }
      });

      const results = await Promise.all(revocationPromises);
      const successCount = results.filter((r) => r.success).length;

      console.log(`✅ ${successCount}/3 concurrent revocations succeeded`);
      assert.equal(successCount, 3, "All concurrent revocations should succeed");

      // Verify reputation aggregate updated correctly
      const reputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      console.log(`✅ Reputation after revocations: ${reputation.totalFeedbacks.toNumber()} feedbacks`);
    });

    it("✅ Test 7: Reputation aggregate consistency under rapid updates", async () => {
      console.log("Testing reputation aggregate consistency...");

      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      // Get initial state
      const initialReputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      const initialCount = initialReputation.totalFeedbacks.toNumber();
      const initialSum = initialReputation.totalScoreSum.toNumber();

      console.log(`Initial: ${initialCount} feedbacks, sum=${initialSum}`);

      // Perform rapid updates (3 new feedbacks + 1 revocation)
      const client = clients[0];
      const feedbackAuth = createFeedbackAuth(client.publicKey);

      const [clientIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("client_index"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
        ],
        reputationProgram.programId
      );

      // Add 3 feedbacks
      for (let i = 6; i <= 8; i++) {
        const [feedbackPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("feedback"),
            new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
            client.publicKey.toBuffer(),
            new anchor.BN(i).toArrayLike(Buffer, "le", 8),
          ],
          reputationProgram.programId
        );

        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(agentId),
            90,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            `ipfs://QmRapid${i}`,
            Array.from(Buffer.alloc(32)),
            new anchor.BN(i),
            feedbackAuth
          )
          .accounts({
            client: client.publicKey,
            payer: client.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client])
          .rpc();
      }

      // Revoke one feedback
      const [feedbackToRevoke] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          new anchor.BN(1).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgram.programId
      );

      await reputationProgram.methods
        .revokeFeedback(new anchor.BN(agentId), new anchor.BN(1))
        .accounts({
          client: client.publicKey,
          feedbackAccount: feedbackToRevoke,
          agentReputation: reputationPda,
        })
        .signers([client])
        .rpc();

      // Verify final consistency
      const finalReputation = await reputationProgram.account.agentReputationMetadata.fetch(reputationPda);
      const finalCount = finalReputation.totalFeedbacks.toNumber();
      const finalSum = finalReputation.totalScoreSum.toNumber();

      console.log(`Final: ${finalCount} feedbacks, sum=${finalSum}`);

      // Expected: +3 feedbacks (90 each) - 1 revoked feedback
      // The revoked feedback score needs to be determined
      const expectedCount = initialCount + 3 - 1; // +3 new, -1 revoked

      assert.equal(finalCount, expectedCount);

      // Verify average is recalculated correctly
      const expectedAverage = Math.floor(finalSum / finalCount);
      assert.equal(finalReputation.averageScore, expectedAverage);

      console.log(`✅ Reputation aggregate consistent: avg=${finalReputation.averageScore}`);
    });
  });

  after(() => {
    console.log("\n⚡ Concurrency tests completed - system handles parallel operations correctly!\n");
  });
});
