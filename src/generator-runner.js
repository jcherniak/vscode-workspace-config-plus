'use strict';

/* eslint-disable max-statements -- orchestrates child process lifecycle */
const cp = require('child_process');

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Runs a generator script under Node. Script must write JSON (optionally JSONC) to stdout.
 *
 * @param {string} scriptFsPath Absolute path on disk
 * @param {string} workspaceRootFsPath Used as cwd; also passed in env WORKSPACE_CONFIG_PLUS_ROOT
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>} raw stdout trimmed
 */
const runGeneratorScript = (scriptFsPath, workspaceRootFsPath, options) => {
  const timeoutMs =
    options && typeof options.timeoutMs === 'number'
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;

    /** @type {import('child_process').ChildProcess | undefined} */
    let child;

    const finishReject = /** @type {(e: unknown) => void} */ arg => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(arg instanceof Error ? arg : new Error(String(arg)));
    };

    const finishResolve = /** @type {(v: string) => void} */ val => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(val);
    };

    timer =
      timeoutMs > 0
        ? setTimeout(() => {
          if (child) {
            try {
              child.kill('SIGKILL');
            } catch (_e) {
              /* noop */
            }
          }
          finishReject(
            new Error(
              `Generator timed out after ${timeoutMs}ms: ${scriptFsPath}`
            )
          );
        }, timeoutMs)
        : undefined;

    try {
      child = cp.spawn('node', [scriptFsPath], {
        cwd: workspaceRootFsPath,
        windowsHide: true,
        env: {
          ...process.env,
          WORKSPACE_CONFIG_PLUS_ROOT: workspaceRootFsPath,
        },
      });
    } catch (e) {
      finishReject(e);
      return;
    }

    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => errChunks.push(d));
    child.once('error', finishReject);
    child.once('close', code => {
      if (settled) {
        return;
      }

      const stdout = Buffer.concat(chunks).toString('utf8').trimEnd();

      if (code !== 0) {
        const errText = Buffer.concat(errChunks).toString('utf8').trim();
        finishReject(
          new Error(
            `Generator exited with code ${code}: ${scriptFsPath}${errText ? `\n${errText}` : ''}`
          )
        );
        return;
      }

      if (!stdout.length) {
        finishReject(new Error(`Generator printed no stdout: ${scriptFsPath}`));
        return;
      }

      finishResolve(stdout);
    });
  });
};

module.exports = {
  runGeneratorScript,
  DEFAULT_TIMEOUT_MS,
};
