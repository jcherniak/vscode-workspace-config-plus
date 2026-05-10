# Workspace Config+

Provides additional capabilities to manage your "workspace" configuration settings, including the ability to utilize `shared` and `local` versions of the VS Code workspace configuration files.

> **Note**: A VS Code "workspace" is usually just your project root folder. This extension can be immediately used in standard, single root/projects, _as well as_ more advanced, multi-root workspaces. See the VS Code docs [What is a VS Code "Workspace"?](https://code.visualstudio.com/docs/editor/workspaces) and [Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings#_workspace-settings) for more information.

---

**Functional, but still in Beta !!!!**

---

[![Version Badge][version-badge]][ext-url]
[![Installs Badge][installs-badge]][ext-url]
[![Rating Badge][rating-badge]][ext-url]
[![License Badge][license-badge]][license-url]

[![Linux CI Badge][linux-ci-badge]][linux-ci-url]
[![Mac CI Badge][mac-ci-badge]][mac-ci-url]
[![Windows CI Badge][windows-ci-badge]][windows-ci-url]

[![Test Results Badge][tests-badge]][tests-url]
[![Coverage Badge][coverage-badge]][coverage-url]
[![Sonar Quality GateBadge][quality-gate-badge]][sonar-project-url]

## Current Features

- Adds support for `shared` and `local` configuration files (e.g., `settings.shared.json`, `settings.local.json`).
- Looks for configuration files in `.cursor` and `.vscode` directories (prioritizes `.cursor` if present).

### Shared and Local Configuration Files

With this extension you can now split your project's workspace configuration between shared files that can be checked into version control and shared with other team members, as well as local configuration overrides/extension that are excluded from version control.

The extension automatically detects whether to use the `.cursor` or `.vscode` directory for configuration files. If a `.cursor` directory exists in your workspace folder, it will be used; otherwise, the extension falls back to using the `.vscode` directory. This allows compatibility with standard VS Code setups while enabling distinct configurations for Cursor users.

It currently supports merging `*.shared.json` and `*.local.json` files into the corresponding base `.json` file for:

- `settings.json` - (`settings.shared.json`, `settings.local.json`)
- `tasks.json` - (`tasks.shared.json`, `tasks.local.json`)
- `launch.json` - (`launch.shared.json`, `launch.local.json`)
- `mcp.json` - (`mcp.shared.json`, `mcp.local.json`) 

#### Setup

Be sure your `*.local.json` files and the main configuration files (e.g., `settings.json`, `mcp.json`) are excluded from version control by adding the corresponding entries to your project's ignore file (e.g. `.gitignore`, `.hgignore`). For example:

```
# .gitignore

# Ignore all files in .vscode and .cursor...
.vscode/*
.cursor/*

# ...but DO track the shared files
!.vscode/*.shared.json
!.cursor/*.shared.json
```

Then just add your desired `*.shared.json` and/or `*.local.json` files to your preferred configuration directory (`.cursor` or `.vscode`) in your workspace folder(s). The extension works with both standard (single root) workspace projects and [multi root workspaces][multi-root-workspace-docs].

Enter the values that you want to share with other contributors into the `*.shared.json` file, and any personal/local overrides and additional settings to the corresponding `*.local.json` file. The configuration values defined in a `*.local.json` file will take precedence over any conflicting values defined in the corresponding `*.shared.json` file.

The extension will re-evaluate and, if necessary, automatically apply any configuration updates any time any supported `*.shared.json` or `*.local.json` files are added, modified, or removed, as well as when additional folders are added to a workspace. As such you never have to worry about running any commands!

This extension is not an all-or-nothing proposition. Team members and contributors that want to take advantage of the shared configuration defined in the `*.shared.json` files only need to have this extension installed and enabled. Any contributor that _doesn't_ want to pull in any of the project's shared configuration can either not install or disable this extension, or they can create a corresponding `*.local.json` file to override the shared settings.

[multi-root-workspace-docs]: https://code.visualstudio.com/docs/editor/multi-root-workspaces

#### Settings

> Note that currently Workspace Config+ requires you to specify any of the below settings in your "workspace" files, and it doesn't yet support setting them at the user/machine global level.
>
> If you'd like to use these settings to modify the behavior of Workspace Config+ ,then you'll need to add the setting to either your `*.local.json` or `*.shared.json` file (e.g., `settings.local.json`, `mcp.shared.json`).

##### `arrayMerge`

Allows you to specify how the extension should handle array-type keys that are defined in multiple places (i.e. in both the `*.shared.json` and `*.local.json)`)

**Default**: `combine`  
**Supported values**: [ `combine`, `overwrite` ]

When set to `combine`, the two array values will be combined in the final result.

For example, if you have the following:

`tasks.local.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "My awesome personal task",
      ...
    }
  ]
}
```

and `tasks.shared.json`

```json
{
  "version": "0.1.0",
  "foo": "bar",
  "configurations": [
    {
      "name": "Shared Team task #1",
      ...
    }
  ]
}
```

The end result in `tasks.json` that VS Code will see and honor will have both of the tasks defined under the `configurations` arrays in the shared and local files:

`tasks.json`

```json
{
  "version": "0.2.0",
  "foo": "bar",
  "configurations": [
    {
      "name": "My awesome personal task",
      ...
    },
    {
      "name": "Shared Team task #1",
      ...
    }
  ]
}
```

However, if you change the value of the setting to `overwrite`, then the overlapping `configurations` array value in `*.local.json` will be used instead, producing the below for `tasks.json`:

```json
{
  "version": "0.2.0",
  "foo": "bar",
  "configurations": [
    {
      "name": "Shared Team task #1",
      ...
    }
  ]
}
```

### Limitations

All configuration setting values are ultimately stored and persisted in the native workspace configuration files (e.g. `.vscode/settings.json`, `.cursor/mcp.json`). However, because these features are added via an extension there are some associated limitations and accordingly we'd strongly advise against manually modifying those native files when using the extension, and instead advise managing your configuration in the shared/local files.

- You can utilize inline comments in the `*.local.json` and `*.shared.json` files, but any comments from those files are not persisted into the native VS Code configuration file.
- Any comments added to the native VS Code configuration file (e.g. `settings.json`) will be lost when any configuration updates are applied based on changes to the local/shared files.
  - Some other extensions may automatically add configuration values to the native files with comments, so we'd advise moving any such configuration values to the corresponding `*.local.json` or `*.shared.json` file if you'd like to maintain the comments.
- The extension does _not_ monitor any changes made to the native VS Code configuration files (e.g. `settings.json`), so if you manually modify a value in one of those files then that takes precedence with VS Code.
  - If you mistakenly modify the native file, the easiest way to trigger this extension to correct the configuration is to modify the corresponding shared or local file (e.g. add a blank line and then save).
- This extension only works with the workspace configuration files, and doesn't allow for configuration values to be edited in the [VS Code Settings Editor][vscode-settings-editor-docs] interface.
- We've tested and validated the extension with both single and [multi-root workspace][vscode-multiroot-docs] projects. We have _not_ had a chance to test with [VS Code Remote SSH][vscode-ssh-docs] based workspaces, nor browser-based workspaces like [GitHub Codespaces][github-codespaces-docs]. We don't necessarily expect any particular issues in those types of projects, but just haven't been able to test and validate (if you do, and want to test, please let us know!)
- Our understanding is that you will not be able to sync your `*.local.json` files if you are a user of the native [VS Code Settings Sync][vscode-settings-sync] feature. However, the [Settings Sync Extension][settings-sync-ext] may support synchronizing the `*.local.json` configuration files too.

[vscode-settings-editor-docs]: https://code.visualstudio.com/docs/getstarted/settings#_settings-editor
[vscode-multiroot-docs]: https://code.visualstudio.com/docs/editor/multi-root-workspaces
[vscode-ssh-docs]: https://code.visualstudio.com/docs/remote/ssh
[github-codespaces-docs]: https://github.com/features/codespaces
[vscode-settings-sync]: https://code.visualstudio.com/docs/editor/settings-sync
[settings-sync-ext]: https://marketplace.visualstudio.com/items?itemName=Shan.code-settings-sync

### Background

VS Code is highly configurable, and allows you to [configure specific workspaces in addition to your global user settings.]([vscode-settings-docs]). This includes things like general settings, such as the zoom level, as well as [tasks and launch configurations] amongst others. These configurations are stored in various respective files within the `.vscode` directory (or `.cursor` for Cursor users) in the workspace. For example, the workspace task configuration is stored in `.vscode/tasks.json`.

This works fantastically, but unfortunately often poses a challenging question for teams or projects that have more than one author since they have to determine whether or not to track the configuration file(s) in version control. If they include the files in version control then they'll often run into conflicting opinions or even conflicting settings, such as those from extensions which are specific to the developer's local file system. However, if they exclude the files from version control then they give up the ability to share elements that are helpful for other developers and force contributors to manually duplicate part of their setup.

There are some longstanding requests from the VS Code community ([microsoft/vscode#40233][vscode-github-issue-40233], [microsoft/vscode#37519][vscode-github-issue-37519], [microsoft/vscode#15909][vscode-github-issue-15909]) to extend the product to address these concerns, and we hope to see a resolution natively within VS Code some day. This extension should help fill the gap in the interim however.

[vscode-settings-docs]: https://code.visualstudio.com/docs/getstarted/settings
[tasks-launch-docs]: https://code.visualstudio.com/docs/editor/workspaces#_workspace-tasks-and-launch-configurations
[vscode-github-issue-40233]: https://github.com/microsoft/vscode/issues/40233
[vscode-github-issue-37519]: https://github.com/microsoft/vscode/issues/37519
[vscode-github-issue-15909]: https://github.com/microsoft/vscode/issues/15909

## MCP Broadcast

Drop a single canonical MCP server definition into `.mcp/` and Workspace Config+ broadcasts it to every AI agent's expected config file with per-agent format conversion. One source of truth, every surface stays in sync.

Supported targets: **Cursor** (`.cursor/mcp.json`), **Claude** (`<root>/.mcp.json`), **VSCode/Copilot** (`.vscode/mcp.json`), **Codex** (`.codex/config.toml`), and **[opencode](https://opencode.ai)** (`<root>/opencode.json`). The extension watches `.mcp/` and refreshes outputs on every change. The CLI (`wcp`) provides the same logic for terminal and hook usage.

### Quick start

1. Create `.mcp/team.json` at your workspace root:
   ```json
   {
     "linear": {
       "type": "stdio",
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-linear"],
       "env": { "LINEAR_API_KEY": "${env:LINEAR_API_KEY}" }
     }
   }
   ```
2. Open the workspace in VSCode/Cursor (extension auto-broadcasts), **or** run `wcp run` from your terminal.
3. The first run auto-generates `.mcp/wcp-config.json` listing the agents detected in your workspace. Edit it later to opt agents in or out.
4. For Claude / Codex / Gemini, add a wrapper alias to your shell rc — see [Per-agent integration](#per-agent-integration) below.

### `.mcp/` directory layout

The extension only looks at files **directly inside `.mcp/`** (non-recursive). Subdirectories are ignored — put helper modules used by your generators inside `.mcp/lib/` or any subfolder.

| Pattern | Role |
|---------|------|
| `*.json` (top-level) | **Definition file** — flat map of `serverName → serverDef`. Multiple files allowed (e.g. `team.json`, `infra.json`). Merged in alphabetical filename order. |
| `local.json` (top-level) | **Personal override** — pinned to merge last so it always wins over other definition files. Conventionally gitignored. |
| `<name>.<priority>.js` (top-level) | **Generator** — Node script that prints canonical-shape JSON to stdout. Runs after JSON definitions in priority order (lower priority first; later overrides earlier). |
| `*.js` without `<priority>` segment | Ignored — usable as `require()` targets from generators. |
| `wcp-config.json` | Reserved — see [Per-workspace opt-in](#per-workspace-opt-in-mcpwcp-configjson). NOT treated as a definition file. |

### Canonical format

Author each server as a flat entry keyed by name:

```jsonc
{
  "linear": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-linear"],
    "env": { "LINEAR_API_KEY": "${env:LINEAR_API_KEY}" }
  },
  "company-internal": {
    "type": "http",
    "url": "https://mcp.example.com",
    "headers": { "Authorization": "Bearer ${env:COMPANY_TOKEN}" }
  }
}
```

The wrapper key (`mcpServers` for Claude/Cursor, `servers` for VSCode, `mcp_servers` TOML sections for Codex, `mcp` for opencode) is added by each agent's converter at write time — you never write it by hand.

**Lenient input format**: `.mcp/*.json` files and generator output may use either the flat form above or a wrapped shape (`{ "mcpServers": { ... } }`, `{ "servers": { ... } }`, `{ "mcp_servers": { ... } }`). The extension auto-unwraps. Lets you drop a legacy generator script into `.mcp/` without rewriting it.

### Per-server agent filters (optional)

Two optional metadata keys on each server entry control which agents receive that server:

| Key | Meaning |
|-----|---------|
| `"agentInclude": ["*"]` | Emit to every agent (matches the no-target default — see below). |
| `"agentInclude": ["claude", "cursor"]` | Emit only to the listed agents. |
| `"agentExclude": ["codex"]` | Emit to every agent except the listed ones. |
| `"agentExclude": ["*"]` | Skip every agent (effectively disabled). |

**Defaults when filter is omitted** (contextual — based on how the broadcast was launched):

- **Launched with `--target X`** (from a `wcp wrap claude` wrapper, a SessionStart hook, etc.): the server defaults to `agentInclude: [<X's agentNames>]`. Only the launching agent sees it. Matches "I'm running for claude right now, so unfiltered servers should go to claude."
- **Launched without `--target`** (manual `wcp run` or extension full-refresh): the server defaults to `agentInclude: ["*"]`. Broadcast everywhere.

Rules:

- **Mutually exclusive**: specifying both `agentInclude` and `agentExclude` on the same server logs an error and drops that server from every output.
- **Stripped on output**: agent-filter keys are extension metadata; they're removed from the emitted config so the agent never sees them.

Recognized agent names: `cursor`, `claude`, `vscode`, `codex`, `opencode`, plus `copilot` as an alias for the `vscode` target (Copilot in VSCode reads the same `.vscode/mcp.json`, so a server visible to one is visible to both).

### Per-workspace opt-in: `.mcp/wcp-config.json`

The broadcast only writes to agents listed in `.mcp/wcp-config.json`:

```json
{ "agents": ["claude", "cursor", "vscode", "codex", "opencode"] }
```

If the file is missing on first run, the extension auto-generates it from detected artifacts (`.cursor/`, `.claude/`, `.vscode/`, `.codex/`, `opencode.json`, `.opencode/`). Edit the generated file to opt agents in or out — it's never overwritten once it exists.

This is the workspace-level opt-in. Per-server `agentInclude` / `agentExclude` filters narrow further on top of this list. A server with `agentInclude: ["claude"]` only ever goes to Claude regardless of what `wcp-config.json` says.

### Output destinations

| Agent | Output file | Format |
|-------|-------------|--------|
| Cursor | `.cursor/mcp.json` | `{ "mcpServers": { ... } }` |
| Claude | `<workspace_root>/.mcp.json` | `{ "mcpServers": { ... } }` |
| VSCode (& Copilot) | `.vscode/mcp.json` | `{ "servers": { ... } }` |
| Codex | `.codex/config.toml` | `[mcp_servers.<name>]` TOML; non-MCP keys preserved |
| opencode | `<workspace_root>/opencode.json` | `{ "mcp": { ... } }` with full schema transform; non-MCP keys preserved |

Codex's `config.toml` and opencode's `opencode.json` are **section-merged**: the extension reads the existing file, replaces only the MCP section, and writes back, preserving keys like Codex's `model` and opencode's `tools` / `agent` / `tui`.

#### opencode schema transform

Opencode's MCP schema differs from the standard. The converter remaps each canonical entry:

| Canonical | opencode |
|-----------|----------|
| `type: "stdio"` | `type: "local"` |
| `type: "http"` / `"sse"` | `type: "remote"` |
| `command` (string) + `args` (array) | `command` (array) — joined as `[command, ...args]` |
| `env` (object) | `environment` (object) |
| `url` / `headers` / `timeout` | Pass-through |
| (extension default) | `enabled: true` |

### Per-tool overlays (advanced)

Per-tool config files (`.cursor/mcp.shared.json`, `.claude/mcp.shared.json`, `.vscode/mcp.shared.json`, `.codex/mcp.shared.json` plus their `.local.json` and `mcp.generator.*.*.js` siblings) still work — they're treated as **overlays on top of the canonical `.mcp/` content** for that tool only. Tool-specific overlay wins on name collision. Servers in an overlay file inherit the tool's scope automatically — you don't need to add `agentInclude` to overlay servers.

When `.mcp/` exists, the broadcast pipeline owns every per-tool MCP output. When `.mcp/` is absent, the per-tool merge runs as it did before this feature.

### Migration from legacy per-tool layout

If your repo already has `.cursor/mcp.shared.json`, `.claude/mcp.shared.json`, etc. but no `.mcp/`, the extension offers a one-time migration dialog on activation. The CLI exposes the same flow as `wcp migrate`.

The dialog has three steps:

1. **Convert?** — `Migrate all`, `Choose services…`, `Don't ask again`, or `Dismiss`.
2. **Generator handling, per tool** — `Move to .mcp/` (broadcasts to all agents), `Keep tool-specific` (stays scoped to that tool), or `Skip`.
3. **Original files** — `Leave originals in place` (recommended), `Rename to .bak`, `Delete originals`, or `Cancel migration`.

Migration produces:

- `.mcp/team.json` from each tool's `mcp.shared.json` (servers stamped with `agentInclude: [<sourceTool>]` to preserve original scope)
- `.mcp/local.json` from each tool's `mcp.local.json` (same stamping)
- Optional copied generators in `.mcp/<name>.<priority>.js`

### Codex caveats

- Output goes to `.codex/config.toml` at the workspace root. Project-scoped Codex config requires a recent Codex CLI version that reads project-level `.codex/`. The extension does **not** write `~/.codex/config.toml` (the user-level Codex config) — that's intentional.
- HTTP/SSE server schemas in Codex TOML are less standardized than stdio. The converter writes canonical fields verbatim; stdio is the well-supported case.

### CLI (`wcp`)

The same broadcast and migration logic ships as a single-file Node CLI for use outside of VSCode/Cursor — terminals, scripts, hooks, and CI.

#### Build & install

```bash
npm install
npm run build:cli                    # writes dist/wcp.js (~330 KiB single file with shebang)
cp dist/wcp.js ~/.local/bin/wcp      # or wherever your shell looks
```

Requires Node 18+ on the target machine.

#### Commands

```text
wcp run [--target <agent>] [--root <path>] [--silent]
    Run the .mcp/ broadcast once. With --target, only that agent's output
    file is written; otherwise broadcasts to every detected agent.
    Hooks/wrappers always set --target and --silent.
    With --silent, missing .mcp/ exits 0 silently (hook-friendly).

wcp wrap <agent> -- <agent args>
    Wrapper trampoline for claude / codex / gemini. Runs a scoped broadcast
    for the given agent, then execs the real agent binary with the
    remaining args. Skips any binary whose realpath matches the wrapper
    itself.

wcp migrate [--root <path>]
    Interactive migration from legacy per-tool MCP files into .mcp/.
    Three steps: which services -> generator handling -> original-file
    disposition. Requires a TTY.
```

### Per-agent integration

| Agent | Recommended setup |
|-------|-------------------|
| **Claude Code** | `alias claude='wcp wrap claude --'`. Claude reads MCP at session bootstrap *before* any hook fires, so the wrapper is the only way to refresh `.mcp.json` for the **current** session. |
| **Cursor** | The VSCode extension covers this. CLI is the manual fallback. |
| **VSCode** | Same — extension is the primary path. |
| **Codex CLI** | `alias codex='wcp wrap codex --'` |
| **Gemini CLI** | `alias gemini='wcp wrap gemini --'` |
| **opencode** | The extension covers this when running in your editor. CLI: run `wcp run` manually as needed (opencode reloads its config on file change). |
| GitHub Copilot CLI | Out of scope — `~/.copilot/mcp-config.json` is global; manage manually. |

#### Claude wrapper alias (recommended)

```bash
# In ~/.bashrc or ~/.zshrc:
alias claude='wcp wrap claude --'
```

`wcp wrap claude` runs `wcp run --target claude --silent` (writes only `<root>/.mcp.json`), then `exec`s the real `claude` binary with the user's original args. The trailing `--` tells the wcp argv parser to stop interpreting flags so Claude's own `--`-flags pass through unambiguously.

#### Claude SessionStart hook (fallback)

```jsonc
// ~/.claude/settings.json (or .claude/settings.local.json per-project)
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "wcp run --target claude --silent" }
        ]
      }
    ]
  }
}
```

The hook refreshes `<root>/.mcp.json` for the **next** session. Claude reads MCP servers during session bootstrap *before* `SessionStart` hooks complete, so the hook does NOT apply to the current session. Use the wrapper alias above if you need current-session freshness; the hook is a fallback for launches that bypass the alias (CI, scripts, IDE buttons).

#### Codex / Gemini wrapper aliases

```bash
# In ~/.bashrc or ~/.zshrc:
alias codex='wcp wrap codex --'
alias gemini='wcp wrap gemini --'
```

#### Why scope to a single agent

When invoked from a hook or wrapper, the only file the launching agent needs is its own. Writing the other four outputs at that moment is wasted work and a chance to thrash other agents' configs while they're not running. `--target <agent>` scopes the broadcast pipeline to one converter and exits fast.

The "broadcast to everything" mode is still available without `--target` for explicit manual invocations from a shell or CI.

## Feedback

Found a bug, have an idea for a new feature, or a question? Please reach out to us on the [project GitHub repository][github-repo-url] by opening an Issue or starting a Discussion!

Like this extension? Please consider starring the repo on GitHub! ![][stars-badge]

You can also share feedback by rating the extension and/or leaving a [review][marketplace-reviews-url] on the Marketplace.

[stars-badge]: https://img.shields.io/github/stars/swellaby/vscode-workspace-config-plus?style=social
[marketplace-reviews-url]: https://marketplace.visualstudio.com/items?itemName=swellaby.workspace-config-plus&ssr=false#review-details

## Contributing

All contributions are welcomed and appreciated! See the [Contributing guide](./CONTRIBUTING.md) for more information.

## License

MIT - see license details [here][license-url]

## Code of Conduct

This project follows the standard [Code of Conduct](https://github.com/swellaby/.github/blob/master/CODE_OF_CONDUCT.md) as other Swellaby projects, which is the [Contributor Covenant](https://www.contributor-covenant.org/)

[installs-badge]: https://img.shields.io/vscode-marketplace/i/swellaby.workspace-config-plus?style=flat-square&label=installs
[version-badge]: https://img.shields.io/vscode-marketplace/v/swellaby.workspace-config-plus?style=flat-square&label=version
[rating-badge]: https://img.shields.io/vscode-marketplace/r/swellaby.workspace-config-plus?style=flat-square
[ext-url]: https://marketplace.visualstudio.com/items?itemName=swellaby.workspace-config-plus
[license-url]: https://github.com/swellaby/vscode-workspace-config-plus/blob/main/LICENSE
[license-badge]: https://img.shields.io/github/license/swellaby/vscode-workspace-config-plus?style=flat-square&color=blue
[linux-ci-badge]: https://img.shields.io/github/actions/workflow/status/swellaby/vscode-workspace-config-plus/linux.yml?label=linux%20build&style=flat-square&branch=main
[linux-ci-url]: https://github.com/swellaby/vscode-workspace-config-plus/actions/workflows/linux.yml?query=branch%3Amain
[mac-ci-badge]: https://img.shields.io/github/actions/workflow/status/swellaby/vscode-workspace-config-plus/mac.yml?label=mac%20build&style=flat-square&branch=main
[mac-ci-url]: https://github.com/swellaby/vscode-workspace-config-plus/actions/workflows/mac.yml?query=branch%3Amain
[windows-ci-badge]: https://img.shields.io/github/actions/workflow/status/swellaby/vscode-workspace-config-plus/windows.yml?label=windows%20build&style=flat-square&branch=main
[windows-ci-url]: https://github.com/swellaby/vscode-workspace-config-plus/actions/workflows/windows.yml?query=branch%3Amain
[coverage-badge]: https://img.shields.io/codecov/c/github/swellaby/vscode-workspace-config-plus/main?style=flat-square
[coverage-url]: https://codecov.io/gh/swellaby/vscode-workspace-config-plus
[tests-badge]: https://img.shields.io/sonar/tests/swellaby:vscode-workspace-config-plus?server=https%3A%2F%2Fsonarcloud.io&style=flat-square
[tests-url]: https://sonarcloud.io/component_measures?id=swellaby%3Avscode-workspace-config-plus&metric=test_success_density&selected=swellaby%3Avscode-workspace-config-plus%3Atests%2Funit%2Fwatcher.js&view=list
[quality-gate-badge]: https://img.shields.io/sonar/quality_gate/swellaby:vscode-workspace-config-plus?server=https%3A%2F%2Fsonarcloud.io&style=flat-square
[sonar-project-url]: https://sonarcloud.io/project/overview?id=swellaby%3Avscode-workspace-config-plus
[github-repo-url]: https://github.com/swellaby/vscode-workspace-config-plus
