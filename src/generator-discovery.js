'use strict';

/** Match: {launch|settings|tasks|mcp}.generator.{slug}.{priority}.js — slug is informational (sort tie-break uses filename). */
const GENERATOR_FILENAME_RE =
  /^(launch|settings|tasks|mcp)\.generator\.([^.]+)\.(\d+)\.js$/;

/** VS Code workspace.fs.readDirectory FileType.File */
const VSCODE_FILETYPE_FILE = 1;

/**
 * @param {string} filename
 * @returns {{ baseName: string, slug: string, priority: number, filename: string } | null}
 */
const parseGeneratorFilename = filename => {
  const m = filename.match(GENERATOR_FILENAME_RE);
  if (!m) {
    return null;
  }
  const priority = parseInt(m[3], 10);
  if (!Number.isFinite(priority)) {
    return null;
  }
  return {
    baseName: m[1],
    slug: m[2],
    priority,
    filename,
  };
};

/**
 * Collect matching generator filenames for one config basename, sorted ascending by priority then filename.
 *
 * @param {[string, number][]} directoryEntries
 * @param {string} workspaceConfigBase — launch | settings | tasks | mcp
 */
const collectGeneratorsForBase = (directoryEntries, workspaceConfigBase) => {
  const list = [];
  for (const [name, fileType] of directoryEntries) {
    if (fileType !== VSCODE_FILETYPE_FILE) {
      continue;
    }
    const parsed = parseGeneratorFilename(name);
    if (parsed && parsed.baseName === workspaceConfigBase) {
      list.push(parsed);
    }
  }
  list.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.filename.localeCompare(b.filename);
  });
  return list;
};

module.exports = {
  GENERATOR_FILENAME_RE,
  VSCODE_FILETYPE_FILE,
  parseGeneratorFilename,
  collectGeneratorsForBase,
};
