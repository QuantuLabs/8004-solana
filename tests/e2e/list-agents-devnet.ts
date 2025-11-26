/**
 * Script to list all agents on devnet identity-registry
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import { IdentityRegistry } from "../../target/types/identity_registry";

const DEVNET_RPC = "https://api.devnet.solana.com";
const IDENTITY_PROGRAM_ID = new PublicKey("2dtvC4hyb7M6fKwNx1C6h4SrahYvor3xW11eH6uLNvSZ");

function loadKeypair(): Keypair {
  const keypairPath = process.env.AGENT_OWNER_KEYPAIR ||
                      `${process.env.HOME}/.config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

async function main() {
  console.log("\n🔍 Searching for agents on devnet...\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = new Wallet(loadKeypair());
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const identityProgram = new Program(
    require("../../target/idl/identity_registry.json") as anchor.Idl,
    provider
  ) as Program<IdentityRegistry>;

  console.log(`Identity Program: ${IDENTITY_PROGRAM_ID.toBase58()}`);
  console.log(`Searching for Agent accounts...\n`);

  try {
    // Get all Agent accounts via getProgramAccounts
    const accounts = await connection.getProgramAccounts(IDENTITY_PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: "3qKZLnL7DSQX", // "agent" discriminator
          },
        },
      ],
    });

    const agents = accounts.map((account) => {
      try {
        const decoded = identityProgram.coder.accounts.decode("agent", account.account.data);
        return {
          publicKey: account.pubkey,
          account: decoded,
        };
      } catch (err) {
        return null;
      }
    }).filter((a) => a !== null);

    console.log(`Found ${agents.length} agent(s):\n`);

    for (const agent of agents) {
      console.log(`Agent PDA: ${agent.publicKey.toBase58()}`);
      console.log(`  Agent ID: ${agent.account.agentId.toNumber()}`);
      console.log(`  Mint: ${agent.account.agentMint.toBase58()}`);
      console.log(`  Owner: ${agent.account.ownerAddress.toBase58()}`);
      console.log(`  Metadata URI: ${agent.account.metadataUri}`);
      console.log(`  Created at: ${new Date(agent.account.createdAt.toNumber() * 1000).toISOString()}`);
      console.log("");
    }

    // Filter agents owned by current wallet
    const myAgents = agents.filter(a =>
      a.account.ownerAddress.toBase58() === wallet.publicKey.toBase58()
    );

    if (myAgents.length > 0) {
      console.log(`\n✅ You own ${myAgents.length} agent(s) on devnet!`);
      console.log(`\nTo test feedbackAuth, use:`);
      console.log(`AGENT_MINT=${myAgents[0].account.agentMint.toBase58()} npx ts-node tests/e2e/feedbackauth-devnet.ts\n`);
    } else {
      console.log(`\n⚠️  No agents found owned by ${wallet.publicKey.toBase58()}`);
      console.log(`You need to register an agent first on devnet.\n`);
    }
  } catch (err) {
    console.error("❌ Error fetching agents:", err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
