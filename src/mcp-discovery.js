'use strict';

const log = require('./log');

const _GENERATOR_PATTERN = /^(.+)\.(\d+)\.js$/;

// Filenames in .mcp/ that are reserved for the extension's own use and must
// NOT be treated as server-definition JSON. Without this exclusion, e.g.
// wcp-config.json's `{ "agents": ["claude", ...] }` gets deep-merged into the
// canonical server map and `agents` ends up as a key in every emitted output.
const _RESERVED_FILENAMES = new Set(['wcp-config.json']);

const _isFileEntry = entry => Array.isArray(entry) && entry[1] === 1;

const _classify = name => {
  if (_RESERVED_FILENAMES.has(name)) {
    return null;
  }
  if (name.endsWith('.json')) {
    return { kind: 'definition', name, sortKey: name.toLowerCase() };
  }
  if (name.endsWith('.js')) {
    const m = _GENERATOR_PATTERN.exec(name);
    if (m) {
      return {
        kind: 'generator',
        name,
        priority: parseInt(m[2], 10),
        baseName: m[1],
        sortKey: name.toLowerCase(),
      };
    }
  }
  return null;
};

const classifyMcpDirEntries = entries => {
  if (!Array.isArray(entries)) {
    return { definitions: [], generators: [] };
  }
  const definitions = [];
  const generators = [];
  for (const entry of entries) {
    if (!_isFileEntry(entry)) continue;
    const c = _classify(entry[0]);
    if (!c) continue;
    if (c.kind === 'definition') definitions.push(c);
    else generators.push(c);
  }
  // Sort alphabetically, but pin `local.json` to the end so personal overrides
  // always win over shared definitions regardless of alphabet.
  definitions.sort((a, b) => {
    const aLocal = a.name === 'local.json';
    const bLocal = b.name === 'local.json';
    if (aLocal && !bLocal) return 1;
    if (!aLocal && bLocal) return -1;
    return a.sortKey.localeCompare(b.sortKey);
  });
  generators.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sortKey.localeCompare(b.sortKey);
  });
  return { definitions, generators };
};

const readMcpDir = async (mcpDirUri, readDirectory) => {
  try {
    const entries = await readDirectory(mcpDirUri);
    return classifyMcpDirEntries(entries);
  } catch (e) {
    log.warn(`Workspace Config+ listing ${mcpDirUri.fsPath}: ${e.message}`);
    log.debug(e);
    return { definitions: [], generators: [] };
  }
};

module.exports = {
  classifyMcpDirEntries,
  readMcpDir,
  _GENERATOR_PATTERN,
  _RESERVED_FILENAMES,
};
