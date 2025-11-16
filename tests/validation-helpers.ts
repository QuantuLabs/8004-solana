import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { ValidationRegistry } from "../target/types/validation_registry";
import { IdentityRegistry } from "../target/types/identity_registry";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import * as crypto from "crypto";

// Metaplex imports
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Helper function: Get validation config PDA
export function getValidationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
}

// Helper function: Get validation request PDA
export function getValidationRequestPda(
  programId: PublicKey,
  agentId: number,
  validatorAddress: PublicKey,
  nonce: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("validation"),
      new BN(agentId).toArrayLike(Buffer, "le", 8),
      validatorAddress.toBuffer(),
      new BN(nonce).toArrayLike(Buffer, "le", 4),
    ],
    programId
  );
}

// Helper function: Get agent account PDA (from Identity Registry)
export function getAgentAccountPda(
  identityProgramId: PublicKey,
  agentMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentMint.toBuffer()],
    identityProgramId
  );
}

// Helper function: Get identity config PDA
export function getIdentityConfigPda(identityProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    identityProgramId
  );
}

// Helper function: Compute SHA-256 hash
export function computeHash(content: string): Buffer {
  return crypto.createHash("sha256").update(content).digest();
}

// Helper function: Register an agent in Identity Registry
export async function registerAgent(
  identityProgram: Program<IdentityRegistry>,
  provider: anchor.AnchorProvider,
  owner: Keypair
): Promise<{
  id: number;
  owner: Keypair;
  mint: Keypair;
  account: PublicKey;
}> {
  // Airdrop SOL to owner
  const airdropSig = await provider.connection.requestAirdrop(
    owner.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropSig);

  const agentMint = Keypair.generate();
  const [agentAccount] = getAgentAccountPda(identityProgram.programId, agentMint.publicKey);
  const [configPda] = getIdentityConfigPda(identityProgram.programId);

  // Get current agent count to determine next ID
  const config = await identityProgram.account.registryConfig.fetch(configPda);
  const agentId = config.nextAgentId.toNumber();

  // Get metadata PDAs
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      agentMint.publicKey.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );

  const [masterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      agentMint.publicKey.toBuffer(),
      Buffer.from("edition"),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );

  const tokenAccount = await getAssociatedTokenAddress(
    agentMint.publicKey,
    owner.publicKey
  );

  // Get collection metadata PDAs
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      config.collectionMint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );

  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      config.collectionMint.toBuffer(),
      Buffer.from("edition"),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );

  await identityProgram.methods
    .registerEmpty()
    .accounts({
      config: configPda,
      authority: config.authority,
      agentAccount,
      agentMint: agentMint.publicKey,
      agentMetadata: metadata,
      agentMasterEdition: masterEdition,
      agentTokenAccount: tokenAccount,
      collectionMint: config.collectionMint,
      collectionMetadata,
      collectionMasterEdition,
      owner: owner.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
      sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .signers([owner, agentMint])
    .rpc();

  return {
    id: agentId,
    owner,
    mint: agentMint,
    account: agentAccount,
  };
}

// Helper function: Request validation
export async function requestValidation(
  validationProgram: Program<ValidationRegistry>,
  identityProgram: Program<IdentityRegistry>,
  config: {
    validationConfig: PublicKey;
    agentId: number;
    agentAccount: PublicKey;
    agentOwner: Keypair;
    validatorAddress: PublicKey;
    nonce: number;
    requestUri: string;
    requestHash: Buffer;
  }
): Promise<PublicKey> {
  const [validationRequest] = getValidationRequestPda(
    validationProgram.programId,
    config.agentId,
    config.validatorAddress,
    config.nonce
  );

  await validationProgram.methods
    .requestValidation(
      new BN(config.agentId),
      config.validatorAddress,
      config.nonce,
      config.requestUri,
      Array.from(config.requestHash)
    )
    .accounts({
      config: config.validationConfig,
      requester: config.agentOwner.publicKey,
      payer: config.agentOwner.publicKey,
      agentAccount: config.agentAccount,
      validationRequest,
      identityRegistryProgram: identityProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .signers([config.agentOwner])
    .rpc();

  return validationRequest;
}

// Helper function: Respond to validation
export async function respondToValidation(
  validationProgram: Program<ValidationRegistry>,
  config: {
    validationConfig: PublicKey;
    validationRequest: PublicKey;
    validator: Keypair;
    response: number;
    responseUri: string;
    responseHash: Buffer;
    tag: Buffer;
  }
): Promise<void> {
  await validationProgram.methods
    .respondToValidation(
      config.response,
      config.responseUri,
      Array.from(config.responseHash),
      Array.from(config.tag)
    )
    .accounts({
      config: config.validationConfig,
      validator: config.validator.publicKey,
      validationRequest: config.validationRequest,
    })
    .signers([config.validator])
    .rpc();
}
