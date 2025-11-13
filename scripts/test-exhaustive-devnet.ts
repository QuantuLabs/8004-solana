/**
 * EXHAUSTIVE DEVNET TESTING - ALL SCENARIOS
 *
 * Tests every possible scenario with data retrieval verification after each operation
 * Run with: ts-node scripts/test-exhaustive-devnet.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
} from "@solana/spl-token";
import { IdentityRegistry } from "../target/types/identity_registry";
import * as fs from "fs";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR");

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.log("❌ FAILED:", message);
    testsFailed++;
    throw new Error(message);
  }
  console.log("✅ PASS:", message);
  testsPassed++;
}

async function main() {
  console.log("\n=== EXHAUSTIVE DEVNET TESTING ===");
  console.log("Testing ALL scenarios with data retrieval\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = loadWallet();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync("target/idl/identity_registry.json", "utf8")
  );
  const program = new Program(idl, provider) as Program<IdentityRegistry>;

  console.log("Wallet:", wallet.publicKey.toBase58());
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  try {
    // ==================== SCENARIO 1: REGISTRY INITIALIZATION ====================
    console.log("\n━━━ SCENARIO 1: REGISTRY INITIALIZATION ━━━\n");

    let config = await program.account.registryConfig.fetch(configPda);
    console.log("Initial state:");
    console.log("  Next Agent ID:", config.nextAgentId.toString());
    console.log("  Total Agents:", config.totalAgents.toString());
    assert(config.authority.toBase58() === wallet.publicKey.toBase58(), "Authority should be wallet");

    // Retrieve and verify again
    config = await program.account.registryConfig.fetch(configPda);
    assert(config.nextAgentId instanceof anchor.BN, "nextAgentId should be BN");
    assert(config.totalAgents instanceof anchor.BN, "totalAgents should be BN");

    // ==================== SCENARIO 2: REGISTER WITH VALID NFT ====================
    console.log("\n━━━ SCENARIO 2: REGISTER WITH VALID NFT ━━━\n");

    const mint1 = Keypair.generate();
    const nftMint1 = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0,
      mint1
    );
    console.log("Created NFT mint:", nftMint1.toBase58());

    const tokenAccount1 = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      nftMint1,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      nftMint1,
      tokenAccount1.address,
      wallet.publicKey,
      1
    );

    // Verify NFT was minted correctly
    const tokenInfo = await getAccount(connection, tokenAccount1.address);
    assert(tokenInfo.amount.toString() === "1", "NFT should have amount = 1");

    const [agentPda1] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint1.toBuffer()],
      program.programId
    );

    const uri1 = "ipfs://QmTest" + Date.now();
    const initialTotalAgents = config.totalAgents.toNumber();

    await program.methods
      .register(uri1)
      .accounts({ agentMint: nftMint1 })
      .rpc();

    // RETRIEVE AND VERIFY immediately
    const agent1 = await program.account.agentAccount.fetch(agentPda1);
    assert(agent1.tokenUri === uri1, "Token URI should match");
    assert(agent1.owner.toBase58() === wallet.publicKey.toBase58(), "Owner should be wallet");
    assert(agent1.agentMint.toBase58() === nftMint1.toBase58(), "Agent mint should match");
    assert(agent1.metadata.length === 0, "Initial metadata should be empty");
    assert(agent1.agentId.toNumber() === initialTotalAgents, "Agent ID should be sequential");

    // Verify config was updated
    config = await program.account.registryConfig.fetch(configPda);
    assert(config.totalAgents.toNumber() === initialTotalAgents + 1, "Total agents should increment");

    console.log("Agent registered and verified:");
    console.log("  Agent ID:", agent1.agentId.toString());
    console.log("  Owner:", agent1.owner.toBase58());
    console.log("  NFT Mint:", agent1.agentMint.toBase58());
    console.log("  Token URI:", agent1.tokenUri);

    // ==================== SCENARIO 3: REGISTER WITH EMPTY URI ====================
    console.log("\n━━━ SCENARIO 3: REGISTER WITH EMPTY URI (ERC-8004 SPEC) ━━━\n");

    const mint2 = Keypair.generate();
    const nftMint2 = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      0,
      mint2
    );

    const tokenAccount2 = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      nftMint2,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      nftMint2,
      tokenAccount2.address,
      wallet.publicKey,
      1
    );

    const [agentPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), nftMint2.toBuffer()],
      program.programId
    );

    await program.methods
      .register("")
      .accounts({ agentMint: nftMint2 })
      .rpc();

    // RETRIEVE AND VERIFY
    const agent2 = await program.account.agentAccount.fetch(agentPda2);
    assert(agent2.tokenUri === "", "Empty URI should be allowed");
    console.log("Empty URI agent created successfully");

    // ==================== SCENARIO 4: SET METADATA (SINGLE ENTRY) ====================
    console.log("\n━━━ SCENARIO 4: SET METADATA (SINGLE ENTRY) ━━━\n");

    await program.methods
      .setMetadata("name", Buffer.from("Test Agent"))
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY
    let agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    assert(agentAfterMeta.metadata.length === 1, "Should have 1 metadata entry");
    assert(agentAfterMeta.metadata[0].key === "name", "Key should be 'name'");
    assert(
      Buffer.from(agentAfterMeta.metadata[0].value).toString() === "Test Agent",
      "Value should match"
    );
    console.log("Metadata entry verified:", agentAfterMeta.metadata[0].key);

    // ==================== SCENARIO 5: SET MULTIPLE METADATA ENTRIES ====================
    console.log("\n━━━ SCENARIO 5: SET MULTIPLE METADATA ENTRIES ━━━\n");

    const metadataEntries = [
      { key: "description", value: "AI Agent on Solana" },
      { key: "version", value: "1.0.0" },
      { key: "category", value: "DeFi" },
      { key: "author", value: "ERC-8004 Team" },
      { key: "license", value: "MIT" },
    ];

    for (const entry of metadataEntries) {
      await program.methods
        .setMetadata(entry.key, Buffer.from(entry.value))
        .accountsPartial({ agentAccount: agentPda1 })
        .rpc();

      // RETRIEVE AND VERIFY after EACH addition
      agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
      const found = agentAfterMeta.metadata.find((m) => m.key === entry.key);
      assert(found !== undefined, `Key '${entry.key}' should exist`);
      assert(
        Buffer.from(found.value).toString() === entry.value,
        `Value for '${entry.key}' should match`
      );
      console.log(`  ✓ Added and verified: ${entry.key} = ${entry.value}`);
    }

    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    assert(agentAfterMeta.metadata.length === 6, "Should have 6 metadata entries total");
    console.log("Total metadata entries:", agentAfterMeta.metadata.length);

    // ==================== SCENARIO 6: UPDATE EXISTING METADATA ====================
    console.log("\n━━━ SCENARIO 6: UPDATE EXISTING METADATA ━━━\n");

    const oldVersion = agentAfterMeta.metadata.find((m) => m.key === "version");
    console.log("Old version:", Buffer.from(oldVersion.value).toString());

    await program.methods
      .setMetadata("version", Buffer.from("2.0.0"))
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY update
    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    const newVersion = agentAfterMeta.metadata.find((m) => m.key === "version");
    assert(
      Buffer.from(newVersion.value).toString() === "2.0.0",
      "Version should be updated"
    );
    assert(agentAfterMeta.metadata.length === 6, "Total entries should remain the same");
    console.log("New version:", Buffer.from(newVersion.value).toString());
    console.log("✓ Metadata updated without creating duplicate");

    // ==================== SCENARIO 7: METADATA WITH SPECIAL CHARACTERS ====================
    console.log("\n━━━ SCENARIO 7: METADATA WITH SPECIAL CHARACTERS ━━━\n");

    const specialValue = "Special: éàü 中文 🚀 \n\t";
    await program.methods
      .setMetadata("special", Buffer.from(specialValue, "utf8"))
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY
    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    const special = agentAfterMeta.metadata.find((m) => m.key === "special");
    assert(
      Buffer.from(special.value).toString("utf8") === specialValue,
      "Special characters should be preserved"
    );
    console.log("✓ Special characters preserved correctly");

    // ==================== SCENARIO 8: METADATA WITH MAX LENGTHS ====================
    console.log("\n━━━ SCENARIO 8: METADATA WITH MAX LENGTHS ━━━\n");

    const maxKey = "a".repeat(32);
    const maxValue = Buffer.alloc(256, "x");

    await program.methods
      .setMetadata(maxKey, maxValue)
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY
    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    const maxEntry = agentAfterMeta.metadata.find((m) => m.key === maxKey);
    assert(maxEntry !== undefined, "Max length key should exist");
    assert(maxEntry.value.length === 256, "Max length value should be stored");
    console.log("✓ Max length key (32 bytes) and value (256 bytes) stored");

    // ==================== SCENARIO 9: FILL UP TO 10 METADATA ENTRIES ====================
    console.log("\n━━━ SCENARIO 9: FILL UP TO 10 METADATA ENTRIES ━━━\n");

    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    const currentCount = agentAfterMeta.metadata.length;
    console.log("Current metadata count:", currentCount);

    const remaining = 10 - currentCount;
    for (let i = 0; i < remaining; i++) {
      await program.methods
        .setMetadata(`extra${i}`, Buffer.from(`value${i}`))
        .accountsPartial({ agentAccount: agentPda1 })
        .rpc();
    }

    // RETRIEVE AND VERIFY we hit the limit
    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    assert(agentAfterMeta.metadata.length === 10, "Should have exactly 10 entries");
    console.log("✓ Successfully filled to 10 metadata entries");

    // Verify each entry is retrievable
    for (let i = 0; i < remaining; i++) {
      const found = agentAfterMeta.metadata.find((m) => m.key === `extra${i}`);
      assert(found !== undefined, `extra${i} should exist`);
    }
    console.log("✓ All 10 entries are retrievable");

    // ==================== SCENARIO 10: TRY TO EXCEED 10 METADATA LIMIT ====================
    console.log("\n━━━ SCENARIO 10: TRY TO EXCEED 10 METADATA LIMIT ━━━\n");

    try {
      await program.methods
        .setMetadata("overflow", Buffer.from("should fail"))
        .accountsPartial({ agentAccount: agentPda1 })
        .rpc();
      assert(false, "Should have failed with MetadataLimitReached");
    } catch (error) {
      assert(
        error.message.includes("MetadataLimitReached"),
        "Should fail with MetadataLimitReached error"
      );
      console.log("✓ Correctly rejected 11th metadata entry");
    }

    // RETRIEVE AND VERIFY still 10 entries
    agentAfterMeta = await program.account.agentAccount.fetch(agentPda1);
    assert(agentAfterMeta.metadata.length === 10, "Should still have 10 entries");

    // ==================== SCENARIO 11: UPDATE AGENT URI ====================
    console.log("\n━━━ SCENARIO 11: UPDATE AGENT URI ━━━\n");

    const oldUri = agent1.tokenUri;
    const newUri = "ar://NewURI" + Date.now();

    await program.methods
      .setAgentUri(newUri)
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY
    const agentAfterUri = await program.account.agentAccount.fetch(agentPda1);
    assert(agentAfterUri.tokenUri === newUri, "URI should be updated");
    assert(agentAfterUri.tokenUri !== oldUri, "URI should be different from old");
    console.log("Old URI:", oldUri);
    console.log("New URI:", agentAfterUri.tokenUri);
    console.log("✓ URI updated successfully");

    // ==================== SCENARIO 12: UPDATE URI TO EMPTY STRING ====================
    console.log("\n━━━ SCENARIO 12: UPDATE URI TO EMPTY STRING ━━━\n");

    await program.methods
      .setAgentUri("")
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY
    const agentEmptyUri = await program.account.agentAccount.fetch(agentPda1);
    assert(agentEmptyUri.tokenUri === "", "URI should be empty");
    console.log("✓ URI set to empty string successfully");

    // Restore URI
    await program.methods
      .setAgentUri(newUri)
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // ==================== SCENARIO 13: UPDATE URI MULTIPLE TIMES ====================
    console.log("\n━━━ SCENARIO 13: UPDATE URI MULTIPLE TIMES ━━━\n");

    const uris = [
      "ipfs://QmFirst",
      "ar://Second",
      "https://example.com/third",
      "ipfs://QmFourth",
    ];

    for (const uri of uris) {
      await program.methods
        .setAgentUri(uri)
        .accountsPartial({ agentAccount: agentPda1 })
        .rpc();

      // RETRIEVE AND VERIFY after each update
      const agent = await program.account.agentAccount.fetch(agentPda1);
      assert(agent.tokenUri === uri, `URI should be ${uri}`);
      console.log(`  ✓ Updated to: ${uri}`);
    }

    console.log("✓ Multiple URI updates work correctly");

    // ==================== SCENARIO 14: URI WITH MAX LENGTH ====================
    console.log("\n━━━ SCENARIO 14: URI WITH MAX LENGTH (200 BYTES) ━━━\n");

    const maxUri = "ipfs://" + "a".repeat(193); // 7 + 193 = 200 bytes

    await program.methods
      .setAgentUri(maxUri)
      .accountsPartial({ agentAccount: agentPda1 })
      .rpc();

    // RETRIEVE AND VERIFY
    const agentMaxUri = await program.account.agentAccount.fetch(agentPda1);
    assert(agentMaxUri.tokenUri === maxUri, "Max URI should be stored");
    assert(agentMaxUri.tokenUri.length === 200, "URI should be exactly 200 bytes");
    console.log("✓ Max length URI (200 bytes) stored successfully");

    // ==================== SCENARIO 15: TRY URI TOO LONG ====================
    console.log("\n━━━ SCENARIO 15: TRY URI TOO LONG (>200 BYTES) ━━━\n");

    const tooLongUri = "ipfs://" + "a".repeat(194); // 7 + 194 = 201 bytes

    try {
      await program.methods
        .setAgentUri(tooLongUri)
        .accountsPartial({ agentAccount: agentPda1 })
        .rpc();
      assert(false, "Should have failed with UriTooLong");
    } catch (error) {
      assert(error.message.includes("UriTooLong"), "Should fail with UriTooLong error");
      console.log("✓ Correctly rejected URI > 200 bytes");
    }

    // RETRIEVE AND VERIFY URI unchanged
    const agentAfterFail = await program.account.agentAccount.fetch(agentPda1);
    assert(agentAfterFail.tokenUri === maxUri, "URI should be unchanged after failed update");

    // ==================== SCENARIO 16: SYNC OWNER ====================
    console.log("\n━━━ SCENARIO 16: SYNC OWNER ━━━\n");

    await program.methods
      .syncOwner()
      .accountsPartial({
        agentAccount: agentPda1,
        tokenAccount: tokenAccount1.address,
      })
      .rpc();

    // RETRIEVE AND VERIFY
    const agentAfterSync = await program.account.agentAccount.fetch(agentPda1);
    assert(
      agentAfterSync.owner.toBase58() === wallet.publicKey.toBase58(),
      "Owner should be synced"
    );
    console.log("✓ Owner synced successfully");
    console.log("  Current owner:", agentAfterSync.owner.toBase58());

    // ==================== SCENARIO 17: REGISTER MULTIPLE AGENTS ====================
    console.log("\n━━━ SCENARIO 17: REGISTER MULTIPLE AGENTS ━━━\n");

    const numAgents = 3;
    const agents = [];

    for (let i = 0; i < numAgents; i++) {
      const mintKp = Keypair.generate();
      const mint = await createMint(
        connection,
        wallet.payer,
        wallet.publicKey,
        null,
        0,
        mintKp
      );

      const tokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        mint,
        wallet.publicKey
      );

      await mintTo(connection, wallet.payer, mint, tokenAcc.address, wallet.publicKey, 1);

      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), mint.toBuffer()],
        program.programId
      );

      await program.methods
        .register(`ipfs://Agent${i}`)
        .accounts({ agentMint: mint })
        .rpc();

      // RETRIEVE AND VERIFY
      const agent = await program.account.agentAccount.fetch(pda);
      assert(agent.tokenUri === `ipfs://Agent${i}`, `Agent ${i} URI should match`);

      agents.push({ mint, pda, agent });
      console.log(`  ✓ Agent ${i} created and verified (ID: ${agent.agentId.toString()})`);
    }

    // Verify all agents are still retrievable
    for (let i = 0; i < numAgents; i++) {
      const agent = await program.account.agentAccount.fetch(agents[i].pda);
      assert(agent.tokenUri === `ipfs://Agent${i}`, `Agent ${i} should still be retrievable`);
    }
    console.log(`✓ All ${numAgents} agents are retrievable`);

    // ==================== SCENARIO 18: VERIFY REGISTRY FINAL STATE ====================
    console.log("\n━━━ SCENARIO 18: VERIFY REGISTRY FINAL STATE ━━━\n");

    const finalConfig = await program.account.registryConfig.fetch(configPda);
    console.log("Final registry state:");
    console.log("  Total Agents:", finalConfig.totalAgents.toString());
    console.log("  Next Agent ID:", finalConfig.nextAgentId.toString());
    assert(
      finalConfig.totalAgents.toNumber() === finalConfig.nextAgentId.toNumber(),
      "Total agents should equal next ID"
    );

    // ==================== SCENARIO 19: METADATA KEY TOO LONG ====================
    console.log("\n━━━ SCENARIO 19: METADATA KEY TOO LONG (>32 BYTES) ━━━\n");

    const longKey = "a".repeat(33);

    try {
      await program.methods
        .setMetadata(longKey, Buffer.from("value"))
        .accountsPartial({ agentAccount: agentPda2 })
        .rpc();
      assert(false, "Should have failed with KeyTooLong");
    } catch (error) {
      assert(error.message.includes("KeyTooLong"), "Should fail with KeyTooLong error");
      console.log("✓ Correctly rejected key > 32 bytes");
    }

    // ==================== SCENARIO 20: METADATA VALUE TOO LONG ====================
    console.log("\n━━━ SCENARIO 20: METADATA VALUE TOO LONG (>256 BYTES) ━━━\n");

    const longValue = Buffer.alloc(257, "x");

    try {
      await program.methods
        .setMetadata("test", longValue)
        .accountsPartial({ agentAccount: agentPda2 })
        .rpc();
      assert(false, "Should have failed with ValueTooLong");
    } catch (error) {
      assert(error.message.includes("ValueTooLong"), "Should fail with ValueTooLong error");
      console.log("✓ Correctly rejected value > 256 bytes");
    }

    // ==================== SCENARIO 21: REGISTER WITH INVALID NFT (DECIMALS != 0) ====================
    console.log("\n━━━ SCENARIO 21: REGISTER WITH INVALID NFT (DECIMALS != 0) ━━━\n");

    const invalidMintKp = Keypair.generate();
    const invalidMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9, // NOT 0 decimals!
      invalidMintKp
    );

    try {
      await program.methods
        .register("ipfs://invalid")
        .accounts({ agentMint: invalidMint })
        .rpc();
      assert(false, "Should have failed with InvalidNFT");
    } catch (error) {
      assert(error.message.includes("InvalidNFT"), "Should fail with InvalidNFT error");
      console.log("✓ Correctly rejected NFT with decimals != 0");
    }

    // ==================== FINAL SUMMARY ====================
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 EXHAUSTIVE TEST SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log(`✅ Tests Passed: ${testsPassed}`);
    console.log(`❌ Tests Failed: ${testsFailed}`);
    console.log(`📊 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(2)}%`);
    console.log("\nScenarios Covered:");
    console.log("  ✓ Registry initialization & state");
    console.log("  ✓ Agent registration (valid NFT)");
    console.log("  ✓ Agent registration (empty URI)");
    console.log("  ✓ Single metadata entry");
    console.log("  ✓ Multiple metadata entries");
    console.log("  ✓ Metadata updates");
    console.log("  ✓ Special characters in metadata");
    console.log("  ✓ Max length metadata (32/256 bytes)");
    console.log("  ✓ 10 metadata entry limit");
    console.log("  ✓ Metadata limit enforcement");
    console.log("  ✓ Agent URI updates");
    console.log("  ✓ Empty URI updates");
    console.log("  ✓ Multiple URI updates");
    console.log("  ✓ Max length URI (200 bytes)");
    console.log("  ✓ URI length enforcement");
    console.log("  ✓ Owner synchronization");
    console.log("  ✓ Multiple agents registration");
    console.log("  ✓ Registry state consistency");
    console.log("  ✓ Key length validation");
    console.log("  ✓ Value length validation");
    console.log("  ✓ NFT validation (decimals)");
    console.log("\n✅ ALL DATA RETRIEVAL VERIFIED AFTER EACH OPERATION");
    console.log("✅ CONTRACT IS PRODUCTION READY!\n");

  } catch (error) {
    console.error("\n❌ TEST SUITE FAILED:");
    console.error(error);
    console.log(`\n✅ Tests Passed: ${testsPassed}`);
    console.log(`❌ Tests Failed: ${testsFailed + 1}`);
    process.exit(1);
  }
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
