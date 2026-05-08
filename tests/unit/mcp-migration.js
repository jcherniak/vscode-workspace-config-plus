'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');

const migration = require('../../src/mcp-migration');
const log = require('../../src/log');

const FILE = 1;

const wsUri = { fsPath: '/w' };
const mcpDirUri = { fsPath: '/w/.mcp' };

const makeJoinPath = () => (base, name) => ({
  fsPath: `${base.fsPath}/${name}`,
});

const bufFromObj = obj => Buffer.from(JSON.stringify(obj));

suite('mcp-migration Suite', () => {
  setup(() => {
    Sinon.stub(log, 'error');
    Sinon.stub(log, 'warn');
    Sinon.stub(log, 'debug');
    Sinon.stub(log, 'info');
  });
  teardown(() => Sinon.restore());

  suite('detectLegacy', () => {
    test('returns map of tools with shared/local/generators', async () => {
      const joinPath = makeJoinPath();
      const stat = uri => {
        const present = new Set([
          '/w/.cursor',
          '/w/.cursor/mcp.shared.json',
          '/w/.claude',
          '/w/.claude/mcp.local.json',
        ]);
        return present.has(uri.fsPath) ? Promise.resolve({}) : Promise.reject({ code: 'ENOENT' });
      };
      const readDirectory = Sinon.stub();
      readDirectory.withArgs({ fsPath: '/w/.cursor' }).resolves([
        ['mcp.shared.json', FILE],
        ['mcp.generator.runtime.50.js', FILE],
      ]);
      readDirectory.withArgs({ fsPath: '/w/.claude' }).resolves([
        ['mcp.local.json', FILE],
      ]);
      readDirectory.resolves([]);

      const detected = await migration.detectLegacy({
        workspaceFolderUri: wsUri,
        joinPath,
        stat,
        readDirectory,
      });
      assert.hasAllKeys(detected, ['cursor', 'claude']);
      assert.isTrue(detected.cursor.hasShared);
      assert.isFalse(detected.cursor.hasLocal);
      assert.deepEqual(detected.cursor.generators, ['mcp.generator.runtime.50.js']);
      assert.isFalse(detected.claude.hasShared);
      assert.isTrue(detected.claude.hasLocal);
      assert.deepEqual(detected.claude.generators, []);
    });

    test('returns empty when no legacy artifacts exist', async () => {
      const stat = () => Promise.reject({ code: 'ENOENT' });
      const detected = await migration.detectLegacy({
        workspaceFolderUri: wsUri,
        joinPath: makeJoinPath(),
        stat,
        readDirectory: Sinon.stub().resolves([]),
      });
      assert.deepEqual(detected, {});
    });
  });

  suite('runMigration', () => {
    test('writes team.json and local.json with agentInclude:[<tool>] stamped', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = JSON.parse(body.toString());
        return Promise.resolve();
      };
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ mcpServers: { linear: { command: 'npx' } } })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(
        bufFromObj({ mcpServers: { local_only: { command: 'l' } } })
      );
      readFile.resolves(null);

      await migration.runMigration({
        selectedTools: ['cursor'],
        generatorActions: { cursor: 'keep' },
        disposition: 'leave',
        detected: {
          cursor: { hasShared: true, hasLocal: true, generators: [] },
        },
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
      });

      const team = writes['/w/.mcp/team.json'];
      const local = writes['/w/.mcp/local.json'];
      assert.deepEqual(team.linear.agentInclude, ['cursor']);
      assert.equal(team.linear.command, 'npx');
      assert.deepEqual(local.local_only.agentInclude, ['cursor']);
    });

    test('move generator action copies <tool>/mcp.generator.<n>.<p>.js to .mcp/<n>.<p>.js', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body;
        return Promise.resolve();
      };
      const readFile = Sinon.stub();
      const generatorBody = Buffer.from('// some generator');
      readFile
        .withArgs({ fsPath: '/w/.cursor/mcp.generator.runtime.50.js' })
        .resolves(generatorBody);
      readFile.resolves(null);

      await migration.runMigration({
        selectedTools: ['cursor'],
        generatorActions: { cursor: 'move' },
        disposition: 'leave',
        detected: {
          cursor: {
            hasShared: false,
            hasLocal: false,
            generators: ['mcp.generator.runtime.50.js'],
          },
        },
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
      });

      assert.equal(writes['/w/.mcp/runtime.50.js'].toString(), '// some generator');
    });

    test('keep generator action does not copy', async () => {
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body;
        return Promise.resolve();
      };
      const readFile = Sinon.stub().resolves(null);

      await migration.runMigration({
        selectedTools: ['cursor'],
        generatorActions: { cursor: 'keep' },
        disposition: 'leave',
        detected: {
          cursor: {
            hasShared: false,
            hasLocal: false,
            generators: ['mcp.generator.runtime.50.js'],
          },
        },
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath: makeJoinPath(),
        readFile,
        writeFile,
      });

      assert.notProperty(writes, '/w/.mcp/runtime.50.js');
    });

    test('disposition=delete removes original files', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const deletedPaths = [];
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body;
        return Promise.resolve();
      };
      const deleteFile = uri => {
        deletedPaths.push(uri.fsPath);
        return Promise.resolve();
      };
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ mcpServers: { a: { command: 'a' } } })
      );
      readFile.resolves(null);

      await migration.runMigration({
        selectedTools: ['cursor'],
        generatorActions: { cursor: 'keep' },
        disposition: 'delete',
        detected: {
          cursor: { hasShared: true, hasLocal: false, generators: [] },
        },
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
        deleteFile,
      });

      assert.include(deletedPaths, '/w/.cursor/mcp.shared.json');
    });

    test('disposition=rename writes .bak and deletes src', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const deletedPaths = [];
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body;
        return Promise.resolve();
      };
      const deleteFile = uri => {
        deletedPaths.push(uri.fsPath);
        return Promise.resolve();
      };
      const buf = bufFromObj({ mcpServers: { a: { command: 'a' } } });
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(buf);
      readFile.resolves(null);

      await migration.runMigration({
        selectedTools: ['cursor'],
        generatorActions: { cursor: 'keep' },
        disposition: 'rename',
        detected: {
          cursor: { hasShared: true, hasLocal: false, generators: [] },
        },
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
        deleteFile,
      });

      assert.exists(writes['/w/.cursor/mcp.shared.json.bak']);
      assert.include(deletedPaths, '/w/.cursor/mcp.shared.json');
    });
  });

  suite('promptAndMigrate dialog flow', () => {
    const baseDeps = () => {
      const joinPath = makeJoinPath();
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ mcpServers: { linear: { command: 'npx' } } })
      );
      readFile.resolves(null);
      const writeFile = Sinon.stub().resolves();
      const deleteFile = Sinon.stub().resolves();
      const stat = uri => {
        const present = new Set(['/w/.cursor', '/w/.cursor/mcp.shared.json']);
        return present.has(uri.fsPath) ? Promise.resolve({}) : Promise.reject({ code: 'ENOENT' });
      };
      const readDirectory = Sinon.stub().resolves([['mcp.shared.json', FILE]]);
      return { joinPath, readFile, writeFile, deleteFile, stat, readDirectory };
    };

    test('"Migrate all" path migrates all detected tools', async () => {
      const deps = baseDeps();
      const showInformationMessage = Sinon.stub();
      showInformationMessage.onFirstCall().resolves(migration.STEP1.MIGRATE_ALL);
      showInformationMessage.onSecondCall().resolves(migration.STEP3_DISPOSITION.LEAVE);
      const result = await migration.promptAndMigrate({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        ...deps,
        showInformationMessage,
        showQuickPick: Sinon.stub(),
      });
      assert.exists(result);
      assert.deepEqual(result.selected, ['cursor']);
      assert.equal(result.disposition, 'leave');
    });

    test('"Don\'t ask again" persists dismissal', async () => {
      const deps = baseDeps();
      const update = Sinon.stub().resolves();
      const workspaceState = {
        get: Sinon.stub().returns(false),
        update,
      };
      const showInformationMessage = Sinon.stub().resolves(migration.STEP1.DONT_ASK);
      await migration.promptAndMigrate({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        ...deps,
        showInformationMessage,
        workspaceState,
      });
      Sinon.assert.calledWith(update, migration._DISMISS_KEY, true);
    });

    test('skips when dismissal is persisted', async () => {
      const deps = baseDeps();
      const workspaceState = {
        get: Sinon.stub().returns(true),
        update: Sinon.stub(),
      };
      const showInformationMessage = Sinon.stub();
      const result = await migration.promptAndMigrate({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        ...deps,
        showInformationMessage,
        workspaceState,
      });
      assert.isNull(result);
      Sinon.assert.notCalled(showInformationMessage);
    });

    test('cancel-at-disposition aborts before any write', async () => {
      const deps = baseDeps();
      const showInformationMessage = Sinon.stub();
      showInformationMessage.onFirstCall().resolves(migration.STEP1.MIGRATE_ALL);
      showInformationMessage.onSecondCall().resolves(migration.STEP3_DISPOSITION.CANCEL);
      const writeSpy = Sinon.spy();
      const result = await migration.promptAndMigrate({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        ...deps,
        writeFile: writeSpy,
        showInformationMessage,
      });
      assert.isNull(result);
      Sinon.assert.notCalled(writeSpy);
    });
  });
});
