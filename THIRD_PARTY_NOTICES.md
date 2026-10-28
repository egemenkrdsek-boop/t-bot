# Third-party notices and provenance

T Bot original code uses the [MIT License](LICENSE), Copyright (c) 2026 T Bot contributors. Version 3.0.0 includes specifically adapted MIT components identified below. These ports do not import either upstream repository's complete Git history, runtime, dependency tree, assets, or branding. The available T Bot history begins with its own `Initial T Bot CLI`; no broader ancestry or complete source similarity audit is claimed. No affiliation, endorsement, or upstream API compatibility is implied.

## OpenCode: edit matching and line-ending preservation

- Repository: [anomalyco/opencode](https://github.com/anomalyco/opencode).
- Pinned commit: `fa1260d6ca484fe0fd868aa992ad81ab85343cf3`.
- [Source: packages/core/src/tool/plugin/edit.ts](https://github.com/anomalyco/opencode/blob/fa1260d6ca484fe0fd868aa992ad81ab85343cf3/packages/core/src/tool/plugin/edit.ts), blob `5165e7a5547b94c638d847da9d16f5066bb481b1`.
- Local adaptation: `src/tools/edit-match.ts`, integrated through T Bot file editing.
- Scope: Unicode match normalization, occurrence/line matching, and preserving line endings in replacement regions. T Bot requires a unique match, bounds candidate scanning and line alignment, and omits the upstream Effect runtime and replace-all behavior. This is a selected component port, not the complete OpenCode editor.
- [Pinned upstream license](https://github.com/anomalyco/opencode/blob/fa1260d6ca484fe0fd868aa992ad81ab85343cf3/LICENSE), checked 2026-10-28. The copyright and complete MIT notice follow.

```text
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Hermes Agent: context compaction window planning

- Repository: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).
- Pinned commit: `ee7e0f517232fb619c72e49d7e648436bddc598e`.
- [Source: agent/context_compressor_window.py](https://github.com/NousResearch/hermes-agent/blob/ee7e0f517232fb619c72e49d7e648436bddc598e/agent/context_compressor_window.py) and [agent/context_compressor.py](https://github.com/NousResearch/hermes-agent/blob/ee7e0f517232fb619c72e49d7e648436bddc598e/agent/context_compressor.py) (`_walk_tail_budget`, lines 3125–3143; `_find_tail_cut_by_tokens`, lines 4985–5105).
- Local adaptation: `src/context-window.ts`, integrated through `src/token-optimizer.ts` and `src/agent.ts`.
- Scope: a TypeScript token-budget tail window with atomic tool call/result boundaries. T Bot retains system/user text, adds bounded evidence handoff and explicit overflow, and omits Python dependencies, LLM summarization and prepared background compaction. This is a selected planner adaptation, not the complete Hermes compressor.
- [Pinned upstream license](https://github.com/NousResearch/hermes-agent/blob/ee7e0f517232fb619c72e49d7e648436bddc598e/LICENSE), checked 2026-10-28. The copyright and complete MIT notice follow.

```text
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Distributed dependencies

Runtime dependencies include the Model Context Protocol TypeScript SDK, Playwright Core, TypeScript and their transitive dependencies. Their own package licenses and notices apply. See [THIRD_PARTY_DEPENDENCIES.md](THIRD_PARTY_DEPENDENCIES.md) for production dependency license identifiers from the lockfile. Distributed dependency package directories retain their license files. Electron distributions additionally include Electron/Chromium notices supplied by Electron. Development and packaging tools have their own licenses; this inventory does not cover every downloaded build tool or operating system component.
