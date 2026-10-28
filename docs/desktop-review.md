# Desktop review — 2026-10-28

Scope: all desktop source files, including Electron main process, preload bridge,
renderer document/controller/styles, and memory-trimmer. Reviewed their contracts
with config, sessions, agent inputs, workflow storage, model discovery, and MCP
configuration. No E2E automation was added or run.

## Corrections

- Removed the developer-specific workspace from startup. The renderer asks main
  for its workspace; installed launches start in the user's home. Workspace
  changes reset the selected conversation, and a new session no longer inserts
  a synthetic user message.
- Reserved a turn before asynchronous config/provider/session work, rejected
  overlapping starts, and extended cancellation to asynchronous startup. Pending
  approvals settle on cancellation and completion. Composer/workspace/new-session
  controls remain locked until the actual turn promise settles; session switches
  cannot interrupt the displayed conversation mid-turn.
- Passed image attachments through IPC into the shared agent input contract
  implemented by the runtime owner. Decode PNG/JPEG/WebP/GIF inputs, normalize to
  PNG, resize to a 1200-pixel longest edge, cap three attachments, 4 MB source
  files, 16-megapixel decoded size and 2 MB base64 per image, release object URLs,
  validate base64 payloads again in main, and prevent
  submission while image decoding is pending.
- Escape assistant HTML before formatting markdown. No raw HTML or markdown link
  URLs become active renderer elements. Replaced inline event attributes with
  delegated listeners and added a restrictive CSP, renderer sandbox, blocked
  navigation/popups, denied Chromium permission prompts, and checked IPC sender
  webContents and main frame centrally.
- Settings writes preserve the loaded config object's revision identity, merge
  existing effort entries, use the provider:model effort key, and accept only the
  settings fields the desktop actually edits. API keys are cleared from the form
  after saving/closing. Removed the browser mock that silently stored keys in
  localStorage. Missing preload now produces an explicit failure screen.
- Centralized displayed provider/model catalogs on backend discovery and offline
  fallback instead of maintaining a separate renderer list. Keep configured
  custom model IDs selectable when discovery omits them. Reject stale model
  dropdown responses after a provider switch.
- Made pin-window work, corrected shell.openPath return handling, fixed keyboard
  navigation in the command search, supported IME composition, added button
  names/focus rings, keyboard-operable cards/todos/sessions, modal focus containment
  and restoration, and sidebar controls that remain reachable after collapsing.
- Actual application quit now aborts startup/active work, resolves pending
  approvals, stops background processes, closes the browser and desktop daemon,
  and closes live MCP connections. A dedicated lifecycle helper coalesces repeat
  quit events and applies a five-second deadline; hiding to tray does not trigger
  cleanup. New turns are rejected once shutdown starts.
- Actual total Electron working-set measurements replace the main-process-only
  RAM display. Removed invented initial RAM/savings/grounding values, invented
  memory-trim results, assumed connection validation, and the fake active MCP
  count (disabled default configurations no longer count). MCP status explicitly
  describes enabled configuration rather than proven connectivity.
- Removed the Ultracode toggle and stepper: they did not drive a desktop runtime
  mode. Goal submission now uses the same awaited, cancellable, session-aware
  message path and shared runGoal runner (up to four autonomous steps). Enabled
  MCP connections are opened for the turn, passed into the agent and closed in
  finally after both success and failure; unavailable servers emit safe status
  messages without disabling ordinary local tools. File drops resolve real paths
  through preload webUtils.getPathForFile, replacing removed Electron File.path.

## Cost and interface decisions

Kept Electron with vanilla JavaScript/CSS and the existing module boundaries.
Applied neutral surfaces, smaller static branding, readable dark-theme secondary
text, fewer decorative claims, and a narrower sidebar. Eliminated the permanent
60 FPS canvas loop, blurred overlays, decorative idle animation, and automatic
PowerShell/working-set trimming after every turn. Streaming markdown redraws are
coalesced to 50 ms and flushed at message boundaries. Thinking time updates once
per second; completed tool cards are removed from the active-card map. CSS honors
prefers-reduced-motion; JavaScript uses a static thinking marker in that mode.

Manual memory trim remains available. Windows EmptyWorkingSet changes resident
working-set accounting and can cause subsequent page faults; it is not evidence
that heap allocations were released. Removed the arbitrary 128 MB V8 heap cap, which could exhaust during image/provider
copies. Bounded image inputs and reduced idle work provide the cost controls.
No arbitrary RAM/performance target is
claimed from source review or these checks.

## Verification

- `node --test tests/desktop.test.cjs`: 10 passing focused checks covering
  hostile markdown, measured RAM values, IPC frame ownership, overlapping startup
  and cancellation, malformed attachments, config revision identity/effort
  preservation, MCP tool hydration/cleanup on success and failure, and CSP/inline-event
  restrictions, actual-quit versus tray-hide lifecycle behavior, and a hanging
  cleanup deadline. These use isolated JavaScript
  contexts and mocked IPC; they do not launch Electron or drive its UI.
- `node --check src/desktop/renderer/app.js` and
  `node --check src/desktop/preload.cjs`: passed.
- `npm run typecheck`: passed again after the runtime image contract and
  concurrent computer-tool integration were complete.
- `git diff --check -- src/desktop`: passed (Git only reported the repository's
  configured future LF-to-CRLF conversion notices).

Root coordinates final production build, packaging, and release artifact checks.

## Limits and follow-up considerations

- No graphical/installed-app visual QA, screen-reader QA, live provider request,
  real Windows trim measurement, or packaged-app execution was performed by this
  reviewer. The checks above do not prove those behaviors or an absolute RAM cap.
- Markdown intentionally supports a small safe subset; markdown links render as
  text. Images are first-frame/static PNG after normalization.
- Session history remains fully rendered; extremely long conversations can still
  grow renderer DOM/memory. No virtualization dependency or speculative rewrite
  was introduced. Existing tool results are scroll-bounded visually, not truncated
  in underlying stored history.
- Desktop goal launch now uses the shared bounded autonomous goal runner.
  Ultracode orchestration remains CLI-owned, and no desktop toggle claims to
  activate it.
- Custom provider endpoint management and MCP connection setup remain CLI-owned;
  desktop exposes current provider/model settings and enabled MCP configuration.
- The existing memory-trimmer native helper and optional headless verification
  mode were reviewed but not exercised or rewritten. Automatic post-turn working-set
  trimming is removed; only explicit user actions and explicit verification use it.
- Image dimensions are checked after browser decoding; this is not a guarantee
  against transient decode memory pressure from unusually compressed image files.
- SessionStore intentionally strips image payloads on disk: resumed conversations
  contain saved text/tool history and require reattaching images for visual context.
- MCP command-only definitions are not adapted into shell strings. Use an existing
  supported provider or a configured stdio URL; malformed/unsupported connections
  report a safe status and ordinary agent tools continue.
- Quit cleanup uses existing shared shutdown APIs. The browser shutdown API
  waits for any in-progress browser launch. If that launch outlasts the five-second
  quit deadline, a newly launched external browser could escape graceful cleanup;
  a browser-owner launch cancellation/force-shutdown API is required to eliminate
  that race. This review does not claim that a deadline can force a stuck external
  transport to release its process.
