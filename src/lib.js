'use strict';

const fileHandler = require('./file-handler');
const watcher = require('./watcher');
const log = require('./log');

const workspaceConfigFileNames = ['launch', 'settings', 'tasks', 'mcp'];
const configDirPreference = ['.cursor', '.vscode', '.claude', '.codex', '.gemini'];

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
  workspaceState,
  getConfiguration,
}) => {
  let foundAnyConfigDir = false;

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
    log.info(`No configuration directory found in ${folderUri.fsPath} (checked: ${configDirPreference.join(', ')})`);
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
