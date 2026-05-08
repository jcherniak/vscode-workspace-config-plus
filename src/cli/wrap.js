'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const log = require('../log');
const { runCommand, VALID_TARGETS } = require('./run');

const WRAPPABLE_AGENTS = ['codex', 'gemini'];

// Find the real binary on PATH, skipping any path that looks like the wcp
// wrapper itself (e.g. ~/.local/bin/wcp-codex pointing at the wcp bundle).
const _findRealBinary = async (binName, ourEntry) => {
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.BAT;.CMD').split(';').map(e => e.toLowerCase())
    : [''];
  const ourReal = ourEntry ? await fs.realpath(ourEntry).catch(() => ourEntry) : null;
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binName + ext);
      try {
        const stats = await fs.stat(candidate);
        if (!stats.isFile()) continue;
        // Skip any candidate whose realpath is the wrapper itself
        // (defends against wcp-codex symlinks that resolve back to wcp).
        const realCand = await fs.realpath(candidate).catch(() => candidate);
        if (ourReal && realCand === ourReal) continue;
        // Also skip if filename itself starts with 'wcp-' (defensive).
        if (path.basename(realCand).startsWith('wcp-')) continue;
        return candidate;
      } catch (_e) {
        // not found; continue
      }
    }
  }
  return null;
};

const wrapCommand = async (args, ourEntry) => {
  log.initializeConsole({ silent: true });

  const agent = args._.shift(); // first positional after `wrap`
  if (!agent) {
    log.error(
      `wcp wrap: missing agent name. Usage: wcp wrap <${WRAPPABLE_AGENTS.join('|')}> -- <agent args>`
    );
    return 2;
  }
  if (!WRAPPABLE_AGENTS.includes(agent)) {
    log.error(
      `wcp wrap: unsupported agent "${agent}". Supported: ${WRAPPABLE_AGENTS.join(', ')}.`
    );
    return 2;
  }
  if (!VALID_TARGETS.includes(agent)) {
    log.error(`wcp wrap: agent "${agent}" has no broadcast target.`);
    return 2;
  }

  // Step 1: scoped broadcast for this agent only.
  const runRc = await runCommand({
    root: args.root,
    target: agent,
    silent: true,
  });
  if (runRc !== 0) {
    log.warn(
      `wcp wrap ${agent}: broadcast returned ${runRc}; proceeding to exec ${agent} anyway.`
    );
  }

  // Step 2: find real <agent> binary on PATH (excluding ourselves).
  const realBin = await _findRealBinary(agent, ourEntry);
  if (!realBin) {
    log.error(
      `wcp wrap: could not find real "${agent}" on PATH (after skipping wrapper). Make sure ${agent} is installed.`
    );
    return 127;
  }

  // Step 3: exec the real binary, forwarding remaining args + stdio.
  // node doesn't have true exec(), but spawn with inherit stdio + propagating
  // exit code is functionally equivalent for our case.
  const remaining = args._;
  log.info(`wcp wrap ${agent}: exec ${realBin} ${remaining.join(' ')}`);
  return await new Promise((resolve, reject) => {
    const child = spawn(realBin, remaining, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        // Re-raise the signal on ourselves to propagate exit semantics.
        process.kill(process.pid, signal);
        return;
      }
      resolve(code == null ? 0 : code);
    });
  });
};

module.exports = { wrapCommand, WRAPPABLE_AGENTS, _findRealBinary };
