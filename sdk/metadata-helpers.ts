import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

/**
 * Get PDA for metadata extension account
 * Seeds: ["metadata_ext", agent_mint, key]
 */
export function getMetadataExtPda(
  programId: PublicKey,
  agentMint: PublicKey,
  key: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata_ext"),
      agentMint.toBuffer(),
      Buffer.from(key)
    ],
    programId
  );
}

/**
 * Set extended metadata (creates PDA if needed)
 *
 * NOTE: This is a template for implementing extension PDAs.
 * Requires custom instruction implementation in the program.
 *
 * @param program - Anchor program instance
 * @param agentMint - Agent NFT mint address
 * @param key - Metadata key (max 32 bytes)
 * @param value - Metadata value (max 256 bytes)
 */
export async function setExtendedMetadata(
  program: Program,
  agentMint: PublicKey,
  key: string,
  value: Uint8Array
): Promise<void> {
  // Validate inputs
  if (key.length > 32) {
    throw new Error("Key must be ≤32 bytes");
  }
  if (value.length > 256) {
    throw new Error("Value must be ≤256 bytes");
  }

  const [metadataExtPda] = getMetadataExtPda(
    program.programId,
    agentMint,
    key
  );

  // NOTE: This requires implementing a custom instruction
  // Example:
  /*
  await program.methods
    .setMetadataExtension(key, Array.from(value))
    .accounts({
      metadataExtPda,
      agentMint,
      payer: program.provider.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  */

  throw new Error(
    "Extension PDAs require custom instruction implementation. " +
    "See docs/METADATA_EXTENSIONS.md for details."
  );
}

/**
 * Get extended metadata value
 *
 * NOTE: This is a template for implementing extension PDAs.
 * Requires custom account structure in the program.
 */
export async function getExtendedMetadata(
  program: Program,
  agentMint: PublicKey,
  key: string
): Promise<Uint8Array | null> {
  const [metadataExtPda] = getMetadataExtPda(
    program.programId,
    agentMint,
    key
  );

  try {
    // NOTE: This requires defining MetadataExtensionAccount structure
    // Example:
    /*
    const account = await program.account.metadataExtensionAccount.fetch(metadataExtPda);
    return new Uint8Array(account.value);
    */

    throw new Error(
      "Extension PDAs require custom account structure. " +
      "See docs/METADATA_EXTENSIONS.md for details."
    );
  } catch (error) {
    // Account doesn't exist
    return null;
  }
}

/**
 * Upload metadata JSON to IPFS
 *
 * This is a placeholder - implement with your preferred IPFS client
 * (e.g., @pinata/sdk, ipfs-http-client, nft.storage)
 */
export async function uploadMetadataToIPFS(
  metadata: Record<string, any>
): Promise<string> {
  // Example using Pinata:
  /*
  const pinata = new PinataClient(apiKey, secretKey);
  const result = await pinata.pinJSONToIPFS(metadata);
  return `ipfs://${result.IpfsHash}`;
  */

  throw new Error(
    "IPFS upload not implemented. " +
    "Install @pinata/sdk or ipfs-http-client and implement this function."
  );
}

/**
 * Fetch metadata JSON from IPFS
 */
export async function fetchMetadataFromIPFS(
  uri: string
): Promise<Record<string, any>> {
  // Convert ipfs:// to HTTP gateway
  const httpUrl = uri.replace("ipfs://", "https://ipfs.io/ipfs/");

  const response = await fetch(httpUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch metadata: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Helper to combine on-chain and off-chain metadata
 *
 * @param program - Anchor program instance
 * @param agentPda - Agent account PDA
 * @returns Combined metadata from on-chain and tokenURI
 */
export async function getAllMetadata(
  program: Program,
  agentPda: PublicKey
): Promise<Record<string, any>> {
  // Fetch agent account
  const agent = await program.account.agentAccount.fetch(agentPda);

  // Start with on-chain metadata
  const combined: Record<string, any> = {};

  for (const entry of agent.metadata) {
    combined[entry.key] = Buffer.from(entry.value).toString("utf-8");
  }

  // Fetch off-chain metadata if tokenURI is set
  if (agent.tokenUri && agent.tokenUri.length > 0) {
    try {
      const offChainMetadata = await fetchMetadataFromIPFS(agent.tokenUri);
      // Merge, with on-chain taking precedence
      Object.assign(combined, offChainMetadata, combined);
    } catch (error) {
      console.warn("Failed to fetch off-chain metadata:", error);
    }
  }

  return combined;
}

/**
 * Recommended metadata schema for agents
 */
export interface AgentMetadataSchema {
  // On-chain (frequently queried)
  name?: string;
  type?: string;
  version?: string;
  mcp_endpoint?: string;
  a2a_endpoint?: string;
  wallet?: string;
  ens_name?: string;
  operator?: string;
  status?: string;
  health_endpoint?: string;

  // Off-chain (IPFS/Arweave)
  description?: string;
  image?: string;
  external_url?: string;
  skills?: string[];
  domains?: string[];
  capabilities?: {
    languages?: string[];
    tools?: string[];
    models?: string[];
  };
  performance_history?: any[];
  interaction_logs?: string;
}

/**
 * Split metadata into on-chain and off-chain based on schema
 */
export function splitMetadata(
  metadata: AgentMetadataSchema
): {
  onChain: Record<string, Buffer>;
  offChain: Record<string, any>;
} {
  const onChainKeys = new Set([
    "name",
    "type",
    "version",
    "mcp_endpoint",
    "a2a_endpoint",
    "wallet",
    "ens_name",
    "operator",
    "status",
    "health_endpoint",
  ]);

  const onChain: Record<string, Buffer> = {};
  const offChain: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (onChainKeys.has(key) && typeof value === "string") {
      onChain[key] = Buffer.from(value);
    } else {
      offChain[key] = value;
    }
  }

  return { onChain, offChain };
}
