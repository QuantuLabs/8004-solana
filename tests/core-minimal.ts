import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

// Metaplex Core program ID
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
// BPF Loader Upgradeable program ID
const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

describe("agent_registry_8004 - Core Minimal Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  // Test keypairs
  const collectionKeypair = Keypair.generate();
  let configPda: PublicKey;
  let configBump: number;
  let programDataPda: PublicKey;

  before(async () => {
    // Derive config PDA
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Derive program data PDA (for F-01 upgrade authority check)
    [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_ID
    );

    console.log("Program ID:", program.programId.toBase58());
    console.log("Config PDA:", configPda.toBase58());
    console.log("Program Data PDA:", programDataPda.toBase58());
    console.log("Collection:", collectionKeypair.publicKey.toBase58());
  });

  it("Initialize registry with Core collection", async () => {
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          config: configPda,
          collection: collectionKeypair.publicKey,
          authority: provider.wallet.publicKey,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([collectionKeypair])
        .rpc();

      console.log("Initialize tx:", tx);

      // Fetch and verify config
      const config = await program.account.registryConfig.fetch(configPda);
      expect(config.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(config.collection.toBase58()).to.equal(collectionKeypair.publicKey.toBase58());
      expect(config.nextAgentId.toNumber()).to.equal(0);
      expect(config.totalAgents.toNumber()).to.equal(0);
      console.log("✓ Registry initialized successfully");
    } catch (e) {
      console.error("Initialize error:", e);
      throw e;
    }
  });

  it("Register agent with Core asset", async () => {
    const assetKeypair = Keypair.generate();

    // Derive agent PDA
    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), assetKeypair.publicKey.toBuffer()],
      program.programId
    );

    try {
      const tx = await program.methods
        .register("https://example.com/agent/0")
        .accounts({
          config: configPda,
          agentAccount: agentPda,
          asset: assetKeypair.publicKey,
          collection: collectionKeypair.publicKey,
          owner: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([assetKeypair])
        .rpc();

      console.log("Register tx:", tx);

      // Fetch and verify agent
      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.agentId.toNumber()).to.equal(0);
      expect(agent.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agent.asset.toBase58()).to.equal(assetKeypair.publicKey.toBase58());
      expect(agent.agentUri).to.equal("https://example.com/agent/0");
      console.log("✓ Agent #0 registered successfully");

      // Verify config updated
      const config = await program.account.registryConfig.fetch(configPda);
      expect(config.nextAgentId.toNumber()).to.equal(1);
      expect(config.totalAgents.toNumber()).to.equal(1);
      console.log("✓ Config counters updated");
    } catch (e) {
      console.error("Register error:", e);
      throw e;
    }
  });
});
