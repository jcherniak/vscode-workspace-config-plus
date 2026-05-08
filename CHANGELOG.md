# Changelog

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
