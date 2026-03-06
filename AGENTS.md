# Agent Workflow Guardrails

## Core Rules
- Always prefer the smallest possible change that fixes the root cause.
- Avoid broad refactors unless strictly required to unblock correctness.
- After each patch, re-run the minimum relevant validations, then full flow when needed.
- For every bug, first do a deep root-cause audit with evidence. Do not ship a patch that only masks symptoms or "seems to help" without identifying the actual source of the bug.

## Parallel Execution Rules
- Never wait idly on subagents.
- While a subagent is running, always propose and run useful parallel tasks.
- Parallelize everything that can be safely parallelized via subagents (audit, tests, repo checks).
- If waiting is unavoidable, ask what additional parallel work should be done meanwhile.

## Standard Deep-Audit Pipeline
- This flow is executed by Codex + subagents (not by local shell automation scripts).
- Cross-repo checks are **diff-scoped only**: validate changed files and their direct integration paths, not full-repo audits by default.

1. Identify change scope and impacted modules.
2. Run deep audit on the diff.
3. Add/adjust tests that cover the changed behavior (unit first, then integration/e2e on devnet when relevant).
4. Execute validations.
5. If a step fails, apply a minimal patch and restart the pipeline from audit.
6. Run cross-repo validation only on impacted paths across:
   - `8004-solana-indexer`
   - `agent0-ts-solana`
   - `8004-solana`
   - `8004-atom`
7. Only finalize when all checks are green.
