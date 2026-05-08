# Changelog

## v1.3.0

- **`.mcp/wcp-config.json` explicit opt-in for broadcast targets**: a new per-workspace file lets you control which agents the broadcast actually writes to, instead of "any agent dir we happen to detect". Schema:
  ```json
  { "agents": ["claude", "cursor"] }
  ```
  Only listed agents receive a write. Other agents are skipped even if their config dirs/files exist.
- **First-run auto-generation**: when `.mcp/wcp-config.json` is missing, the broadcast pipeline detects which agent artifacts are present in the workspace (e.g. `.cursor/`, `.claude/`, `opencode.json`) and writes a `wcp-config.json` containing those names. No prompt, no destructive action — the file is created with create-only semantics so existing files are never overwritten. This bootstraps existing users without surprise; you can then edit the generated list to opt agents in or out.
- **Per-server `agentExclude` still works** as before — wcp-config.json is the *workspace*-level opt-in; per-server filters narrow further. A server with `agentInclude: ["claude"]` only goes to Claude regardless of what wcp-config.json says.
- **opencode** added as a broadcast target (https://opencode.ai). The converter:
  - Output path: `<root>/opencode.json` (file at workspace root, not a subdir).
  - Schema transform: canonical `command` + `args` are joined into opencode's `command` array; `env` → `environment`; `type: "stdio"` → `"local"`; `type: "http"` / `"sse"` → `"remote"`; `enabled: true` is set by default.
  - Section-merge: `opencode.json` typically holds non-MCP keys (`tools`, `agent`, `tui`, etc.) — the converter reads existing content, replaces only the `mcp` key, and preserves everything else.
  - File-based detection: opencode is detected when either `.opencode/` (subdir for agents/commands/plugins) or `opencode.json` exists at the workspace root. New `detectFiles` array on the converter descriptor supports this.
- **Contextual default for missing agentInclude/agentExclude in .mcp/ content**: when a server in `.mcp/` (static or generator-emitted) lacks both filter keys, it now defaults based on how the broadcast was launched:
  - `wcp run --target X` → server is treated as `agentInclude: <X's agentNames>` (only the launching agent sees it).
  - `wcp run` (no target) → server is treated as `agentInclude: ["*"]` (broadcast everywhere).
  This unblocks generators authored before v1.1.0 (and lets users drop in legacy generator scripts that emit `{ mcpServers: { ... } }` fragments verbatim) without forcing every server to declare an explicit filter. Servers WITH explicit filters still honor exactly what the user wrote.
- **`wcp run --silent` + missing .mcp/ → exit 0 silently** (hook-friendly). When the SessionStart hook fires in a workspace that doesn't use `.mcp/` broadcast, the hook now exits silently instead of logging a "no .mcp/ directory found" error. Manual invocations (`wcp run` without `--silent`) still get the helpful error pointing at `wcp migrate`.
- **CLI build (`wcp`)**: ship a single-file Node CLI bundle alongside the VSCode extension. Same broadcast/migration logic, callable from terminals, hooks, and CI.
  - `wcp run [--target <agent>] [--silent]` — run the broadcast once. With `--target`, only that agent's output file is written (skipping the other converters entirely). Hooks/wrappers always set `--target` and `--silent`.
  - `wcp wrap <agent> -- <agent args>` — wrapper trampoline for `codex` and `gemini`. Internally runs a scoped broadcast (`--target <agent>`), then `exec`s the real agent binary with the original args. Skips any candidate on `PATH` whose realpath is the wrapper itself, so `wcp-codex` symlinks don't loop.
  - `wcp migrate` — interactive migration prompt (the same three-step dialog as the extension). Requires a TTY.
- **`--target` scoping in `broadcastMcpToAllAgents`**: pass `target: '<agent>'` to scope the broadcast pipeline to a single converter. Used by the CLI's hot-path commands.
- **`log.initializeConsole({ silent })`**: log.js now supports a CLI/console sink (stdout/stderr) alongside the existing VSCode `OutputChannel` sink. `--silent` mode suppresses INFO/DEBUG so hook output stays clean.
- **Claude `SessionStart` hook**: documented copy-paste recipe for `.claude/settings.json` that runs `wcp run --target claude --silent` before each Claude session.
- **Codex/Gemini wrapper aliases**: documented `alias codex='wcp wrap codex --'` (and `gemini`) for transparent broadcast-on-launch.
- **Build pipeline**: new `npm run build:cli` (esbuild bundle). Output: `dist/wcp.js` (~320 KiB, single file with shebang). `chmod +x` is applied automatically. Works on Node 18+.
- **TOML library swap**: replaced `@iarna/toml` with `smol-toml`. `@iarna/toml`'s lazy-require pattern (`require('./impl/format')`) was unbundleable by esbuild; `smol-toml` is ESM/CJS native and statically analyzable. Same parse/stringify API; behavior unchanged. ~40 KiB smaller bundle.

## v1.2.0

- **Migration dialog**: when the extension activates and detects legacy per-tool MCP files (`.cursor/mcp.shared.json`, `.cursor/mcp.local.json`, `.cursor/mcp.generator.*.*.js`, and same in `.vscode` / `.claude` / `.codex`) but no `.mcp/` directory, a one-time prompt offers to convert them to the new shared layout. The flow has three steps:
  - Step 1: `Migrate all` / `Choose services…` / `Don't ask again` / `Dismiss`. Persistence of "don't ask" is per-workspace via `workspaceState`.
  - Step 2: per-tool generator handling — `Move to .mcp/` (broadcasts to all agents), `Keep tool-specific` (leaves them in `.<tool>/mcp.generator.*.*.js`), or `Skip`.
  - Step 3: original-file disposition — `Leave originals in place`, `Rename to .bak`, `Delete originals`, or `Cancel migration`.
- **Lenient JSON unwrap throughout the broadcast pipeline**: `.mcp/*.json` files, `.mcp/*.js` generator output, and tool-specific overlays may all use either the canonical flat form or any known wrapper key (`mcpServers`, `servers`, `mcp_servers`). Lets users migrate generator scripts verbatim without rewriting their return values.
- **Tool-overlay auto-inject**: servers in `.<tool>/mcp.shared.json` / `.<tool>/mcp.local.json` / `.<tool>/mcp.generator.*.*.js` that lack both `agentInclude` and `agentExclude` are auto-stamped with the converter's `agentNames` (e.g. `["vscode", "copilot"]`). The file's location is treated as the scope declaration, so existing overlays don't need editing.
- **Migration outputs gitignore-warn**: `.mcp/team.json` and `.mcp/local.json` written by migration go through the same `gitignoreCheck.warnIfTargetNotIgnored` flow as every other extension-written file.

## v1.1.0

- Add `.claude`, `.codex`, `.gemini` to the list of recognized AI-tool config dirs alongside `.cursor` / `.vscode`. Same `<base>.shared.json` / `<base>.local.json` / `<base>.generator.*.*.js` pattern as today.
- Special-case `.claude` to avoid collisions with Claude's own conventions:
  - `.claude/settings.shared.json` + `.claude/settings.personal.json` → `.claude/settings.local.json` (Claude's gitignored personal-overrides slot). The personal-input is renamed from `settings.local.json` to `settings.personal.json`.
  - `.claude/mcp.shared.json` + `.claude/mcp.local.json` → `<workspace>/.mcp.json` (Claude's project-scope MCP file location).
  - `.claude/launch.*` and `.claude/tasks.*` are skipped (Claude doesn't read them).
- Add a new shared `.mcp/` directory at the workspace root that holds canonical, agent-agnostic MCP server definitions and broadcasts them to every agent's expected MCP file with per-agent format conversion: `mcpServers` for Cursor/Claude/Copilot, `servers` for VSCode, `[mcp_servers.*]` TOML sections for Codex (preserving non-MCP TOML keys).
- Non-recursive discovery in `.mcp/`: top-level `*.json` files are definitions (alphabetical, with `local.json` pinned last so personal overrides win), top-level `<name>.<priority>.js` files are generators (priority order). Subdirectories ignored — put `require()`-able helpers in `.mcp/lib/`.
- Per-server `agentInclude` / `agentExclude` filters, **required**: every server in `.mcp/` must declare exactly one of these keys (use `["*"]` for "all agents"). `"copilot"` is recognized as an alias for the `.vscode/mcp.json` output (since GitHub Copilot in VSCode reads that file).
- Add `workspaceConfigPlus.mcp.broadcast.targets` setting (array of `cursor` | `claude` | `vscode` | `codex`, default all four).
- Add `workspaceConfigPlus.gitignoreWarning` setting (`prompt` | `silent`, default `prompt`). When the extension is about to write a merged output that isn't gitignored, a one-time dialog offers to add the path to `.gitignore`, suppress the warning for that file (persisted in `workspaceState`), or dismiss.

## v0.2.5

- Support deep merging when merging _.shared.json and _.local.json pairs and use by default
- Add extension configuration option, `arrayMerge`, that allows users to control the merge behavior of array-type keys defined in both the _.shared.json and _.local.json files: either by deeply merging/combining the two array values, or utilize the prior behavior of just using the array from _.local.json/ignoring the overlapping key in _.shared.json
