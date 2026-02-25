import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { AgentRegistry8004 } from "../target/types/agent_registry_8004";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

import {
  MPL_CORE_PROGRAM_ID,
  ATOM_ENGINE_PROGRAM_ID,
  getRootConfigPda,
  getRegistryConfigPda,
  getAgentPda,
  getAtomConfigPda,
  getRegistryAuthorityPda,
  randomHash,
  expectAnchorError,
  fundKeypair,
} from "./utils/helpers";

describe("E2E ATOM Toggle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentRegistry8004 as Program<AgentRegistry8004>;

  let rootConfigPda: PublicKey;
  let registryConfigPda: PublicKey;
  let collectionPubkey: PublicKey;
  let atomConfigPda: PublicKey;
  let registryAuthorityPda: PublicKey;

  async function registerAgentWithAtomDisabled(owner: Keypair) {
    const asset = Keypair.generate();
    const [agentPda] = getAgentPda(asset.publicKey, program.programId);

    await program.methods
      .registerWithOptions("https://example.com/agent/atom-off", false)
      .accountsPartial({
        rootConfig: rootConfigPda,
        registryConfig: registryConfigPda,
        agentAccount: agentPda,
        asset: asset.publicKey,
        collection: collectionPubkey,
        owner: owner.publicKey,
        payer: owner.publicKey,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([owner, asset])
      .rpc();

    return { asset, agentPda };
  }

  before(async () => {
    [rootConfigPda] = getRootConfigPda(program.programId);
    const rootConfig = await program.account.rootConfig.fetch(rootConfigPda);
    collectionPubkey = rootConfig.baseCollection;
    [registryConfigPda] = getRegistryConfigPda(collectionPubkey, program.programId);
    [atomConfigPda] = getAtomConfigPda();
    [registryAuthorityPda] = getRegistryAuthorityPda(program.programId);
  });

  it("registerWithOptions(false) keeps ATOM disabled and feedback works without ATOM CPI accounts", async () => {
    const owner = Keypair.generate();
    const client = Keypair.generate();
    await fundKeypair(provider, owner, 0.2 * anchor.web3.LAMPORTS_PER_SOL);
    await fundKeypair(provider, client, 0.2 * anchor.web3.LAMPORTS_PER_SOL);

    const { asset, agentPda } = await registerAgentWithAtomDisabled(owner);
    const before = await program.account.agentAccount.fetch(agentPda);

    expect(before.atomEnabled).to.equal(false);
    expect(before.feedbackCount.toNumber()).to.equal(0);

    const feedbackDigestBefore = Buffer.from(before.feedbackDigest);

    await program.methods
      .giveFeedback(
        new BN(8400),
        2,
        84,
        Array.from(randomHash()),
        "uptime",
        "daily",
        "https://api.example.com",
        "https://example.com/feedback/no-atom-cpi"
      )
      .accountsPartial({
        client: client.publicKey,
        asset: asset.publicKey,
        collection: collectionPubkey,
        agentAccount: agentPda,
        atomConfig: atomConfigPda,
        atomStats: collectionPubkey,
        atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
        registryAuthority: registryAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const after = await program.account.agentAccount.fetch(agentPda);
    expect(after.feedbackCount.toNumber()).to.equal(1);
    expect(Buffer.from(after.feedbackDigest).equals(feedbackDigestBefore)).to.equal(false);
  });

  it("enableAtom() rejects non-owner, allows owner once, then rejects second enable", async () => {
    const owner = Keypair.generate();
    const attacker = Keypair.generate();
    await fundKeypair(provider, owner, 0.2 * anchor.web3.LAMPORTS_PER_SOL);
    await fundKeypair(provider, attacker, 0.2 * anchor.web3.LAMPORTS_PER_SOL);

    const { asset, agentPda } = await registerAgentWithAtomDisabled(owner);

    await expectAnchorError(
      program.methods
        .enableAtom()
        .accountsPartial({
          owner: attacker.publicKey,
          asset: asset.publicKey,
          agentAccount: agentPda,
        })
        .signers([attacker])
        .rpc(),
      "Unauthorized"
    );

    await program.methods
      .enableAtom()
      .accountsPartial({
        owner: owner.publicKey,
        asset: asset.publicKey,
        agentAccount: agentPda,
      })
      .signers([owner])
      .rpc();

    const enabled = await program.account.agentAccount.fetch(agentPda);
    expect(enabled.atomEnabled).to.equal(true);

    await expectAnchorError(
      program.methods
        .enableAtom()
        .accountsPartial({
          owner: owner.publicKey,
          asset: asset.publicKey,
          agentAccount: agentPda,
        })
        .signers([owner])
        .rpc(),
      "AtomAlreadyEnabled"
    );
  });

  it("giveFeedback() rejects invalid atom_stats account when ATOM is enabled", async () => {
    const owner = Keypair.generate();
    const client = Keypair.generate();
    await fundKeypair(provider, owner, 0.2 * anchor.web3.LAMPORTS_PER_SOL);
    await fundKeypair(provider, client, 0.2 * anchor.web3.LAMPORTS_PER_SOL);

    const { asset, agentPda } = await registerAgentWithAtomDisabled(owner);

    await program.methods
      .enableAtom()
      .accountsPartial({
        owner: owner.publicKey,
        asset: asset.publicKey,
        agentAccount: agentPda,
      })
      .signers([owner])
      .rpc();

    await expectAnchorError(
      program.methods
        .giveFeedback(
          new BN(9000),
          2,
          90,
          Array.from(randomHash()),
          "quality",
          "weekly",
          "https://api.example.com",
          "https://example.com/feedback/wrong-atom-stats"
        )
        .accountsPartial({
          client: client.publicKey,
          asset: asset.publicKey,
          collection: collectionPubkey,
          agentAccount: agentPda,
          atomConfig: atomConfigPda,
          atomStats: collectionPubkey,
          atomEngineProgram: ATOM_ENGINE_PROGRAM_ID,
          registryAuthority: registryAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([client])
        .rpc(),
      "InvalidAtomStatsAccount"
    );
  });
});
