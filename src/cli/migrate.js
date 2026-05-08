'use strict';

const path = require('node:path');
const log = require('../log');
const cliPlatform = require('../cli-platform');
const mcpMigration = require('../mcp-migration');

const migrateCommand = async args => {
  log.initializeConsole({ silent: false });

  if (!process.stdin.isTTY) {
    log.error(
      'wcp migrate requires an interactive terminal. ' +
        'Pipe-friendly invocation is not yet supported; run from a real shell.'
    );
    return 2;
  }

  const workspaceRoot = await cliPlatform.resolveWorkspaceRoot(args.root);
  const mcpDirAbs = path.join(workspaceRoot, '.mcp');
  const callbacks = cliPlatform.createCallbacks({ workspaceRoot });

  // Warm the workspaceState cache so `.get()` returns persisted dismissal.
  if (callbacks.workspaceState && callbacks.workspaceState._load) {
    await callbacks.workspaceState._load();
  }

  const result = await mcpMigration.promptAndMigrate({
    workspaceFolderUri: cliPlatform._uri(workspaceRoot),
    mcpDirUri: cliPlatform._uri(mcpDirAbs),
    ...callbacks,
  });

  if (!result) {
    log.info('wcp migrate: no migration performed.');
    return 0;
  }
  log.info(
    `wcp migrate: imported from ${result.selected.join(', ')} (disposition=${result.disposition}).`
  );
  return 0;
};

module.exports = { migrateCommand };
