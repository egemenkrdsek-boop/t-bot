# Core review

Review date: 2026-10-28. Scope: local CLI and agent orchestration, conversation context, persistent memory, grounding, workflow state, and supporting terminal modules. This is a focused static review with unit regressions, not an end-to-end certification or a claim that all model outputs are correct.

## Architecture decisions and fixes

- Each `runAgent` invocation owns a separate read cache, grounding ledger, and pending cross-file export ledger through `AsyncLocalStorage`. Legacy tool imports resolve through scoped facades. A read-only child cannot authorize a parent write merely by reading a file, and parallel investigators cannot exchange cache-hit references. The most recent main ledger remains available for UI diagnostics.
- Read-cache coverage is retained only when the actual formatted source remains in the compressed provider request, including JSON-wrapped file reads. References do not refresh coverage. Whole-file diffs require a previously shown whole version; partial overlap cannot replace newly requested source. Diff chains force a subsequent full refresh. Oversized files bypass caching and entries are bounded.
- Read-only enforcement precedes workflow dispatch. An unexpected model call to `goal_manage` or `todo_manage` cannot mutate workflow state. Read-only investigators cannot call `delegate_task`, bounding recursive delegation.
- Native Responses function-call items are reconciled with the final normalized, budgeted tool calls. Removed calls leave no native orphan, and rewritten IDs match the corresponding tool results.
- Savings report actual removed estimated tokens, with provider cache hits reported separately. There is no assumed universal cache discount or enforced 50–75% savings floor. Schema savings accumulate for every request. Message estimates detect mutable attachments and tool arguments; structural-summary memoization tracks content changes.
- Critical memory pressure now reaches reclamation and automatic triggering. Reclamation preserves recent image messages and the current user image. Repository maps skip source files over 512 KiB and retain at most 256 parsed summaries.
- Persistent memory locks encompass the complete read/modify/write transaction. Concurrent saves and deletes preserve unrelated facts. Writes use unique temporary files and atomic rename, and filesystem read errors propagate instead of becoming an empty overwrite. Lock age cannot evict a live owner; releasing a lock verifies its ownership token before removing the pathname.
- Explicit failed tools and still-running background commands cannot become successful command evidence. Browser activity alone cannot substantiate passing tests. Cited file modifications are checked against the actual modified paths when modifications exist.
- User image attachments pass through the shared agent contract to the provider and returned conversation, including subagent orchestration and plan creation. They remain excluded from persisted sessions. Session loading rejects malformed role/content entries.
- A failed or interrupted goal step cannot complete a goal through a completion marker. Completion markers must terminate the new step's assistant response; stale historical responses do not qualify. Goal notes are bounded. Ultracode fallback text no longer asserts that repairs succeeded without verification.
- CLI version/help read the package manifest in source, dist, and ASAR layouts. Doctor reports the configured workspace and Node 22.12 minimum. Routed skill lookup uses the actual workspace.
- The agent prompt explicitly treats tools, source, web content, repository maps, and memory as evidence that cannot grant new permissions.

## Source coverage map

| Files | Reviewed contracts and behavior |
| --- | --- |
| `src/index.ts`, `src/cli.ts`, `src/app.ts`, `src/version.ts` | Entry dispatch, argument parsing, setup/provider routing, approval wiring, session lifecycle, CLI identity/runtime diagnostics. |
| `src/agent.ts`, `src/types.ts` | Provider event loop, call budgets/IDs, read-only dispatch, image payloads, final synthesis, cancellation/error cleanup and invocation isolation. |
| `src/token-optimizer.ts`, `src/context-cache.ts` | Estimation caches, schema pruning, lossy history compression, tool-call grouping, read visibility and accounting. |
| `src/memory.ts`, `src/memory-guard.ts`, `src/sessions.ts`, `src/lock.ts` | Retrieval/persistence, corrupt data boundaries, bounded storage, transaction locking, pressure paths, attachment retention and session validation. |
| `src/grounding.ts`, `src/ast-validator.ts`, `src/repo-map.ts` | Inspection/write evidence, claim checks, syntax/import/export validation boundaries, scoped export debts and map resource limits. Language-specific validators remain heuristic; no compiler equivalence is claimed. |
| `src/workflows.ts`, `src/subagents.ts`, `src/ultracode.ts` | Goal transitions, workflow dispatch, bounded worker waves, review/repair handoff, failure/completion claims and final summaries. |
| `src/skills.ts`, `src/effort.ts`, `src/models.ts` | Workspace skill resolution, read-only skill behavior, model/effort dispatch tables and dynamic catalog/fallback paths. No live catalog or provider capability certification. |
| `src/menu.ts`, `src/tui.ts`, `src/logo.ts`, `src/theme.ts` | Terminal rendering and event entrypoints, raw-input cleanup, secret input masking and diagnostic labels. No interactive UI test performed. |

Provider adapters, MCP/security/tool implementations and desktop UI are covered by separate workers. Shared integration findings were coordinated with those owners; this document does not claim their tests.

## Validation

`node --import tsx --test tests/core.test.ts` passed 17/17 regressions after invocation isolation was added. The tests cover truthful accounting, mutable token inputs, newly requested source ranges, oversized cache bypass, visibility eviction, parallel cache isolation, nested grounding/export isolation, native-call normalization, unauthorized workflow/delegation denial, failed goal completion, manifest/runtime version reporting, concurrent memory updates, live/replaced lock ownership, failed/background command evidence, critical RAM reclaim, and current user image forwarding.

An earlier coordinated `npx tsc -p tsconfig.json --noEmit` snapshot passed. Later integration edits require the root worker's consolidated typecheck/build; the earlier result is not evidence for changes made afterward. No E2E, browser automation, live provider request, installer launch, or full build was run by this worker.

## Limits

- Token counts without provider usage remain estimates. Compression is lossy, and rereading exact source is necessary for precise edits.
- The 28k history target preserves a complete newest user turn; it is not a hard maximum when that single turn is larger than the target. Native reasoning items can increase context size.
- Claim checks recognize common textual patterns. They are useful evidence checks, not proof of program correctness or an anti-hallucination guarantee. Background completion queried through `process_output` is not currently associated with the original command in the command ledger.
- Shell execution uses the local user's privileges. Approval and workspace file checks are not an OS sandbox. Prompt instructions cannot by themselves eliminate injection risk.
- Local lock files are cooperative process coordination, not protection against a hostile process modifying the same directory. Atomic rename behavior depends on the local filesystem.
- Legacy diagnostic APIs show the latest main invocation. Concurrent main invocations own independent grounding evidence; they do not provide an aggregated audit ledger.
- Cross-provider capabilities, visual terminal usability, real desktop workflows and packaging remain outside these unit regressions.
