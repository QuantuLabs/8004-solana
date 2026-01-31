# SEAL v1 - Solana Event Authenticity Layer

Trustless on-chain hash computation for feedback integrity.

## Overview

SEAL v1 ensures that feedback data cannot be tampered with. The program computes `seal_hash` deterministically from all instruction parameters—clients cannot lie about what they submitted.

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT submits (instruction params):                       │
│  value, decimals, score, tag1, tag2, endpoint, uri,         │
│  feedbackFileHash (optional)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  PROGRAM computes ON-CHAIN:                                 │
│  seal_hash = keccak256(canonical_encoding(params))          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LEAF binds seal to context:                                │
│  leaf = keccak256(DOMAIN || asset || client || index ||     │
│                   seal_hash || slot)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  HASH-CHAIN (rolling digests):                              │
│  digest = keccak256(prev_digest || DOMAIN || leaf)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  INDEXER stores events:                                     │
│  seal_hash in feedback_hash column                          │
│  Enables off-chain verification                             │
└─────────────────────────────────────────────────────────────┘
```

## Binary Format

### Seal Hash (Canonical Encoding)

The `seal_hash` is computed from a deterministic binary encoding:

```
FIXED FIELDS (28 bytes):
┌────────────────────────────────────────────────────────────┐
│ Offset │ Size │ Field            │ Format                  │
├────────┼──────┼──────────────────┼─────────────────────────┤
│   0    │  16  │ DOMAIN_SEAL_V1   │ "8004_SEAL_V1____"      │
│  16    │   8  │ value            │ i64 little-endian       │
│  24    │   1  │ value_decimals   │ u8                      │
│  25    │   1  │ score_flag       │ 0=None, 1=Some          │
│  26    │   1  │ score_value      │ u8 (0 if flag=0)        │
│  27    │   1  │ file_hash_flag   │ 0=None, 1=Some          │
└────────┴──────┴──────────────────┴─────────────────────────┘

DYNAMIC FIELDS (after offset 28):
┌────────────────────────────────────────────────────────────┐
│ Order │ Field              │ Format                        │
├───────┼────────────────────┼───────────────────────────────┤
│   1   │ feedback_file_hash │ 32 bytes (only if flag=1)     │
│   2   │ tag1               │ u16 LE length + UTF-8 bytes   │
│   3   │ tag2               │ u16 LE length + UTF-8 bytes   │
│   4   │ endpoint           │ u16 LE length + UTF-8 bytes   │
│   5   │ feedback_uri       │ u16 LE length + UTF-8 bytes   │
└───────┴────────────────────┴───────────────────────────────┘
```

### Leaf Hash (Context Binding)

The leaf binds the seal to its on-chain context:

```
┌────────────────────────────────────────────────────────────┐
│ Offset │ Size │ Field            │ Format                  │
├────────┼──────┼──────────────────┼─────────────────────────┤
│   0    │  16  │ DOMAIN_LEAF_V1   │ "8004_LEAF_V1____"      │
│  16    │  32  │ asset            │ Pubkey bytes            │
│  48    │  32  │ client           │ Pubkey bytes            │
│  80    │   4  │ feedback_index   │ u32 little-endian       │
│  84    │  32  │ seal_hash        │ 32 bytes                │
│ 116    │   8  │ slot             │ u64 little-endian       │
└────────┴──────┴──────────────────┴─────────────────────────┘
Total: 124 bytes
```

## Domain Separators

| Constant | Value (16 bytes) | Usage |
|----------|------------------|-------|
| `DOMAIN_SEAL_V1` | `8004_SEAL_V1____` | Seal hash prefix |
| `DOMAIN_LEAF_V1` | `8004_LEAF_V1____` | Leaf hash prefix |
| `DOMAIN_FEEDBACK` | `8004_FEED_V1___` | Feedback chain |
| `DOMAIN_RESPONSE` | `8004_RESP_V1___` | Response chain |
| `DOMAIN_REVOKE` | `8004_REVK_V1___` | Revoke chain |

## Instruction Changes

### give_feedback

```rust
// Before (v0.5.x)
pub fn give_feedback(
    value: i64,
    value_decimals: u8,
    score: Option<u8>,
    feedback_hash: [u8; 32],  // Client-provided (untrusted)
    tag1: String,
    tag2: String,
    endpoint: String,
    feedback_uri: String,
)

// After (v0.6.0 SEAL v1)
pub fn give_feedback(
    value: i64,
    value_decimals: u8,
    score: Option<u8>,
    feedback_file_hash: Option<[u8; 32]>,  // Optional, only for file linking
    tag1: String,
    tag2: String,
    endpoint: String,
    feedback_uri: String,
)
// seal_hash computed ON-CHAIN from all params
```

### revoke_feedback

```rust
pub fn revoke_feedback(
    feedback_index: u64,
    seal_hash: [u8; 32],  // Must match original (client recomputes)
)
```

### append_response

```rust
pub fn append_response(
    asset_key: Pubkey,
    client_address: Pubkey,
    feedback_index: u64,
    response_uri: String,
    response_hash: [u8; 32],
    seal_hash: [u8; 32],  // Must match original feedback
)
```

## Event Changes

### NewFeedback

```rust
#[event]
pub struct NewFeedback {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub value: i64,
    pub value_decimals: u8,
    pub score: Option<u8>,
    pub tag1: String,
    pub tag2: String,
    pub endpoint: String,
    pub feedback_uri: String,
    pub slot: u64,

    // SEAL v1
    pub feedback_file_hash: Option<[u8; 32]>,  // Optional file hash
    pub seal_hash: [u8; 32],                   // On-chain computed

    // ATOM metrics
    pub atom_enabled: bool,
    pub new_trust_tier: u8,
    pub new_quality_score: u8,
    // ...
}
```

### FeedbackRevoked

```rust
#[event]
pub struct FeedbackRevoked {
    pub asset: Pubkey,
    pub client_address: Pubkey,
    pub feedback_index: u64,
    pub seal_hash: [u8; 32],  // Was feedback_hash
    pub slot: u64,
    // ...
}
```

### ResponseAppended

```rust
#[event]
pub struct ResponseAppended {
    pub asset: Pubkey,
    pub client: Pubkey,
    pub feedback_index: u64,
    pub slot: u64,
    pub responder: Pubkey,
    pub response_hash: [u8; 32],
    pub seal_hash: [u8; 32],  // Was feedback_hash
    pub response_uri: String,
    // ...
}
```

## SDK Usage

### Compute Seal Hash

```typescript
import { computeSealHash } from '8004-solana';

const sealHash = computeSealHash({
  value: 9977n,
  valueDecimals: 2,
  score: 85,  // or null to skip ATOM
  tag1: 'uptime',
  tag2: 'day',
  endpoint: 'https://api.agent.com/mcp',
  feedbackUri: 'ipfs://QmTest123',
  feedbackFileHash: null,  // or Buffer if linking file
});
```

### Verify Feedback Integrity

```typescript
import { computeSealHash } from '8004-solana';

// Fetch feedback from indexer
const feedback = await sdk.readFeedback(asset, client, 0);

// Recompute seal hash
const computed = computeSealHash({
  value: feedback.value,
  valueDecimals: feedback.valueDecimals,
  score: feedback.score,
  tag1: feedback.tag1,
  tag2: feedback.tag2,
  endpoint: feedback.endpoint,
  feedbackUri: feedback.feedbackUri,
  feedbackFileHash: feedback.feedbackFileHash ?? null,
});

// Verify
const isValid = computed.equals(feedback.sealHash);
```

### Revoke with Seal Hash

```typescript
// Option 1: Provide seal hash directly
await sdk.revokeFeedback(asset, feedbackIndex, sealHash);

// Option 2: SDK fetches from indexer
await sdk.revokeFeedback(asset, feedbackIndex);
// Requires indexer to have synced the feedback
```

## Cross-Validation Vectors

These vectors ensure Rust and TypeScript produce identical hashes.

### Vector 1: Minimal

```
Input:
  value: 9977
  valueDecimals: 2
  score: None
  tag1: "uptime"
  tag2: "day"
  endpoint: ""
  feedbackUri: "ipfs://QmTest123"
  feedbackFileHash: None

Expected: 95e4e651a4833ff431d6a290307d37bb3402e4bbad49b0252625b105195b40b6
```

### Vector 2: Full

```
Input:
  value: -100 (negative)
  valueDecimals: 0
  score: Some(85)
  tag1: "x402-resource-delivered"
  tag2: "exact-svm"
  endpoint: "https://api.agent.com/mcp"
  feedbackUri: "ar://abc123"
  feedbackFileHash: Some([0x01; 32])

Expected: 12cb1b6d1351b3a79ff15440d6c41e098a4fb69077670ce6b21c636adf98f04a
```

### Vector 3: Empty Strings

```
Input:
  value: 0
  valueDecimals: 0
  score: Some(0)
  tag1: ""
  tag2: ""
  endpoint: ""
  feedbackUri: ""
  feedbackFileHash: None

Expected: cc81c864e771056c9b0e5fc4401035f0189142d3d44364acf8e5a6597c469c2e
```

### Vector 4: UTF-8

```
Input:
  value: 1000000
  valueDecimals: 6
  score: None
  tag1: "質量" (Chinese)
  tag2: "émoji🎉"
  endpoint: "https://例え.jp/api"
  feedbackUri: "ipfs://QmTest"
  feedbackFileHash: None

Expected: 84be87fdff6ff50a53c30188026d69f28b4888bf4ae9bd93d27cc341520fe6e6
```

## Indexer Integration

The indexer parses SEAL v1 events and stores them:

| Event Field | DB Column | Notes |
|-------------|-----------|-------|
| `seal_hash` | `feedback_hash` | Stored as hex string |
| `feedback_file_hash` | Not stored | Retrievable from URI if needed |

### Verification via Indexer

```typescript
// Fetch from indexer
const feedback = await indexer.getFeedback(asset, client, index);

// feedback.feedback_hash contains the seal_hash
// Recompute and compare to verify integrity
```

## Security Properties

| Property | Guarantee |
|----------|-----------|
| **Trustless** | Hash computed on-chain, client cannot lie |
| **Deterministic** | Same input → same hash (Rust = TypeScript) |
| **Verifiable** | Anyone can recompute and verify |
| **Canonical** | Strict binary format, no ambiguity |
| **Versioned** | Domain separators allow future upgrades |

## Max Lengths (DoS Protection)

| Field | Max Length | Error |
|-------|------------|-------|
| tag1 | 64 bytes | `SealError::TagTooLong` |
| tag2 | 64 bytes | `SealError::TagTooLong` |
| endpoint | 256 bytes | `SealError::EndpointTooLong` |
| feedback_uri | 512 bytes | `SealError::UriTooLong` |

## Compute Cost

| Operation | CU |
|-----------|-----|
| Keccak256 base | ~100 |
| Per 64 bytes | ~8 |
| Total (~200 bytes) | ~125-150 |

Negligible impact on transaction cost.

## Migration from v0.5.x

1. Update SDK to v0.6.0
2. Replace `feedbackHash` with `feedbackFileHash` (optional)
3. For revoke/response, either:
   - Provide `sealHash` directly (recompute with SDK)
   - Let SDK fetch from indexer
4. Update indexer to parse `seal_hash` field

## References

- [ERC-8004 Spec](https://eips.ethereum.org/EIPS/eip-8004)
- [Keccak256](https://keccak.team/keccak.html)
- [Anchor Events](https://www.anchor-lang.com/docs/events)
