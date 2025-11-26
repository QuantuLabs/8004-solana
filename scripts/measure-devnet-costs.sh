#!/usr/bin/env bash
#
# Measure devnet costs for FeedbackAuth operations
#

set -e

echo "🚀 Measuring FeedbackAuth costs on devnet..."
echo "=============================================="
echo ""

# Check balance before
echo "📊 Balance before:"
BALANCE_BEFORE=$(solana balance --url devnet | awk '{print $1}')
echo "$BALANCE_BEFORE SOL"
echo ""

# Run a simple feedbackAuth transaction
echo "📝 Running feedbackAuth transaction with Ed25519..."
ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
npx ts-node tests/e2e/feedbackauth-simple-cost.ts

# Check balance after
echo ""
echo "📊 Balance after:"
BALANCE_AFTER=$(solana balance --url devnet | awk '{print $1}')
echo "$BALANCE_AFTER SOL"

# Calculate cost
COST=$(echo "$BALANCE_BEFORE - $BALANCE_AFTER" | bc)
echo ""
echo "💰 Total cost: $COST SOL"
echo ""
echo "✅ Measurement complete!"
