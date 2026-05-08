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
// Used for tool-specific overlays AND for canonical .mcp/ content: the
// launching context determines the default. For overlays, the file's location
// IS the scope declaration → use the converter's agentNames. For canonical
// content with --target X → use X's agentNames (only the launching agent).
// For canonical content with no --target → use ['*'] (broadcast).
const _stampMissingAgentInclude = (flat, agentNames) => {
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

// Backward-compat alias kept for callers in computeToolOverlay.
const _stampOverlayAgentInclude = _stampMissingAgentInclude;

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
  const opencodeDir = joinPath(workspaceFolderUri, '.opencode');
  return {
    cursorDir,
    claudeDir,
    vscodeDir,
    codexDir,
    opencodeDir,
    cursorMcpUri: joinPath(cursorDir, 'mcp.json'),
    workspaceMcpUri: joinPath(workspaceFolderUri, '.mcp.json'),
    vscodeMcpUri: joinPath(vscodeDir, 'mcp.json'),
    codexConfigUri: joinPath(codexDir, 'config.toml'),
    opencodeConfigUri: joinPath(workspaceFolderUri, 'opencode.json'),
  };
};

// _enabledTargets composes three filters that all must pass for a target to
// receive a broadcast write:
//
//   1. wcpConfigAgents: explicit opt-in list from .mcp/wcp-config.json. When
//      absent (first-run pre-bootstrap), this is null and we fall back to
//      "every detected target".
//   2. settingsCfgValue: workspaceConfigPlus.mcp.broadcast.targets (user
//      setting). Lets a user further narrow per-workspace without editing
//      wcp-config.json.
//   3. targetFilter: --target X from the CLI / hook. Hot-path scoping to a
//      single agent's output.
//
// dirsExist scopes the result to artifacts actually present in the workspace
// (a target listed in wcp-config.json but with no marker dir/file is silently
// skipped — the user is opting in to writing that file even if the agent
// hasn't been used in this workspace yet, which is fine and writes anyway).
const _enabledTargets = (settingsCfgValue, dirsExist, targetFilter, wcpConfigAgents) => {
  // Start with the wcp-config.json opt-in list when present; otherwise
  // every supported converter (caller will narrow by dirsExist below).
  const baseList = Array.isArray(wcpConfigAgents)
    ? wcpConfigAgents
    : converters.allConverterNames;
  // Settings-level filter (from VSCode workspace settings or env).
  const settingsList = Array.isArray(settingsCfgValue)
    ? settingsCfgValue
    : null;
  let list = baseList.filter(
    name => !settingsList || settingsList.includes(name)
  );
  // Skip targets whose dir/marker file isn't present.
  list = list.filter(name => dirsExist[name]);
  // Hot-path --target scoping.
  if (typeof targetFilter === 'string' && targetFilter.length > 0) {
    list = list.filter(name => name === targetFilter);
  } else if (Array.isArray(targetFilter) && targetFilter.length > 0) {
    list = list.filter(name => targetFilter.includes(name));
  }
  return list;
};

// eslint-disable-next-line max-statements
const _readWcpConfig = async (mcpDirUri, joinPath, readFile) => {
  const wcpConfigUri = joinPath(mcpDirUri, 'wcp-config.json');
  try {
    const buf = await readFile(wcpConfigUri);
    if (!buf) return { uri: wcpConfigUri, config: null };
    const text = buf.toString();
    if (!text.trim()) return { uri: wcpConfigUri, config: null };
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.agents)) {
      return { uri: wcpConfigUri, config: parsed };
    }
    return { uri: wcpConfigUri, config: null };
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'FileNotFound')) {
      return { uri: wcpConfigUri, config: null };
    }
    log.warn(`mcp-broadcast: parsing ${wcpConfigUri.fsPath}: ${e.message}`);
    log.debug(e);
    return { uri: wcpConfigUri, config: null };
  }
};

// First-run auto-generation: when .mcp/wcp-config.json doesn't exist, write
// it based on detected artifacts so subsequent runs are stable + the user has
// a file they can edit to control opt-in.
const _autogenerateWcpConfig = async ({
  wcpConfigUri,
  detectedAgents,
  writeFile,
}) => {
  const body = `${JSON.stringify({ agents: detectedAgents }, null, 2)}\n`;
  try {
    await writeFile(wcpConfigUri, Buffer.from(body), {
      create: true,
      overwrite: false, // do NOT overwrite an existing file (race-safe)
    });
    log.info(
      `wcp: auto-generated ${wcpConfigUri.fsPath} with detected agents: [${detectedAgents.join(', ')}]. Edit this file to opt agents in or out.`
    );
  } catch (e) {
    log.warn(`wcp: failed to auto-generate ${wcpConfigUri.fsPath}: ${e.message}`);
    log.debug(e);
  }
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
    const _exists = async uri => {
      if (!stat) return true;
      try {
        await stat(uri);
        return true;
      } catch (_e) {
        return false;
      }
    };
    await Promise.all(
      converters.allConverterNames.map(async name => {
        const converter = converters.converters[name];
        const dirUri = ctx[`${name}Dir`];
        if (await _exists(dirUri)) {
          dirsExist[name] = true;
          return;
        }
        // Some agents (opencode) ship a flat config FILE at the workspace root
        // rather than a `.<agent>/` directory. Check the converter's
        // detectFiles list as a secondary signal.
        const detectFiles = Array.isArray(converter.detectFiles)
          ? converter.detectFiles
          : [];
        for (const fileName of detectFiles) {
          const fileUri = joinPath(workspaceFolderUri, fileName);
          if (await _exists(fileUri)) {
            dirsExist[name] = true;
            return;
          }
        }
        dirsExist[name] = false;
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

    // Read .mcp/wcp-config.json (the explicit per-workspace opt-in file).
    // Auto-generate it on first run from detected artifacts so users have a
    // file they can edit to control which agents the broadcast writes to.
    const { uri: wcpConfigUri, config: wcpConfig } = await _readWcpConfig(
      mcpDirUri,
      joinPath,
      readFile
    );
    let wcpConfigAgents = null;
    if (wcpConfig && Array.isArray(wcpConfig.agents)) {
      wcpConfigAgents = wcpConfig.agents;
    } else {
      // First-run bootstrap: detect agents from artifacts (dirs + detectFiles),
      // write wcp-config.json, then proceed with the detected list.
      const detectedAgents = converters.allConverterNames.filter(
        name => dirsExist[name]
      );
      await _autogenerateWcpConfig({
        wcpConfigUri,
        detectedAgents,
        writeFile,
      });
      wcpConfigAgents = detectedAgents;
    }

    const enabledNames = _enabledTargets(
      cfgEnabled,
      dirsExist,
      target,
      wcpConfigAgents
    );
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
      // Default agentInclude for canonical servers that lack a filter:
      //  - When invoked with --target X: use the launching converter's
      //    agentNames so the server is scoped to that agent only.
      //  - When invoked without --target (full broadcast): use ['*'] so
      //    missing-filter servers go everywhere.
      // Overlay servers were already stamped in computeToolOverlay with the
      // converter's agentNames, so this pass leaves them alone.
      const defaultAgentInclude = target ? converter.agentNames : ['*'];
      const stamped = _stampMissingAgentInclude(combined, defaultAgentInclude);
      const filtered = converters.filterByAgent(stamped, converter.agentNames);
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
