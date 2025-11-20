#!/bin/bash
# Script to measure exact transaction costs on devnet for ERC-8004 Solana programs
# Does NOT rely on Anchor IDL - uses Solana CLI directly

set -e

echo "========================================="
echo "ERC-8004 Devnet Cost Measurement"
echo "========================================="
echo ""

# Program IDs on devnet
IDENTITY_REGISTRY="AcngQwqu55Ut92MAP5owPh6PhsJUZhaTAG5ULyvW1TpR"
REPUTATION_REGISTRY="9WcFLL3Fsqs96JxuewEt9iqRwULtCZEsPT717hPbsQAa"
VALIDATION_REGISTRY="2masQXYbHKXMrTV9aNLTWS4NMbNHfJhgcsLBtP6N5j6x"

# Ensure devnet cluster
solana config set --url devnet > /dev/null
CURRENT_BALANCE=$(solana balance --lamports | grep -oE '[0-9]+')
echo "Current devnet balance: $(echo "scale=9; $CURRENT_BALANCE / 1000000000" | bc) SOL"
echo ""

echo "========================================="
echo "DEPLOYMENT COSTS (already deployed)"
echo "========================================="
echo ""

# Identity Registry deployment cost
echo "📦 Identity Registry: $IDENTITY_REGISTRY"
IDENTITY_SIZE=$(solana program show $IDENTITY_REGISTRY | grep "Data Length" | awk '{print $3}')
IDENTITY_RENT=$(solana program show $IDENTITY_REGISTRY | grep "Balance" | awk '{print $2}')
echo "   Size: $IDENTITY_SIZE bytes"
echo "   Rent-exempt minimum: $IDENTITY_RENT SOL"
echo ""

# Reputation Registry deployment cost
echo "📦 Reputation Registry: $REPUTATION_REGISTRY"
REPUTATION_SIZE=$(solana program show $REPUTATION_REGISTRY | grep "Data Length" | awk '{print $3}')
REPUTATION_RENT=$(solana program show $REPUTATION_REGISTRY | grep "Balance" | awk '{print $2}')
echo "   Size: $REPUTATION_SIZE bytes"
echo "   Rent-exempt minimum: $REPUTATION_RENT SOL"
echo ""

# Validation Registry deployment cost
echo "📦 Validation Registry: $VALIDATION_REGISTRY"
VALIDATION_SIZE=$(solana program show $VALIDATION_REGISTRY | grep "Data Length" | awk '{print $3}')
VALIDATION_RENT=$(solana program show $VALIDATION_REGISTRY | grep "Balance" | awk '{print $2}')
echo "   Size: $VALIDATION_SIZE bytes"
echo "   Rent-exempt minimum: $VALIDATION_RENT SOL"
echo ""

# Calculate total deployment cost
TOTAL_DEPLOYMENT=$(echo "$IDENTITY_RENT + $REPUTATION_RENT + $VALIDATION_RENT" | bc)
echo "💰 TOTAL DEPLOYMENT COST: $TOTAL_DEPLOYMENT SOL"
echo ""

echo "========================================="
echo "ACCOUNT RENT COSTS (per operation)"
echo "========================================="
echo ""

# Standard Solana rent calculation (at 6965 lamports per byte-year)
# These are theoretical minimums based on account sizes

echo "📝 Agent Account (Identity Registry)"
AGENT_ACCOUNT_SIZE=297  # 8 discriminator + 8 agent_id + 32 owner + 32 agent_mint + 200 token_uri + 8 timestamp + 8 status + 1 bump
AGENT_ACCOUNT_RENT=$(echo "scale=9; ($AGENT_ACCOUNT_SIZE * 6965) / 1000000000" | bc)
echo "   Size: $AGENT_ACCOUNT_SIZE bytes"
echo "   Rent: ~$AGENT_ACCOUNT_RENT SOL"
echo ""

echo "📝 Metadata Entry (Identity Registry)"
METADATA_ENTRY_SIZE=307  # 8 discriminator + 8 agent_id + 32 key + 256 value + 1 bump + 8 timestamp
METADATA_ENTRY_RENT=$(echo "scale=9; ($METADATA_ENTRY_SIZE * 6965) / 1000000000" | bc)
echo "   Size: $METADATA_ENTRY_SIZE bytes"
echo "   Rent: ~$METADATA_ENTRY_RENT SOL"
echo ""

echo "📝 Feedback Account (Reputation Registry)"
FEEDBACK_ACCOUNT_SIZE=526  # 8 discriminator + 8 agent_id + 32 client + 8 index + 1 score + 64 tags + 200 uri + 32 hash + 1 revoked + 8 timestamp + 1 bump
FEEDBACK_ACCOUNT_RENT=$(echo "scale=9; ($FEEDBACK_ACCOUNT_SIZE * 6965) / 1000000000" | bc)
echo "   Size: $FEEDBACK_ACCOUNT_SIZE bytes"
echo "   Rent: ~$FEEDBACK_ACCOUNT_RENT SOL"
echo ""

echo "📝 Response Account (Reputation Registry)"
RESPONSE_ACCOUNT_SIZE=322  # 8 discriminator + 8 agent_id + 32 client + 8 feedback_index + 8 response_index + 32 responder + 200 uri + 32 hash + 8 timestamp + 1 bump
RESPONSE_ACCOUNT_RENT=$(echo "scale=9; ($RESPONSE_ACCOUNT_SIZE * 6965) / 1000000000" | bc)
echo "   Size: $RESPONSE_ACCOUNT_SIZE bytes"
echo "   Rent: ~$RESPONSE_ACCOUNT_RENT SOL"
echo ""

echo "📝 Validation Request (Validation Registry)"
VALIDATION_REQUEST_SIZE=147  # 8 discriminator + 8 agent_id + 32 validator + 4 nonce + 32 request_hash + 32 response_hash + 1 response + 8 created_at + 8 responded_at + 1 bump
VALIDATION_REQUEST_RENT=$(echo "scale=9; ($VALIDATION_REQUEST_SIZE * 6965) / 1000000000" | bc)
echo "   Size: $VALIDATION_REQUEST_SIZE bytes"
echo "   Rent: ~$VALIDATION_REQUEST_RENT SOL"
echo ""

echo "========================================="
echo "ESTIMATED TRANSACTION COSTS"
echo "========================================="
echo ""
echo "Note: Base transaction fee is 5000 lamports (0.000005 SOL)"
echo "      Priority fees may add ~0.000001-0.000010 SOL depending on network"
echo ""

# Base transaction fee on Solana
BASE_TX_FEE="0.000005"

echo "Identity Registry Operations:"
echo "  • Initialize: $BASE_TX_FEE SOL (tx fee only, one-time)"
echo "  • Register Agent: $(echo "$BASE_TX_FEE + $AGENT_ACCOUNT_RENT" | bc) SOL (tx + agent account rent)"
echo "  • Set Metadata: $(echo "$BASE_TX_FEE + $METADATA_ENTRY_RENT" | bc) SOL (tx + metadata entry rent)"
echo "  • Set Agent URI: $BASE_TX_FEE SOL (tx fee only, updates existing)"
echo "  • Transfer Agent: $BASE_TX_FEE SOL (tx fee only, transfers ownership)"
echo "  • Sync Owner: $BASE_TX_FEE SOL (tx fee only, syncs from NFT)"
echo ""

echo "Reputation Registry Operations:"
echo "  • Give Feedback: $(echo "$BASE_TX_FEE + $FEEDBACK_ACCOUNT_RENT" | bc) SOL (tx + feedback account rent)"
echo "  • Revoke Feedback: $BASE_TX_FEE SOL (tx fee only, updates existing)"
echo "  • Append Response: $(echo "$BASE_TX_FEE + $RESPONSE_ACCOUNT_RENT" | bc) SOL (tx + response account rent)"
echo ""

echo "Validation Registry Operations:"
echo "  • Initialize: $BASE_TX_FEE SOL (tx fee only, one-time)"
echo "  • Request Validation: $(echo "$BASE_TX_FEE + $VALIDATION_REQUEST_RENT" | bc) SOL (tx + validation request rent)"
echo "  • Respond to Validation: $BASE_TX_FEE SOL (tx fee only, updates existing)"
echo ""

echo "========================================="
echo "REAL TRANSACTION COST VERIFICATION"
echo "========================================="
echo ""
echo "To get EXACT costs, we need to execute real transactions on devnet."
echo "This would require:"
echo "  1. Funding a test wallet with devnet SOL"
echo "  2. Executing each operation"
echo "  3. Analyzing transaction signatures with 'solana confirm -v <signature>'"
echo ""
echo "Current balance: $(echo "scale=9; $CURRENT_BALANCE / 1000000000" | bc) SOL"
echo ""

if (( CURRENT_BALANCE < 100000000 )); then
  echo "⚠️  WARNING: Balance too low for comprehensive testing"
  echo "    Need at least 0.1 SOL for multiple test transactions"
  echo "    Request devnet SOL: solana airdrop 1"
else
  echo "✅ Balance sufficient for testing"
fi

echo ""
echo "========================================="
echo "SUMMARY"
echo "========================================="
echo ""
echo "Deployment (one-time, already done): $TOTAL_DEPLOYMENT SOL"
echo ""
echo "Per-Operation Costs (estimates):"
echo "  • Register Agent: ~$(echo "$BASE_TX_FEE + $AGENT_ACCOUNT_RENT" | bc) SOL"
echo "  • Give Feedback: ~$(echo "$BASE_TX_FEE + $FEEDBACK_ACCOUNT_RENT" | bc) SOL"
echo "  • Request Validation: ~$(echo "$BASE_TX_FEE + $VALIDATION_REQUEST_RENT" | bc) SOL"
echo ""
echo "Note: Actual costs may vary based on:"
echo "  - Compute unit consumption (CU pricing)"
echo "  - Priority fees (network congestion)"
echo "  - Account size (if using optional fields)"
echo ""
