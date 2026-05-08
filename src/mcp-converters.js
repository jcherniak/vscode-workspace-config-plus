'use strict';

const TOML = require('@iarna/toml');
const log = require('./log');

const _AGENT_META_KEYS = ['agentInclude', 'agentExclude'];

const _stripMetaKeys = def => {
  const clean = {};
  for (const [k, v] of Object.entries(def)) {
    if (!_AGENT_META_KEYS.includes(k)) clean[k] = v;
  }
  return clean;
};

const _hasWildcard = list => Array.isArray(list) && list.includes('*');

const _intersects = (list, set) =>
  Array.isArray(list) && list.some(x => set.includes(x));

// Returns:
//   true     -> emit to this converter
//   false    -> skip silently (filter excluded it)
//   'conflict' -> both keys set; log error and drop
//   'missing'  -> neither key set; log error and drop
const _passesAgentFilter = (def, names) => {
  const hasInclude = Array.isArray(def.agentInclude);
  const hasExclude = Array.isArray(def.agentExclude);
  if (hasInclude && hasExclude) return 'conflict';
  if (!hasInclude && !hasExclude) return 'missing';
  if (hasInclude) {
    if (_hasWildcard(def.agentInclude)) return true;
    return _intersects(def.agentInclude, names);
  }
  // hasExclude
  if (_hasWildcard(def.agentExclude)) return false;
  return !_intersects(def.agentExclude, names);
};

// agentNames is an array of names this converter answers to (e.g. ['vscode', 'copilot']
// because Copilot reads the same .vscode/mcp.json as VSCode native).
// eslint-disable-next-line max-statements
const filterByAgent = (flat, agentNames) => {
  const names = Array.isArray(agentNames) ? agentNames : [agentNames];
  const out = {};
  for (const [name, def] of Object.entries(flat || {})) {
    if (!def || typeof def !== 'object') continue;
    const verdict = _passesAgentFilter(def, names);
    if (verdict === 'conflict') {
      log.error(
        `MCP server "${name}" has both agentInclude and agentExclude — skipping. ` +
          'Specify one or the other, not both.'
      );
      continue;
    }
    if (verdict === 'missing') {
      log.error(
        `MCP server "${name}" must declare agentInclude or agentExclude — skipping. ` +
          'Use ["*"] to apply to all agents.'
      );
      continue;
    }
    if (!verdict) continue;
    out[name] = _stripMetaKeys(def);
  }
  return out;
};

const _jsonBuffer = obj => Buffer.from(`${JSON.stringify(obj, null, 2)}\n`);

const _wrap = (wrapKey, flat) => ({ [wrapKey]: flat });

// Read existing TOML file content; return empty object on missing/parse-failure (logged).
const _readTomlSafe = async (uri, readFile) => {
  try {
    const buf = await readFile(uri);
    if (!buf) return {};
    const text = buf.toString();
    if (!text.trim()) return {};
    return TOML.parse(text) || {};
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'FileNotFound')) return {};
    log.warn(`mcp-converters: parsing existing TOML at ${uri.fsPath}: ${e.message}`);
    log.debug(e);
    return {};
  }
};

const _codexSerialize = async (flat, ctx) => {
  const existing = await _readTomlSafe(ctx.codexConfigUri, ctx.readFile);
  // Replace the entire `mcp_servers` table; preserve every other top-level key.
  const next = { ...existing, mcp_servers: flat };
  return Buffer.from(TOML.stringify(next));
};

const cursorConverter = {
  name: 'cursor',
  agentNames: ['cursor'],
  configDir: '.cursor',
  outputUri: ctx => ctx.cursorMcpUri,
  wrapKey: 'mcpServers',
  serialize: flat => _jsonBuffer(_wrap('mcpServers', flat)),
};

const claudeConverter = {
  name: 'claude',
  agentNames: ['claude'],
  configDir: '.claude',
  outputUri: ctx => ctx.workspaceMcpUri,
  wrapKey: 'mcpServers',
  serialize: flat => _jsonBuffer(_wrap('mcpServers', flat)),
};

// VSCode native agent mode and GitHub Copilot agent mode both read .vscode/mcp.json,
// so a single converter answers to both names. Users can write
// agentInclude: ["copilot"] or ["vscode"] interchangeably for filtering purposes,
// but the underlying file is shared, so a server visible to one is visible to both.
const vscodeConverter = {
  name: 'vscode',
  agentNames: ['vscode', 'copilot'],
  configDir: '.vscode',
  outputUri: ctx => ctx.vscodeMcpUri,
  wrapKey: 'servers',
  serialize: flat => _jsonBuffer(_wrap('servers', flat)),
};

const codexConverter = {
  name: 'codex',
  agentNames: ['codex'],
  configDir: '.codex',
  outputUri: ctx => ctx.codexConfigUri,
  wrapKey: 'mcp_servers',
  serialize: _codexSerialize,
};

const converters = {
  cursor: cursorConverter,
  claude: claudeConverter,
  vscode: vscodeConverter,
  codex: codexConverter,
};

const allConverterNames = ['cursor', 'claude', 'vscode', 'codex'];

// Every agent name (including aliases like 'copilot') that any converter recognizes.
// Exposed for documentation / settings dropdowns.
const knownAgentNames = Array.from(
  new Set(Object.values(converters).flatMap(c => c.agentNames))
);

// All wrapper keys recognized for lenient unwrap (mcpServers, servers, mcp_servers).
const knownWrapKeys = Array.from(
  new Set(Object.values(converters).map(c => c.wrapKey))
);

// Lenient unwrap: if `raw` has a top-level key matching any known converter wrapKey,
// return raw[wrapKey] (the inner flat map). Otherwise treat raw as already-flat.
// Used uniformly for: static .mcp/ definitions, .mcp/ generator output, and
// tool-specific overlay files. Lets a generator emit { mcpServers: {...} }
// (Cursor's wrapped form) and have it Just Work in the broadcast pipeline.
const normalizeMcpJson = raw => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  for (const wrapKey of knownWrapKeys) {
    const inner = raw[wrapKey];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner;
    }
  }
  return raw;
};

module.exports = {
  converters,
  allConverterNames,
  knownAgentNames,
  knownWrapKeys,
  normalizeMcpJson,
  filterByAgent,
  cursorConverter,
  claudeConverter,
  vscodeConverter,
  codexConverter,
  _stripMetaKeys,
  _readTomlSafe,
};
