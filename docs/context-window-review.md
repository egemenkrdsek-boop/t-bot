# Hermes context window adaptation — 2026-10-28

## Provenance

This is an adapted component port, not a complete Hermes fork or a claim of shared Git history. The official `NousResearch/hermes-agent` MIT sources were read through the GitHub connector at immutable commit `ee7e0f517232fb619c72e49d7e648436bddc598e`:

- [agent/context_compressor_window.py](https://github.com/NousResearch/hermes-agent/blob/ee7e0f517232fb619c72e49d7e648436bddc598e/agent/context_compressor_window.py): protected head/middle/tail window planning.
- [agent/context_compressor.py, _walk_tail_budget](https://github.com/NousResearch/hermes-agent/blob/ee7e0f517232fb619c72e49d7e648436bddc598e/agent/context_compressor.py#L3125): newest-first token accumulation.
- [agent/context_compressor.py, _find_tail_cut_by_tokens](https://github.com/NousResearch/hermes-agent/blob/ee7e0f517232fb619c72e49d7e648436bddc598e/agent/context_compressor.py#L4985): atomic tool boundaries, newest-row protection, and allowing a long active turn to split at a safe boundary while retaining its actionable request.

Local implementation: `src/context-window.ts`; integration: `src/token-optimizer.ts` and `src/agent.ts`. Upstream MIT attribution and license are included in `THIRD_PARTY_NOTICES.md` by the release owner. The commit SHA was pinned and verified by the upstream investigation; it is not claimed to have a verified signature.

## Behavior and deliberate adaptations

The TypeScript planner walks backwards by atomic groups rather than retaining an entire user turn. Assistant calls and matching results remain together, including parallel calls, nonadjacent matching IDs, native Responses calls, and a standalone native reasoning row immediately preceding its assistant call. The newest group and latest text-bearing assistant reply remain exact. No call arguments, native encrypted reasoning, or newest result body are truncated.

Every existing system/user message remains verbatim, including later corrections and constraints. This replaces the previous 600-character first-user pseudo-summary, which could discard later constraints and prevent a large active turn from shrinking. Older optional assistant/tool groups can be omitted from the provider request; the original session transcript is unchanged. A bounded deterministic evidence handoff explicitly marks historical evidence as untrusted, omitted details as unavailable, and re-reading as necessary. It has assistant role and grants no permissions. It is not a model-generated semantic summary and must not be treated as proof of success or complete source code.

The agent reserves system, tool-schema, focus and final-synthesis instruction costs before allocating the history target. Both ordinary requests and final synthesis update read-cache visibility against the actual selected messages; evicted source text cannot keep authorizing a differential cache stub. Existing Unicode-aware estimates remain unchanged.

## Budget and native limitations

The existing 28,000 estimated-token setting is a **soft optimization target**, not a discovered model context limit. The return value includes `budget`, `estimatedTokens`, `overflow`, `omittedMessages`, and `splitActiveTurn`. Windowing and overflow emit explicit user-visible status. An indivisible huge user message, protected group, or accumulated user constraints may exceed the target and remain intact; the agent continues to the provider rather than inventing a hard 28k rejection. The existing input character safety cap still applies.

Unknown native replay item types, including opaque item references with dependencies the planner cannot prove, conservatively retain the full transcript and report overflow. Known native reasoning/call/output groups can be windowed atomically. Native item content is not parsed or rewritten. The estimator may count both normalized calls and native copies conservatively; attachment estimates remain approximate.

No model context length/output allowance is discovered here, so the planner does not promise a hard provider budget or guarantee space for the generated answer. A provider may reject an oversized intact request. This port adds no Python runtime, database, backend, background model summarization, prepared-compaction thread, model fallback, or context-overflow retry loop. Those Hermes subsystems were not ported.

Grounding permission and source visibility remain separate: eviction does not erase the current invocation's inspection ledger. The file edit layer independently requires its current hash/revision and exact patch context; the read cache forces full content when evicted evidence is requested again. The model must still heed the explicit re-read requirement before relying on omitted source details. This port does not claim that deterministic historical excerpts preserve every semantic dependency.

## Verification

`node --import tsx --test tests/context-window.test.ts`: 10 focused unit/component fixtures passed. They cover a bounded long active turn, retained corrections beyond 600 characters, oversized indivisible Unicode+image input, parallel/nonadjacent tool groups, unknown native references, native Responses serialization with reasoning/call/result linkage, read-cache invalidation, fixture-agent soft-overflow continuation, complete-request schema/system reservation, and session immutability. All transports are local fixtures; no live provider or E2E test runs.

The 2,001-message/1,000-tool-round boundary fixture retained 1,476/1,500 estimated tokens and completed in approximately 18 ms in the recorded local run. This is a fixture measurement, not a general latency or token-saving promise. The core regression tests plus the first nine context fixtures passed together (36/36); the tenth complete-request fixture then passed in the focused run. Build/full-suite/release checks belong to the orchestrator's serialized integration stage.
