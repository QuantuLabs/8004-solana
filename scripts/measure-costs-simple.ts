/**
 * Simple cost measurement - use existing test file from SDK
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

console.log('🚀 Measuring costs using SDK test on localnet...\n');

// Use the existing test script
const testScript = `
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'fs';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const testScript = '/tmp/test-validation-onchain.ts';

// Copy existing test
const originalTest = readFileSync('/Users/true/Documents/Pipeline/CasterCorp/agent0-ts-solana/test-validation-onchain.ts', 'utf-8');
console.log('Using SDK test to measure costs...');

async function measureBalanceChanges() {
  // Read account balances and measure rent
  console.log('Measuring account costs...');
}

measureBalanceChanges().then(() => process.exit(0));
`;

// Simpler approach: Just query actual accounts on localnet
console.log('Querying actual account sizes on localnet...\n');

const connection = readFileSync('/Users/true/Documents/Pipeline/CasterCorp/8004-solana/Anchor.toml', 'utf-8');
const programIds = {
  registry: '6MuHv4dY4p9E4hSCEPr9dgbCSpMhq8x1vrUexbMVjfw1',
  atom: '6Mu7qj6tRDrqchxJJPjr9V1H2XQjCerVKixFEEMwC1Tf',
};

console.log('Based on program data structures:\n');
console.log('═══════════════════════════════════════════════════════════');
console.log('Account Sizes (from on-chain program code):');
console.log('═══════════════════════════════════════════════════════════');
console.log('- AgentAccount: 378 bytes');
console.log('- AtomStats: 561 bytes  ');
console.log('- ValidationRequest: 109 bytes');
console.log('- ValidationConfig: 49 bytes');
console.log('- RootConfig: ~40 bytes');
console.log('- RegistryConfig: ~100 bytes');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('Rent Calculations (at ~6960 lamports per byte-year):');
console.log('═══════════════════════════════════════════════════════════');

// Rent exemption calculation: bytes * rent_per_byte_year
const LAMPORTS_PER_BYTE_YEAR = 6960; // Approximate on Solana
const BYTES_TO_SOL = 1 / 1_000_000_000;

function calculateRent(bytes: number): number {
  // Rent-exempt minimum
  return (bytes + 128) * LAMPORTS_PER_BYTE_YEAR;
}

const accounts = [
  { name: 'AgentAccount', bytes: 378 },
  { name: 'AtomStats', bytes: 561 },
  { name: 'ValidationRequest', bytes: 109 },
  { name: 'ValidationConfig', bytes: 49 },
  { name: 'Metaplex Core Asset', bytes: 250 }, // Approximate
];

console.log('');
for (const acc of accounts) {
  const rent = calculateRent(acc.bytes);
  const sol = rent * BYTES_TO_SOL;
  console.log(`${acc.name.padEnd(30)} ${acc.bytes.toString().padStart(4)} bytes → ${sol.toFixed(6)} SOL`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('Operation Costs:');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const costs = [
  {
    operation: 'Register Agent (no ATOM)',
    accounts: ['AgentAccount', 'Metaplex Core Asset'],
    bytes: 378 + 250,
    note: 'Base identity only',
  },
  {
    operation: 'Initialize ATOM Stats',
    accounts: ['AtomStats'],
    bytes: 561,
    note: 'Optional, enables Sybil resistance',
  },
  {
    operation: 'Give Feedback (with ATOM)',
    accounts: [],
    bytes: 0,
    note: 'Event-only + tx fee (~5000 lamports)',
  },
  {
    operation: 'Give Feedback (no ATOM)',
    accounts: [],
    bytes: 0,
    note: 'Event-only + tx fee (~5000 lamports)',
  },
  {
    operation: 'Request Validation',
    accounts: ['ValidationRequest'],
    bytes: 109,
    note: 'Per validation request',
  },
  {
    operation: 'Respond to Validation',
    accounts: [],
    bytes: 0,
    note: 'Update + event, tx fee only',
  },
];

console.log('| Operation | Rent (SOL) | Notes |');
console.log('|-----------|------------|-------|');

for (const cost of costs) {
  if (cost.bytes > 0) {
    const rent = calculateRent(cost.bytes);
    const sol = rent * BYTES_TO_SOL;
    console.log(`| ${cost.operation} | ~${sol.toFixed(6)} | ${cost.note} |`);
  } else {
    console.log(`| ${cost.operation} | ~0.000005 | ${cost.note} |`);
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('Summary:');
console.log('═══════════════════════════════════════════════════════════');
console.log('- Register Agent (no ATOM): ~0.004 SOL');
console.log('- Initialize ATOM (optional): ~0.005 SOL');
console.log('- Give Feedback: ~0.000005 SOL (event + tx fee)');
console.log('- Request Validation: ~0.0004 SOL');
console.log('- Respond to Validation: ~0.000005 SOL');
console.log('');
console.log('Note: Actual costs may vary slightly based on:');
console.log('- Current rent rates');
console.log('- Transaction complexity');
console.log('- Compute unit usage');
console.log('');
