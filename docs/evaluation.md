# Offline component evaluation

Run from a source checkout with development dependencies installed:

```sh
npm run --silent evaluate:components > evaluation.json
node --import tsx --test tests/evaluation.test.ts
```

The script emits one machine-readable JSON document. Exit code 1 means a **critical fixture** failed; informational misses remain counted and visible even when that gate passes. The command does not build, install, call a model, fetch a URL, launch a browser/computer tool, or compare competitor products. It creates a uniquely owned temporary source repository and removes it in `finally`.

The fixed seed is `0x54424f54`. Each report includes the fixture script SHA256, hashes of the measured production source files, a deterministic-results digest, package/Node/V8/OS information, wall time, and process RSS/heap before and after each section. Hashes tie each recorded result to the source snapshot actually measured; later source edits require another run. Imports are excluded from the timed interval. RSS/heap deltas are raw process observations, **not peak memory, isolated allocations, or proof that memory was reclaimed**. Estimated token values are explicitly marked; byte counts are UTF-8 or serialized JSON lengths, not provider billing.

## Coverage and baselines

The harness calls real production exports from `token-optimizer`, `agent`, `context-cache`, `edit-match`, `repo-map`, and the local tool/workflow registries. It uses six bounded fixture sections:

| Section | What is checked | Baseline and limit |
|---|---|---|
| Schema selection | Required-tool visibility for coding, browser, computer, shell, workflow and MCP, including paraphrases and continuation history | Same complete local schema list; connected MCP definitions are synthetic fixture catalog data. Recall is schema visibility, not successful execution or argument correctness. |
| Greeting routing | Work requests, mixed greeting/work prompts, continuations, multilingual prompts and image inputs keep tools available | Annotated social/work cases. Unsupported `hola`/`bonjour` social fast paths are informational latency coverage misses. Sending a work/image request down the tool-free path is critical. |
| Context window | 1,000 tool rounds; all user/system constraints, native reasoning/call/result linkage, latest evidence, immutable session, bounded target and explicit overflow | Same full native history before local windowing. Opaque item references and one huge Unicode user message deliberately exceed the soft target and must remain intact. |
| Repeated source | Repeated identical source/range references shrink, then eviction restores full source text | Sending the same full source three times. No billed prompt-cache claim; modified or evicted source requires full evidence again. |
| Unicode editing | Six exact/typographic/mixed-ending/BOM/Unicode byte-output cases and six rejection cases | Exact expected UTF-8 output, including untouched context; ambiguous Unicode candidates, overlaps, missing/empty/no-op searches and alignment limits must reject. This invokes the pure matcher, not file permissions or disk writes. |
| Repo query retrieval | A 92-file repository with root distractions, deep `.mts` source, and a relevant export after 22 helper symbols; nonexistent symbol negative | Raw complete source bytes/tokens compared with bounded query maps. Path and symbol visibility are measured, not semantic dependency/bug-finding recall. First query is cold; later queries may use the map cache. |

Every annotated case and failure is included in JSON; the report does not select only passing inputs. Critical versus informational classification is explicit on each check. The test verifies deterministic results and report counts while forbidding `fetch`; it does not turn a failed product fixture into a pass by hiding that failure.

## Recorded local results

The checked-in [before-schema snapshot](evaluation-before.json) preserves its original package `2.1.0` measurement and source hashes. The [final after snapshot](evaluation-after.json) measures the frozen `2.2.0` sources. Both use the same fixture version/seed on Windows x64, Node `v24.15.0`. The first exploratory run found eight failed checks, including two deep repo-map misses. Deniz's repo retrieval change landed before the persisted before-schema snapshot, so the JSON pair records the subsequent schema-recall improvement; it must not be described as a saved before/after artifact for the repo-map change. Source hashes also record intervening repo-map and agent maintenance, so this pair is not an isolated timing experiment.

| Metric | Before schema fix (2.1.0) | Final after (2.2.0) |
|---|---:|---:|
| Passing / all checks | 56 / 62 | 60 / 62 |
| Critical failed checks | 4 | 0 |
| Informational failed checks | 2 | 2 |
| Required tool observations found | 18 / 24 | 24 / 24 |
| Required-tool false negatives | 6 | 0 |
| Required-tool recall | 75% | 100% |
| Mean selected/full schema estimated-token ratio | 43.17% | 48.64% |
| Work requests misrouted to a tool-free greeting path | 0 | 0 |
| Social fast-path coverage misses | 2 | 2 |

The four critical schema cases exposed browser dropdown/scroll, focused Enter, interactive-job input, and generic connected-service discovery. The narrow production change broadens general UI/process action vocabulary and keeps configured MCP catalog/call discovery visible without requiring a service keyword. It increases schema size to recover fixture recall; the former smaller schema is not a quality improvement when needed tools are absent. This is still a lexical selector and this corpus does not establish recall on every paraphrase.

The remaining two informational misses are `hola` and `bonjour`. They conservatively retain the full work path; no production greeting rule was expanded merely to improve this score. The after report's critical quality gate passes while the overall report remains **60/62**, not 100%.

The context fixture has 2,009 messages, 997,404 estimated tokens and 2,160,021 serialized bytes in its full local-history baseline. The selected request has 14 messages, 4,942 estimated tokens and 11,427 serialized bytes, with explicit omitted-evidence notice and all annotated constraints/native group invariants retained. This deliberately repetitive synthetic history demonstrates a bounded component behavior; it is not evidence that a real task retains equal answer quality after such a reduction.

Three identical source reads fall from 4,317 to 1,607 estimated tokens and 7,590 to 2,864 raw bytes. Both repeat references are tested, and a subsequent visibility eviction requires full source again. These particular reductions do not establish a general 50–75% saving.

The recorded whole-harness wall times are approximately 425 ms before and 444 ms for the final 2.2.0 snapshot; these single observations include fixture construction and local filesystem work and are not a performance regression/improvement estimate. Per-section RSS/heap and times remain in JSON for inspection. Independent repeated trials, startup costs, and peak-memory profiling have not been measured. The final recorded implementation hashes were checked against the frozen source files, and the repeatability/no-network test passed once after the final measurement.

## Evidence still missing for the product goal

These results do not establish world ranking, superiority to OpenCode/Hermes/Codex/other products, or a general token-saving percentage. That requires representative real tasks and repositories, matched model/tool/budget configurations, repeated independent runs, verified task completion and human-rated outcomes, and provider-billed token/cost/latency distributions. Cross-product live task-quality data and end-to-end evidence are absent. Offline tool visibility and safe transformations are useful component evidence, but cannot substitute for those missing outcome measurements.
