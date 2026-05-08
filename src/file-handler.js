'use strict';

const { isDeepStrictEqual } = require('util');
const jsoncParser = require('jsonc-parser');
const deepMerge = require('deepmerge');
const log = require('./log');
const discovery = require('./generator-discovery');
const { runGeneratorScript: defaultRunGeneratorScript } = require('./generator-runner');
const gitignoreCheck = require('./gitignore-check');

const _arrayMergeKey = 'workspaceConfigPlus.arrayMerge';
const _arrayMergeDefaultValue = 'combine';

const _loadConfigFromFile = async (fileUri, readFile) => {
  const contents = await readFile(fileUri);
  if (!contents) {
    return undefined;
  }
  const errors = [];
  const config = jsoncParser.parse(contents.toString(), errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    throw new Error(`Failed to parse contents of: ${fileUri.fsPath}`);
  }
  return config;
};

const _objectFromGeneratorStdout = (stdoutText, scriptFsPath) => {
  const errors = [];
  const config = jsoncParser.parse(stdoutText, errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/C from generator: ${scriptFsPath}`);
  }
  if (
    typeof config !== 'object' ||
    config === null ||
    Array.isArray(config)
  ) {
    throw new Error(
      `Generator output must be a JSON object: ${scriptFsPath}`
    );
  }
  return config;
};

const getMergedConfigs = ({ sharedConfig, localConfig }) => {
  const shared = sharedConfig || {};
  const local = localConfig || {};
  let arrayMerge =
    local[_arrayMergeKey] || shared[_arrayMergeKey] || _arrayMergeDefaultValue;
  const invalidValueErrorMessage = `Invalid value for 'arrayMerge' setting: '${arrayMerge}'. Must be 'overwrite' or 'combine'`;
  if (typeof arrayMerge != 'string') {
    throw new Error(invalidValueErrorMessage);
  }

  arrayMerge = arrayMerge.toLowerCase();
  let options = {};
  if (arrayMerge == 'overwrite') {
    options.arrayMerge = (_dest, source, _options) => source;
  } else if (arrayMerge !== 'combine') {
    throw new Error(invalidValueErrorMessage);
  }
  return deepMerge(shared, local, options);
};

/**
 * Runs generator scripts by ascending priority order and merges onto shared+local aggregate.
 *
 * Each layer uses the same arrayMerge rules as local-over-shared (`getMergedConfigs`).
 */
const _mergeGeneratorLayersOntoBase = async ({
  generatorSpecs,
  joinPath,
  configDirUri,
  workspaceFsPath,
  runGeneratorScriptFn,
  mergedBase,
}) => {
  let merged = mergedBase;
  for (const spec of generatorSpecs) {
    const scriptUri = joinPath(configDirUri, spec.filename);
    const scriptFsPath =
      typeof scriptUri.fsPath === 'string'
        ? scriptUri.fsPath
        : `${scriptUri.path || scriptUri}`;
    try {
      const stdoutText = await runGeneratorScriptFn(
        scriptFsPath,
        workspaceFsPath
      );
      const genConfig = _objectFromGeneratorStdout(stdoutText, scriptFsPath);
      merged = module.exports.getMergedConfigs({
        sharedConfig: merged,
        localConfig: genConfig,
      });
    } catch (e) {
      log.error(`Generator ${spec.filename}: ${e.message}`);
      log.debug(e);
    }
  }
  return merged;
};

const _canEnumerateGenerators = args =>
  Boolean(
    typeof args.readDirectory === 'function' &&
      typeof args.joinPath === 'function' &&
      args.configDirUri &&
      args.workspaceFolderUri &&
      args.configFileBaseName
  );

const _readGeneratorDirectorySafe = async (readDirectory, configDirUri) => {
  try {
    const entries = await readDirectory(configDirUri);
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    log.warn(`Workspace Config+ listing ${configDirUri.fsPath}: ${e.message}`);
    log.debug(e);
    return [];
  }
};

// eslint-disable-next-line max-statements, complexity
const mergeConfigFiles = async ({
  vscodeFileUri,
  sharedFileUri,
  localFileUri,
  readFile,
  writeFile,
  joinPath,
  workspaceFolderUri,
  configDirUri,
  configFileBaseName,
  readDirectory,
  runGeneratorScript,
  showWarningMessage,
  workspaceState,
  getConfiguration,
}) => {
  const loadConfigFromFile = module.exports._loadConfigFromFile;
  try {
    const generatorCapable = _canEnumerateGenerators({
      readDirectory,
      joinPath,
      configDirUri,
      workspaceFolderUri,
      configFileBaseName,
    });

    const directoryPromise =
      generatorCapable && readDirectory && configDirUri
        ? _readGeneratorDirectorySafe(readDirectory, configDirUri)
        : Promise.resolve([]);

    const [[sharedConfig, localConfig], directoryEntries] =
      await Promise.all([
        Promise.all([
          loadConfigFromFile(sharedFileUri, readFile),
          loadConfigFromFile(localFileUri, readFile),
        ]),
        directoryPromise,
      ]);

    const generatorSpecs = generatorCapable
      ? discovery.collectGeneratorsForBase(directoryEntries, configFileBaseName)
      : [];

    if (
      !sharedConfig &&
      !localConfig &&
      generatorSpecs.length === 0
    ) {
      return;
    }

    let merged = module.exports.getMergedConfigs({
      sharedConfig: sharedConfig || {},
      localConfig: localConfig || {},
    });

    if (
      generatorSpecs.length > 0 &&
      joinPath &&
      configDirUri &&
      workspaceFolderUri
    ) {
      const wsPath = workspaceFolderUri.fsPath || workspaceFolderUri.path;
      const runGeneratorScriptFn =
        typeof runGeneratorScript === 'function'
          ? runGeneratorScript
          : defaultRunGeneratorScript;
      merged = await _mergeGeneratorLayersOntoBase({
        generatorSpecs,
        joinPath,
        configDirUri,
        workspaceFsPath: wsPath,
        runGeneratorScriptFn,
        mergedBase: merged,
      });
    }

    const vscodeFileContents = await loadConfigFromFile(
      vscodeFileUri,
      readFile
    );

    if (isDeepStrictEqual(vscodeFileContents, merged)) {
      return;
    }

    log.info(`Updating config in ${vscodeFileUri.fsPath}`);

    const writePromise = writeFile(
      vscodeFileUri,
      Buffer.from(JSON.stringify({ ...vscodeFileContents, ...merged }, null, 2)),
      { create: true, overwrite: true }
    );

    if (workspaceFolderUri && typeof showWarningMessage === 'function') {
      gitignoreCheck
        .warnIfTargetNotIgnored({
          workspaceRootUri: workspaceFolderUri,
          targetFileUri: vscodeFileUri,
          readFile,
          writeFile,
          joinPath,
          showWarningMessage,
          workspaceState,
          getConfiguration,
        })
        .catch(e => {
          log.debug(`gitignore-check failed: ${e.message}`);
        });
    }

    await writePromise;
  } catch (e) {
    log.error(e.message);
    log.debug(e);
  }
};

module.exports = {
  mergeConfigFiles,
  getMergedConfigs,
  // Private, only exported for test mocking / advanced use
  _loadConfigFromFile,
  _arrayMergeKey,
  _arrayMergeDefaultValue,
  _objectFromGeneratorStdout,
};
