'use strict';

const fileHandler = require('./file-handler');
const watcher = require('./watcher');
const log = require('./log');
const mcpBroadcast = require('./mcp-broadcast');
const mcpMigration = require('./mcp-migration');

const workspaceConfigFileNames = ['launch', 'settings', 'tasks', 'mcp'];
const configDirPreference = ['.cursor', '.vscode', '.claude', '.codex', '.gemini'];
const SHARED_MCP_DIR = '.mcp';

// Sparse override of the default `<base>.{shared,local}.json -> <base>.json` mapping.
// Missing key => default behavior. Explicit `null` => skip this base in this dir entirely.
const fileOverrides = {
  '.claude': {
    settings: {
      sharedFile: 'settings.shared.json',
      localFile: 'settings.personal.json',
      targetFile: 'settings.local.json',
      targetLocation: 'configDir',
    },
    mcp: {
      sharedFile: 'mcp.shared.json',
      localFile: 'mcp.local.json',
      targetFile: '.mcp.json',
      targetLocation: 'workspaceRoot',
    },
    launch: null,
    tasks: null,
  },
};

async function directoryExists(dirUri, statFn) {
  try {
    await statFn(dirUri);
    return true;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'FileNotFound')) {
      return false;
    }
    log.error(`Error checking directory ${dirUri.fsPath}: ${error.message}`);
    log.debug(error);
    return false;
  }
}

const generatorGlobFragment = (sharedFileName, localFileName, base) =>
  `{${localFileName},${sharedFileName},${base}.generator.*.*.js}`;

const resolveBaseFiles = (dirName, base) => {
  const override = (fileOverrides[dirName] || {})[base];
  if (override === null) {
    return null;
  }
  const o = override || {};
  return {
    sharedFileName: o.sharedFile || `${base}.shared.json`,
    localFileName: o.localFile || `${base}.local.json`,
    targetFileName: o.targetFile || `${base}.json`,
    targetLocation: o.targetLocation || 'configDir',
  };
};

const _setupSharedMcpBroadcast = ({
  folderUri,
  mcpDirUri,
  createFileSystemWatcher,
  createRelativePattern,
  joinPath,
  readFile,
  writeFile,
  stat,
  readDirectory,
  showWarningMessage,
  workspaceState,
  getConfiguration,
}) => {
  log.info(`Using shared MCP directory: ${mcpDirUri.fsPath}`);

  const broadcastArgs = {
    folderUri, // watcher uses this as a disposable key
    workspaceFolderUri: folderUri,
    mcpDirUri,
    joinPath,
    readFile,
    writeFile,
    readDirectory,
    stat,
    showWarningMessage,
    workspaceState,
    getConfiguration,
  };

  // Watch .mcp/ for any *.json or *.js change.
  const mcpGlob = createRelativePattern(mcpDirUri, '*.{json,js}');
  watcher.generateFileSystemWatcher({
    globPattern: mcpGlob,
    createFileSystemWatcher,
    mergeArgs: { ...broadcastArgs, _broadcast: true },
  });

  // Also watch each per-tool overlay dir for mcp.* changes so overlay edits re-broadcast.
  for (const dirName of configDirPreference) {
    const overlayDir = joinPath(folderUri, dirName);
    const overlayGlob = createRelativePattern(
      overlayDir,
      '{mcp.shared.json,mcp.local.json,mcp.generator.*.*.js}'
    );
    watcher.generateFileSystemWatcher({
      globPattern: overlayGlob,
      createFileSystemWatcher,
      mergeArgs: { ...broadcastArgs, _broadcast: true },
    });
  }

  // Initial broadcast.
  mcpBroadcast.broadcastMcpToAllAgents(broadcastArgs);
};

// eslint-disable-next-line max-statements, complexity
const initializeWorkspaceFolder = async ({
  folderUri,
  createFileSystemWatcher,
  createRelativePattern,
  joinPath,
  readFile,
  writeFile,
  stat,
  readDirectory,
  showWarningMessage,
  showInformationMessage,
  showQuickPick,
  deleteFile,
  workspaceState,
  getConfiguration,
}) => {
  let foundAnyConfigDir = false;

  // Check for shared .mcp/ first; if present it OWNS all MCP outputs and the
  // per-tool mcp merges in the loop below are skipped.
  const mcpDirUri = joinPath(folderUri, SHARED_MCP_DIR);
  let sharedMcpEnabled = await directoryExists(mcpDirUri, stat);

  // Offer migration when .mcp/ is absent but legacy per-tool MCP files exist.
  if (!sharedMcpEnabled) {
    try {
      const migrationResult = await mcpMigration.promptAndMigrate({
        workspaceFolderUri: folderUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
        deleteFile,
        stat,
        readDirectory,
        showInformationMessage,
        showQuickPick,
        showWarningMessage,
        workspaceState,
        getConfiguration,
      });
      if (migrationResult && migrationResult.written && migrationResult.written.length > 0) {
        // Migration created .mcp/; proceed with broadcast setup.
        sharedMcpEnabled = await directoryExists(mcpDirUri, stat);
      }
    } catch (e) {
      log.error(`MCP migration prompt failed: ${e.message}`);
      log.debug(e);
    }
  }
  if (sharedMcpEnabled) {
    foundAnyConfigDir = true;
    _setupSharedMcpBroadcast({
      folderUri,
      mcpDirUri,
      createFileSystemWatcher,
      createRelativePattern,
      joinPath,
      readFile,
      writeFile,
      stat,
      readDirectory,
      showWarningMessage,
      workspaceState,
      getConfiguration,
    });
    // Also: if a .mcp/local.json exists post-migration, the warning fires
    // automatically when migration writes it. If .mcp/local.json was authored
    // manually after the fact, the broadcast watcher's first run will produce
    // outputs that already trigger the warning chain.
  }

  for (const dirName of configDirPreference) {
    const dirUri = joinPath(folderUri, dirName);
    if (!(await directoryExists(dirUri, stat))) {
      continue;
    }
    foundAnyConfigDir = true;
    log.info(`Using configuration directory: ${dirUri.fsPath}`);

    const activeConfigDirUri = dirUri;

    // eslint-disable-next-line max-statements
    workspaceConfigFileNames.forEach(configFileBaseName => {
      // When .mcp/ is present, the broadcast pipeline owns every per-tool MCP output.
      if (sharedMcpEnabled && configFileBaseName === 'mcp') {
        return;
      }
      const resolved = resolveBaseFiles(dirName, configFileBaseName);
      if (resolved === null) {
        return;
      }
      const { sharedFileName, localFileName, targetFileName, targetLocation } = resolved;

      const targetParentUri =
        targetLocation === 'workspaceRoot' ? folderUri : activeConfigDirUri;
      const targetFileUri = joinPath(targetParentUri, targetFileName);
      const sharedFileUri = joinPath(activeConfigDirUri, sharedFileName);
      const localFileUri = joinPath(activeConfigDirUri, localFileName);

      const globPattern = createRelativePattern(
        activeConfigDirUri,
        generatorGlobFragment(sharedFileName, localFileName, configFileBaseName)
      );

      log.debug(
        `Setting up watcher for pattern: ${(globPattern && globPattern.pattern) || '?'} in ${activeConfigDirUri.fsPath}`
      );

      const mergeArgs = {
        folderUri,
        vscodeFileUri: targetFileUri,
        sharedFileUri,
        localFileUri,
        readFile,
        writeFile,
        joinPath,
        workspaceFolderUri: folderUri,
        configDirUri: activeConfigDirUri,
        configFileBaseName,
        readDirectory,
        showWarningMessage,
        workspaceState,
        getConfiguration,
      };

      watcher.generateFileSystemWatcher({
        globPattern,
        createFileSystemWatcher,
        mergeArgs,
      });

      log.debug(`Performing initial merge check for ${targetFileName} in ${activeConfigDirUri.fsPath}`);
      fileHandler.mergeConfigFiles(mergeArgs);
    });
  }

  if (!foundAnyConfigDir) {
    log.info(`No configuration directory found in ${folderUri.fsPath} (checked: ${SHARED_MCP_DIR}, ${configDirPreference.join(', ')})`);
  }
};

const handleWorkspaceFolderUpdates = ({
  added,
  removed,
  createFileSystemWatcher,
  createRelativePattern,
  joinPath,
  readFile,
  writeFile,
  stat,
  readDirectory,
  showWarningMessage,
  showInformationMessage,
  showQuickPick,
  deleteFile,
  workspaceState,
  getConfiguration,
}) => {
  if (added && Array.isArray(added)) {
    added.forEach(f =>
      module.exports.initializeWorkspaceFolder({
        folderUri: f.uri,
        createFileSystemWatcher,
        createRelativePattern,
        joinPath,
        readFile,
        writeFile,
        stat,
        readDirectory,
        showWarningMessage,
        showInformationMessage,
        showQuickPick,
        deleteFile,
        workspaceState,
        getConfiguration,
      })
    );
  }
  if (removed && Array.isArray(removed)) {
    removed.forEach(f => watcher.disposeWorkspaceWatcher(f.uri));
  }
};

const initializeLog = createOutputChannel => {
  log.initialize(createOutputChannel);
};

const deactivate = () => {
  log.info('Deactivating and disposing all watchers');
  watcher.disposeAllWatchers();
  log.dispose();
};

module.exports = {
  deactivate,
  handleWorkspaceFolderUpdates,
  initializeLog,
  initializeWorkspaceFolder,
};
