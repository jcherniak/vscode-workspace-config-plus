'use strict';

const createFileSystemWatcher = (_a, _b) => {};
const createRelativePattern = _c => {};
const joinPath = (_d, _e, _f) => {};
const readFile = (_g, _h, _i, _j) => {};
const writeFile = () => {};
/** @returns {Promise<[string, number][]>} */
const readDirectory = async _dirUri => [];
// Basic stat mock - can be overridden in tests
const stat = async _uri => {
  // Default behavior: assume file/dir exists unless specifically told otherwise in tests
  // console.log(`Mock stat called for: ${uri.fsPath || uri}`); // For debugging tests
  return { type: 1 }; // Return a basic object indicating existence
};

const callbacks = {
  createFileSystemWatcher,
  createRelativePattern,
  joinPath,
  readFile,
  writeFile,
  stat, // Added mock stat
  readDirectory,
};

// --- .vscode URIs ---
const vscodeDirUri = { uri: 'foo/.vscode', fsPath: 'foo/.vscode' }; // Added dir URI
const settingsVscodeFileUri = { uri: 'foo/.vscode/settings.json', fsPath: 'foo/.vscode/settings.json' };
const settingsVscodeSharedUri = { uri: 'foo/.vscode/settings.shared.json', fsPath: 'foo/.vscode/settings.shared.json' };
const settingsVscodeLocalUri = { uri: 'foo/.vscode/settings.local.json', fsPath: 'foo/.vscode/settings.local.json' };

const launchVscodeFileUri = { uri: 'foo/.vscode/launch.json', fsPath: 'foo/.vscode/launch.json' };
const launchVscodeSharedUri = { uri: 'foo/.vscode/launch.shared.json', fsPath: 'foo/.vscode/launch.shared.json' };
const launchVscodeLocalUri = { uri: 'foo/.vscode/launch.local.json', fsPath: 'foo/.vscode/launch.local.json' };

const tasksVscodeFileUri = { uri: 'foo/.vscode/tasks.json', fsPath: 'foo/.vscode/tasks.json' };
const tasksVscodeSharedUri = { uri: 'foo/.vscode/tasks.shared.json', fsPath: 'foo/.vscode/tasks.shared.json' };
const tasksVscodeLocalUri = { uri: 'foo/.vscode/tasks.local.json', fsPath: 'foo/.vscode/tasks.local.json' };

const mcpVscodeFileUri = { uri: 'foo/.vscode/mcp.json', fsPath: 'foo/.vscode/mcp.json' };
const mcpVscodeSharedUri = { uri: 'foo/.vscode/mcp.shared.json', fsPath: 'foo/.vscode/mcp.shared.json' };
const mcpVscodeLocalUri = { uri: 'foo/.vscode/mcp.local.json', fsPath: 'foo/.vscode/mcp.local.json' };

// --- .cursor URIs ---
const cursorDirUri = { uri: 'foo/.cursor', fsPath: 'foo/.cursor' }; // Added dir URI
const settingsCursorFileUri = { uri: 'foo/.cursor/settings.json', fsPath: 'foo/.cursor/settings.json' };
const settingsCursorSharedUri = { uri: 'foo/.cursor/settings.shared.json', fsPath: 'foo/.cursor/settings.shared.json' };
const settingsCursorLocalUri = { uri: 'foo/.cursor/settings.local.json', fsPath: 'foo/.cursor/settings.local.json' };

const launchCursorFileUri = { uri: 'foo/.cursor/launch.json', fsPath: 'foo/.cursor/launch.json' };
const launchCursorSharedUri = { uri: 'foo/.cursor/launch.shared.json', fsPath: 'foo/.cursor/launch.shared.json' };
const launchCursorLocalUri = { uri: 'foo/.cursor/launch.local.json', fsPath: 'foo/.cursor/launch.local.json' };

const tasksCursorFileUri = { uri: 'foo/.cursor/tasks.json', fsPath: 'foo/.cursor/tasks.json' };
const tasksCursorSharedUri = { uri: 'foo/.cursor/tasks.shared.json', fsPath: 'foo/.cursor/tasks.shared.json' };
const tasksCursorLocalUri = { uri: 'foo/.cursor/tasks.local.json', fsPath: 'foo/.cursor/tasks.local.json' };

const mcpCursorFileUri = { uri: 'foo/.cursor/mcp.json', fsPath: 'foo/.cursor/mcp.json' };
const mcpCursorSharedUri = { uri: 'foo/.cursor/mcp.shared.json', fsPath: 'foo/.cursor/mcp.shared.json' };
const mcpCursorLocalUri = { uri: 'foo/.cursor/mcp.local.json', fsPath: 'foo/.cursor/mcp.local.json' };

// --- AI tool config dir URIs (.claude / .codex / .gemini) ---
const claudeDirUri = { uri: 'foo/.claude', fsPath: 'foo/.claude' };
const codexDirUri = { uri: 'foo/.codex', fsPath: 'foo/.codex' };
const geminiDirUri = { uri: 'foo/.gemini', fsPath: 'foo/.gemini' };

const makeBaseUris = (dirPath, base) => ({
  fileUri: { uri: `${dirPath}/${base}.json`, fsPath: `${dirPath}/${base}.json` },
  sharedUri: { uri: `${dirPath}/${base}.shared.json`, fsPath: `${dirPath}/${base}.shared.json` },
  localUri: { uri: `${dirPath}/${base}.local.json`, fsPath: `${dirPath}/${base}.local.json` },
});

const settingsClaude = makeBaseUris('foo/.claude', 'settings');
settingsClaude.personalUri = { uri: 'foo/.claude/settings.personal.json', fsPath: 'foo/.claude/settings.personal.json' };
const launchClaude = makeBaseUris('foo/.claude', 'launch');
const tasksClaude = makeBaseUris('foo/.claude', 'tasks');
const mcpClaude = makeBaseUris('foo/.claude', 'mcp');
const workspaceMcpFileUri = { uri: 'foo/.mcp.json', fsPath: 'foo/.mcp.json' };
const workspaceGitignoreUri = { uri: 'foo/.gitignore', fsPath: 'foo/.gitignore' };

const settingsCodex = makeBaseUris('foo/.codex', 'settings');
const launchCodex = makeBaseUris('foo/.codex', 'launch');
const tasksCodex = makeBaseUris('foo/.codex', 'tasks');
const mcpCodex = makeBaseUris('foo/.codex', 'mcp');

const settingsGemini = makeBaseUris('foo/.gemini', 'settings');
const launchGemini = makeBaseUris('foo/.gemini', 'launch');
const tasksGemini = makeBaseUris('foo/.gemini', 'tasks');
const mcpGemini = makeBaseUris('foo/.gemini', 'mcp');

// --- Legacy/Simplified URIs (keep for now if needed by other tests) ---
const vscodeFileUri = settingsVscodeFileUri; // Alias for potential backward compat
const sharedFileUri = settingsVscodeSharedUri;
const localFileUri = settingsVscodeLocalUri;
const uris = {
  vscodeFileUri,
  sharedFileUri,
  localFileUri,
};

const globPattern = {
  path:
    'foo/.vscode/{settings.local.json,settings.shared.json,settings.generator.*.*.js}',
};

module.exports = {
  callbacks,
  globPattern,
  uris, // Legacy uris object
  // Export new detailed URIs
  vscodeDirUri,
  settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri,
  launchVscodeFileUri, launchVscodeSharedUri, launchVscodeLocalUri,
  tasksVscodeFileUri, tasksVscodeSharedUri, tasksVscodeLocalUri,
  mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri,
  cursorDirUri,
  settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri,
  launchCursorFileUri, launchCursorSharedUri, launchCursorLocalUri,
  tasksCursorFileUri, tasksCursorSharedUri, tasksCursorLocalUri,
  mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri,
  claudeDirUri, codexDirUri, geminiDirUri,
  settingsClaude, launchClaude, tasksClaude, mcpClaude,
  settingsCodex, launchCodex, tasksCodex, mcpCodex,
  settingsGemini, launchGemini, tasksGemini, mcpGemini,
  workspaceMcpFileUri, workspaceGitignoreUri,
};
