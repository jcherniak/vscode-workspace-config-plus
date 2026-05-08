'use strict';

const { assert } = require('chai');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const cliIndex = require('../../src/cli/index');
const { _findRealBinary, WRAPPABLE_AGENTS } = require('../../src/cli/wrap');
const cliPlatform = require('../../src/cli-platform');

const _mkTempDir = async (prefix = 'wcp-test-') =>
  fs.mkdtemp(path.join(os.tmpdir(), prefix));

suite('CLI Suite', () => {
  suite('main argv parsing', () => {
    test('--version prints version and exits 0', async () => {
      const original = process.stdout.write.bind(process.stdout);
      const captured = [];
      process.stdout.write = chunk => {
        captured.push(chunk);
        return true;
      };
      try {
        const code = await cliIndex.main(['--version']);
        assert.equal(code, 0);
        assert.match(captured.join(''), /^\d+\.\d+\.\d+/);
      } finally {
        process.stdout.write = original;
      }
    });

    test('--help prints HELP and exits 0', async () => {
      const original = process.stdout.write.bind(process.stdout);
      const captured = [];
      process.stdout.write = chunk => {
        captured.push(chunk);
        return true;
      };
      try {
        const code = await cliIndex.main(['--help']);
        assert.equal(code, 0);
        assert.include(captured.join(''), 'wcp');
        assert.include(captured.join(''), 'Usage:');
      } finally {
        process.stdout.write = original;
      }
    });

    test('no subcommand prints HELP', async () => {
      const original = process.stdout.write.bind(process.stdout);
      const captured = [];
      process.stdout.write = chunk => {
        captured.push(chunk);
        return true;
      };
      try {
        const code = await cliIndex.main([]);
        assert.equal(code, 0);
        assert.include(captured.join(''), 'Usage:');
      } finally {
        process.stdout.write = original;
      }
    });

    test('unknown subcommand exits 2', async () => {
      const originalErr = process.stderr.write.bind(process.stderr);
      const captured = [];
      process.stderr.write = chunk => {
        captured.push(chunk);
        return true;
      };
      try {
        const code = await cliIndex.main(['frobnicate']);
        assert.equal(code, 2);
        assert.include(captured.join(''), 'unknown command');
      } finally {
        process.stderr.write = originalErr;
      }
    });
  });

  suite('run command', () => {
    test('--silent + no .mcp/ exits 0 silently (hook-friendly)', async () => {
      const { runCommand } = require('../../src/cli/run');
      const dir = await _mkTempDir();
      const code = await runCommand({ root: dir, silent: true, target: 'claude' });
      assert.equal(code, 0);
    });

    test('non-silent + no .mcp/ exits 1 with error', async () => {
      const { runCommand } = require('../../src/cli/run');
      const dir = await _mkTempDir();
      const code = await runCommand({ root: dir, silent: false, target: 'claude' });
      assert.equal(code, 1);
    });

    test('unknown --target exits 2', async () => {
      const { runCommand } = require('../../src/cli/run');
      const dir = await _mkTempDir();
      const code = await runCommand({ root: dir, silent: true, target: 'bogus' });
      assert.equal(code, 2);
    });
  });

  suite('cli-platform', () => {
    test('readFile returns Buffer for present file', async () => {
      const dir = await _mkTempDir();
      const file = path.join(dir, 'hello.txt');
      await fs.writeFile(file, 'world');
      const buf = await cliPlatform.readFile(file);
      assert.equal(buf.toString(), 'world');
    });

    test('readFile resolves to undefined for missing file', async () => {
      const buf = await cliPlatform.readFile('/no/such/file/here.json');
      assert.isUndefined(buf);
    });

    test('readDirectory returns [name, type] pairs (vscode shape)', async () => {
      const dir = await _mkTempDir();
      await fs.writeFile(path.join(dir, 'a.json'), '{}');
      await fs.mkdir(path.join(dir, 'sub'));
      const entries = await cliPlatform.readDirectory(dir);
      const sorted = entries.sort((x, y) => x[0].localeCompare(y[0]));
      assert.deepEqual(sorted, [
        ['a.json', 1],
        ['sub', 2],
      ]);
    });

    test('joinPath returns URI-shaped object', async () => {
      const u = cliPlatform.joinPath('/a', 'b', 'c.json');
      assert.equal(u.fsPath, path.join('/a', 'b', 'c.json'));
      assert.equal(u.path, u.fsPath);
      assert.equal(String(u), u.fsPath);
    });

    test('resolveWorkspaceRoot finds dir containing .mcp/', async () => {
      const dir = await _mkTempDir();
      await fs.mkdir(path.join(dir, '.mcp'));
      const sub = path.join(dir, 'a', 'b');
      await fs.mkdir(sub, { recursive: true });
      const root = await cliPlatform.resolveWorkspaceRoot(undefined, sub);
      assert.equal(root, dir);
    });

    test('resolveWorkspaceRoot honors explicit --root', async () => {
      const root = await cliPlatform.resolveWorkspaceRoot('/explicit/path');
      assert.equal(root, path.resolve('/explicit/path'));
    });

    test('createGetConfiguration: env var override for mcp.broadcast.targets', () => {
      const get = cliPlatform.createGetConfiguration({
        env: { WCP_MCP_BROADCAST_TARGETS: 'cursor,claude' },
      });
      const cfg = get('workspaceConfigPlus');
      assert.deepEqual(cfg.get('mcp.broadcast.targets'), ['cursor', 'claude']);
    });

    test('createGetConfiguration: explicit flag wins over env', () => {
      const get = cliPlatform.createGetConfiguration({
        flags: { 'mcp.broadcast.targets': ['vscode'] },
        env: { WCP_MCP_BROADCAST_TARGETS: 'cursor,claude' },
      });
      const cfg = get('workspaceConfigPlus');
      assert.deepEqual(cfg.get('mcp.broadcast.targets'), ['vscode']);
    });

    test('workspaceState persists across get/update via JSON file', async () => {
      const dir = await _mkTempDir();
      const ws = cliPlatform.createWorkspaceState(dir);
      await ws._load();
      assert.equal(ws.get('foo', 'default'), 'default');
      await ws.update('foo', 'bar');
      assert.equal(ws.get('foo', 'default'), 'bar');
      // Reload from disk
      const ws2 = cliPlatform.createWorkspaceState(dir);
      await ws2._load();
      assert.equal(ws2.get('foo'), 'bar');
    });
  });

  suite('wrap _findRealBinary', () => {
    test('returns null when binary is not on PATH', async () => {
      const result = await _findRealBinary('definitely-not-a-real-binary-xyz', null);
      assert.isNull(result);
    });

    test('finds real binary when present', async () => {
      // `node` is guaranteed to exist on PATH during tests.
      const result = await _findRealBinary('node', null);
      assert.isString(result);
      assert.match(result, /node/);
    });

    test('skips a candidate whose realpath matches our own entry', async () => {
      // Create a temp dir with a "fake" wrapper binary whose name resolves
      // to our entry point — the resolver should skip it.
      const dir = await _mkTempDir();
      const wrapperBin = path.join(dir, 'codex'); // pretend this is wcp-codex aliased
      const ourEntry = path.join(dir, 'wcp.js');
      await fs.writeFile(ourEntry, '// fake wcp');
      await fs.symlink(ourEntry, wrapperBin);

      const oldPath = process.env.PATH;
      process.env.PATH = `${dir}:${oldPath}`;
      try {
        const result = await _findRealBinary('codex', ourEntry);
        // result should NOT be the symlink we just made, since its realpath
        // matches ourEntry. It might be a real codex elsewhere on PATH or null.
        if (result !== null) {
          assert.notEqual(
            await fs.realpath(result),
            await fs.realpath(ourEntry)
          );
        }
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test('WRAPPABLE_AGENTS is the documented set', () => {
      // claude is included because SessionStart hooks fire after MCP load,
      // so wrapping is the only way to refresh .mcp.json for the current
      // session.
      assert.deepEqual(WRAPPABLE_AGENTS, ['codex', 'gemini', 'claude']);
    });
  });
});
