'use strict';

// Note: the shebang for the bundled CLI is added by esbuild's `banner` option
// in build/build-cli.mjs. We don't put one here so that direct `require()` of
// this file (in tests) works without a leading "#!" syntax error.

const mri = require('mri');
const { runCommand } = require('./run');
const { migrateCommand } = require('./migrate');
const { wrapCommand } = require('./wrap');

const VERSION = require('../../package.json').version;

const HELP = `wcp ${VERSION} — Workspace Config+ CLI

Usage:
  wcp run [--target <agent>] [--root <path>] [--silent]
      Run the .mcp/ broadcast once. Writes only the named target's output
      file when --target is set; otherwise broadcasts to every detected
      agent. Hooks/wrappers should always set --target and --silent.

  wcp wrap <agent> -- <agent args>
      Wrapper trampoline for claude / codex / gemini. Runs a scoped
      broadcast for the given agent, then execs the real agent binary
      with the remaining args. Skips any binary whose real path matches
      the wcp wrapper itself. Wrapping is required for claude because
      SessionStart hooks fire AFTER MCP discovery; wrapping refreshes
      .mcp.json before claude bootstraps.

  wcp migrate [--root <path>]
      Interactive migration from legacy per-tool MCP files into .mcp/.
      Three steps: which services -> generator handling -> original-file
      disposition. Requires a TTY.

Flags:
  --target <agent>   cursor | claude | vscode | codex
  --root <path>      Workspace root (default: walk up from CWD looking for
                     .mcp/ / .vscode/ / .cursor/ / .claude/ / .codex/ / .git/)
  --silent           Suppress non-error output (info/debug)
  -h, --help         Show this help
  -v, --version      Print version

Examples:
  wcp run                                # broadcast to every detected agent
  wcp run --target claude --silent       # what Claude SessionStart hook calls
  alias claude='wcp wrap claude --'      # refresh .mcp.json before claude
                                         #  reads it (current-session fix)
  alias codex='wcp wrap codex --'        # transparent wrapper
  wcp migrate                            # interactive migration prompt
`;

const main = async (argv = process.argv.slice(2), entry = process.argv[1]) => {
  const args = mri(argv, {
    boolean: ['silent', 'help', 'version'],
    alias: { h: 'help', v: 'version' },
    string: ['target', 'root'],
    '--': false,
  });

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const cmd = args._.shift();
  if (!cmd) {
    process.stdout.write(HELP);
    return 0;
  }

  try {
    switch (cmd) {
      case 'run':
        return await runCommand(args);
      case 'wrap':
        return await wrapCommand(args, entry);
      case 'migrate':
        return await migrateCommand(args);
      default:
        process.stderr.write(`wcp: unknown command "${cmd}". See \`wcp --help\`.\n`);
        return 2;
    }
  } catch (e) {
    process.stderr.write(`wcp: ${e.message || e}\n`);
    if (process.env.WCP_DEBUG) process.stderr.write(`${e.stack}\n`);
    return 1;
  }
};

if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = { main, HELP, VERSION };
