# Indexer Remaining Work Plan

Date: 2026-01-19
Repo: 8004-solana-indexer
Goal: Stabilize tests and align data model with ERC-8004 Jan 2026 (feedback_index per client)

## Scope
- Indexer core (parser, poller/websocket, db handlers)
- Supabase schema + migrations
- Indexer client types (used by SDK)

## Work Items (Detailed)

### ✅ COMPLETED (2026-01-20)

1) Schema + data model alignment
- ✅ Added `client_address` to `feedback_responses` in Supabase schema
- ✅ Updated unique constraint to `(asset, client_address, feedback_index, responder)`
- ✅ Updated inserts in `src/db/supabase.ts` to persist client_address
- ✅ Updated response queries and indexes to include client
- ✅ Updated `agent0-ts-solana/src/core/indexer-client.ts` response types with client_address
- ✅ Created migration script: `supabase/migrations/20260119_add_client_address_to_responses.sql`
- Files: `supabase/schema.sql`, `src/db/supabase.ts`, `agent0-ts-solana/src/core/indexer-client.ts`

2) Event parsing + fixtures (tests)
- ✅ IDL used by indexer matches on-chain program (events + fields + programId).
- ✅ Updated `tests/setup.ts` programId to the current registry program.
- ✅ Updated `tests/mocks/solana.ts` event encoder:
  - Include `atom_enabled` in `AgentRegisteredInRegistry`.
  - Follow exact field order from IDL (e.g., `updated_by` before `new_uri`).
- ✅ Updated `tests/unit/parser/decoder.test.ts` to use snake_case event keys (Anchor output).
- ✅ Updated poller/websocket tests to include `atomEnabled` in mock event data.
- ✅ Stubbed `testWebSocketConnection` to avoid real network usage.

3) Indexer logic correctness
- ✅ Normalized optional hashes: all-zero `feedback_hash`/`response_hash` stored as NULL
- ✅ Fixed `Number()` conversion: using `.toString()` for `feedback_index` to preserve u64 precision
- File: `src/db/supabase.ts`

4) Test suite verification
- ✅ `npm test` in `8004-solana-indexer` (119 tests) passes

### REMAINING

1) Operational steps (partially complete)
- ✅ Migration script created
- ✅ Apply migration to production Supabase (includes wipe of `feedback_responses`)
- ✅ Keep `indexer_state` (skip backfill so old responses stay wiped)
- ✅ Restart indexer service and monitor logs (done by user)

## Verification Checklist
- ✅ Responses stored per `(asset, client, feedback_index, responder)` with no collisions
- ✅ feedback_index values preserved correctly for large values (no precision loss)
- ✅ API responses include `client_address` for feedback responses
- ✅ All unit tests pass (`npm test`)
- ✅ Indexer resumes from current cursor without re-ingesting old responses (per user restart)

## Related Commits
- Programs: "Fix agent_uri length mismatch: MAX_URI_LENGTH 250 -> 200"
- Indexer: "Add client_address to feedback_responses and normalize optional hashes"
- SDK: "Add client parameter to feedback reads and migrate response methods to indexer"
