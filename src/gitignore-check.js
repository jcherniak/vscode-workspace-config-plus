'use strict';

const path = require('path');
const ignoreFactory = require('ignore');
const log = require('./log');

const _suppressionStateKey = 'workspaceConfigPlus.gitignoreWarn.suppressed';

const _toPosixRelative = (workspaceFsPath, targetFsPath) => {
  const rel = path.relative(workspaceFsPath, targetFsPath);
  return rel.split(path.sep).join('/');
};

const _readGitignore = async (gitignoreUri, readFile) => {
  try {
    const buf = await readFile(gitignoreUri);
    if (!buf) {
      return '';
    }
    return buf.toString();
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'FileNotFound')) {
      return '';
    }
    log.debug(`gitignore-check: failed to read .gitignore: ${e.message}`);
    return '';
  }
};

const _isIgnored = (gitignoreContents, relPath) => {
  const ig = ignoreFactory();
  if (gitignoreContents) {
    ig.add(gitignoreContents);
  }
  return ig.ignores(relPath);
};

const _appendToGitignore = async ({
  gitignoreUri,
  existingContents,
  relPath,
  writeFile,
}) => {
  const sep = existingContents.length === 0 || existingContents.endsWith('\n') ? '' : '\n';
  const next = `${existingContents}${sep}${relPath}\n`;
  await writeFile(gitignoreUri, Buffer.from(next), { create: true, overwrite: true });
  log.info(`Appended ${relPath} to .gitignore`);
};

// eslint-disable-next-line max-statements, complexity
const warnIfTargetNotIgnored = async ({
  workspaceRootUri,
  targetFileUri,
  readFile,
  writeFile,
  joinPath,
  showWarningMessage,
  workspaceState,
  getConfiguration,
}) => {
  if (!workspaceRootUri || !targetFileUri || !joinPath || !readFile) {
    return;
  }
  if (typeof showWarningMessage !== 'function') {
    return;
  }

  if (typeof getConfiguration === 'function') {
    try {
      const cfg = getConfiguration('workspaceConfigPlus', workspaceRootUri);
      if (cfg && typeof cfg.get === 'function' && cfg.get('gitignoreWarning') === 'silent') {
        return;
      }
    } catch (e) {
      log.debug(`gitignore-check: getConfiguration threw ${e.message}`);
    }
  }

  const workspaceFsPath = workspaceRootUri.fsPath || workspaceRootUri.path;
  const targetFsPath = targetFileUri.fsPath || targetFileUri.path;
  const relPath = _toPosixRelative(workspaceFsPath, targetFsPath);

  if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
    return;
  }

  let suppressed = [];
  if (workspaceState && typeof workspaceState.get === 'function') {
    suppressed = workspaceState.get(_suppressionStateKey, []) || [];
    if (suppressed.includes(relPath)) {
      return;
    }
  }

  const gitignoreUri = joinPath(workspaceRootUri, '.gitignore');
  const existing = await _readGitignore(gitignoreUri, readFile);
  if (_isIgnored(existing, relPath)) {
    return;
  }

  const addBtn = 'Add to .gitignore';
  const dontWarnBtn = 'Don\'t warn for this file';
  const dismissBtn = 'Dismiss';
  const choice = await showWarningMessage(
    `Workspace Config+ is about to write ${relPath}, which is not gitignored. Personal overrides may end up committed.`,
    addBtn,
    dontWarnBtn,
    dismissBtn
  );

  if (choice === addBtn) {
    if (typeof writeFile === 'function') {
      try {
        await _appendToGitignore({
          gitignoreUri,
          existingContents: existing,
          relPath,
          writeFile,
        });
      } catch (e) {
        log.error(`gitignore-check: failed to append to .gitignore: ${e.message}`);
      }
    }
  } else if (choice === dontWarnBtn) {
    if (workspaceState && typeof workspaceState.update === 'function') {
      const next = Array.from(new Set([...suppressed, relPath]));
      try {
        await workspaceState.update(_suppressionStateKey, next);
      } catch (e) {
        log.debug(`gitignore-check: failed to persist suppression: ${e.message}`);
      }
    }
  }
};

module.exports = {
  warnIfTargetNotIgnored,
  _suppressionStateKey,
  _toPosixRelative,
  _isIgnored,
};
