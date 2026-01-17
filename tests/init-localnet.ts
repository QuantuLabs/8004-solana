/**
 * Initialize Localnet for Testing
 * Must be run FIRST before other tests to set up registry + ATOM engine
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { AtomEngine } from "../target/types/atom_engine";
import { Keypair, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  getRootConfigPda,
  getRegistryConfigPda,
  getAtomConfigPda,
  getValidationConfigPda,
} from "./utils/helpers";

describe("Initialize Localnet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;
  const atomEngine = anchor.workspace.AtomEngine as Program<AtomEngine>;

  let rootConfigPda: PublicKey;
  let collectionKeypair: Keypair;

  before(async () => {
    console.log("\n=== Localnet Initialization ===");
    console.log("Provider wallet:", provider.wallet.publicKey.toBase58());
    console.log("Registry Program ID:", program.programId.toBase58());
    console.log("ATOM Engine ID:", atomEngine.programId.toBase58());

    [rootConfigPda] = getRootConfigPda(program.programId);

    // Check if already initialized
    const accountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    if (accountInfo !== null) {
      console.log("Registry already initialized - skipping init");
      const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
      console.log("Current base registry:", rootConfig.currentBaseRegistry.toBase58());
      return;
    }

    collectionKeypair = Keypair.generate();
  });

  it("Initialize Agent Registry (if needed)", async () => {
    // Check if already initialized
    const accountInfo = await provider.connection.getAccountInfo(rootConfigPda);
    if (accountInfo !== null) {
      console.log("Already initialized - skipping");
      return;
    }

    // Derive program data PDA for upgrade authority verification
    const [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    );

    // Derive registry config PDA
    const [registryConfigPda] = getRegistryConfigPda(
      collectionKeypair.publicKey,
      program.programId
    );

    console.log("Initializing registry...");
    console.log("  Root Config PDA:", rootConfigPda.toBase58());
    console.log("  Registry Config PDA:", registryConfigPda.toBase58());
    console.log("  Collection:", collectionKeypair.publicKey.toBase58());
    console.log("  Program Data:", programDataPda.toBase58());

    const tx = await program.methods
      .initialize()
      .accounts({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        collection: collectionKeypair.publicKey,
        authority: provider.wallet.publicKey,
        programData: programDataPda,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([collectionKeypair])
      .rpc();

    console.log("Initialize tx:", tx);

    // Verify initialization
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    expect(rootConfig.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(rootConfig.currentBaseRegistry.toBase58()).to.equal(registryConfigPda.toBase58());

    const registryConfig = await program.account.registryConfig.fetch(registryConfigPda);
    expect(registryConfig.collection.toBase58()).to.equal(collectionKeypair.publicKey.toBase58());

    console.log("Registry initialized successfully!");
  });

  it("Initialize ValidationConfig (if needed)", async () => {
    const [validationConfigPda] = getValidationConfigPda(program.programId);

    // Check if already initialized
    const accountInfo = await provider.connection.getAccountInfo(validationConfigPda);
    if (accountInfo !== null) {
      console.log("ValidationConfig already initialized - skipping");
      return;
    }

    console.log("Initializing ValidationConfig...");
    console.log("  Config PDA:", validationConfigPda.toBase58());

    const tx = await program.methods
      .initializeValidationConfig()
      .accounts({
        config: validationConfigPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("ValidationConfig Initialize tx:", tx);

    // Verify initialization
    const validationConfig = await program.account.validationConfig.fetch(validationConfigPda);
    expect(validationConfig.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(validationConfig.totalRequests.toString()).to.equal("0");
    expect(validationConfig.totalResponses.toString()).to.equal("0");

    console.log("ValidationConfig initialized successfully!");
  });

  it("Initialize ATOM Engine (if needed)", async () => {
    const [atomConfigPda] = getAtomConfigPda(atomEngine.programId);

    // Check if already initialized
    const accountInfo = await provider.connection.getAccountInfo(atomConfigPda);
    if (accountInfo !== null) {
      console.log("ATOM Engine already initialized - skipping");
      return;
    }

    console.log("Initializing ATOM Engine...");
    console.log("  Config PDA:", atomConfigPda.toBase58());
    console.log("  Agent Registry Program:", program.programId.toBase58());

    const tx = await atomEngine.methods
      .initializeConfig(program.programId)
      .accounts({
        config: atomConfigPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("ATOM Initialize tx:", tx);

    // Verify initialization
    const atomConfig = await atomEngine.account.atomConfig.fetch(atomConfigPda);
    expect(atomConfig.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(atomConfig.agentRegistryProgram.toBase58()).to.equal(program.programId.toBase58());

    console.log("ATOM Engine initialized successfully!");
  });

  it("Display final state", async () => {
    console.log("\n=== Final Localnet State ===");

    // Root Config
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    console.log("\nRoot Config:");
    console.log("  Authority:", rootConfig.authority.toBase58());
    console.log("  Current Base Registry:", rootConfig.currentBaseRegistry.toBase58());
    console.log("  Base Registry Count:", rootConfig.baseRegistryCount);

    // Registry Config
    const registryConfig = await program.account.registryConfig.fetch(
      rootConfig.currentBaseRegistry
    );
    console.log("\nRegistry Config:");
    console.log("  Collection:", registryConfig.collection.toBase58());
    console.log("  Registry Type:", registryConfig.registryType);
    console.log("  Base Index:", registryConfig.baseIndex);

    // ValidationConfig
    const [validationConfigPda] = getValidationConfigPda(program.programId);
    try {
      const validationConfig = await program.account.validationConfig.fetch(validationConfigPda);
      console.log("\nValidation Config:");
      console.log("  Authority:", validationConfig.authority.toBase58());
      console.log("  Total Requests:", validationConfig.totalRequests.toString());
      console.log("  Total Responses:", validationConfig.totalResponses.toString());
    } catch (e) {
      console.log("\nValidation Config: Not initialized");
    }

    // ATOM Config
    const [atomConfigPda] = getAtomConfigPda(atomEngine.programId);
    try {
      const atomConfig = await atomEngine.account.atomConfig.fetch(atomConfigPda);
      console.log("\nATOM Config:");
      console.log("  Authority:", atomConfig.authority.toBase58());
      console.log("  Agent Registry Program:", atomConfig.agentRegistryProgram.toBase58());
    } catch (e) {
      console.log("\nATOM Config: Not initialized");
    }

    console.log("\n=== Localnet Ready for Testing ===\n");
  });
});
