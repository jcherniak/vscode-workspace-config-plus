'use strict';

const jsoncParser = require('jsonc-parser');
const log = require('./log');
const converters = require('./mcp-converters');
const generatorDiscovery = require('./generator-discovery');
const gitignoreCheck = require('./gitignore-check');

const _DISMISS_KEY = 'workspaceConfigPlus.mcp.migration.dismissed';

const _parseJson = (text, label) => {
  if (!text) return null;
  const errors = [];
  const obj = jsoncParser.parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Failed to parse ${label}`);
  }
  return obj;
};

const _readJsonFile = async (uri, readFile) => {
  try {
    const buf = await readFile(uri);
    if (!buf) return null;
    return _parseJson(buf.toString(), uri.fsPath);
  } catch (e) {
    log.debug(`mcp-migration: read ${uri.fsPath}: ${e.message}`);
    return null;
  }
};

const _statExists = async (uri, stat) => {
  try {
    await stat(uri);
    return true;
  } catch (_e) {
    return false;
  }
};

const _readDirSafe = async (uri, readDirectory) => {
  try {
    const entries = await readDirectory(uri);
    return Array.isArray(entries) ? entries : [];
  } catch (_e) {
    return [];
  }
};

/**
 * Detect legacy MCP layout for the given workspace folder.
 * Returns map of toolName -> { hasShared, hasLocal, generators: [filename, ...] }
 * for every tool with at least one legacy artifact.
 */
// eslint-disable-next-line max-statements
const detectLegacy = async ({
  workspaceFolderUri,
  joinPath,
  stat,
  readDirectory,
}) => {
  const detected = {};
  for (const name of converters.allConverterNames) {
    const converter = converters.converters[name];
    const dirUri = joinPath(workspaceFolderUri, converter.configDir);
    if (!(await _statExists(dirUri, stat))) continue;
    const sharedUri = joinPath(dirUri, 'mcp.shared.json');
    const localUri = joinPath(dirUri, 'mcp.local.json');
    const hasShared = await _statExists(sharedUri, stat);
    const hasLocal = await _statExists(localUri, stat);
    const entries = await _readDirSafe(dirUri, readDirectory);
    const gens = generatorDiscovery.collectGeneratorsForBase(entries, 'mcp');
    if (hasShared || hasLocal || gens.length > 0) {
      detected[name] = {
        hasShared,
        hasLocal,
        generators: gens.map(g => g.filename),
      };
    }
  }
  return detected;
};

const _injectAgentInclude = (flat, agentNames) => {
  const out = {};
  for (const [name, def] of Object.entries(flat)) {
    if (!def || typeof def !== 'object') continue;
    if (Array.isArray(def.agentInclude) || Array.isArray(def.agentExclude)) {
      out[name] = def;
    } else {
      out[name] = { ...def, agentInclude: agentNames };
    }
  }
  return out;
};

const _mergeFlat = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (out[k] && typeof out[k] === 'object' && typeof v === 'object') {
      out[k] = { ...out[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
};

const _writeJsonAndWarn = async ({
  uri,
  obj,
  readFile,
  writeFile,
  joinPath,
  workspaceFolderUri,
  showWarningMessage,
  workspaceState,
  getConfiguration,
}) => {
  const body = Buffer.from(`${JSON.stringify(obj, null, 2)}\n`);
  await writeFile(uri, body, { create: true, overwrite: true });
  // Hook into the same gitignore warning used by the rest of the extension.
  if (typeof showWarningMessage === 'function') {
    gitignoreCheck
      .warnIfTargetNotIgnored({
        workspaceRootUri: workspaceFolderUri,
        targetFileUri: uri,
        readFile,
        writeFile,
        joinPath,
        showWarningMessage,
        workspaceState,
        getConfiguration,
      })
      .catch(e => log.debug(`gitignore-check: ${e.message}`));
  }
};

// eslint-disable-next-line max-statements
const _mergeStaticForTool = async ({
  toolName,
  toolDirUri,
  joinPath,
  readFile,
  teamAccumulator,
  localAccumulator,
}) => {
  const sharedUri = joinPath(toolDirUri, 'mcp.shared.json');
  const localUri = joinPath(toolDirUri, 'mcp.local.json');
  const sharedRaw = await _readJsonFile(sharedUri, readFile);
  const localRaw = await _readJsonFile(localUri, readFile);
  if (sharedRaw) {
    const flat = converters.normalizeMcpJson(sharedRaw);
    const stamped = _injectAgentInclude(flat, [toolName]);
    Object.assign(teamAccumulator, _mergeFlat(teamAccumulator, stamped));
  }
  if (localRaw) {
    const flat = converters.normalizeMcpJson(localRaw);
    const stamped = _injectAgentInclude(flat, [toolName]);
    Object.assign(localAccumulator, _mergeFlat(localAccumulator, stamped));
  }
};

const _renameUri = async ({ srcUri, destUri, readFile, writeFile, deleteFile }) => {
  // Portable rename via read-write-delete (extension API doesn't expose rename
  // directly; vscode.workspace.fs.rename exists but our injected callback bag
  // doesn't carry it. Read+write is fine for our small JSON/JS files.)
  let buf;
  try {
    buf = await readFile(srcUri);
  } catch (_e) {
    return false;
  }
  if (!buf) return false;
  await writeFile(destUri, buf, { create: true, overwrite: true });
  if (typeof deleteFile === 'function') {
    try {
      await deleteFile(srcUri);
    } catch (e) {
      log.warn(`mcp-migration: rename src delete failed for ${srcUri.fsPath}: ${e.message}`);
    }
  }
  return true;
};

// eslint-disable-next-line max-statements
const _disposeOriginals = async ({
  disposition, // 'leave' | 'rename' | 'delete'
  legacyFiles, // [{ uri, baseName }]
  readFile,
  writeFile,
  deleteFile,
  joinPath,
}) => {
  if (disposition === 'leave') return;
  for (const f of legacyFiles) {
    if (disposition === 'delete') {
      if (typeof deleteFile === 'function') {
        try {
          await deleteFile(f.uri);
          log.info(`mcp-migration: deleted ${f.uri.fsPath}`);
        } catch (e) {
          log.warn(`mcp-migration: delete failed for ${f.uri.fsPath}: ${e.message}`);
        }
      }
      continue;
    }
    if (disposition === 'rename') {
      const parent = f.parentUri;
      const destUri = joinPath(parent, `${f.baseName}.bak`);
      const ok = await _renameUri({ srcUri: f.uri, destUri, readFile, writeFile, deleteFile });
      if (ok) log.info(`mcp-migration: renamed ${f.uri.fsPath} -> ${destUri.fsPath}`);
    }
  }
};

/**
 * Run the migration:
 *   - For each selected tool: merge mcp.shared.json/mcp.local.json into team/local accumulators
 *   - For each selected tool with generatorAction === 'move': copy *.generator.<n>.<p>.js to .mcp/<n>.<p>.js
 *   - Write .mcp/team.json and .mcp/local.json (if non-empty) and run gitignore warning
 *   - Apply original-file disposition (leave / rename / delete)
 */
// eslint-disable-next-line max-statements, complexity
const runMigration = async ({
  selectedTools,
  generatorActions, // { [toolName]: 'move' | 'keep' | 'skip' }
  disposition, // 'leave' | 'rename' | 'delete'
  detected,
  workspaceFolderUri,
  mcpDirUri,
  joinPath,
  readFile,
  writeFile,
  deleteFile,
  showWarningMessage,
  workspaceState,
  getConfiguration,
}) => {
  const teamAcc = {};
  const localAcc = {};
  const legacyFiles = []; // for disposition step

  for (const toolName of selectedTools) {
    const converter = converters.converters[toolName];
    if (!converter) continue;
    const toolDirUri = joinPath(workspaceFolderUri, converter.configDir);
    const info = detected[toolName] || {};

    if (info.hasShared) {
      legacyFiles.push({
        uri: joinPath(toolDirUri, 'mcp.shared.json'),
        parentUri: toolDirUri,
        baseName: 'mcp.shared.json',
      });
    }
    if (info.hasLocal) {
      legacyFiles.push({
        uri: joinPath(toolDirUri, 'mcp.local.json'),
        parentUri: toolDirUri,
        baseName: 'mcp.local.json',
      });
    }

    await _mergeStaticForTool({
      toolName,
      toolDirUri,
      joinPath,
      readFile,
      teamAccumulator: teamAcc,
      localAccumulator: localAcc,
    });

    const genAction = (generatorActions && generatorActions[toolName]) || 'keep';
    if (genAction === 'move' && Array.isArray(info.generators)) {
      for (const filename of info.generators) {
        const srcUri = joinPath(toolDirUri, filename);
        // strip 'mcp.generator.' prefix; keep <name>.<priority>.js
        const baseName = filename.replace(/^mcp\.generator\./, '');
        const destUri = joinPath(mcpDirUri, baseName);
        try {
          const buf = await readFile(srcUri);
          if (buf) {
            await writeFile(destUri, buf, { create: true, overwrite: true });
            log.info(`mcp-migration: copied generator ${srcUri.fsPath} -> ${destUri.fsPath}`);
            legacyFiles.push({
              uri: srcUri,
              parentUri: toolDirUri,
              baseName: filename,
            });
          }
        } catch (e) {
          log.warn(`mcp-migration: copy generator ${srcUri.fsPath} failed: ${e.message}`);
        }
      }
    }
    // 'keep' / 'skip' → nothing to do; generator stays where it is.
  }

  const written = [];
  if (Object.keys(teamAcc).length > 0) {
    const teamUri = joinPath(mcpDirUri, 'team.json');
    await _writeJsonAndWarn({
      uri: teamUri,
      obj: teamAcc,
      readFile,
      writeFile,
      joinPath,
      workspaceFolderUri,
      showWarningMessage,
      workspaceState,
      getConfiguration,
    });
    written.push(teamUri);
  }
  if (Object.keys(localAcc).length > 0) {
    const localUri = joinPath(mcpDirUri, 'local.json');
    await _writeJsonAndWarn({
      uri: localUri,
      obj: localAcc,
      readFile,
      writeFile,
      joinPath,
      workspaceFolderUri,
      showWarningMessage,
      workspaceState,
      getConfiguration,
    });
    written.push(localUri);
  }

  await _disposeOriginals({
    disposition,
    legacyFiles,
    readFile,
    writeFile,
    deleteFile,
    joinPath,
  });

  return written;
};

const _isDismissed = workspaceState => {
  if (!workspaceState || typeof workspaceState.get !== 'function') return false;
  return Boolean(workspaceState.get(_DISMISS_KEY, false));
};

const _persistDismiss = async workspaceState => {
  if (!workspaceState || typeof workspaceState.update !== 'function') return;
  try {
    await workspaceState.update(_DISMISS_KEY, true);
  } catch (e) {
    log.debug(`mcp-migration: failed to persist dismiss: ${e.message}`);
  }
};

const STEP1 = {
  MIGRATE_ALL: 'Migrate all',
  CHOOSE: 'Choose services…',
  DONT_ASK: 'Don\'t ask again',
  DISMISS: 'Dismiss',
};

const STEP2_GENERATOR = {
  MOVE: 'Move to .mcp/',
  KEEP: 'Keep tool-specific',
  SKIP: 'Skip',
};

const STEP3_DISPOSITION = {
  LEAVE: 'Leave originals in place',
  RENAME: 'Rename to .bak',
  DELETE: 'Delete originals',
  CANCEL: 'Cancel migration',
};

const _summarize = detected => {
  const lines = [];
  for (const [tool, info] of Object.entries(detected)) {
    const parts = [];
    if (info.hasShared) parts.push('mcp.shared.json');
    if (info.hasLocal) parts.push('mcp.local.json');
    if (info.generators.length > 0) parts.push(`${info.generators.length} generator(s)`);
    lines.push(`.${tool}/ (${parts.join(', ')})`);
  }
  return lines.join('; ');
};

// eslint-disable-next-line max-statements, complexity
const _selectServices = async ({ detected, choice, showQuickPick }) => {
  const allTools = Object.keys(detected);
  if (choice === STEP1.MIGRATE_ALL) return allTools;
  if (choice !== STEP1.CHOOSE) return null;
  if (typeof showQuickPick !== 'function') {
    log.warn('MCP migration: showQuickPick not available; using all detected tools.');
    return allTools;
  }
  const picks = await showQuickPick(
    allTools.map(name => ({ label: name, picked: true })),
    {
      canPickMany: true,
      placeHolder: 'Select tools to import into .mcp/ (default: all)',
    }
  );
  if (!picks || picks.length === 0) {
    log.info('MCP migration: cancelled (no selection).');
    return null;
  }
  return picks.map(p => (typeof p === 'string' ? p : p.label));
};

const _askGeneratorActions = async ({
  selectedTools,
  detected,
  showInformationMessage,
}) => {
  const actions = {};
  for (const tool of selectedTools) {
    const info = detected[tool] || {};
    if (!info.generators || info.generators.length === 0) {
      actions[tool] = 'keep';
      continue;
    }
    const choice = await showInformationMessage(
      `Migrate ${info.generators.length} generator(s) from .${tool}/? ` +
        'Move makes them broadcast to all agents; Keep leaves them tool-specific.',
      STEP2_GENERATOR.MOVE,
      STEP2_GENERATOR.KEEP,
      STEP2_GENERATOR.SKIP
    );
    if (choice === STEP2_GENERATOR.MOVE) actions[tool] = 'move';
    else if (choice === STEP2_GENERATOR.SKIP) actions[tool] = 'skip';
    else actions[tool] = 'keep';
  }
  return actions;
};

const _askDisposition = async showInformationMessage => {
  const choice = await showInformationMessage(
    'After migration, what should I do with the original .<tool>/mcp.* files?',
    STEP3_DISPOSITION.LEAVE,
    STEP3_DISPOSITION.RENAME,
    STEP3_DISPOSITION.DELETE,
    STEP3_DISPOSITION.CANCEL
  );
  if (choice === STEP3_DISPOSITION.RENAME) return 'rename';
  if (choice === STEP3_DISPOSITION.DELETE) return 'delete';
  if (choice === STEP3_DISPOSITION.CANCEL) return null;
  return 'leave';
};

// eslint-disable-next-line max-statements, complexity
const promptAndMigrate = async ({
  workspaceFolderUri,
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
}) => {
  if (typeof showInformationMessage !== 'function') return null;
  if (_isDismissed(workspaceState)) return null;

  const detected = await detectLegacy({
    workspaceFolderUri,
    joinPath,
    stat,
    readDirectory,
  });
  if (Object.keys(detected).length === 0) return null;

  const summary = _summarize(detected);
  const choice = await showInformationMessage(
    `Workspace Config+: detected legacy MCP files (${summary}). ` +
      'Convert them to the shared .mcp/ layout? Generators are handled per-tool in the next step.',
    STEP1.MIGRATE_ALL,
    STEP1.CHOOSE,
    STEP1.DONT_ASK,
    STEP1.DISMISS
  );

  if (choice === STEP1.DONT_ASK) {
    await _persistDismiss(workspaceState);
    return null;
  }
  if (choice !== STEP1.MIGRATE_ALL && choice !== STEP1.CHOOSE) {
    return null;
  }

  const selected = await _selectServices({ detected, choice, showQuickPick });
  if (!selected) return null;

  const generatorActions = await _askGeneratorActions({
    selectedTools: selected,
    detected,
    showInformationMessage,
  });

  const disposition = await _askDisposition(showInformationMessage);
  if (!disposition) {
    log.info('MCP migration: cancelled at disposition step.');
    return null;
  }

  log.info(
    `MCP migration: importing ${selected.join(', ')} -> .mcp/ (disposition: ${disposition})`
  );
  const written = await runMigration({
    selectedTools: selected,
    generatorActions,
    disposition,
    detected,
    workspaceFolderUri,
    mcpDirUri,
    joinPath,
    readFile,
    writeFile,
    deleteFile,
    showWarningMessage,
    workspaceState,
    getConfiguration,
  });
  log.info(`MCP migration: wrote ${written.length} file(s) into .mcp/`);
  return { written, selected, generatorActions, disposition };
};

module.exports = {
  detectLegacy,
  runMigration,
  promptAndMigrate,
  _DISMISS_KEY,
  STEP1,
  STEP2_GENERATOR,
  STEP3_DISPOSITION,
  _injectAgentInclude,
  _summarize,
};
