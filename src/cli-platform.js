'use strict';

// CLI adapter that produces the same callback bag the VSCode extension uses.
// The core modules (mcp-broadcast, mcp-migration, file-handler, gitignore-check)
// don't know they're running in a CLI context — they just consume callbacks.
//
// Filesystem callbacks return Buffer-like values matching what
// vscode.workspace.fs.readFile etc. produce, so no core changes are needed.
// joinPath returns a URI-shaped object ({ fsPath, path }) for compatibility
// with `${uri.fsPath}` patterns throughout the core.

const fs = require('node:fs/promises');
const path = require('node:path');
const prompts = require('prompts');

const _uri = p => ({
  fsPath: p,
  path: p,
  toString() {
    return p;
  },
});

const _stringPath = p => {
  if (typeof p === 'string') return p;
  if (p && typeof p.fsPath === 'string') return p.fsPath;
  if (p && typeof p.path === 'string') return p.path;
  return String(p);
};

const joinPath = (base, ...parts) => {
  return _uri(path.join(_stringPath(base), ...parts));
};

const readFile = async uri => {
  try {
    return await fs.readFile(_stringPath(uri));
  } catch (e) {
    // Match the extension's behavior: readFile resolves to undefined on
    // missing/unreadable files (callers treat that as "no content").
    if (e && (e.code === 'ENOENT' || e.code === 'FileNotFound')) {
      return undefined;
    }
    throw e;
  }
};

const writeFile = async (uri, contents, _options) => {
  const target = _stringPath(uri);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
};

const stat = async uri => {
  const s = await fs.stat(_stringPath(uri));
  // Mimic vscode.FileStat shape (just the fields we use).
  return { type: s.isDirectory() ? 2 : 1, size: s.size, mtime: s.mtimeMs };
};

const readDirectory = async uri => {
  try {
    const entries = await fs.readdir(_stringPath(uri), { withFileTypes: true });
    // Match vscode.workspace.fs.readDirectory shape: [name, type] pairs where
    // type is 1 for file, 2 for directory.
    return entries.map(e => [e.name, e.isDirectory() ? 2 : 1]);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
};

const deleteFile = async uri => {
  try {
    await fs.unlink(_stringPath(uri));
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
};

// Build a prompts-backed showInformationMessage that matches the VSCode API
// shape: returns the chosen item (one of the `items`) or undefined.
const _showSelect = async (message, items) => {
  if (!process.stdin.isTTY) {
    // No TTY → can't prompt. Return undefined (caller treats as "dismissed").
    return undefined;
  }
  const response = await prompts(
    {
      type: 'select',
      name: 'choice',
      message,
      choices: items.map(label => ({ title: label, value: label })),
      initial: 0,
    },
    {
      onCancel: () => true,
    }
  );
  return response.choice;
};

const showInformationMessage = (message, ...items) => _showSelect(message, items);
const showWarningMessage = (message, ...items) => _showSelect(message, items);

const showQuickPick = async (items, options = {}) => {
  if (!process.stdin.isTTY) return undefined;
  const choices = items.map(item => {
    if (typeof item === 'string') {
      return { title: item, value: item, selected: true };
    }
    return {
      title: item.label || String(item),
      value: item,
      selected: item.picked !== false,
    };
  });
  if (options.canPickMany) {
    const response = await prompts(
      {
        type: 'multiselect',
        name: 'choices',
        message: options.placeHolder || 'Select items',
        choices,
        instructions: false,
      },
      { onCancel: () => true }
    );
    return response.choices;
  }
  const response = await prompts(
    {
      type: 'select',
      name: 'choice',
      message: options.placeHolder || 'Select an item',
      choices,
    },
    { onCancel: () => true }
  );
  return response.choice;
};

// JSON-file-backed workspaceState. Stored at <workspaceRoot>/.workspace-config-plus/state.json.
// Uses an in-memory cache so multiple .get/.update calls in one CLI invocation
// don't thrash the disk.
const createWorkspaceState = workspaceRoot => {
  const stateFile = path.join(workspaceRoot, '.workspace-config-plus', 'state.json');
  let cache = null;
  const load = async () => {
    if (cache) return cache;
    try {
      const buf = await fs.readFile(stateFile, 'utf8');
      cache = JSON.parse(buf);
    } catch (_e) {
      cache = {};
    }
    return cache;
  };
  const persist = async () => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(cache, null, 2));
  };
  return {
    get: (key, defaultValue) => {
      // Synchronous getter expected by the core (matches vscode.Memento.get).
      // We require load() to be called once first; on miss return default.
      if (!cache) cache = {};
      return key in cache ? cache[key] : defaultValue;
    },
    update: async (key, value) => {
      if (!cache) await load();
      cache[key] = value;
      await persist();
    },
    _load: load, // exposed so callers can warm the cache before sync .get
  };
};

// CLI getConfiguration: reads from process.env (WCP_<UPPER_KEY>) or returns a
// caller-supplied flag map. The core consumes a vscode.WorkspaceConfiguration
// shape that has a .get(key) method.
const createGetConfiguration = ({ flags = {}, env = process.env } = {}) => {
  return (_section, _scope) => ({
    get: key => {
      // Flag-mapped config (CLI-only): explicit flag overrides env.
      if (key in flags) return flags[key];
      const envKey = `WCP_${key.toUpperCase().replace(/\./g, '_')}`;
      if (env[envKey] !== undefined) {
        // Env vars are strings; for known array configs, split on commas.
        if (key === 'mcp.broadcast.targets') {
          return env[envKey]
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }
        return env[envKey];
      }
      return undefined;
    },
  });
};

// Resolve workspace root: explicit --root flag wins, else walk up from cwd
// looking for .mcp/, .vscode/, .cursor/, .claude/, or .git/.
const resolveWorkspaceRoot = async (explicitRoot, cwd = process.cwd()) => {
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  let dir = path.resolve(cwd);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const markers = ['.mcp', '.vscode', '.cursor', '.claude', '.codex', '.git'];
    for (const m of markers) {
      try {
        await fs.access(path.join(dir, m));
        return dir;
      } catch (_e) {
        // continue
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return cwd; // hit filesystem root; fall back to cwd
    dir = parent;
  }
};

// Build the full callback bag the core expects, suitable for passing into
// initializeWorkspaceFolder / broadcastMcpToAllAgents / promptAndMigrate.
const createCallbacks = ({ workspaceRoot, configFlags = {} } = {}) => {
  const workspaceState = workspaceRoot ? createWorkspaceState(workspaceRoot) : {
    get: (_k, d) => d,
    update: async () => {},
  };
  const getConfiguration = createGetConfiguration({ flags: configFlags });
  return {
    joinPath,
    readFile,
    writeFile,
    stat,
    readDirectory,
    deleteFile,
    showWarningMessage,
    showInformationMessage,
    showQuickPick,
    workspaceState,
    getConfiguration,
  };
};

module.exports = {
  joinPath,
  readFile,
  writeFile,
  stat,
  readDirectory,
  deleteFile,
  showInformationMessage,
  showWarningMessage,
  showQuickPick,
  createWorkspaceState,
  createGetConfiguration,
  resolveWorkspaceRoot,
  createCallbacks,
  _uri,
  _stringPath,
};
