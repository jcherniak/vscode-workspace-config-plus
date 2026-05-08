'use strict';

const { isDeepStrictEqual } = require('util');
const jsoncParser = require('jsonc-parser');
const deepMerge = require('deepmerge');
const log = require('./log');
const discovery = require('./mcp-discovery');
const converters = require('./mcp-converters');
const generatorDiscovery = require('./generator-discovery');
const { runGeneratorScript: defaultRunGeneratorScript } = require('./generator-runner');
const gitignoreCheck = require('./gitignore-check');

const _arrayMergeKey = 'workspaceConfigPlus.arrayMerge';

const _parseJson = (text, label) => {
  if (!text) return {};
  const errors = [];
  const obj = jsoncParser.parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Failed to parse ${label}`);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  return obj;
};

const _readJsonFile = async (uri, readFile) => {
  try {
    const buf = await readFile(uri);
    if (!buf) return {};
    return _parseJson(buf.toString(), uri.fsPath);
  } catch (e) {
    log.debug(`mcp-broadcast: read ${uri.fsPath}: ${e.message}`);
    return {};
  }
};

// Stamp agentInclude on every server in `flat` that lacks both filter keys.
// Used for tool-specific overlays: the file's location IS the scope declaration,
// so we default to the converter's agentNames (e.g. ['vscode', 'copilot']).
const _stampOverlayAgentInclude = (flat, agentNames) => {
  if (!flat || typeof flat !== 'object') return flat;
  const out = {};
  for (const [name, def] of Object.entries(flat)) {
    if (!def || typeof def !== 'object') {
      out[name] = def;
      continue;
    }
    if (Array.isArray(def.agentInclude) || Array.isArray(def.agentExclude)) {
      out[name] = def;
    } else {
      out[name] = { ...def, agentInclude: agentNames };
    }
  }
  return out;
};

const _mergeWithArrayRule = (a, b) => {
  // Pull arrayMerge directive if present at top level of either layer.
  const rule = (b && b[_arrayMergeKey]) || (a && a[_arrayMergeKey]) || 'combine';
  const opts = {};
  if (rule === 'overwrite') {
    opts.arrayMerge = (_dest, source) => source;
  }
  return deepMerge(a || {}, b || {}, opts);
};

const _stripMergeDirective = obj => {
  if (!obj || typeof obj !== 'object') return obj;
  const rest = { ...obj };
  delete rest[_arrayMergeKey];
  return rest;
};

const _runGenerators = async ({
  generators,
  mcpDirUri,
  joinPath,
  workspaceFsPath,
  runGeneratorScript,
  base,
}) => {
  let merged = base;
  for (const g of generators) {
    const scriptUri = joinPath(mcpDirUri, g.name);
    const scriptFsPath = scriptUri.fsPath || scriptUri.path || `${scriptUri}`;
    try {
      const stdoutText = await runGeneratorScript(scriptFsPath, workspaceFsPath);
      const raw = _parseJson(stdoutText, scriptFsPath);
      // Lenient: a generator copied from .<tool>/mcp.generator.*.*.js still emits
      // its tool-specific wrapped form. Unwrap via the shared registry.
      const obj = converters.normalizeMcpJson(raw);
      merged = _mergeWithArrayRule(merged, obj);
    } catch (e) {
      log.error(`MCP generator ${g.name}: ${e.message}`);
      log.debug(e);
    }
  }
  return merged;
};

/**
 * Compute the canonical flat MCP map by merging all top-level *.json files
 * (alphabetical) and then running all top-level *.js generators (priority order)
 * in `.mcp/`. Returns `{}` when nothing is found.
 */
const computeCanonical = async ({
  mcpDirUri,
  joinPath,
  readFile,
  readDirectory,
  workspaceFolderUri,
  runGeneratorScript,
}) => {
  const { definitions, generators } = await discovery.readMcpDir(
    mcpDirUri,
    readDirectory
  );
  let canonical = {};
  for (const def of definitions) {
    const raw = await _readJsonFile(joinPath(mcpDirUri, def.name), readFile);
    // Lenient: accept either flat or any known wrapped form (mcpServers / servers /
    // mcp_servers). Lets users migrate old wrapped definitions verbatim.
    const obj = converters.normalizeMcpJson(raw);
    canonical = _mergeWithArrayRule(canonical, obj);
  }
  if (generators.length > 0) {
    const wsPath = workspaceFolderUri.fsPath || workspaceFolderUri.path;
    canonical = await _runGenerators({
      generators,
      mcpDirUri,
      joinPath,
      workspaceFsPath: wsPath,
      runGeneratorScript: runGeneratorScript || defaultRunGeneratorScript,
      base: canonical,
    });
  }
  return _stripMergeDirective(canonical);
};

/**
 * Compute a tool-specific overlay (flat map) by merging
 * .<toolDir>/mcp.shared.json, mcp.local.json, and mcp.generator.*.*.js,
 * then unwrapping with the converter's wrapKey.
 */
// eslint-disable-next-line max-statements, complexity
const computeToolOverlay = async ({
  toolConfigDirUri,
  agentNames,
  joinPath,
  readFile,
  readDirectory,
  workspaceFolderUri,
  runGeneratorScript,
}) => {
  const sharedUri = joinPath(toolConfigDirUri, 'mcp.shared.json');
  const localUri = joinPath(toolConfigDirUri, 'mcp.local.json');
  const sharedRaw = await _readJsonFile(sharedUri, readFile);
  const localRaw = await _readJsonFile(localUri, readFile);
  // Normalize each input independently; both layers may use either wrapped or flat form.
  const shared = converters.normalizeMcpJson(sharedRaw);
  const local = converters.normalizeMcpJson(localRaw);
  let merged = _mergeWithArrayRule(shared, local);

  let entries = [];
  try {
    entries = (await readDirectory(toolConfigDirUri)) || [];
  } catch (_e) {
    entries = [];
  }
  const generatorSpecs = generatorDiscovery.collectGeneratorsForBase(entries, 'mcp');
  if (generatorSpecs.length > 0) {
    const wsPath = workspaceFolderUri.fsPath || workspaceFolderUri.path;
    const fn = runGeneratorScript || defaultRunGeneratorScript;
    for (const spec of generatorSpecs) {
      const scriptUri = joinPath(toolConfigDirUri, spec.filename);
      const scriptFsPath = scriptUri.fsPath || scriptUri.path;
      try {
        const stdoutText = await fn(scriptFsPath, wsPath);
        const raw = _parseJson(stdoutText, scriptFsPath);
        const obj = converters.normalizeMcpJson(raw);
        merged = _mergeWithArrayRule(merged, obj);
      } catch (e) {
        log.error(`Tool MCP generator ${spec.filename}: ${e.message}`);
        log.debug(e);
      }
    }
  }
  merged = _stripMergeDirective(merged);
  // Auto-inject agentInclude on overlay-derived servers that lack any filter:
  // the file's location IS the scope declaration, so default to this converter's
  // agentNames (e.g. ['vscode', 'copilot']). Existing filters are left untouched.
  if (Array.isArray(agentNames)) {
    merged = _stampOverlayAgentInclude(merged, agentNames);
  }
  return merged;
};

const _maybeWriteAndWarn = async ({
  outputUri,
  body,
  readFile,
  writeFile,
  joinPath,
  workspaceFolderUri,
  showWarningMessage,
  workspaceState,
  getConfiguration,
}) => {
  let existing;
  try {
    existing = await readFile(outputUri);
  } catch (_e) {
    existing = undefined;
  }
  if (existing && Buffer.isBuffer(body) && Buffer.compare(Buffer.from(existing), body) === 0) {
    return false;
  }
  log.info(`MCP broadcast: writing ${outputUri.fsPath}`);
  const writePromise = writeFile(outputUri, body, { create: true, overwrite: true });
  if (workspaceFolderUri && typeof showWarningMessage === 'function') {
    gitignoreCheck
      .warnIfTargetNotIgnored({
        workspaceRootUri: workspaceFolderUri,
        targetFileUri: outputUri,
        readFile,
        writeFile,
        joinPath,
        showWarningMessage,
        workspaceState,
        getConfiguration,
      })
      .catch(e => log.debug(`gitignore-check: ${e.message}`));
  }
  await writePromise;
  return true;
};

const _resolveTargetUris = (workspaceFolderUri, joinPath) => {
  const cursorDir = joinPath(workspaceFolderUri, '.cursor');
  const claudeDir = joinPath(workspaceFolderUri, '.claude');
  const vscodeDir = joinPath(workspaceFolderUri, '.vscode');
  const codexDir = joinPath(workspaceFolderUri, '.codex');
  return {
    cursorDir,
    claudeDir,
    vscodeDir,
    codexDir,
    cursorMcpUri: joinPath(cursorDir, 'mcp.json'),
    workspaceMcpUri: joinPath(workspaceFolderUri, '.mcp.json'),
    vscodeMcpUri: joinPath(vscodeDir, 'mcp.json'),
    codexConfigUri: joinPath(codexDir, 'config.toml'),
  };
};

const _enabledTargets = (cfgValue, dirsExist, targetFilter) => {
  const enabled = Array.isArray(cfgValue)
    ? cfgValue
    : converters.allConverterNames;
  let list = enabled.filter(name => dirsExist[name]);
  // Hot-path scoping: when invoked from a hook or wrapper, restrict to a
  // single named target (e.g. 'claude' from SessionStart, 'codex' from
  // `wcp wrap codex`). Skips writing the other agents' files entirely.
  if (typeof targetFilter === 'string' && targetFilter.length > 0) {
    list = list.filter(name => name === targetFilter);
  } else if (Array.isArray(targetFilter) && targetFilter.length > 0) {
    list = list.filter(name => targetFilter.includes(name));
  }
  return list;
};

// Accepts an optional `target` arg (string, e.g. 'claude' or 'codex') to scope
// the broadcast to a single agent's output. When omitted, broadcasts to every
// detected/enabled agent.
// eslint-disable-next-line max-statements, complexity
const broadcastMcpToAllAgents = async ({
  workspaceFolderUri,
  mcpDirUri,
  joinPath,
  readFile,
  writeFile,
  readDirectory,
  stat,
  showWarningMessage,
  workspaceState,
  getConfiguration,
  runGeneratorScript,
  target,
}) => {
  try {
    const ctx = _resolveTargetUris(workspaceFolderUri, joinPath);

    const dirsExist = {};
    await Promise.all(
      converters.allConverterNames.map(async name => {
        const dirUri = ctx[`${name}Dir`];
        if (!stat) {
          dirsExist[name] = true;
          return;
        }
        try {
          await stat(dirUri);
          dirsExist[name] = true;
        } catch (_e) {
          dirsExist[name] = false;
        }
      })
    );

    let cfgEnabled;
    if (typeof getConfiguration === 'function') {
      try {
        const cfg = getConfiguration('workspaceConfigPlus', workspaceFolderUri);
        if (cfg && typeof cfg.get === 'function') {
          cfgEnabled = cfg.get('mcp.broadcast.targets');
        }
      } catch (_e) {
        // ignore
      }
    }
    const enabledNames = _enabledTargets(cfgEnabled, dirsExist, target);
    if (enabledNames.length === 0) {
      log.debug('MCP broadcast: no enabled targets present in workspace');
      return;
    }

    const canonical = await computeCanonical({
      mcpDirUri,
      joinPath,
      readFile,
      readDirectory,
      workspaceFolderUri,
      runGeneratorScript,
    });

    for (const name of enabledNames) {
      const converter = converters.converters[name];
      const toolDirUri = ctx[`${name}Dir`];
      const overlay = await computeToolOverlay({
        toolConfigDirUri: toolDirUri,
        agentNames: converter.agentNames,
        joinPath,
        readFile,
        readDirectory,
        workspaceFolderUri,
        runGeneratorScript,
      });
      const combined = _mergeWithArrayRule(canonical, overlay);
      const filtered = converters.filterByAgent(combined, converter.agentNames);
      const body = await converter.serialize(filtered, {
        ...ctx,
        readFile,
      });
      const outputUri = converter.outputUri(ctx);
      await _maybeWriteAndWarn({
        outputUri,
        body,
        readFile,
        writeFile,
        joinPath,
        workspaceFolderUri,
        showWarningMessage,
        workspaceState,
        getConfiguration,
      });
    }
  } catch (e) {
    log.error(`MCP broadcast failed: ${e.message}`);
    log.debug(e);
  }
};

module.exports = {
  broadcastMcpToAllAgents,
  computeCanonical,
  computeToolOverlay,
  _resolveTargetUris,
  _enabledTargets,
  _mergeWithArrayRule,
  isDeepStrictEqual,
};
