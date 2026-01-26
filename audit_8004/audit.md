# Audit 8004 (programs + SDK + indexer)

Date: 2026-01-20
Spec reference: ERC-8004 Jan 2026
Scope:
- Programs: `8004-solana/programs/agent-registry-8004`, `8004-solana/programs/atom-engine`
- SDK: `agent0-ts-solana`
- Indexer: `8004-solana-indexer`

Method: static review of on-chain logic, SDK write/read paths, and indexer storage for spec conformance and data integrity.

## Executive Summary

- High: 2
- Medium: 5
- Low: 1

Top risks:
- Feedback indexing is not enforced on-chain and is deduped off-chain; stale or malicious indexes can silently drop data.
- SDK feedback_index calculation can miscompute if Supabase returns BIGINT as string.

## Findings

### High

1) feedback_index integrity not enforced on-chain + indexer drops duplicates
- Evidence: `8004-solana/programs/agent-registry-8004/src/reputation/instructions.rs:22`, `8004-solana-indexer/src/db/supabase.ts:330`
- Impact: clients can submit duplicate or out-of-order feedback_index values; indexer uses `id = asset:client:feedback_index` and `ON CONFLICT DO NOTHING`, so duplicates are silently discarded. Revokes/responses can target the wrong feedback if indexer state diverges.
- Recommendation: enforce per-(asset, client) sequencing on-chain or include tx signature in indexer keys; reject duplicates in SDK and indexer or store all events with a monotonic secondary key.

2) SDK feedback_index calculation can corrupt indexes when Supabase returns BIGINT as string
- Evidence: `agent0-ts-solana/src/core/indexer-client.ts:519`, `agent0-ts-solana/src/core/transaction-builder.ts:1178`
- Impact: PostgREST often returns BIGINT as string; `lastIndex + 1` becomes string concatenation (e.g., "1" + 1 = "11"), yielding incorrect feedback_index and collisions.
- Recommendation: parse to `BigInt` and increment as `lastIndex + 1n`, or coerce with `Number(...)` only within safe range and validate.

### Medium

3) validation responseHash is required in program + SDK, but optional in spec (IPFS)
- Evidence: `8004-solana/programs/agent-registry-8004/src/validation/instructions.rs:134`, `agent0-ts-solana/src/core/transaction-builder.ts:1520`, `8004-solana-indexer/src/db/supabase.ts:545`
- Impact: spec allows omitting responseHash for IPFS; current implementation forces 32-byte hash and indexer stores zero-hash as real value.
- Recommendation: accept optional responseHash (treat empty as NULL), normalize all-zero hash to NULL in indexer, and document zero-hash fallback if kept.

4) SDK URI length limits are stricter than on-chain (200 vs 250)
- Evidence: `agent0-ts-solana/src/core/transaction-builder.ts:1158`, `agent0-ts-solana/src/core/transaction-builder.ts:1440`, `agent0-ts-solana/src/core/transaction-builder.ts:1541`, `8004-solana/programs/agent-registry-8004/src/reputation/state.rs:2`
- Impact: valid on-chain URIs (201-250 bytes) are rejected by SDK for feedback, validation requests, and validation responses.
- Recommendation: align SDK validation to 250 bytes or surface a shared constant from the program IDL.

5) append_response authorization is stricter than ERC-8004
- Evidence: `8004-solana/programs/agent-registry-8004/src/reputation/instructions.rs:316`
- Impact: ERC-8004 allows any responder (e.g., auditors/indexers) to append responses; current program restricts to agent owner or agent wallet only.
- Recommendation: decide if this divergence is intentional. If spec compliance is required, allow any responder or add an allowlist mechanism.

6) getLastIndex returns count, not max feedback_index
- Evidence: `agent0-ts-solana/src/core/feedback-manager-solana.ts:315`
- Impact: if feedback_index is sparse, duplicated, or out of order, count != max index. Clients relying on this value may produce incorrect next indexes or UI state.
- Recommendation: compute max(feedback_index) + 1 from indexer data or expose a dedicated RPC/DB query.

7) give_feedback hard-depends on indexer availability
- Evidence: `agent0-ts-solana/src/core/transaction-builder.ts:1178`
- Impact: if indexer is down or lagging, SDK cannot submit feedback even though on-chain program would accept it.
- Recommendation: allow explicit client-supplied feedback_index (with warning), or cache per-client counters locally with optimistic concurrency and retry.

### Low

8) agent_uri not indexed on registration events
- Evidence: `8004-solana-indexer/src/db/supabase.ts:156`, `8004-solana-indexer/src/db/handlers.ts:124`
- Impact: agent_uri remains null/empty until UriUpdated event; initial metadata is missing in indexer views.
- Recommendation: fetch AgentAccount during registration, or include URI in registration event.

## Testing Status

- Indexer unit tests: PASS (`npm test` in `8004-solana-indexer`)
- SDK E2E: `npm run test:e2e` fails to start (Jest ESM config; `tests/setup.ts` parsed as CJS). Use `NODE_OPTIONS=--experimental-vm-modules` and `--config jest.e2e.config.js` for ESM runs.
- Localnet-required suites (01/02/03/04-* complete) not executed; they require a local validator + deployed programs.

## Notes / Assumptions

- ATOM is one-way enabled: `register_with_options(atom_enabled=false)` + `enable_atom()` only.
- Optional hash handling for feedback/response is normalized in indexer; validation response hash is not yet normalized.
