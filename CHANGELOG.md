# Changelog

## 4.1.0

### Default reasoning and token discipline

- Embedded the Ultra J-Space Engine as a hidden built-in skill. A compact `[J-SPACE DEFAULT KERNEL]` is always injected for agentic turns; the full skill text loads only through `/jspace` or an explicit deep-reasoning trigger.
- Hidden skills are excluded from `/skills` and the desktop skill catalog while remaining available to the model.
- Removed unconditional `BUILTIN_SKILLS` injection from CLI/TUI and the Telegram bridge. This restores the fast conversational path and avoids sending all built-in skill guidance on every turn.

### GUI fast path

- Browser and computer actions now return lightweight page/window state by default. Set-of-Marks screenshots and UIA trees require `observe: "visual"`, `auto_screenshot: true`, or an explicit inspect/screenshot action.
- Browser screenshots are no longer taken after every click/type/scroll; the forced 450 ms visual wait is reduced to a 40 ms human-perceptible spotlight hold. Inspect is capped at 120 visible elements and skips CSS-path work for off-screen elements.
- Computer actions no longer take a second screenshot/UIA round-trip by default; the 220 ms delay is removed unless visual observation is requested.
- Added `browser_batch` and `computer_batch`: up to 12 validated steps under one approval, one final observation, with an explicit stopping step on failure.
- Warm sessions now survive normal model/approval latency: browser and desktop keep-alive is 10 minutes instead of 60/90 seconds. `/gui stop`, idle timeout and memory pressure still release them.
- Pure GUI observations (`browser_inspect`, tab listing, computer inspect/windows) no longer require a separate approval per call; mutations, screenshots and batches keep the approval boundary.
- Added screenshot retention (40 files / 32 MB) and `durationMs` on tool-end events.

### Verification

- Unit/component tests now cover the J-Space kernel, hidden skill routing, GUI observation defaults, batch validation, screenshot retention and existing 4.0 security gates.
- No E2E, live provider, real browser/computer or Telegram task was run.

## 4.0.0

### Precision and security

- Added local file checkpoints before `file_write`/`file_patch`; `checkpoint_list`, `checkpoint_restore`, `/checkpoints` and `/undo <id|last>` are available in CLI and desktop. Restores snapshot the current file first, so an undo can itself be undone.
- Checkpoint IDs now include the workspace-relative path and a random suffix; identical content in the same millisecond no longer collides.
- Wired the optional OS shell sandbox (`TBOT_SANDBOX=required|bwrap|sandbox-exec`). Required mode fails closed when no adapter exists; `/doctor` reports the effective mode. Windows remains approval-only and is documented as such.
- Split MCP capabilities into read (catalog) and write (call/remote tools); a reduced policy can no longer execute arbitrary remote MCP tools. Unknown tools now fail closed under a host allowlist.
- Hardened user boundaries: `no-write` covers checkpoints, Git writes and skill creation; `no-command` covers process control and delegated subagents. Shell commands that reference credential-like files get an explicit approval warning.
- Completion gate now requires verification **after** the last write and uses the latest verification result, not an earlier pass. Review-only requests no longer produce a write-required task contract.
- Diagnostics loads the TypeScript compiler lazily; it no longer adds the compiler to every CLI/desktop start. Directory targets are expanded correctly.
- Added a static layer/import check (`npm run check:layers`) and regression tests for phase gates, checkpoints, diagnostics, capabilities, taint, sandbox status, task contracts and context reduction.

### Interface

- Added the signal-spine pulse and motion tokens to the desktop run bar; all motion remains opacity/transform-only and is disabled by `prefers-reduced-motion`.
- Desktop `/doctor` now reports shell isolation; `/checkpoints` and `/undo` use the same core checkpoint service as the CLI.

### Verification limits

- Unit/component tests and static checks only; no E2E app launch, live provider, browser, computer or Telegram run.
- Token values remain local estimates. No competitor benchmark, "world #1" or 50–75% external-savings claim is made.

## 3.1.0

### Command parity

- Added `src/commands.ts` as the single catalog for command names, usage, argument rules and supported surfaces. CLI help, TUI help/routing and the desktop palette/help now read from it.
- Fixed `/ultracode <task>` on CLI/TUI; it previously returned a usage error while desktop ran the workflow.
- Added `/doctor` to the interactive CLI and `/ram` as a `/gc` alias. Desktop gained `/tokens`, `/memory`, `/remember`, `/forget`, `/skills` and `/status`.
- Removed the duplicated TUI tool-title map; TUI uses `src/theme.ts`. The desktop renderer loads the same map over IPC instead of maintaining its own copy.
- Known commands that are CLI-only now produce an explicit unsupported message on desktop instead of a generic unknown-command error.

### User boundaries

- Added `src/constraints.ts`: conservative English/Turkish extraction of explicit path, command, tool and all-write boundaries.
- Boundaries persist across turns from the retained user messages, can be released explicitly, and are injected into the stable prompt as a hard-boundary section.
- Tool calls are checked before approval/execution. File writes and shell write syntax that target a protected path are rejected; `only` paths are enforced as an allowlist.
- Negated reminders such as “don’t forget to run tests” are deliberately not treated as constraints.

### Desktop parity and fixes (same 3.1.0 release)

- Added `src/host-services.ts` for shared image-provider resolution, model catalog and API-key validation; Desktop image generation now receives the same provider context as CLI.
- Added `src/turn-runner.ts`; CLI and Desktop use the same goal/plan/ultracode/subagent dispatch.
- Fixed Desktop custom-endpoint model discovery (base URL preserved) and added OpenRouter key validation.
- Desktop gained `/effort`, `/skills <id>`, `/sessions`, `/resume`, `/imagegen`, `/gui`, `/mcp` and `/bot`; `/ultracode` now supports the same on/off toggle and task forms as CLI.
- Added an MCP management modal, Desktop Telegram bridge controls and first-run API-key onboarding.
- Fixed command-palette clicks after dynamic catalog replacement via event delegation; Escape now closes the topmost modal before it can abort a running turn.
- Tightened narrow-window toolbar behavior and added shared MCP status styling.

### Context and interface

- Large artifacts are content-addressed, so identical tool output reuses one local file and one id.
- The desktop Run Spine now derives its phase from real tool events (`Keşif`, `Plan`, `Uygulama`, `Doğrulama`) instead of a monotonic tool counter.
- Version metadata remains 3.1.0; the local NSIS installer is produced as `release/T-Bot-Setup-3.1.0.exe`.

### Verification limits

- Unit/component tests only; no E2E app launch, live provider, browser, computer or Telegram run.
- Token values remain local estimates, not a competitor benchmark. No “world #1” or 50–75% external savings claim is made.

## 3.0.0

### Revision

- Restored the Tabit green brand palette across the desktop and TUI.
- Added title-case UI labels (Turkish conjunctions stay lowercase).
- Restored desktop `/plan` and `/ultracode` flows, including Plan Apply.
- Fixed narrow-window sidebar toggles with an overlay drawer and explicit active state.
- Restored desktop `/subagents` with the real `runSubagents` host path.
- Kept browser, desktop and dev-server tool schemas visible for their intents; clarified the agent prompt for Browser Use, Computer Use, background dev servers and project verification.
- Added lightweight enter/palette transitions on the GPU compositor.

### Agent and context

- Added model-aware local context budgets (`context-budget.ts`); small models get a tighter history, fewer rounds and one-action guidance.
- Replaced the Turkish system prompt with a stable English operating contract; final response language now follows the user.
- Added artifact storage for large tool outputs. The model receives a bounded summary and can recover exact slices with `artifact_read`.
- Added `project_verify` to run only project-declared `typecheck`, `check`, `lint` and `test` scripts with approval.
- Added turn/phase guidance: locate, plan, act, verify, report.
- Centralized credential redaction in `src/security/redact.ts` and fixed a quadratic URL-userinfo regex found while testing large session persistence.

### Desktop and TUI

- Rebuilt the desktop visual language around a quiet, terminal-inspired layout: graphite surfaces, one Tabit-green accent, no emoji, monospace code, thin rules.
- Added the Run Spine activity indicator, a compact status line and a keyboard-first command palette.
- Reworked session, task, approval, tool-card, diff, modal and composer surfaces.
- Moved the TUI palette to the same graphite/Tabit-green system.
- Preserved the 40-record transcript bound, lazy tool bodies, reduced-motion policy and approval queue.

### Desktop/runtime

- Version metadata is now 3.0.0; the local NSIS installer and manifest are produced as `release/T-Bot-Setup-3.0.0.exe`.
- Added artifact and verification tests; full suite is 204 tests at the time of this change.

### Security

- Shared credential redaction across sessions, artifacts and logs.
- Kept protected-path read approval/write refusal, environment scrubbing, process ownership, GUI approval and last-exit-code classification.
- Security boundaries remain documented: shell commands run with user permissions and there is no OS sandbox.
