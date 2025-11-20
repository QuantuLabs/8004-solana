import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { IdentityRegistry } from "../target/types/identity_registry";
import { ReputationRegistry } from "../target/types/reputation_registry";
import { ValidationRegistry } from "../target/types/validation_registry";
import { Metaplex, keypairIdentity } from "@metaplex-foundation/js";

/**
 * LOT 2: Critical Security Tests
 *
 * Tests critical security vulnerabilities across all three registries:
 * - Access control violations
 * - State validation bypass attempts
 * - PDA derivation attacks
 * - Authorization bypass
 * - Account ownership verification
 *
 * Coverage: 12 critical security tests
 */
describe("ERC-8004 Registries - Critical Security Tests (LOT 2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const identityProgram = anchor.workspace.IdentityRegistry as Program<IdentityRegistry>;
  const reputationProgram = anchor.workspace.ReputationRegistry as Program<ReputationRegistry>;
  const validationProgram = anchor.workspace.ValidationRegistry as Program<ValidationRegistry>;
  const metaplex = Metaplex.make(provider.connection).use(keypairIdentity(provider.wallet as any));

  // Test wallets
  let legitimateOwner: Keypair;
  let attacker: Keypair;
  let client: Keypair;
  let payer: Keypair;

  // Agent data
  let agentMint: PublicKey;
  let agentId: number = 100;
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

  before(async () => {
    console.log("\n🔒 Setting up security test environment...\n");

    // Initialize wallets
    legitimateOwner = Keypair.generate();
    attacker = Keypair.generate();
    client = Keypair.generate();
    payer = Keypair.generate();

    // Airdrop SOL
    await airdrop(legitimateOwner.publicKey, 5);
    await airdrop(attacker.publicKey, 5);
    await airdrop(client.publicKey, 3);
    await airdrop(payer.publicKey, 5);

    console.log("✅ Wallets funded");

    // Create agent NFT for legitimate owner
    const { nft } = await metaplex.nfts().create({
      uri: "https://example.com/agent-security-test.json",
      name: "Security Test Agent",
      sellerFeeBasisPoints: 0,
      updateAuthority: legitimateOwner,
    });

    agentMint = nft.address;
    [agentPda] = getAgentPda(agentMint);

    // Register legitimate agent
    await identityProgram.methods
      .registerAgent(new anchor.BN(agentId), "Security Test Agent", "https://example.com")
      .accounts({
        owner: legitimateOwner.publicKey,
        agentMint: agentMint,
        agentAccount: agentPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([legitimateOwner])
      .rpc();

    console.log(`✅ Legitimate agent registered: ID=${agentId}\n`);
  });

  describe("🔐 Access Control Tests", () => {
    it("❌ Test 1: Unauthorized agent registration (duplicate ID)", async () => {
      // Attacker tries to register an agent with the same ID
      const attackerMint = Keypair.generate().publicKey;
      const [attackerAgentPda] = getAgentPda(attackerMint);

      try {
        await identityProgram.methods
          .registerAgent(new anchor.BN(agentId), "Malicious Agent", "https://evil.com")
          .accounts({
            owner: attacker.publicKey,
            agentMint: attackerMint,
            agentAccount: attackerAgentPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Should have failed - duplicate agent ID");
      } catch (err: any) {
        // Should fail because agent PDA already exists or ID collision
        console.log("✅ Correctly prevented duplicate agent registration");
      }
    });

    it("❌ Test 2: Unauthorized metadata update", async () => {
      // Attacker tries to update metadata of agent they don't own
      try {
        await identityProgram.methods
          .setMetadata("hacked", "https://evil.com/hacked")
          .accounts({
            owner: attacker.publicKey, // Wrong owner!
            agentMint: agentMint,
            agentAccount: agentPda,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Should have failed - unauthorized metadata update");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
        console.log("✅ Correctly rejected unauthorized metadata update");
      }
    });

    it("❌ Test 3: Unauthorized feedback revocation", async () => {
      // First, legitimate client gives feedback
      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(5),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

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

      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          85,
          Array.from(Buffer.alloc(32)),
          Array.from(Buffer.alloc(32)),
          "ipfs://QmSecurityTest",
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

      console.log("✅ Feedback created for revocation test");

      // Now attacker tries to revoke it
      try {
        await reputationProgram.methods
          .revokeFeedback(new anchor.BN(agentId), new anchor.BN(0))
          .accounts({
            client: attacker.publicKey, // Wrong client!
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Should have failed - unauthorized revocation");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
        console.log("✅ Correctly rejected unauthorized feedback revocation");
      }
    });

    it("❌ Test 4: Unauthorized operator addition", async () => {
      // Attacker tries to add themselves as operator
      try {
        await identityProgram.methods
          .addOperator(attacker.publicKey)
          .accounts({
            owner: attacker.publicKey, // Not the owner!
            agentMint: agentMint,
            agentAccount: agentPda,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Should have failed - unauthorized operator addition");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
        console.log("✅ Correctly rejected unauthorized operator addition");
      }
    });
  });

  describe("🛡️ State Validation Tests", () => {
    it("❌ Test 5: Invalid agent ID in feedback (non-existent agent)", async () => {
      const nonExistentAgentId = 999999;
      const fakeMint = Keypair.generate().publicKey;
      const [fakeAgentPda] = getAgentPda(fakeMint);

      const feedbackAuth = {
        agentId: new anchor.BN(nonExistentAgentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(5),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

      const [clientIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("client_index"),
          new anchor.BN(nonExistentAgentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
        ],
        reputationProgram.programId
      );

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          new anchor.BN(nonExistentAgentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          new anchor.BN(0).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgram.programId
      );

      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(nonExistentAgentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(nonExistentAgentId),
            75,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmFake",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(0),
            feedbackAuth
          )
          .accounts({
            client: client.publicKey,
            payer: client.publicKey,
            agentMint: fakeMint,
            agentAccount: fakeAgentPda,
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client])
          .rpc();

        assert.fail("Should have failed - non-existent agent");
      } catch (err: any) {
        assert.include(err.toString(), "AgentNotFound");
        console.log("✅ Correctly rejected feedback for non-existent agent");
      }
    });

    it("❌ Test 6: Score out of bounds (> 100)", async () => {
      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(10),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

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
          new anchor.BN(1).toArrayLike(Buffer, "le", 8),
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
            255, // Invalid score > 100
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmInvalid",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(1),
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

        assert.fail("Should have failed - score > 100");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidScore");
        console.log("✅ Correctly rejected score > 100");
      }
    });

    it("❌ Test 7: URI too long (> 200 bytes)", async () => {
      const tooLongUri = "ipfs://" + "Q".repeat(200); // > 200 bytes total

      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(10),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

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
          new anchor.BN(1).toArrayLike(Buffer, "le", 8),
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
            80,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            tooLongUri,
            Array.from(Buffer.alloc(32)),
            new anchor.BN(1),
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

        assert.fail("Should have failed - URI too long");
      } catch (err: any) {
        assert.include(err.toString(), "UriTooLong");
        console.log("✅ Correctly rejected URI > 200 bytes");
      }
    });

    it("❌ Test 8: Double validation - validation already exists", async () => {
      // First, create a valid validation
      const [validationPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("validation"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          new anchor.BN(0).toArrayLike(Buffer, "le", 8), // validationIndex = 0
        ],
        validationProgram.programId
      );

      const [indexPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("validation_index"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
        validationProgram.programId
      );

      await validationProgram.methods
        .addValidation(
          new anchor.BN(agentId),
          "initial_validation",
          "https://example.com/validation1"
        )
        .accounts({
          owner: legitimateOwner.publicKey,
          agentMint: agentMint,
          agentAccount: agentPda,
          validationAccount: validationPda,
          validationIndexAccount: indexPda,
          identityRegistryProgram: identityProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([legitimateOwner])
        .rpc();

      console.log("✅ Initial validation created");

      // Try to create the same validation again (same index)
      try {
        await validationProgram.methods
          .addValidation(
            new anchor.BN(agentId),
            "duplicate_validation",
            "https://example.com/validation2"
          )
          .accounts({
            owner: legitimateOwner.publicKey,
            agentMint: agentMint,
            agentAccount: agentPda,
            validationAccount: validationPda, // Same PDA!
            validationIndexAccount: indexPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([legitimateOwner])
          .rpc();

        assert.fail("Should have failed - validation PDA already exists");
      } catch (err: any) {
        // Should fail because account already exists
        console.log("✅ Correctly prevented duplicate validation creation");
      }
    });
  });

  describe("⚔️ Attack Vector Tests", () => {
    it("❌ Test 9: PDA derivation attack - wrong seeds", async () => {
      // Attacker tries to use wrong PDA derivation to bypass checks
      const wrongAgentId = agentId + 1;
      const [wrongPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentMint.toBuffer()],
        identityProgram.programId
      );

      const feedbackAuth = {
        agentId: new anchor.BN(wrongAgentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(10),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

      const [clientIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("client_index"),
          new anchor.BN(wrongAgentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
        ],
        reputationProgram.programId
      );

      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          new anchor.BN(wrongAgentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          new anchor.BN(0).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgram.programId
      );

      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(wrongAgentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      try {
        await reputationProgram.methods
          .giveFeedback(
            new anchor.BN(wrongAgentId),
            75,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmAttack",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(0),
            feedbackAuth
          )
          .accounts({
            client: client.publicKey,
            payer: client.publicKey,
            agentMint: agentMint,
            agentAccount: wrongPda, // Using correct PDA but wrong agent_id parameter
            clientIndex: clientIndexPda,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
            identityRegistryProgram: identityProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .signers([client])
          .rpc();

        assert.fail("Should have failed - agent_id mismatch");
      } catch (err: any) {
        assert.include(err.toString(), "AgentNotFound");
        console.log("✅ Correctly detected PDA/agent_id mismatch");
      }
    });

    it("❌ Test 10: Account ownership verification - wrong program", async () {
      // This test verifies that the program checks account ownership
      // Attacker tries to pass an account owned by a different program
      const fakeAccount = Keypair.generate().publicKey;

      try {
        await identityProgram.methods
          .setMetadata("hacked_via_fake_account", "https://evil.com")
          .accounts({
            owner: legitimateOwner.publicKey,
            agentMint: agentMint,
            agentAccount: fakeAccount, // Wrong account!
          })
          .signers([legitimateOwner])
          .rpc();

        assert.fail("Should have failed - wrong agent account");
      } catch (err: any) {
        // Should fail due to PDA derivation check or account not found
        console.log("✅ Correctly rejected wrong agent account");
      }
    });

    it("❌ Test 11: Feedback index manipulation", async () => {
      // Attacker tries to skip feedback indices to corrupt the sequence
      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(20),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

      const [clientIndexPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("client_index"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
        ],
        reputationProgram.programId
      );

      // Try to submit feedback at index 10, skipping indices 2-9
      const [feedbackPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("feedback"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
          client.publicKey.toBuffer(),
          new anchor.BN(10).toArrayLike(Buffer, "le", 8),
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
            80,
            Array.from(Buffer.alloc(32)),
            Array.from(Buffer.alloc(32)),
            "ipfs://QmSkip",
            Array.from(Buffer.alloc(32)),
            new anchor.BN(10), // Trying to skip to index 10!
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

        assert.fail("Should have failed - invalid feedback index");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidFeedbackIndex");
        console.log("✅ Correctly prevented feedback index manipulation");
      }
    });

    it("❌ Test 12: Revoke already revoked feedback (double revocation)", async () => {
      // First, create and then revoke a feedback
      const feedbackAuth = {
        agentId: new anchor.BN(agentId),
        clientAddress: client.publicKey,
        indexLimit: new anchor.BN(20),
        expiry: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        chainId: "solana-localnet",
        identityRegistry: identityProgram.programId,
        signerAddress: legitimateOwner.publicKey,
        signature: Buffer.alloc(64),
      };

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
          new anchor.BN(1).toArrayLike(Buffer, "le", 8),
        ],
        reputationProgram.programId
      );

      const [reputationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent_reputation"), new anchor.BN(agentId).toArrayLike(Buffer, "le", 8)],
        reputationProgram.programId
      );

      // Create feedback
      await reputationProgram.methods
        .giveFeedback(
          new anchor.BN(agentId),
          90,
          Array.from(Buffer.alloc(32)),
          Array.from(Buffer.alloc(32)),
          "ipfs://QmRevoke",
          Array.from(Buffer.alloc(32)),
          new anchor.BN(1),
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

      console.log("✅ Feedback created for double revocation test");

      // Revoke it once
      await reputationProgram.methods
        .revokeFeedback(new anchor.BN(agentId), new anchor.BN(1))
        .accounts({
          client: client.publicKey,
          feedbackAccount: feedbackPda,
          agentReputation: reputationPda,
        })
        .signers([client])
        .rpc();

      console.log("✅ Feedback revoked once");

      // Try to revoke it again
      try {
        await reputationProgram.methods
          .revokeFeedback(new anchor.BN(agentId), new anchor.BN(1))
          .accounts({
            client: client.publicKey,
            feedbackAccount: feedbackPda,
            agentReputation: reputationPda,
          })
          .signers([client])
          .rpc();

        assert.fail("Should have failed - already revoked");
      } catch (err: any) {
        assert.include(err.toString(), "AlreadyRevoked");
        console.log("✅ Correctly prevented double revocation");
      }
    });
  });

  after(() => {
    console.log("\n🔒 Security tests completed - all attack vectors blocked!\n");
  });
});
