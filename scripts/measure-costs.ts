/**
 * Measure real costs on localnet for README
 */

import { Keypair, LAMPORTS_PER_SOL, Connection } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import * as path from 'path';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');

interface CostMeasurement {
  operation: string;
  lamports: number;
  sol: string;
  accountSize?: number;
}

const costs: CostMeasurement[] = [];

async function measureCost(operation: string, callback: () => Promise<string>): Promise<number> {
  console.log(`\n📊 Measuring: ${operation}...`);

  const signature = await callback();
  await connection.confirmTransaction(signature, 'confirmed');

  // Get transaction details
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    throw new Error('Transaction not found');
  }

  const fee = tx.meta?.fee || 0;
  const preBalances = tx.meta?.preBalances || [];
  const postBalances = tx.meta?.postBalances || [];

  // Calculate rent cost (excluding fees)
  let rentCost = 0;
  for (let i = 0; i < preBalances.length; i++) {
    const balanceDiff = preBalances[i] - postBalances[i];
    if (balanceDiff > 0) {
      rentCost += balanceDiff;
    }
  }

  rentCost -= fee; // Remove tx fee from rent

  console.log(`  TX Fee: ${fee} lamports (~${(fee / LAMPORTS_PER_SOL).toFixed(8)} SOL)`);
  console.log(`  Rent: ${rentCost} lamports (~${(rentCost / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
  console.log(`  Total: ${rentCost + fee} lamports (~${((rentCost + fee) / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);

  return rentCost;
}

async function main() {
  console.log('🚀 Starting cost measurements on localnet...\n');

  // Load programs
  const registryIdl = JSON.parse(
    readFileSync(
      path.join(__dirname, '../target/idl/agent_registry_8004.json'),
      'utf-8'
    )
  );
  const atomIdl = JSON.parse(
    readFileSync(
      path.join(__dirname, '../target/idl/atom_engine.json'),
      'utf-8'
    )
  );

  const registryProgramId = new anchor.web3.PublicKey(registryIdl.address);
  const atomProgramId = new anchor.web3.PublicKey(atomIdl.address);

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  const registryProgram = new Program(registryIdl, provider);
  const atomProgram = new Program(atomIdl, provider);

  console.log(`📍 Registry Program: ${registryProgramId.toBase58()}`);
  console.log(`📍 ATOM Program: ${atomProgramId.toBase58()}`);
  console.log(`💰 Wallet: ${wallet.publicKey.toBase58()}`);

  // 1. Measure: Initialize Registry (one-time)
  console.log('\n═══════════════════════════════════════');
  console.log('1️⃣  Initialize Registry (one-time setup)');
  console.log('═══════════════════════════════════════');

  const collectionKeypair = Keypair.generate();
  const rootConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('root_config')],
    registryProgramId
  )[0];
  const registryConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('registry_config'), collectionKeypair.publicKey.toBuffer()],
    registryProgramId
  )[0];

  try {
    const initRent = await measureCost('Initialize Registry', async () => {
      const tx = await registryProgram.methods
        .initialize('Base Registry', 'https://8004.example/base')
        .accounts({
          rootConfig: rootConfigPda,
          registryConfig: registryConfigPda,
          collection: collectionKeypair.publicKey,
          authority: wallet.publicKey,
        })
        .signers([collectionKeypair])
        .rpc();
      return tx;
    });

    costs.push({
      operation: 'Initialize Registry (one-time)',
      lamports: initRent,
      sol: `~${(initRent / LAMPORTS_PER_SOL).toFixed(6)}`,
    });
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('  ℹ️  Registry already initialized, skipping...');
    } else {
      throw e;
    }
  }

  // 2. Measure: Initialize ATOM Config (one-time)
  console.log('\n═══════════════════════════════════════');
  console.log('2️⃣  Initialize ATOM Config (one-time setup)');
  console.log('═══════════════════════════════════════');

  const atomConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('atom_config')],
    atomProgramId
  )[0];

  try {
    const atomInitRent = await measureCost('Initialize ATOM Config', async () => {
      const tx = await atomProgram.methods
        .initializeConfig(registryProgramId)
        .accounts({
          authority: wallet.publicKey,
          config: atomConfigPda,
        })
        .rpc();
      return tx;
    });

    costs.push({
      operation: 'Initialize ATOM Config (one-time)',
      lamports: atomInitRent,
      sol: `~${(atomInitRent / LAMPORTS_PER_SOL).toFixed(6)}`,
    });
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('  ℹ️  ATOM Config already initialized, skipping...');
    } else {
      throw e;
    }
  }

  // 3. Measure: Register Agent (WITHOUT ATOM)
  console.log('\n═══════════════════════════════════════');
  console.log('3️⃣  Register Agent (WITHOUT ATOM init)');
  console.log('═══════════════════════════════════════');

  const agentKeypair1 = Keypair.generate();
  const agentAccountPda1 = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), agentKeypair1.publicKey.toBuffer()],
    registryProgramId
  )[0];

  const registerRent = await measureCost('Register Agent (no ATOM)', async () => {
    const tx = await registryProgram.methods
      .register('ipfs://test-agent')
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentAccountPda1,
        asset: agentKeypair1.publicKey,
        collection: collectionKeypair.publicKey,
        owner: wallet.publicKey,
      })
      .signers([agentKeypair1])
      .rpc();
    return tx;
  });

  const agentAccountInfo = await connection.getAccountInfo(agentAccountPda1);
  const agentAccountSize = agentAccountInfo?.data.length || 0;

  costs.push({
    operation: 'Register Agent (no ATOM)',
    lamports: registerRent,
    sol: `~${(registerRent / LAMPORTS_PER_SOL).toFixed(6)}`,
    accountSize: agentAccountSize,
  });

  // 4. Measure: Initialize ATOM Stats (optional)
  console.log('\n═══════════════════════════════════════');
  console.log('4️⃣  Initialize ATOM Stats (optional)');
  console.log('═══════════════════════════════════════');

  const atomStatsPda1 = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('atom_stats'), agentKeypair1.publicKey.toBuffer()],
    atomProgramId
  )[0];

  const atomInitStatsRent = await measureCost('Initialize ATOM Stats', async () => {
    const tx = await atomProgram.methods
      .initializeStats()
      .accounts({
        owner: wallet.publicKey,
        asset: agentKeypair1.publicKey,
        collection: collectionKeypair.publicKey,
        config: atomConfigPda,
        stats: atomStatsPda1,
      })
      .rpc();
    return tx;
  });

  const atomStatsInfo = await connection.getAccountInfo(atomStatsPda1);
  const atomStatsSize = atomStatsInfo?.data.length || 0;

  costs.push({
    operation: 'Initialize ATOM Stats (optional)',
    lamports: atomInitStatsRent,
    sol: `~${(atomInitStatsRent / LAMPORTS_PER_SOL).toFixed(6)}`,
    accountSize: atomStatsSize,
  });

  // 5. Measure: Give Feedback WITH ATOM
  console.log('\n═══════════════════════════════════════');
  console.log('5️⃣  Give Feedback (WITH ATOM)');
  console.log('═══════════════════════════════════════');

  const clientKeypair = Keypair.generate();
  // Airdrop to client
  const airdropSig = await connection.requestAirdrop(clientKeypair.publicKey, 1 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const atomCpiAuthorityPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('atom_cpi_authority')],
    registryProgramId
  )[0];

  const feedbackWithAtomRent = await measureCost('Give Feedback (with ATOM)', async () => {
    const tx = await registryProgram.methods
      .giveFeedback(
        85, // score
        'test',
        '',
        '',
        'ipfs://feedback',
        Array.from(new Uint8Array(32)),
        new anchor.BN(1)
      )
      .accounts({
        client: clientKeypair.publicKey,
        agentAccount: agentAccountPda1,
        asset: agentKeypair1.publicKey,
        collection: collectionKeypair.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda1,
        atomEngineProgram: atomProgramId,
        registryAuthority: atomCpiAuthorityPda,
      })
      .signers([clientKeypair])
      .rpc();
    return tx;
  });

  costs.push({
    operation: 'Give Feedback (with ATOM)',
    lamports: feedbackWithAtomRent,
    sol: `~${(feedbackWithAtomRent / LAMPORTS_PER_SOL).toFixed(8)}`,
  });

  // 6. Measure: Register Agent WITHOUT ATOM and Give Feedback
  console.log('\n═══════════════════════════════════════');
  console.log('6️⃣  Register Agent + Feedback (NO ATOM)');
  console.log('═══════════════════════════════════════');

  const agentKeypair2 = Keypair.generate();
  const agentAccountPda2 = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), agentKeypair2.publicKey.toBuffer()],
    registryProgramId
  )[0];

  await measureCost('Register Agent 2', async () => {
    const tx = await registryProgram.methods
      .register('ipfs://test-agent-2')
      .accounts({
        registryConfig: registryConfigPda,
        agentAccount: agentAccountPda2,
        asset: agentKeypair2.publicKey,
        collection: collectionKeypair.publicKey,
        owner: wallet.publicKey,
      })
      .signers([agentKeypair2])
      .rpc();
    return tx;
  });

  const atomStatsPda2 = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('atom_stats'), agentKeypair2.publicKey.toBuffer()],
    atomProgramId
  )[0];

  const feedbackNoAtomRent = await measureCost('Give Feedback (NO ATOM)', async () => {
    const tx = await registryProgram.methods
      .giveFeedback(
        75,
        'test',
        '',
        '',
        'ipfs://feedback2',
        Array.from(new Uint8Array(32)),
        new anchor.BN(1)
      )
      .accounts({
        client: clientKeypair.publicKey,
        agentAccount: agentAccountPda2,
        asset: agentKeypair2.publicKey,
        collection: collectionKeypair.publicKey,
        atomConfig: atomConfigPda,
        atomStats: atomStatsPda2, // Uninitialized!
        atomEngineProgram: atomProgramId,
        registryAuthority: atomCpiAuthorityPda,
      })
      .signers([clientKeypair])
      .rpc();
    return tx;
  });

  costs.push({
    operation: 'Give Feedback (NO ATOM)',
    lamports: feedbackNoAtomRent,
    sol: `~${(feedbackNoAtomRent / LAMPORTS_PER_SOL).toFixed(8)}`,
  });

  // 7. Measure: Request Validation
  console.log('\n═══════════════════════════════════════');
  console.log('7️⃣  Request Validation');
  console.log('═══════════════════════════════════════');

  const validatorKeypair = Keypair.generate();
  const nonce = 1;
  const validationConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('validation_config')],
    registryProgramId
  )[0];
  const validationRequestPda = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('validation'),
      agentKeypair1.publicKey.toBuffer(),
      validatorKeypair.publicKey.toBuffer(),
      Buffer.from(new Uint8Array(new Uint32Array([nonce]).buffer)),
    ],
    registryProgramId
  )[0];

  const validationRent = await measureCost('Request Validation', async () => {
    const tx = await registryProgram.methods
      .requestValidation(
        nonce,
        'ipfs://validation-request',
        Array.from(new Uint8Array(32))
      )
      .accounts({
        requester: wallet.publicKey,
        agentAccount: agentAccountPda1,
        asset: agentKeypair1.publicKey,
        validatorAddress: validatorKeypair.publicKey,
        validationConfig: validationConfigPda,
        validationRequest: validationRequestPda,
      })
      .rpc();
    return tx;
  });

  const validationRequestInfo = await connection.getAccountInfo(validationRequestPda);
  const validationRequestSize = validationRequestInfo?.data.length || 0;

  costs.push({
    operation: 'Request Validation',
    lamports: validationRent,
    sol: `~${(validationRent / LAMPORTS_PER_SOL).toFixed(6)}`,
    accountSize: validationRequestSize,
  });

  // 8. Measure: Respond to Validation
  console.log('\n═══════════════════════════════════════');
  console.log('8️⃣  Respond to Validation');
  console.log('═══════════════════════════════════════');

  // Airdrop to validator
  const validatorAirdrop = await connection.requestAirdrop(validatorKeypair.publicKey, 1 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(validatorAirdrop);

  const respondRent = await measureCost('Respond to Validation', async () => {
    const tx = await registryProgram.methods
      .respondToValidation(
        nonce,
        90, // score
        'ipfs://validation-response',
        Array.from(new Uint8Array(32))
      )
      .accounts({
        validator: validatorKeypair.publicKey,
        agentAccount: agentAccountPda1,
        asset: agentKeypair1.publicKey,
        validationConfig: validationConfigPda,
        validationRequest: validationRequestPda,
      })
      .signers([validatorKeypair])
      .rpc();
    return tx;
  });

  costs.push({
    operation: 'Respond to Validation',
    lamports: respondRent,
    sol: `~${(respondRent / LAMPORTS_PER_SOL).toFixed(8)}`,
  });

  // Print Summary
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    COST SUMMARY                            ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('| Operation | Rent (SOL) | Account Size | Notes |');
  console.log('|-----------|------------|--------------|-------|');

  for (const cost of costs) {
    const sizeStr = cost.accountSize ? `${cost.accountSize}B` : 'N/A';
    const notes = cost.operation.includes('one-time') ? 'One-time setup' :
                  cost.operation.includes('NO ATOM') ? 'Basic ERC-8004' :
                  cost.operation.includes('ATOM') ? 'With Sybil resistance' : 'Per operation';
    console.log(`| ${cost.operation} | ${cost.sol} | ${sizeStr} | ${notes} |`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ Cost measurements complete!');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
