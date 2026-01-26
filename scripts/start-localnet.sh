#!/bin/bash

# Start Solana localnet with Metaplex Core cloned from devnet
# This allows testing with the real Metaplex Core program

set -e

echo "🚀 Starting Solana localnet with Metaplex Core..."

# Metaplex Core program ID
MPL_CORE_PROGRAM="CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"

# Kill any existing test validator
pkill -9 solana-test-validator || true
sleep 2

# Clean ledger
rm -rf test-ledger

# Start test validator with cloned accounts
solana-test-validator \
  --url https://api.devnet.solana.com \
  --clone $MPL_CORE_PROGRAM \
  --clone-upgradeable-program $MPL_CORE_PROGRAM \
  --reset \
  --quiet &

echo "⏳ Waiting for validator to start..."
sleep 5

# Wait for validator to be ready
until solana cluster-version --url http://localhost:8899 &> /dev/null; do
  echo "   Still waiting..."
  sleep 2
done

echo "✅ Localnet ready!"
echo "📍 RPC: http://localhost:8899"
echo "🔑 Metaplex Core cloned: $MPL_CORE_PROGRAM"

# Show validator logs location
echo "📝 Logs: test-ledger/validator.log"
