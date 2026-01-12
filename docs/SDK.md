# ERC-8004 Solana SDK Specification

**Status**: 📝 Specification Only (Implementation after Validation Registry)
**Target**: TypeScript SDK compatible with agent0-ts patterns
**ERC-8004 Compliance**: Required for 100% specification compliance

---

## Overview

The SDK will provide client-side methods to interact with all three ERC-8004 registries on Solana. This document specifies the read functions required by the ERC-8004 Reputation Registry specification, which are currently missing (0/6 implemented).

---

## Part 1: Reputation Registry Read Functions

### 1.1 getSummary()

**ERC-8004 Spec**:
```solidity
function getSummary(
    uint256 agentId,
    bool includeRevoked,
    address[] calldata clientAddresses,
    uint8 minScore,
    bytes32[] calldata tag1,
    bytes32[] calldata tag2
) external view returns (uint256 count, uint256 averageScore)
```

**SDK Signature**:
```typescript
async getSummary(
  agentId: number,
  options?: {
    includeRevoked?: boolean;      // Default: false
    clientAddresses?: PublicKey[]; // Filter by specific clients
    minScore?: number;             // Filter feedbacks >= minScore
    tag1?: Buffer[];               // Filter by tag1 values
    tag2?: Buffer[];               // Filter by tag2 values
  }
): Promise<{
  count: number;
  averageScore: number;
}>
```

**Implementation Strategy**:
1. Fetch AgentReputationMetadata PDA (gives global count/average)
2. If no filters provided, return cached values (O(1) optimization)
3. If filters provided:
   - Use `getProgramAccounts` to fetch all FeedbackAccount PDAs for this agent
   - Apply client-side filtering (includeRevoked, clientAddresses, minScore, tags)
   - Calculate filtered count and average

**PDA Derivation**:
```typescript
const [reputationPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("agent_reputation"),
    Buffer.from(new BN(agentId).toArray("le", 8))
  ],
  REPUTATION_PROGRAM_ID
);
```

**Complexity**:
- No filters: O(1) - fetch cached metadata
- With filters: O(n) - fetch all feedbacks + client-side filter

---

### 1.2 readFeedback()

**ERC-8004 Spec**:
```solidity
function readFeedback(
    uint256 agentId,
    address clientAddress,
    uint64 feedbackIndex
) external view returns (
    uint8 score,
    bytes32 tag1,
    bytes32 tag2,
    string memory fileuri,
    bytes32 filehash,
    bool isRevoked
)
```

**SDK Signature**:
```typescript
async readFeedback(
  agentId: number,
  clientAddress: PublicKey,
  feedbackIndex: number
): Promise<{
  score: number;
  tag1: Buffer;
  tag2: Buffer;
  fileUri: string;
  fileHash: Buffer;
  isRevoked: boolean;
  createdAt: number;
} | null>
```

**Implementation Strategy**:
1. Derive FeedbackAccount PDA from (agentId, clientAddress, feedbackIndex)
2. Fetch account data
3. Return null if account doesn't exist
4. Parse and return feedback data

**PDA Derivation**:
```typescript
const [feedbackPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("feedback"),
    Buffer.from(new BN(agentId).toArray("le", 8)),
    clientAddress.toBuffer(),
    Buffer.from(new BN(feedbackIndex).toArray("le", 8))
  ],
  REPUTATION_PROGRAM_ID
);
```

**Complexity**: O(1) - single PDA fetch

---

### 1.3 readAllFeedback()

**ERC-8004 Spec**:
```solidity
function readAllFeedback(
    uint256 agentId,
    address clientAddress,
    bool includeRevoked
) external view returns (FeedbackData[] memory)
```

**SDK Signature**:
```typescript
async readAllFeedback(
  agentId: number,
  clientAddress: PublicKey,
  includeRevoked: boolean = false
): Promise<Array<{
  feedbackIndex: number;
  score: number;
  tag1: Buffer;
  tag2: Buffer;
  fileUri: string;
  fileHash: Buffer;
  isRevoked: boolean;
  createdAt: number;
}>>
```

**Implementation Strategy**:
1. Get last index via `getLastIndex(agentId, clientAddress)`
2. Fetch all FeedbackAccount PDAs from index 0 to lastIndex
3. Filter out revoked feedbacks if `includeRevoked = false`
4. Return sorted by feedbackIndex

**Alternative Strategy** (more efficient):
```typescript
// Use getProgramAccounts with memcmp filters
const feedbacks = await connection.getProgramAccounts(
  REPUTATION_PROGRAM_ID,
  {
    filters: [
      { memcmp: { offset: 8, bytes: agentIdBytes } },     // Offset 8 = after discriminator
      { memcmp: { offset: 16, bytes: clientAddress.toBase58() } }
    ]
  }
);
```

**Complexity**:
- Direct fetch: O(n) where n = lastIndex
- getProgramAccounts: O(m) where m = actual feedback count

---

### 1.4 getLastIndex()

**ERC-8004 Spec**:
```solidity
function getLastIndex(
    uint256 agentId,
    address clientAddress
) external view returns (uint64)
```

**SDK Signature**:
```typescript
async getLastIndex(
  agentId: number,
  clientAddress: PublicKey
): Promise<number>
```

**Implementation Strategy**:
1. Derive ClientIndexAccount PDA
2. Fetch account data
3. Return `last_index` field
4. Return 0 if account doesn't exist (client never gave feedback)

**PDA Derivation**:
```typescript
const [clientIndexPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("client_index"),
    Buffer.from(new BN(agentId).toArray("le", 8)),
    clientAddress.toBuffer()
  ],
  REPUTATION_PROGRAM_ID
);
```

**Complexity**: O(1) - single PDA fetch

---

### 1.5 getClients()

**ERC-8004 Spec**:
```solidity
function getClients(uint256 agentId) external view returns (address[] memory)
```

**SDK Signature**:
```typescript
async getClients(agentId: number): Promise<PublicKey[]>
```

**Implementation Strategy** (Option 1 - Indexer):
```typescript
// Use Helius or Shyft indexer
const accounts = await indexer.getProgramAccounts(REPUTATION_PROGRAM_ID, {
  accountType: "ClientIndexAccount",
  filters: { agentId }
});

return accounts.map(acc => acc.clientAddress);
```

**Implementation Strategy** (Option 2 - Direct RPC):
```typescript
// Use getProgramAccounts with memcmp filter on agent_id
const accounts = await connection.getProgramAccounts(
  REPUTATION_PROGRAM_ID,
  {
    filters: [
      { dataSize: ClientIndexAccount.SIZE },
      { memcmp: { offset: 8, bytes: agentIdBytes } } // agent_id field
    ]
  }
);

return accounts.map(({ account }) => {
  const data = ClientIndexAccount.decode(account.data);
  return data.clientAddress;
});
```

**Complexity**: O(n) where n = total clients for this agent

**Note**: Indexer approach is recommended for production (faster, cached).

---

### 1.6 getResponseCount()

**ERC-8004 Spec**:
```solidity
function getResponseCount(
    uint256 agentId,
    address clientAddress,
    uint64 feedbackIndex
) external view returns (uint64)
```

**SDK Signature**:
```typescript
async getResponseCount(
  agentId: number,
  clientAddress: PublicKey,
  feedbackIndex: number
): Promise<number>
```

**Implementation Strategy**:
1. Derive ResponseIndexAccount PDA
2. Fetch account data
3. Return `next_index` field (= total response count)
4. Return 0 if account doesn't exist (no responses yet)

**PDA Derivation**:
```typescript
const [responseIndexPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("response_index"),
    Buffer.from(new BN(agentId).toArray("le", 8)),
    clientAddress.toBuffer(),
    Buffer.from(new BN(feedbackIndex).toArray("le", 8))
  ],
  REPUTATION_PROGRAM_ID
);
```

**Complexity**: O(1) - single PDA fetch

---

## Part 2: Additional Helper Methods (Optional)

### 2.1 readResponse()
```typescript
async readResponse(
  agentId: number,
  clientAddress: PublicKey,
  feedbackIndex: number,
  responseIndex: number
): Promise<{
  responder: PublicKey;
  responseUri: string;
  responseHash: Buffer;
  createdAt: number;
} | null>
```

### 2.2 readAllResponses()
```typescript
async readAllResponses(
  agentId: number,
  clientAddress: PublicKey,
  feedbackIndex: number
): Promise<Array<{
  responseIndex: number;
  responder: PublicKey;
  responseUri: string;
  responseHash: Buffer;
  createdAt: number;
}>>
```

### 2.3 getAgentReputation()
```typescript
async getAgentReputation(agentId: number): Promise<{
  totalFeedbacks: number;
  totalScoreSum: number;
  averageScore: number;
  lastUpdated: number;
}>
```

---

## Part 3: Identity Registry Read Functions

### 3.1 getAgent()
```typescript
async getAgent(agentId: number): Promise<{
  agentId: number;
  owner: PublicKey;
  agentMint: PublicKey;
  tokenUri: string;
  metadata: Array<{ key: string; value: Buffer }>;
  createdAt: number;
}>
```

### 3.2 ownerOf()
```typescript
async ownerOf(agentId: number): Promise<PublicKey>
```

### 3.3 totalSupply()
```typescript
async totalSupply(): Promise<number>
```

---

## Part 4: SDK Class Structure

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";

export class ERC8004Client {
  private connection: Connection;
  private identityProgram: Program;
  private reputationProgram: Program;
  private validationProgram?: Program; // After Validation Registry

  constructor(
    connection: Connection,
    identityProgramId: PublicKey,
    reputationProgramId: PublicKey,
    validationProgramId?: PublicKey
  ) {
    this.connection = connection;
    // Initialize programs...
  }

  // Identity Registry Methods
  identity = {
    getAgent: this.getAgent.bind(this),
    ownerOf: this.ownerOf.bind(this),
    totalSupply: this.totalSupply.bind(this),
  };

  // Reputation Registry Methods
  reputation = {
    getSummary: this.getSummary.bind(this),
    readFeedback: this.readFeedback.bind(this),
    readAllFeedback: this.readAllFeedback.bind(this),
    getLastIndex: this.getLastIndex.bind(this),
    getClients: this.getClients.bind(this),
    getResponseCount: this.getResponseCount.bind(this),
    readResponse: this.readResponse.bind(this),
    readAllResponses: this.readAllResponses.bind(this),
    getAgentReputation: this.getAgentReputation.bind(this),
  };

  // Validation Registry Methods (TODO)
  validation = {
    // After Validation Registry implementation
  };
}
```

---

## Part 5: Usage Examples

### Example 1: Get Agent Summary
```typescript
const client = new ERC8004Client(connection, IDENTITY_ID, REPUTATION_ID);

// Simple summary (uses cached aggregates)
const summary = await client.reputation.getSummary(agentId);
console.log(`Agent #${agentId}: ${summary.count} feedbacks, avg ${summary.averageScore}/100`);

// Filtered summary
const filtered = await client.reputation.getSummary(agentId, {
  includeRevoked: false,
  minScore: 80,
  tag1: [Buffer.from("quality")]
});
```

### Example 2: Read All Feedback for Agent
```typescript
const allClients = await client.reputation.getClients(agentId);

for (const clientAddress of allClients) {
  const feedbacks = await client.reputation.readAllFeedback(
    agentId,
    clientAddress,
    false // exclude revoked
  );

  for (const feedback of feedbacks) {
    console.log(`Client ${clientAddress}: score=${feedback.score}, revoked=${feedback.isRevoked}`);
  }
}
```

### Example 3: Read Specific Feedback with Responses
```typescript
const feedback = await client.reputation.readFeedback(agentId, clientAddress, 0);

if (feedback && !feedback.isRevoked) {
  const responseCount = await client.reputation.getResponseCount(agentId, clientAddress, 0);
  const responses = await client.reputation.readAllResponses(agentId, clientAddress, 0);

  console.log(`Feedback: ${feedback.score}/100`);
  console.log(`Responses: ${responseCount}`);
  responses.forEach(r => console.log(`  - ${r.responder}: ${r.responseUri}`));
}
```

---

## Part 6: Testing Requirements

### Unit Tests (per function)
- ✅ getSummary with no filters
- ✅ getSummary with all filters
- ✅ readFeedback existing
- ✅ readFeedback non-existing
- ✅ readAllFeedback includeRevoked=true
- ✅ readAllFeedback includeRevoked=false
- ✅ getLastIndex existing client
- ✅ getLastIndex new client (returns 0)
- ✅ getClients with feedbacks
- ✅ getClients empty (returns [])
- ✅ getResponseCount with responses
- ✅ getResponseCount no responses (returns 0)

### Integration Tests
- ✅ Read after write consistency
- ✅ Filter accuracy
- ✅ Performance benchmarks (getProgramAccounts vs direct fetch)
- ✅ Indexer integration (if using Helius/Shyft)

---

## Part 7: Performance Considerations

### Optimization Strategies

1. **Caching**: Cache AgentReputationMetadata for frequent getSummary calls
2. **Batch Fetching**: Use `getMultipleAccounts` for readAllFeedback
3. **Indexer**: Use Helius/Shyft for getClients (avoid full scan)
4. **Pagination**: Implement cursor-based pagination for large result sets

### Benchmark Targets
- Single PDA fetch: <50ms
- getSummary (no filters): <100ms
- readAllFeedback (10 feedbacks): <200ms
- getClients (100 clients): <500ms (with indexer)

---

## Part 8: Dependencies

```json
{
  "dependencies": {
    "@solana/web3.js": "^1.87.0",
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/spl-token": "^0.4.0",
    "bn.js": "^5.2.1"
  },
  "devDependencies": {
    "@types/bn.js": "^5.1.1",
    "chai": "^4.3.10",
    "mocha": "^10.2.0"
  }
}
```

---

## Part 9: Implementation Timeline

**After Validation Registry is complete:**

- **Week 1**: Core read functions (1.1-1.6)
- **Week 2**: Helper methods (2.1-2.3) + Identity methods (3.1-3.3)
- **Week 3**: SDK class structure + tests
- **Week 4**: Documentation + examples + benchmarks

**Estimated Total**: 4 weeks for complete SDK

---

## Part 10: ERC-8004 Compliance Impact

Once SDK is implemented:
- **Current**: 70% compliant (write ops only)
- **After SDK**: 100% compliant (all read + write ops)

**Blocking Items**:
- ❌ getSummary (required)
- ❌ readFeedback (required)
- ❌ readAllFeedback (required)
- ❌ getLastIndex (required)
- ❌ getClients (required)
- ❌ getResponseCount (required)

**Status**: All 6 read functions are specified and ready for implementation.

---

## Notes

- This specification is **complete and ready for implementation**
- Implementation will occur **after Validation Registry** is complete
- All PDA derivations match current program implementation
- All method signatures are ERC-8004 compliant
- Performance optimizations identified (caching, batching, indexers)
- Test coverage defined (12+ unit tests + integration tests)

**Next Steps**:
1. ✅ Complete Validation Registry
2. ✅ Implement SDK based on this spec
3. ✅ Achieve 100% ERC-8004 compliance
