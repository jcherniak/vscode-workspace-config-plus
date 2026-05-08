'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const log = require('../log');
const cliPlatform = require('../cli-platform');
const mcpBroadcast = require('../mcp-broadcast');

const VALID_TARGETS = ['cursor', 'claude', 'vscode', 'codex'];

const runCommand = async args => {
  log.initializeConsole({ silent: Boolean(args.silent) });

  const workspaceRoot = await cliPlatform.resolveWorkspaceRoot(args.root);
  const target = args.target ? String(args.target).toLowerCase() : undefined;
  if (target && !VALID_TARGETS.includes(target)) {
    log.error(
      `Unknown --target "${target}". Must be one of: ${VALID_TARGETS.join(', ')}.`
    );
    return 2;
  }

  const mcpDirAbs = path.join(workspaceRoot, '.mcp');
  try {
    await fs.access(mcpDirAbs);
  } catch (_e) {
    // In --silent mode (hook usage), "no .mcp/ here" is the common case for
    // workspaces that don't use the broadcast feature. Exit 0 silently so we
    // don't spam session-start logs. Manual invocations still get the
    // helpful error.
    if (args.silent) {
      return 0;
    }
    log.error(
      `No .mcp/ directory found at ${workspaceRoot}. Run \`wcp migrate\` if you have legacy per-tool MCP files, or create .mcp/ with your canonical definitions.`
    );
    return 1;
  }

  const callbacks = cliPlatform.createCallbacks({ workspaceRoot });
  const workspaceFolderUri = cliPlatform._uri(workspaceRoot);
  const mcpDirUri = cliPlatform._uri(mcpDirAbs);

  log.info(
    `wcp run: workspace=${workspaceRoot} target=${target || '(all)'}`
  );

  await mcpBroadcast.broadcastMcpToAllAgents({
    workspaceFolderUri,
    mcpDirUri,
    target,
    ...callbacks,
  });

  return 0;
};

module.exports = { runCommand, VALID_TARGETS };
