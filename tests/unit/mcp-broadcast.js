'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');

const broadcast = require('../../src/mcp-broadcast');
const log = require('../../src/log');

const FILE = 1;

const wsUri = { fsPath: '/w' };
const mcpDirUri = { fsPath: '/w/.mcp' };

const makeJoinPath = () => (base, name) => ({
  fsPath: `${base.fsPath}/${name}`,
});

const bufFromObj = obj => Buffer.from(JSON.stringify(obj));

suite('mcp-broadcast Suite', () => {
  setup(() => {
    Sinon.stub(log, 'error');
    Sinon.stub(log, 'warn');
    Sinon.stub(log, 'debug');
    Sinon.stub(log, 'info');
  });
  teardown(() => Sinon.restore());

  suite('computeCanonical', () => {
    test('merges *.json files; local.json wins over alphabetical team.json', async () => {
      const joinPath = makeJoinPath();
      const readDirectory = Sinon.stub().resolves([
        ['team.json', FILE],
        ['local.json', FILE],
      ]);
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/local.json' }).resolves(bufFromObj({
        linear: { command: 'override', agentInclude: ['*'] },
      }));
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        linear: { command: 'shared', args: ['x'], agentInclude: ['*'] },
        other: { command: 'y', agentInclude: ['*'] },
      }));

      const result = await broadcast.computeCanonical({
        mcpDirUri,
        joinPath,
        readFile,
        readDirectory,
        workspaceFolderUri: wsUri,
      });
      // local.json is pinned last so its 'override' wins; deep merge keeps args from team.json
      assert.equal(result.linear.command, 'override');
      assert.deepEqual(result.linear.args, ['x']);
      assert.equal(result.other.command, 'y');
    });

    test('runs *.<priority>.js generators after JSON in priority order', async () => {
      const joinPath = makeJoinPath();
      const readDirectory = Sinon.stub().resolves([
        ['team.json', FILE],
        ['gen.10.js', FILE],
        ['gen.50.js', FILE],
      ]);
      const readFile = Sinon.stub().resolves(bufFromObj({ a: { command: 'json', agentInclude: ['*'] } }));
      const runGeneratorScript = Sinon.stub();
      runGeneratorScript.withArgs('/w/.mcp/gen.10.js').resolves(JSON.stringify({
        a: { command: 'gen10', args: ['p10'], agentInclude: ['*'] },
      }));
      runGeneratorScript.withArgs('/w/.mcp/gen.50.js').resolves(JSON.stringify({
        a: { command: 'gen50', agentInclude: ['*'] },
      }));

      const result = await broadcast.computeCanonical({
        mcpDirUri,
        joinPath,
        readFile,
        readDirectory,
        workspaceFolderUri: wsUri,
        runGeneratorScript,
      });
      assert.equal(result.a.command, 'gen50');
      assert.deepEqual(result.a.args, ['p10']);
    });

    test('returns empty object when .mcp/ has no inputs', async () => {
      const readDirectory = Sinon.stub().resolves([]);
      const readFile = Sinon.stub();
      const result = await broadcast.computeCanonical({
        mcpDirUri,
        joinPath: makeJoinPath(),
        readFile,
        readDirectory,
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(result, {});
    });
  });

  suite('computeToolOverlay', () => {
    test('unwraps wrapKey from overlay file', async () => {
      const joinPath = makeJoinPath();
      const toolDir = { fsPath: '/w/.cursor' };
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ mcpServers: { linear: { command: 'cursor-shared' } } })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(undefined);

      const overlay = await broadcast.computeToolOverlay({
        toolConfigDirUri: toolDir,
        wrapKey: 'mcpServers',
        joinPath,
        readFile,
        readDirectory: Sinon.stub().resolves([]),
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(overlay, { linear: { command: 'cursor-shared' } });
    });

    test('lenient fallback: returns the whole object if wrapKey is absent', async () => {
      const joinPath = makeJoinPath();
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ linear: { command: 'flat-form' } })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(undefined);
      const overlay = await broadcast.computeToolOverlay({
        toolConfigDirUri: { fsPath: '/w/.cursor' },
        wrapKey: 'mcpServers',
        joinPath,
        readFile,
        readDirectory: Sinon.stub().resolves([]),
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(overlay, { linear: { command: 'flat-form' } });
    });
  });

  suite('_enabledTargets', () => {
    test('uses default list when cfg is undefined, filters by dir presence', () => {
      const enabled = broadcast._enabledTargets(undefined, {
        cursor: true,
        claude: true,
        vscode: false,
        codex: false,
      });
      assert.deepEqual(enabled, ['cursor', 'claude']);
    });

    test('respects cfg array when provided', () => {
      const enabled = broadcast._enabledTargets(['claude', 'codex'], {
        cursor: true,
        claude: true,
        vscode: true,
        codex: true,
      });
      assert.deepEqual(enabled, ['claude', 'codex']);
    });
  });

  suite('broadcastMcpToAllAgents (precedence)', () => {
    test('tool-specific overlay wins over canonical for that tool only', async () => {
      const joinPath = makeJoinPath();
      const writes = [];
      const writeFile = (uri, body) => {
        writes.push({ path: uri.fsPath, body: body.toString() });
        return Promise.resolve();
      };
      const stat = uri => {
        // Only .cursor and .claude exist in this workspace
        if (uri.fsPath === '/w/.cursor' || uri.fsPath === '/w/.claude') {
          return Promise.resolve({});
        }
        return Promise.reject({ code: 'ENOENT' });
      };
      const readFile = Sinon.stub();
      // .mcp/ canonical
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        linear: { command: 'canonical', agentInclude: ['*'] },
      }));
      // .cursor overlay overrides 'linear' for cursor only
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ mcpServers: { linear: { command: 'cursor-override' } } })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(undefined);
      readFile.withArgs({ fsPath: '/w/.claude/mcp.shared.json' }).resolves(undefined);
      readFile.withArgs({ fsPath: '/w/.claude/mcp.local.json' }).resolves(undefined);
      // No existing output files
      readFile.resolves(undefined);

      const readDirectory = Sinon.stub();
      readDirectory.withArgs(mcpDirUri).resolves([['team.json', FILE]]);
      readDirectory.resolves([]);

      await broadcast.broadcastMcpToAllAgents({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
        readDirectory,
        stat,
      });

      const cursorWrite = writes.find(w => w.path === '/w/.cursor/mcp.json');
      const claudeWrite = writes.find(w => w.path === '/w/.mcp.json');
      assert.exists(cursorWrite);
      assert.exists(claudeWrite);
      const cursorParsed = JSON.parse(cursorWrite.body);
      const claudeParsed = JSON.parse(claudeWrite.body);
      assert.equal(cursorParsed.mcpServers.linear.command, 'cursor-override');
      assert.equal(claudeParsed.mcpServers.linear.command, 'canonical');
      // VSCode and Codex absent in workspace -> not written
      assert.notExists(writes.find(w => w.path.includes('.vscode')));
      assert.notExists(writes.find(w => w.path.includes('.codex')));
    });

    test('agentInclude limits to listed agents', async () => {
      const joinPath = makeJoinPath();
      const writes = [];
      const writeFile = (uri, body) => {
        writes.push({ path: uri.fsPath, body: body.toString() });
        return Promise.resolve();
      };
      const stat = () => Promise.resolve({});
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        only_claude: { command: 'x', agentInclude: ['claude'] },
      }));
      readFile.resolves(undefined);
      const readDirectory = Sinon.stub();
      readDirectory.withArgs(mcpDirUri).resolves([['team.json', FILE]]);
      readDirectory.resolves([]);

      await broadcast.broadcastMcpToAllAgents({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
        readDirectory,
        stat,
      });

      const claudeOut = writes.find(w => w.path === '/w/.mcp.json');
      const cursorOut = writes.find(w => w.path === '/w/.cursor/mcp.json');
      const vscodeOut = writes.find(w => w.path === '/w/.vscode/mcp.json');
      assert.include(claudeOut.body, 'only_claude');
      assert.notInclude(cursorOut.body, 'only_claude');
      assert.notInclude(vscodeOut.body, 'only_claude');
    });

    test('agentInclude:[copilot] still lands in .vscode/mcp.json (alias)', async () => {
      const joinPath = makeJoinPath();
      const writes = [];
      const writeFile = (uri, body) => {
        writes.push({ path: uri.fsPath, body: body.toString() });
        return Promise.resolve();
      };
      const stat = () => Promise.resolve({});
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        copilot_srv: { command: 'x', agentInclude: ['copilot'] },
      }));
      readFile.resolves(undefined);
      const readDirectory = Sinon.stub();
      readDirectory.withArgs(mcpDirUri).resolves([['team.json', FILE]]);
      readDirectory.resolves([]);

      await broadcast.broadcastMcpToAllAgents({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        joinPath,
        readFile,
        writeFile,
        readDirectory,
        stat,
      });

      const vscodeOut = writes.find(w => w.path === '/w/.vscode/mcp.json');
      const cursorOut = writes.find(w => w.path === '/w/.cursor/mcp.json');
      assert.include(vscodeOut.body, 'copilot_srv');
      assert.notInclude(cursorOut.body, 'copilot_srv');
    });
  });
});
