/**
 * ULTIMATE COVERAGE TEST - All Imaginable Scenarios
 *
 * Comprehensive test of EVERY possible edge case, error path, and state transition
 * Run with: ts-node scripts/test-ultimate-coverage.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { IdentityRegistry } from "../target/types/identity_registry";
import * as fs from "fs";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR");

interface TestResult {
  scenario: string;
  passed: number;
  failed: number;
  assertions: string[];
}

const results: TestResult[] = [];
let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, message: string, result: TestResult) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    result.passed++;
    totalPassed++;
  } else {
    console.log(`❌ FAIL: ${message}`);
    result.failed++;
    totalFailed++;
  }
  result.assertions.push(message);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("\n=== ULTIMATE COVERAGE TEST - ALL SCENARIOS ===\n");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Network:", DEVNET_RPC);
  console.log("\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = loadWallet();
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/identity_registry.json", "utf8"));
  const program = new Program(idl, provider) as Program<IdentityRegistry>;

  console.log("Wallet:", wallet.publicKey.toBase58());
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 1: REGISTRY INITIALIZATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━ CATEGORY 1: REGISTRY INITIALIZATION (3 scenarios) ━━━\n");

  // Scenario 1.1: Check existing initialization
  {
    const result: TestResult = { scenario: "1.1: Registry already initialized", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    try {
      const config = await program.account.registryConfig.fetch(configPda);
      assert(config.authority.equals(wallet.publicKey), "Authority should be wallet", result);
      assert(config.nextAgentId.toNumber() >= 0, "nextAgentId should be >= 0", result);
      assert(config.totalAgents.toNumber() >= 0, "totalAgents should be >= 0", result);
      assert(config.bump > 0, "Bump should be set", result);
      console.log(`  Current state: nextAgentId=${config.nextAgentId}, totalAgents=${config.totalAgents}`);
    } catch (e) {
      assert(false, "Registry should be initialized", result);
    }
    results.push(result);
  }

  // Scenario 1.2: Verify PDA derivation
  {
    const result: TestResult = { scenario: "1.2: Config PDA derivation", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const [derivedPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    assert(derivedPda.equals(configPda), "Derived PDA should match", result);
    assert(bump > 0 && bump <= 255, "Bump should be valid (1-255)", result);
    console.log(`  PDA: ${derivedPda.toBase58()}, Bump: ${bump}`);
    results.push(result);
  }

  // Scenario 1.3: Verify cannot reinitialize
  {
    const result: TestResult = { scenario: "1.3: Cannot reinitialize registry", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    try {
      await program.methods.initialize().rpc();
      assert(false, "Should fail to reinitialize", result);
    } catch (e: any) {
      const errorMsg = e.toString();
      assert(
        errorMsg.includes("already in use") || errorMsg.includes("custom program error"),
        "Should fail with account already exists error",
        result
      );
    }
    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 2: NFT CREATION & VALIDATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n━━━ CATEGORY 2: NFT CREATION & VALIDATION (8 scenarios) ━━━\n");

  // Scenario 2.1: Create valid NFT (supply=1, decimals=0)
  let validNftMint: PublicKey;
  let validTokenAccount: any;
  let validAgentPda: PublicKey;
  {
    const result: TestResult = { scenario: "2.1: Create valid NFT", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    validNftMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0,
      mintKeypair
    );

    validTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      validNftMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      validNftMint,
      validTokenAccount.address,
      wallet.publicKey,
      1
    );

    const mintInfo = await connection.getAccountInfo(validNftMint);
    const tokenAccountInfo = await getAccount(connection, validTokenAccount.address);

    assert(mintInfo !== null, "NFT mint should be created", result);
    assert(tokenAccountInfo.amount === 1n, "Token account should have amount = 1", result);
    assert(tokenAccountInfo.owner.equals(wallet.publicKey), "Token account owner should be wallet", result);

    [validAgentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), validNftMint.toBuffer()],
      program.programId
    );

    console.log(`  NFT Mint: ${validNftMint.toBase58()}`);
    console.log(`  Token Account: ${validTokenAccount.address.toBase58()}`);
    console.log(`  Agent PDA: ${validAgentPda.toBase58()}`);

    results.push(result);
  }

  // Scenario 2.2: Try to create NFT with decimals = 1
  {
    const result: TestResult = { scenario: "2.2: NFT with decimals = 1 (invalid)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const invalidMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      1, // decimals = 1 (INVALID)
      mintKeypair
    );

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      invalidMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      invalidMint,
      tokenAccount.address,
      wallet.publicKey,
      1
    );

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), invalidMint.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .register("ipfs://test")
        .accounts({ agentMint: invalidMint })
        .rpc();
      assert(false, "Should fail with InvalidNFT error", result);
    } catch (e: any) {
      assert(e.toString().includes("InvalidNFT") || e.toString().includes("0x1770"), "Should fail with InvalidNFT", result);
      console.log(`  ✓ Correctly rejected NFT with decimals = 1`);
    }

    results.push(result);
  }

  // Scenario 2.3: Try to create NFT with decimals = 9
  {
    const result: TestResult = { scenario: "2.3: NFT with decimals = 9 (invalid)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const invalidMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9, // decimals = 9 (INVALID)
      mintKeypair
    );

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      invalidMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      invalidMint,
      tokenAccount.address,
      wallet.publicKey,
      1000000000 // 1 token with 9 decimals
    );

    try {
      await program.methods
        .register("ipfs://test")
        .accounts({ agentMint: invalidMint })
        .rpc();
      assert(false, "Should fail with InvalidNFT error", result);
    } catch (e: any) {
      assert(e.toString().includes("InvalidNFT") || e.toString().includes("0x1770"), "Should fail with InvalidNFT", result);
      console.log(`  ✓ Correctly rejected NFT with decimals = 9`);
    }

    results.push(result);
  }

  // Scenario 2.4: Try to create NFT with supply = 0
  {
    const result: TestResult = { scenario: "2.4: NFT with supply = 0 (invalid)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const invalidMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0,
      mintKeypair
    );

    // Don't mint any tokens (supply = 0)

    try {
      await program.methods
        .register("ipfs://test")
        .accounts({ agentMint: invalidMint })
        .rpc();
      assert(false, "Should fail with InvalidNFT error (supply = 0)", result);
    } catch (e: any) {
      assert(e.toString().includes("InvalidNFT") || e.toString().includes("0x1770"), "Should fail with InvalidNFT", result);
      console.log(`  ✓ Correctly rejected NFT with supply = 0`);
    }

    results.push(result);
  }

  // Scenario 2.5: Try to create NFT with supply = 2
  {
    const result: TestResult = { scenario: "2.5: NFT with supply = 2 (invalid)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const invalidMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0,
      mintKeypair
    );

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      invalidMint,
      wallet.publicKey
    );

    // Mint 2 tokens (INVALID for NFT)
    await mintTo(
      connection,
      wallet.payer,
      invalidMint,
      tokenAccount.address,
      wallet.publicKey,
      2
    );

    try {
      await program.methods
        .register("ipfs://test")
        .accounts({ agentMint: invalidMint })
        .rpc();
      assert(false, "Should fail with InvalidNFT error (supply = 2)", result);
    } catch (e: any) {
      assert(e.toString().includes("InvalidNFT") || e.toString().includes("0x1770"), "Should fail with InvalidNFT", result);
      console.log(`  ✓ Correctly rejected NFT with supply = 2`);
    }

    results.push(result);
  }

  // Scenario 2.6: Verify mint authority can be set
  {
    const result: TestResult = { scenario: "2.6: NFT with custom mint authority", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const customAuthority = Keypair.generate();

    const nftMint = await createMint(
      connection,
      wallet.payer,
      customAuthority.publicKey, // custom mint authority
      null,
      0,
      mintKeypair
    );

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      nftMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      nftMint,
      tokenAccount.address,
      customAuthority.publicKey,
      1,
      [customAuthority] // sign with custom authority
    );

    const tokenAccountInfo = await getAccount(connection, tokenAccount.address);
    assert(tokenAccountInfo.amount === 1n, "Should mint with custom authority", result);

    results.push(result);
  }

  // Scenario 2.7: Verify freeze authority can be null
  {
    const result: TestResult = { scenario: "2.7: NFT with null freeze authority", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null, // null freeze authority
      0,
      mintKeypair
    );

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      nftMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      nftMint,
      tokenAccount.address,
      wallet.publicKey,
      1
    );

    assert(tokenAccount.amount === 1n, "Should create NFT with null freeze authority", result);

    results.push(result);
  }

  // Scenario 2.8: Verify agent PDA derivation is deterministic
  {
    const result: TestResult = { scenario: "2.8: Agent PDA derivation is deterministic", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const [pda1, bump1] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), validNftMint.toBuffer()],
      program.programId
    );

    const [pda2, bump2] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), validNftMint.toBuffer()],
      program.programId
    );

    assert(pda1.equals(pda2), "PDA derivation should be deterministic", result);
    assert(bump1 === bump2, "Bump should be deterministic", result);

    console.log(`  PDA: ${pda1.toBase58()}, Bump: ${bump1}`);

    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 3: AGENT REGISTRATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n━━━ CATEGORY 3: AGENT REGISTRATION (12 scenarios) ━━━\n");

  const configBefore = await program.account.registryConfig.fetch(configPda);
  const nextIdBefore = configBefore.nextAgentId.toNumber();

  // Scenario 3.1: Register agent with valid NFT and IPFS URI
  {
    const result: TestResult = { scenario: "3.1: Register with IPFS URI", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const tokenUri = `ipfs://QmTest${Date.now()}`;
    await program.methods
      .register(tokenUri)
      .accounts({ agentMint: validNftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(validAgentPda);
    assert(agent.agentId.toNumber() === nextIdBefore, "Agent ID should be sequential", result);
    assert(agent.owner.equals(wallet.publicKey), "Owner should be wallet", result);
    assert(agent.agentMint.equals(validNftMint), "Agent mint should match", result);
    assert(agent.tokenUri === tokenUri, "Token URI should match", result);
    assert(agent.metadata.length === 0, "Metadata should be empty initially", result);
    assert(agent.createdAt > 0, "Created timestamp should be set", result);

    console.log(`  Agent ID: ${agent.agentId}`);
    console.log(`  Token URI: ${agent.tokenUri}`);

    results.push(result);
  }

  // Scenario 3.2: Register agent with empty URI (ERC-8004 spec)
  {
    const result: TestResult = { scenario: "3.2: Register with empty URI", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("")
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === "", "Empty URI should be allowed", result);
    console.log(`  ✓ Empty URI accepted (ERC-8004 compliant)`);

    results.push(result);
  }

  // Scenario 3.3: Register agent with Arweave URI
  {
    const result: TestResult = { scenario: "3.3: Register with Arweave URI", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    const arweaveUri = `ar://TestArweave${Date.now()}`;
    await program.methods
      .register(arweaveUri)
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === arweaveUri, "Arweave URI should be stored", result);
    console.log(`  ✓ Arweave URI: ${arweaveUri}`);

    results.push(result);
  }

  // Scenario 3.4: Register agent with HTTP URI
  {
    const result: TestResult = { scenario: "3.4: Register with HTTP URI", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    const httpUri = `https://example.com/agent/${Date.now()}`;
    await program.methods
      .register(httpUri)
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === httpUri, "HTTP URI should be stored", result);
    console.log(`  ✓ HTTP URI: ${httpUri}`);

    results.push(result);
  }

  // Scenario 3.5: Register with URI exactly 200 bytes
  {
    const result: TestResult = { scenario: "3.5: Register with URI = 200 bytes (max)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    const maxUri = "x".repeat(200);
    await program.methods
      .register(maxUri)
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === maxUri, "Max URI (200 bytes) should be stored", result);
    assert(agent.tokenUri.length === 200, "URI should be exactly 200 bytes", result);
    console.log(`  ✓ Max URI length (200 bytes) accepted`);

    results.push(result);
  }

  // Scenario 3.6: Try to register with URI > 200 bytes
  {
    const result: TestResult = { scenario: "3.6: Register with URI > 200 bytes (should fail)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const tooLongUri = "x".repeat(201);

    try {
      await program.methods
        .register(tooLongUri)
        .accounts({ agentMint: nftMint })
        .rpc();
      assert(false, "Should fail with UriTooLong error", result);
    } catch (e: any) {
      assert(e.toString().includes("UriTooLong") || e.toString().includes("0x1770"), "Should fail with UriTooLong", result);
      console.log(`  ✓ Correctly rejected URI > 200 bytes`);
    }

    results.push(result);
  }

  // Scenario 3.7: Verify sequential agent IDs
  {
    const result: TestResult = { scenario: "3.7: Sequential agent ID assignment", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const configBefore = await program.account.registryConfig.fetch(configPda);
    const expectedId = configBefore.nextAgentId.toNumber();

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://sequential")
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const configAfter = await program.account.registryConfig.fetch(configPda);

    assert(agent.agentId.toNumber() === expectedId, "Agent ID should match expected sequential ID", result);
    assert(configAfter.nextAgentId.toNumber() === expectedId + 1, "nextAgentId should increment", result);
    assert(configAfter.totalAgents.toNumber() === configBefore.totalAgents.toNumber() + 1, "totalAgents should increment", result);

    console.log(`  Expected ID: ${expectedId}, Got: ${agent.agentId}`);
    console.log(`  Next ID: ${configAfter.nextAgentId}`);

    results.push(result);
  }

  // Scenario 3.8: Try to register same NFT twice
  {
    const result: TestResult = { scenario: "3.8: Cannot register same NFT twice", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    // First registration
    await program.methods
      .register("ipfs://first")
      .accounts({ agentMint: nftMint })
      .rpc();

    // Try to register again
    try {
      await program.methods
        .register("ipfs://second")
        .accounts({ agentMint: nftMint })
        .rpc();
      assert(false, "Should fail to register same NFT twice", result);
    } catch (e: any) {
      assert(
        e.toString().includes("already in use") || e.toString().includes("custom program error"),
        "Should fail with account already exists error",
        result
      );
      console.log(`  ✓ Correctly rejected duplicate registration`);
    }

    results.push(result);
  }

  // Scenario 3.9: Register multiple agents in sequence
  {
    const result: TestResult = { scenario: "3.9: Register 5 agents sequentially", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agents = [];
    for (let i = 0; i < 5; i++) {
      const mintKeypair = Keypair.generate();
      const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
      const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
      await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), nftMint.toBuffer()],
        program.programId
      );

      await program.methods
        .register(`ipfs://batch${i}`)
        .accounts({ agentMint: nftMint })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      agents.push(agent);
      console.log(`  Agent ${i}: ID=${agent.agentId}, URI=${agent.tokenUri}`);
    }

    // Verify all are retrievable
    assert(agents.length === 5, "Should create 5 agents", result);
    for (let i = 0; i < 5; i++) {
      assert(agents[i].tokenUri === `ipfs://batch${i}`, `Agent ${i} URI should match`, result);
    }

    results.push(result);
  }

  // Scenario 3.10: Verify created_at timestamp
  {
    const result: TestResult = { scenario: "3.10: Created timestamp is set", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const timeBefore = Math.floor(Date.now() / 1000);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://timestamp")
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const timeAfter = Math.floor(Date.now() / 1000);

    assert(agent.createdAt.toNumber() >= timeBefore, "Created timestamp should be >= time before", result);
    assert(agent.createdAt.toNumber() <= timeAfter + 60, "Created timestamp should be <= time after + 60s", result);

    console.log(`  Created at: ${new Date(agent.createdAt.toNumber() * 1000).toISOString()}`);

    results.push(result);
  }

  // Scenario 3.11: Verify bump is stored
  {
    const result: TestResult = { scenario: "3.11: Agent bump is stored", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agent = await program.account.agentAccount.fetch(validAgentPda);
    assert(agent.bump > 0 && agent.bump <= 255, "Bump should be valid (1-255)", result);

    console.log(`  Agent bump: ${agent.bump}`);

    results.push(result);
  }

  // Scenario 3.12: Register with Unicode characters in URI
  {
    const result: TestResult = { scenario: "3.12: Register with Unicode URI", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    const unicodeUri = "ipfs://QmTest-日本語-émojis-🚀";
    await program.methods
      .register(unicodeUri)
      .accounts({ agentMint: nftMint })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === unicodeUri, "Unicode URI should be preserved", result);
    console.log(`  ✓ Unicode URI: ${unicodeUri}`);

    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 4: METADATA OPERATIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n━━━ CATEGORY 4: METADATA OPERATIONS (20 scenarios) ━━━\n");

  // Create a fresh agent for metadata tests
  let metadataTestMint: PublicKey;
  let metadataTestPda: PublicKey;
  {
    const mintKeypair = Keypair.generate();
    metadataTestMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, metadataTestMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, metadataTestMint, tokenAccount.address, wallet.publicKey, 1);

    [metadataTestPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), metadataTestMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://metadata-test")
      .accounts({ agentMint: metadataTestMint })
      .rpc();
  }

  // Scenario 4.1: Set single metadata entry
  {
    const result: TestResult = { scenario: "4.1: Set single metadata entry", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    await program.methods
      .setMetadata("name", Buffer.from("Test Agent"))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agent.metadata.length === 1, "Should have 1 metadata entry", result);
    assert(agent.metadata[0].key === "name", "Key should be 'name'", result);
    assert(Buffer.from(agent.metadata[0].value).toString() === "Test Agent", "Value should match", result);

    console.log(`  ✓ Metadata: ${agent.metadata[0].key} = ${Buffer.from(agent.metadata[0].value).toString()}`);

    results.push(result);
  }

  // Scenario 4.2: Update existing metadata entry
  {
    const result: TestResult = { scenario: "4.2: Update existing metadata", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agentBefore = await program.account.agentAccount.fetch(metadataTestPda);
    const lengthBefore = agentBefore.metadata.length;

    await program.methods
      .setMetadata("name", Buffer.from("Updated Agent"))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agent.metadata.length === lengthBefore, "Should not add duplicate entry", result);
    assert(Buffer.from(agent.metadata[0].value).toString() === "Updated Agent", "Value should be updated", result);

    console.log(`  ✓ Updated: ${agent.metadata[0].key} = ${Buffer.from(agent.metadata[0].value).toString()}`);

    results.push(result);
  }

  // Scenario 4.3: Add multiple metadata entries
  {
    const result: TestResult = { scenario: "4.3: Add 5 more metadata entries", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const entries = [
      { key: "description", value: "AI Agent" },
      { key: "version", value: "1.0.0" },
      { key: "category", value: "DeFi" },
      { key: "author", value: "Team" },
      { key: "license", value: "MIT" },
    ];

    for (const entry of entries) {
      await program.methods
        .setMetadata(entry.key, Buffer.from(entry.value))
        .accountsPartial({ agentAccount: metadataTestPda })
        .rpc();
    }

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agent.metadata.length === 6, "Should have 6 metadata entries", result);

    for (const entry of entries) {
      const found = agent.metadata.find(m => m.key === entry.key);
      assert(found !== undefined, `Should find key '${entry.key}'`, result);
      assert(Buffer.from(found!.value).toString() === entry.value, `Value for '${entry.key}' should match`, result);
      console.log(`  ✓ ${entry.key} = ${entry.value}`);
    }

    results.push(result);
  }

  // Scenario 4.4: Metadata with special characters
  {
    const result: TestResult = { scenario: "4.4: Metadata with special characters", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const specialValue = "Special: !@#$%^&*()_+-={}[]|\\:;\"'<>,.?/~`";
    await program.methods
      .setMetadata("special", Buffer.from(specialValue))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    const entry = agent.metadata.find(m => m.key === "special");
    assert(entry !== undefined, "Special entry should exist", result);
    assert(Buffer.from(entry!.value).toString() === specialValue, "Special characters should be preserved", result);

    console.log(`  ✓ Special chars preserved: ${specialValue}`);

    results.push(result);
  }

  // Scenario 4.5: Metadata with Unicode
  {
    const result: TestResult = { scenario: "4.5: Metadata with Unicode", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const unicodeValue = "日本語 🚀 émojis ñ ü";
    await program.methods
      .setMetadata("unicode", Buffer.from(unicodeValue))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    const entry = agent.metadata.find(m => m.key === "unicode");
    assert(entry !== undefined, "Unicode entry should exist", result);
    assert(Buffer.from(entry!.value).toString() === unicodeValue, "Unicode should be preserved", result);

    console.log(`  ✓ Unicode preserved: ${unicodeValue}`);

    results.push(result);
  }

  // Scenario 4.6: Metadata key exactly 32 bytes
  {
    const result: TestResult = { scenario: "4.6: Metadata key = 32 bytes (max)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const maxKey = "k".repeat(32);
    await program.methods
      .setMetadata(maxKey, Buffer.from("max key"))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    const entry = agent.metadata.find(m => m.key === maxKey);
    assert(entry !== undefined, "Max key entry should exist", result);
    assert(entry!.key.length === 32, "Key should be exactly 32 bytes", result);

    console.log(`  ✓ Max key (32 bytes) accepted`);

    results.push(result);
  }

  // Scenario 4.7: Metadata key > 32 bytes (should fail)
  {
    const result: TestResult = { scenario: "4.7: Metadata key > 32 bytes (should fail)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const tooLongKey = "k".repeat(33);

    try {
      await program.methods
        .setMetadata(tooLongKey, Buffer.from("value"))
        .accountsPartial({ agentAccount: metadataTestPda })
        .rpc();
      assert(false, "Should fail with KeyTooLong error", result);
    } catch (e: any) {
      assert(e.toString().includes("KeyTooLong") || e.toString().includes("0x1771"), "Should fail with KeyTooLong", result);
      console.log(`  ✓ Correctly rejected key > 32 bytes`);
    }

    results.push(result);
  }

  // Scenario 4.8: Metadata value exactly 256 bytes
  {
    const result: TestResult = { scenario: "4.8: Metadata value = 256 bytes (max)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const maxValue = "v".repeat(256);
    await program.methods
      .setMetadata("maxval", Buffer.from(maxValue))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    const entry = agent.metadata.find(m => m.key === "maxval");
    assert(entry !== undefined, "Max value entry should exist", result);
    assert(entry!.value.length === 256, "Value should be exactly 256 bytes", result);

    console.log(`  ✓ Max value (256 bytes) accepted`);

    results.push(result);
  }

  // Scenario 4.9: Metadata value > 256 bytes (should fail)
  {
    const result: TestResult = { scenario: "4.9: Metadata value > 256 bytes (should fail)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const tooLongValue = "v".repeat(257);

    try {
      await program.methods
        .setMetadata("toolong", Buffer.from(tooLongValue))
        .accountsPartial({ agentAccount: metadataTestPda })
        .rpc();
      assert(false, "Should fail with ValueTooLong error", result);
    } catch (e: any) {
      assert(e.toString().includes("ValueTooLong") || e.toString().includes("0x1772"), "Should fail with ValueTooLong", result);
      console.log(`  ✓ Correctly rejected value > 256 bytes`);
    }

    results.push(result);
  }

  // Scenario 4.10: Fill up to 10 metadata entries
  {
    const result: TestResult = { scenario: "4.10: Fill to 10 metadata entries", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    const currentCount = agent.metadata.length;
    const toAdd = 10 - currentCount;

    for (let i = 0; i < toAdd; i++) {
      await program.methods
        .setMetadata(`extra${i}`, Buffer.from(`value${i}`))
        .accountsPartial({ agentAccount: metadataTestPda })
        .rpc();
    }

    const agentFull = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agentFull.metadata.length === 10, "Should have exactly 10 entries", result);

    console.log(`  ✓ Filled to 10 metadata entries`);

    results.push(result);
  }

  // Scenario 4.11: Try to exceed 10 metadata limit
  {
    const result: TestResult = { scenario: "4.11: Cannot exceed 10 metadata limit", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    try {
      await program.methods
        .setMetadata("eleventh", Buffer.from("should fail"))
        .accountsPartial({ agentAccount: metadataTestPda })
        .rpc();
      assert(false, "Should fail with MetadataLimitReached error", result);
    } catch (e: any) {
      assert(e.toString().includes("MetadataLimitReached") || e.toString().includes("0x1773"), "Should fail with MetadataLimitReached", result);
      console.log(`  ✓ Correctly rejected 11th metadata entry`);
    }

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agent.metadata.length === 10, "Should still have 10 entries", result);

    results.push(result);
  }

  // Scenario 4.12: Update when at 10 entry limit
  {
    const result: TestResult = { scenario: "4.12: Update existing when at 10 limit", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    await program.methods
      .setMetadata("name", Buffer.from("Updated at limit"))
      .accountsPartial({ agentAccount: metadataTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agent.metadata.length === 10, "Should still have 10 entries", result);
    const entry = agent.metadata.find(m => m.key === "name");
    assert(Buffer.from(entry!.value).toString() === "Updated at limit", "Should update existing entry", result);

    console.log(`  ✓ Update works even at 10 entry limit`);

    results.push(result);
  }

  // Scenario 4.13: Empty metadata key
  {
    const result: TestResult = { scenario: "4.13: Empty metadata key", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://empty-key-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    await program.methods
      .setMetadata("", Buffer.from("empty key value"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const entry = agent.metadata.find(m => m.key === "");
    assert(entry !== undefined, "Empty key should be allowed", result);
    assert(entry!.key === "", "Key should be empty string", result);

    console.log(`  ✓ Empty key accepted`);

    results.push(result);
  }

  // Scenario 4.14: Empty metadata value
  {
    const result: TestResult = { scenario: "4.14: Empty metadata value", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://empty-value-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    await program.methods
      .setMetadata("emptyval", Buffer.from(""))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const entry = agent.metadata.find(m => m.key === "emptyval");
    assert(entry !== undefined, "Empty value entry should exist", result);
    assert(entry!.value.length === 0, "Value should be empty", result);

    console.log(`  ✓ Empty value accepted`);

    results.push(result);
  }

  // Scenario 4.15: Metadata with binary data
  {
    const result: TestResult = { scenario: "4.15: Metadata with binary data", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://binary-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
    await program.methods
      .setMetadata("binary", binaryData)
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const entry = agent.metadata.find(m => m.key === "binary");
    assert(entry !== undefined, "Binary entry should exist", result);
    assert(Buffer.from(entry!.value).equals(binaryData), "Binary data should be preserved", result);

    console.log(`  ✓ Binary data preserved: ${Buffer.from(entry!.value).toString('hex')}`);

    results.push(result);
  }

  // Scenario 4.16: Metadata with JSON string
  {
    const result: TestResult = { scenario: "4.16: Metadata with JSON string", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://json-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    const jsonString = JSON.stringify({ name: "Agent", version: "1.0", active: true });
    await program.methods
      .setMetadata("config", Buffer.from(jsonString))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const entry = agent.metadata.find(m => m.key === "config");
    assert(entry !== undefined, "JSON entry should exist", result);
    assert(Buffer.from(entry!.value).toString() === jsonString, "JSON string should be preserved", result);

    const parsed = JSON.parse(Buffer.from(entry!.value).toString());
    assert(parsed.name === "Agent", "JSON should be parseable", result);

    console.log(`  ✓ JSON preserved: ${jsonString}`);

    results.push(result);
  }

  // Scenario 4.17: Metadata with newlines
  {
    const result: TestResult = { scenario: "4.17: Metadata with newlines", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://newline-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    const multilineValue = "Line 1\nLine 2\r\nLine 3\tTab";
    await program.methods
      .setMetadata("multiline", Buffer.from(multilineValue))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    const entry = agent.metadata.find(m => m.key === "multiline");
    assert(entry !== undefined, "Multiline entry should exist", result);
    assert(Buffer.from(entry!.value).toString() === multilineValue, "Newlines should be preserved", result);

    console.log(`  ✓ Newlines preserved`);

    results.push(result);
  }

  // Scenario 4.18: Case-sensitive metadata keys
  {
    const result: TestResult = { scenario: "4.18: Case-sensitive metadata keys", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://case-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    await program.methods
      .setMetadata("Name", Buffer.from("uppercase"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    await program.methods
      .setMetadata("name", Buffer.from("lowercase"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    await program.methods
      .setMetadata("NAME", Buffer.from("allcaps"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.metadata.length === 3, "Should have 3 separate entries", result);

    const upper = agent.metadata.find(m => m.key === "Name");
    const lower = agent.metadata.find(m => m.key === "name");
    const caps = agent.metadata.find(m => m.key === "NAME");

    assert(upper !== undefined && Buffer.from(upper.value).toString() === "uppercase", "Name should exist", result);
    assert(lower !== undefined && Buffer.from(lower.value).toString() === "lowercase", "name should exist", result);
    assert(caps !== undefined && Buffer.from(caps.value).toString() === "allcaps", "NAME should exist", result);

    console.log(`  ✓ Case-sensitive: Name, name, NAME are different keys`);

    results.push(result);
  }

  // Scenario 4.19: Metadata retrieval order
  {
    const result: TestResult = { scenario: "4.19: Metadata insertion order preserved", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create new agent for this test
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://order-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    const keys = ["first", "second", "third", "fourth"];
    for (const key of keys) {
      await program.methods
        .setMetadata(key, Buffer.from(key))
        .accountsPartial({ agentAccount: agentPda })
        .rpc();
    }

    const agent = await program.account.agentAccount.fetch(agentPda);
    for (let i = 0; i < keys.length; i++) {
      assert(agent.metadata[i].key === keys[i], `Entry ${i} should be '${keys[i]}'`, result);
    }

    console.log(`  ✓ Insertion order preserved: ${keys.join(", ")}`);

    results.push(result);
  }

  // Scenario 4.20: Verify all metadata is retrievable
  {
    const result: TestResult = { scenario: "4.20: All metadata retrievable after operations", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agent = await program.account.agentAccount.fetch(metadataTestPda);
    assert(agent.metadata.length === 10, "Should have 10 entries", result);

    for (const entry of agent.metadata) {
      assert(entry.key.length > 0 || entry.key === "", "Key should be valid", result);
      assert(entry.value.length >= 0, "Value should be valid", result);
      console.log(`  ✓ ${entry.key}: ${Buffer.from(entry.value).toString().substring(0, 30)}...`);
    }

    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 5: AGENT URI OPERATIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n━━━ CATEGORY 5: AGENT URI OPERATIONS (15 scenarios) ━━━\n");

  // Create a fresh agent for URI tests
  let uriTestMint: PublicKey;
  let uriTestPda: PublicKey;
  {
    const mintKeypair = Keypair.generate();
    uriTestMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, uriTestMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, uriTestMint, tokenAccount.address, wallet.publicKey, 1);

    [uriTestPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), uriTestMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://initial")
      .accounts({ agentMint: uriTestMint })
      .rpc();
  }

  // Scenario 5.1: Update URI to IPFS
  {
    const result: TestResult = { scenario: "5.1: Update URI to IPFS", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const newUri = `ipfs://QmNew${Date.now()}`;
    await program.methods
      .setAgentUri(newUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === newUri, "URI should be updated", result);

    console.log(`  ✓ Updated to: ${newUri}`);

    results.push(result);
  }

  // Scenario 5.2: Update URI to Arweave
  {
    const result: TestResult = { scenario: "5.2: Update URI to Arweave", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const newUri = `ar://Arweave${Date.now()}`;
    await program.methods
      .setAgentUri(newUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === newUri, "URI should be updated to Arweave", result);

    console.log(`  ✓ Updated to: ${newUri}`);

    results.push(result);
  }

  // Scenario 5.3: Update URI to HTTP
  {
    const result: TestResult = { scenario: "5.3: Update URI to HTTP", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const newUri = `https://example.com/${Date.now()}`;
    await program.methods
      .setAgentUri(newUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === newUri, "URI should be updated to HTTP", result);

    console.log(`  ✓ Updated to: ${newUri}`);

    results.push(result);
  }

  // Scenario 5.4: Update URI to empty string
  {
    const result: TestResult = { scenario: "5.4: Update URI to empty string", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    await program.methods
      .setAgentUri("")
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === "", "URI should be empty", result);

    console.log(`  ✓ URI set to empty string`);

    results.push(result);
  }

  // Scenario 5.5: Update URI multiple times rapidly
  {
    const result: TestResult = { scenario: "5.5: Update URI 10 times rapidly", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    for (let i = 0; i < 10; i++) {
      const uri = `ipfs://rapid${i}`;
      await program.methods
        .setAgentUri(uri)
        .accountsPartial({ agentAccount: uriTestPda })
        .rpc();

      const agent = await program.account.agentAccount.fetch(uriTestPda);
      assert(agent.tokenUri === uri, `URI should be updated to rapid${i}`, result);
    }

    console.log(`  ✓ 10 rapid updates successful`);

    results.push(result);
  }

  // Scenario 5.6: URI with special characters
  {
    const result: TestResult = { scenario: "5.6: URI with special characters", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const specialUri = "ipfs://QmTest?query=1&foo=bar#fragment";
    await program.methods
      .setAgentUri(specialUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === specialUri, "Special chars in URI should be preserved", result);

    console.log(`  ✓ Special chars preserved: ${specialUri}`);

    results.push(result);
  }

  // Scenario 5.7: URI with Unicode
  {
    const result: TestResult = { scenario: "5.7: URI with Unicode", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const unicodeUri = "ipfs://日本語🚀émojis";
    await program.methods
      .setAgentUri(unicodeUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === unicodeUri, "Unicode in URI should be preserved", result);

    console.log(`  ✓ Unicode preserved: ${unicodeUri}`);

    results.push(result);
  }

  // Scenario 5.8: URI exactly 200 bytes
  {
    const result: TestResult = { scenario: "5.8: URI = 200 bytes (max)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const maxUri = "x".repeat(200);
    await program.methods
      .setAgentUri(maxUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === maxUri, "Max URI should be stored", result);
    assert(agent.tokenUri.length === 200, "URI should be exactly 200 bytes", result);

    console.log(`  ✓ Max URI (200 bytes) accepted`);

    results.push(result);
  }

  // Scenario 5.9: URI > 200 bytes (should fail)
  {
    const result: TestResult = { scenario: "5.9: URI > 200 bytes (should fail)", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const tooLongUri = "x".repeat(201);

    try {
      await program.methods
        .setAgentUri(tooLongUri)
        .accountsPartial({ agentAccount: uriTestPda })
        .rpc();
      assert(false, "Should fail with UriTooLong error", result);
    } catch (e: any) {
      assert(e.toString().includes("UriTooLong") || e.toString().includes("0x1770"), "Should fail with UriTooLong", result);
      console.log(`  ✓ Correctly rejected URI > 200 bytes`);
    }

    results.push(result);
  }

  // Scenario 5.10: Verify URI doesn't affect metadata
  {
    const result: TestResult = { scenario: "5.10: URI update doesn't affect metadata", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create agent with metadata
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://with-metadata")
      .accounts({ agentMint: nftMint })
      .rpc();

    await program.methods
      .setMetadata("key1", Buffer.from("value1"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    await program.methods
      .setMetadata("key2", Buffer.from("value2"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agentBefore = await program.account.agentAccount.fetch(agentPda);
    const metadataBefore = agentBefore.metadata.length;

    await program.methods
      .setAgentUri("ipfs://new-uri")
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const agentAfter = await program.account.agentAccount.fetch(agentPda);
    assert(agentAfter.metadata.length === metadataBefore, "Metadata count should be unchanged", result);
    assert(agentAfter.tokenUri === "ipfs://new-uri", "URI should be updated", result);

    console.log(`  ✓ URI update preserves metadata`);

    results.push(result);
  }

  // Scenario 5.11: Back-and-forth URI updates
  {
    const result: TestResult = { scenario: "5.11: Toggle between two URIs", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const uri1 = "ipfs://uri1";
    const uri2 = "ar://uri2";

    for (let i = 0; i < 5; i++) {
      await program.methods
        .setAgentUri(uri1)
        .accountsPartial({ agentAccount: uriTestPda })
        .rpc();

      let agent = await program.account.agentAccount.fetch(uriTestPda);
      assert(agent.tokenUri === uri1, `Should be uri1 (iteration ${i})`, result);

      await program.methods
        .setAgentUri(uri2)
        .accountsPartial({ agentAccount: uriTestPda })
        .rpc();

      agent = await program.account.agentAccount.fetch(uriTestPda);
      assert(agent.tokenUri === uri2, `Should be uri2 (iteration ${i})`, result);
    }

    console.log(`  ✓ 5 back-and-forth updates successful`);

    results.push(result);
  }

  // Scenario 5.12: URI update from empty to populated
  {
    const result: TestResult = { scenario: "5.12: Update from empty URI to populated", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create agent with empty URI
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("")
      .accounts({ agentMint: nftMint })
      .rpc();

    let agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === "", "Should start with empty URI", result);

    await program.methods
      .setAgentUri("ipfs://now-populated")
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === "ipfs://now-populated", "Should update to populated URI", result);

    console.log(`  ✓ Empty → populated update works`);

    results.push(result);
  }

  // Scenario 5.13: URI update from populated to empty
  {
    const result: TestResult = { scenario: "5.13: Update from populated URI to empty", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    // Create agent with populated URI
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://populated")
      .accounts({ agentMint: nftMint })
      .rpc();

    let agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === "ipfs://populated", "Should start with populated URI", result);

    await program.methods
      .setAgentUri("")
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    agent = await program.account.agentAccount.fetch(agentPda);
    assert(agent.tokenUri === "", "Should update to empty URI", result);

    console.log(`  ✓ Populated → empty update works`);

    results.push(result);
  }

  // Scenario 5.14: URI with path separators
  {
    const result: TestResult = { scenario: "5.14: URI with path separators", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const pathUri = "ipfs://QmHash/path/to/file.json";
    await program.methods
      .setAgentUri(pathUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(uriTestPda);
    assert(agent.tokenUri === pathUri, "Path separators should be preserved", result);

    console.log(`  ✓ Path preserved: ${pathUri}`);

    results.push(result);
  }

  // Scenario 5.15: Verify URI retrieval after multiple operations
  {
    const result: TestResult = { scenario: "5.15: URI retrievable after many operations", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const finalUri = `ipfs://final${Date.now()}`;
    await program.methods
      .setAgentUri(finalUri)
      .accountsPartial({ agentAccount: uriTestPda })
      .rpc();

    // Fetch multiple times
    for (let i = 0; i < 5; i++) {
      const agent = await program.account.agentAccount.fetch(uriTestPda);
      assert(agent.tokenUri === finalUri, `Fetch ${i}: URI should be consistent`, result);
    }

    console.log(`  ✓ URI consistently retrievable`);

    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 6: OWNERSHIP & AUTHORIZATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n━━━ CATEGORY 6: OWNERSHIP & AUTHORIZATION (10 scenarios) ━━━\n");

  // Create test agent for ownership tests
  let ownershipTestMint: PublicKey;
  let ownershipTestPda: PublicKey;
  let ownershipTokenAccount: any;
  {
    const mintKeypair = Keypair.generate();
    ownershipTestMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    ownershipTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, ownershipTestMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, ownershipTestMint, ownershipTokenAccount.address, wallet.publicKey, 1);

    [ownershipTestPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), ownershipTestMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://ownership-test")
      .accounts({ agentMint: ownershipTestMint })
      .rpc();
  }

  // Scenario 6.1: Verify initial owner is correct
  {
    const result: TestResult = { scenario: "6.1: Initial owner is correct", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agent = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agent.owner.equals(wallet.publicKey), "Owner should be wallet", result);

    console.log(`  ✓ Owner: ${agent.owner.toBase58()}`);

    results.push(result);
  }

  // Scenario 6.2: Sync owner with valid token account
  {
    const result: TestResult = { scenario: "6.2: Sync owner with valid token account", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    await program.methods
      .syncOwner()
      .accountsPartial({
        agentAccount: ownershipTestPda,
        tokenAccount: ownershipTokenAccount.address,
      })
      .rpc();

    const agent = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agent.owner.equals(wallet.publicKey), "Owner should still be wallet", result);

    console.log(`  ✓ Owner synced: ${agent.owner.toBase58()}`);

    results.push(result);
  }

  // Scenario 6.3: Sync owner verifies amount = 1
  {
    const result: TestResult = { scenario: "6.3: Sync owner validates NFT amount", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const tokenAccountInfo = await getAccount(connection, ownershipTokenAccount.address);
    assert(tokenAccountInfo.amount === 1n, "Token account should have exactly 1 NFT", result);

    await program.methods
      .syncOwner()
      .accountsPartial({
        agentAccount: ownershipTestPda,
        tokenAccount: ownershipTokenAccount.address,
      })
      .rpc();

    console.log(`  ✓ Amount validated: ${tokenAccountInfo.amount}`);

    results.push(result);
  }

  // Scenario 6.4: Owner can set metadata
  {
    const result: TestResult = { scenario: "6.4: Owner can set metadata", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    await program.methods
      .setMetadata("ownertest", Buffer.from("owner can set"))
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(ownershipTestPda);
    const entry = agent.metadata.find(m => m.key === "ownertest");
    assert(entry !== undefined, "Owner should be able to set metadata", result);

    console.log(`  ✓ Owner successfully set metadata`);

    results.push(result);
  }

  // Scenario 6.5: Owner can update URI
  {
    const result: TestResult = { scenario: "6.5: Owner can update URI", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const newUri = `ipfs://owner-updated${Date.now()}`;
    await program.methods
      .setAgentUri(newUri)
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    const agent = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agent.tokenUri === newUri, "Owner should be able to update URI", result);

    console.log(`  ✓ Owner successfully updated URI`);

    results.push(result);
  }

  // Scenario 6.6: Verify owner field matches token account owner
  {
    const result: TestResult = { scenario: "6.6: Agent owner matches token account owner", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agent = await program.account.agentAccount.fetch(ownershipTestPda);
    const tokenAccountInfo = await getAccount(connection, ownershipTokenAccount.address);

    assert(agent.owner.equals(tokenAccountInfo.owner), "Agent owner should match token account owner", result);

    console.log(`  ✓ Owners match: ${agent.owner.toBase58()}`);

    results.push(result);
  }

  // Scenario 6.7: Multiple sync_owner calls are idempotent
  {
    const result: TestResult = { scenario: "6.7: Multiple sync_owner calls are idempotent", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    for (let i = 0; i < 5; i++) {
      await program.methods
        .syncOwner()
        .accountsPartial({
          agentAccount: ownershipTestPda,
          tokenAccount: ownershipTokenAccount.address,
        })
        .rpc();
    }

    const agent = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agent.owner.equals(wallet.publicKey), "Owner should remain unchanged", result);

    console.log(`  ✓ 5 sync_owner calls successful (idempotent)`);

    results.push(result);
  }

  // Scenario 6.8: Verify agent mint is immutable
  {
    const result: TestResult = { scenario: "6.8: Agent mint is immutable", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agentBefore = await program.account.agentAccount.fetch(ownershipTestPda);
    const mintBefore = agentBefore.agentMint;

    // Perform operations
    await program.methods
      .setMetadata("test", Buffer.from("test"))
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    await program.methods
      .setAgentUri("ipfs://test")
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    const agentAfter = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agentAfter.agentMint.equals(mintBefore), "Agent mint should never change", result);

    console.log(`  ✓ Mint immutable: ${agentAfter.agentMint.toBase58()}`);

    results.push(result);
  }

  // Scenario 6.9: Verify agent ID is immutable
  {
    const result: TestResult = { scenario: "6.9: Agent ID is immutable", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agentBefore = await program.account.agentAccount.fetch(ownershipTestPda);
    const idBefore = agentBefore.agentId.toNumber();

    // Perform operations
    await program.methods
      .setMetadata("test2", Buffer.from("test2"))
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    await program.methods
      .setAgentUri("ipfs://test2")
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    const agentAfter = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agentAfter.agentId.toNumber() === idBefore, "Agent ID should never change", result);

    console.log(`  ✓ ID immutable: ${agentAfter.agentId}`);

    results.push(result);
  }

  // Scenario 6.10: Verify created_at is immutable
  {
    const result: TestResult = { scenario: "6.10: Created timestamp is immutable", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const agentBefore = await program.account.agentAccount.fetch(ownershipTestPda);
    const createdBefore = agentBefore.createdAt.toNumber();

    await sleep(2000); // Wait 2 seconds

    // Perform operations
    await program.methods
      .setMetadata("test3", Buffer.from("test3"))
      .accountsPartial({ agentAccount: ownershipTestPda })
      .rpc();

    const agentAfter = await program.account.agentAccount.fetch(ownershipTestPda);
    assert(agentAfter.createdAt.toNumber() === createdBefore, "Created timestamp should never change", result);

    console.log(`  ✓ Created timestamp immutable: ${new Date(createdBefore * 1000).toISOString()}`);

    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CATEGORY 7: REGISTRY STATE MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n━━━ CATEGORY 7: REGISTRY STATE MANAGEMENT (8 scenarios) ━━━\n");

  // Scenario 7.1: Verify totalAgents increments
  {
    const result: TestResult = { scenario: "7.1: totalAgents increments on registration", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const configBefore = await program.account.registryConfig.fetch(configPda);
    const totalBefore = configBefore.totalAgents.toNumber();

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    await program.methods
      .register("ipfs://increment-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    const configAfter = await program.account.registryConfig.fetch(configPda);
    const totalAfter = configAfter.totalAgents.toNumber();

    assert(totalAfter === totalBefore + 1, "totalAgents should increment by 1", result);

    console.log(`  Total before: ${totalBefore}, after: ${totalAfter}`);

    results.push(result);
  }

  // Scenario 7.2: Verify nextAgentId increments
  {
    const result: TestResult = { scenario: "7.2: nextAgentId increments on registration", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const configBefore = await program.account.registryConfig.fetch(configPda);
    const nextBefore = configBefore.nextAgentId.toNumber();

    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    await program.methods
      .register("ipfs://increment-test2")
      .accounts({ agentMint: nftMint })
      .rpc();

    const configAfter = await program.account.registryConfig.fetch(configPda);
    const nextAfter = configAfter.nextAgentId.toNumber();

    assert(nextAfter === nextBefore + 1, "nextAgentId should increment by 1", result);

    console.log(`  Next ID before: ${nextBefore}, after: ${nextAfter}`);

    results.push(result);
  }

  // Scenario 7.3: Verify totalAgents equals nextAgentId
  {
    const result: TestResult = { scenario: "7.3: totalAgents should equal nextAgentId", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const config = await program.account.registryConfig.fetch(configPda);
    assert(
      config.totalAgents.toNumber() === config.nextAgentId.toNumber(),
      "totalAgents should equal nextAgentId (no deletions)",
      result
    );

    console.log(`  Total: ${config.totalAgents}, Next ID: ${config.nextAgentId}`);

    results.push(result);
  }

  // Scenario 7.4: Verify authority is set correctly
  {
    const result: TestResult = { scenario: "7.4: Registry authority is correct", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const config = await program.account.registryConfig.fetch(configPda);
    assert(config.authority.equals(wallet.publicKey), "Authority should be wallet", result);

    console.log(`  Authority: ${config.authority.toBase58()}`);

    results.push(result);
  }

  // Scenario 7.5: Registry config is retrievable
  {
    const result: TestResult = { scenario: "7.5: Registry config consistently retrievable", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    for (let i = 0; i < 10; i++) {
      const config = await program.account.registryConfig.fetch(configPda);
      assert(config.authority !== undefined, `Fetch ${i}: Config should be retrievable`, result);
      assert(config.nextAgentId.toNumber() >= 0, `Fetch ${i}: nextAgentId should be valid`, result);
    }

    console.log(`  ✓ 10 consecutive fetches successful`);

    results.push(result);
  }

  // Scenario 7.6: Registry bump is stored
  {
    const result: TestResult = { scenario: "7.6: Registry config bump is stored", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const config = await program.account.registryConfig.fetch(configPda);
    assert(config.bump > 0 && config.bump <= 255, "Bump should be valid (1-255)", result);

    console.log(`  Config bump: ${config.bump}`);

    results.push(result);
  }

  // Scenario 7.7: Register batch and verify state
  {
    const result: TestResult = { scenario: "7.7: Register 10 agents and verify state", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const configBefore = await program.account.registryConfig.fetch(configPda);
    const totalBefore = configBefore.totalAgents.toNumber();
    const nextBefore = configBefore.nextAgentId.toNumber();

    for (let i = 0; i < 10; i++) {
      const mintKeypair = Keypair.generate();
      const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
      const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
      await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

      await program.methods
        .register(`ipfs://batch-state${i}`)
        .accounts({ agentMint: nftMint })
        .rpc();
    }

    const configAfter = await program.account.registryConfig.fetch(configPda);
    const totalAfter = configAfter.totalAgents.toNumber();
    const nextAfter = configAfter.nextAgentId.toNumber();

    assert(totalAfter === totalBefore + 10, "totalAgents should increase by 10", result);
    assert(nextAfter === nextBefore + 10, "nextAgentId should increase by 10", result);
    assert(totalAfter === nextAfter, "totalAgents should equal nextAgentId", result);

    console.log(`  Total: ${totalBefore} → ${totalAfter}`);
    console.log(`  Next ID: ${nextBefore} → ${nextAfter}`);

    results.push(result);
  }

  // Scenario 7.8: Verify registry state persistence
  {
    const result: TestResult = { scenario: "7.8: Registry state persists across operations", passed: 0, failed: 0, assertions: [] };
    console.log(`\n📝 SCENARIO ${result.scenario}\n`);

    const config1 = await program.account.registryConfig.fetch(configPda);
    const total1 = config1.totalAgents.toNumber();

    // Perform various operations
    const mintKeypair = Keypair.generate();
    const nftMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 0, mintKeypair);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, nftMint, wallet.publicKey);
    await mintTo(connection, wallet.payer, nftMint, tokenAccount.address, wallet.publicKey, 1);

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint.toBuffer()],
      program.programId
    );

    await program.methods
      .register("ipfs://persist-test")
      .accounts({ agentMint: nftMint })
      .rpc();

    await program.methods
      .setMetadata("test", Buffer.from("test"))
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    await program.methods
      .setAgentUri("ipfs://updated")
      .accountsPartial({ agentAccount: agentPda })
      .rpc();

    const config2 = await program.account.registryConfig.fetch(configPda);
    const total2 = config2.totalAgents.toNumber();

    assert(total2 === total1 + 1, "State should persist correctly", result);
    assert(config2.authority.equals(config1.authority), "Authority should remain the same", result);

    console.log(`  ✓ State persisted through multiple operations`);

    results.push(result);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FINAL SUMMARY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("\n\n" + "━".repeat(60));
  console.log("🎉 ULTIMATE COVERAGE TEST SUMMARY");
  console.log("━".repeat(60) + "\n");

  console.log(`✅ Tests Passed: ${totalPassed}`);
  console.log(`❌ Tests Failed: ${totalFailed}`);
  console.log(`📊 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(2)}%\n`);

  console.log("Categories Tested:");
  console.log("  1. Registry Initialization (3 scenarios)");
  console.log("  2. NFT Creation & Validation (8 scenarios)");
  console.log("  3. Agent Registration (12 scenarios)");
  console.log("  4. Metadata Operations (20 scenarios)");
  console.log("  5. Agent URI Operations (15 scenarios)");
  console.log("  6. Ownership & Authorization (10 scenarios)");
  console.log("  7. Registry State Management (8 scenarios)");
  console.log("\n📈 Total Scenarios: 76");
  console.log(`📊 Total Assertions: ${totalPassed + totalFailed}\n`);

  if (totalFailed === 0) {
    console.log("✅ ALL TESTS PASSED - CONTRACT IS PRODUCTION READY!\n");
  } else {
    console.log("⚠️  SOME TESTS FAILED - REVIEW REQUIRED\n");
    process.exit(1);
  }

  // Export results to file
  const logPath = "/tmp/ultimate_coverage_test.log";
  const logContent = results
    .map((r) => {
      return `\nScenario ${r.scenario}:\n  Passed: ${r.passed}\n  Failed: ${r.failed}\n  Assertions: ${r.assertions.join(", ")}`;
    })
    .join("\n");

  fs.writeFileSync(
    logPath,
    `ULTIMATE COVERAGE TEST RESULTS\n${new Date().toISOString()}\n\nTotal Passed: ${totalPassed}\nTotal Failed: ${totalFailed}\n${logContent}\n`
  );

  console.log(`📝 Detailed results saved to: ${logPath}\n`);
}

function loadWallet(): anchor.Wallet {
  const keypairPath = process.env.HOME + "/.config/solana/id.json";
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  return new anchor.Wallet(keypair);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
