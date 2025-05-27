'use strict';

const fileHandler = require('./file-handler');
const watcher = require('./watcher');
const log = require('./log');
const { workspace, Uri } = require('vscode');
const path = require('path');

const workspaceConfigFileNames = ['launch', 'settings', 'tasks', 'mcp'];
const configDirPreference = ['.cursor', '.vscode'];

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

const initializeWorkspaceFolder = async ({
  folderUri,
  createFileSystemWatcher,
  createRelativePattern,
  joinPath,
  readFile,
  writeFile,
  stat,
}) => {
  let activeConfigDirName = null;

  for (const dirName of configDirPreference) {
    const dirUri = joinPath(folderUri, dirName);
    if (await directoryExists(dirUri, stat)) {
      activeConfigDirName = dirName;
      log.info(`Using configuration directory: ${dirUri.fsPath}`);
      break;
    }
  }

  if (!activeConfigDirName) {
    log.info(`No configuration directory found in ${folderUri.fsPath} (checked: ${configDirPreference.join(', ')})`);
    return;
  }

  const activeConfigDirUri = joinPath(folderUri, activeConfigDirName);

  workspaceConfigFileNames.forEach(configFileBaseName => {
    const sharedFileName = `${configFileBaseName}.shared.json`;
    const localFileName = `${configFileBaseName}.local.json`;
    const targetFileName = `${configFileBaseName}.json`;

    const targetFileUri = joinPath(activeConfigDirUri, targetFileName);
    const sharedFileUri = joinPath(activeConfigDirUri, sharedFileName);
    const localFileUri = joinPath(activeConfigDirUri, localFileName);

    const globPattern = createRelativePattern(
      activeConfigDirUri,
      `{${localFileName},${sharedFileName}}`
    );

    log.debug(`Setting up watcher for pattern: ${globPattern.pattern} in ${activeConfigDirUri.fsPath}`);
    watcher.generateFileSystemWatcher({
      globPattern,
      createFileSystemWatcher,
      readFile,
      writeFile,
      folderUri,
      vscodeFileUri: targetFileUri,
      sharedFileUri,
      localFileUri,
    });

    log.debug(`Performing initial merge check for ${targetFileName} in ${activeConfigDirUri.fsPath}`);
    fileHandler.mergeConfigFiles({
      vscodeFileUri: targetFileUri,
      sharedFileUri,
      localFileUri,
      readFile,
      writeFile,
    });
  });
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
