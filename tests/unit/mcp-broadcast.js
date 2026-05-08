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
    test('unwraps mcpServers wrapper from overlay file', async () => {
      const joinPath = makeJoinPath();
      const toolDir = { fsPath: '/w/.cursor' };
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ mcpServers: { linear: { command: 'cursor-shared' } } })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(undefined);

      const overlay = await broadcast.computeToolOverlay({
        toolConfigDirUri: toolDir,
        agentNames: ['cursor'],
        joinPath,
        readFile,
        readDirectory: Sinon.stub().resolves([]),
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(overlay.linear, {
        command: 'cursor-shared',
        agentInclude: ['cursor'],
      });
    });

    test('lenient fallback: accepts already-flat overlay file', async () => {
      const joinPath = makeJoinPath();
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({ linear: { command: 'flat-form' } })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(undefined);
      const overlay = await broadcast.computeToolOverlay({
        toolConfigDirUri: { fsPath: '/w/.cursor' },
        agentNames: ['cursor'],
        joinPath,
        readFile,
        readDirectory: Sinon.stub().resolves([]),
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(overlay.linear, {
        command: 'flat-form',
        agentInclude: ['cursor'],
      });
    });

    test('auto-injects agentInclude:<agentNames> on overlay servers without filter', async () => {
      const joinPath = makeJoinPath();
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.vscode/mcp.shared.json' }).resolves(
        bufFromObj({ servers: { thing: { command: 'a' } } })
      );
      readFile.withArgs({ fsPath: '/w/.vscode/mcp.local.json' }).resolves(undefined);
      const overlay = await broadcast.computeToolOverlay({
        toolConfigDirUri: { fsPath: '/w/.vscode' },
        agentNames: ['vscode', 'copilot'],
        joinPath,
        readFile,
        readDirectory: Sinon.stub().resolves([]),
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(overlay.thing.agentInclude, ['vscode', 'copilot']);
    });

    test('preserves an explicit agentInclude on overlay-derived server', async () => {
      const joinPath = makeJoinPath();
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.shared.json' }).resolves(
        bufFromObj({
          mcpServers: {
            tagged: { command: 'a', agentInclude: ['claude'] },
          },
        })
      );
      readFile.withArgs({ fsPath: '/w/.cursor/mcp.local.json' }).resolves(undefined);
      const overlay = await broadcast.computeToolOverlay({
        toolConfigDirUri: { fsPath: '/w/.cursor' },
        agentNames: ['cursor'],
        joinPath,
        readFile,
        readDirectory: Sinon.stub().resolves([]),
        workspaceFolderUri: wsUri,
      });
      assert.deepEqual(overlay.tagged.agentInclude, ['claude']);
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

    test('targetFilter (string) scopes to a single agent', () => {
      const enabled = broadcast._enabledTargets(undefined, {
        cursor: true,
        claude: true,
        vscode: true,
        codex: true,
      }, 'claude');
      assert.deepEqual(enabled, ['claude']);
    });

    test('targetFilter (array) scopes to listed agents', () => {
      const enabled = broadcast._enabledTargets(undefined, {
        cursor: true,
        claude: true,
        vscode: true,
        codex: true,
      }, ['claude', 'codex']);
      assert.deepEqual(enabled, ['claude', 'codex']);
    });

    test('targetFilter still respects dir presence (no spurious targets)', () => {
      const enabled = broadcast._enabledTargets(undefined, {
        cursor: false,
        claude: true,
        vscode: false,
        codex: false,
      }, 'cursor');
      assert.deepEqual(enabled, []);
    });

    test('wcpConfigAgents (4th arg) restricts the base list', () => {
      const enabled = broadcast._enabledTargets(undefined, {
        cursor: true,
        claude: true,
        vscode: true,
        codex: true,
        opencode: true,
      }, undefined, ['claude', 'codex']);
      assert.deepEqual(enabled, ['claude', 'codex']);
    });

    test('wcpConfigAgents wins over the default-all-converters fallback', () => {
      // Even though the implicit default would be all 5, wcpConfigAgents=[] returns nothing.
      const enabled = broadcast._enabledTargets(undefined, {
        cursor: true,
        claude: true,
        vscode: true,
        codex: true,
        opencode: true,
      }, undefined, []);
      assert.deepEqual(enabled, []);
    });

    test('settings + wcpConfigAgents intersect (settings narrow further)', () => {
      const enabled = broadcast._enabledTargets(['cursor', 'claude'], {
        cursor: true,
        claude: true,
        vscode: true,
        codex: true,
      }, undefined, ['claude', 'vscode']);
      // claude is in both lists; cursor is settings-only; vscode is wcp-only -> only claude.
      assert.deepEqual(enabled, ['claude']);
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

    test('canonical server without filter + --target claude → scoped to claude', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body.toString();
        return Promise.resolve();
      };
      const stat = () => Promise.resolve({});
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        unfiltered: { command: 'a' },
      }));
      readFile.resolves(undefined);
      const readDirectory = Sinon.stub();
      readDirectory.withArgs(mcpDirUri).resolves([['team.json', FILE]]);
      readDirectory.resolves([]);

      await broadcast.broadcastMcpToAllAgents({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        target: 'claude',
        joinPath,
        readFile,
        writeFile,
        readDirectory,
        stat,
      });

      const claudeOut = writes['/w/.mcp.json'];
      assert.exists(claudeOut, 'expected <root>/.mcp.json to be written for --target claude');
      assert.include(claudeOut, 'unfiltered');
      // No other targets should have been written under --target claude.
      assert.notExists(writes['/w/.cursor/mcp.json']);
      assert.notExists(writes['/w/.vscode/mcp.json']);
    });

    test('wcp-config.json opt-in restricts broadcast to listed agents only', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body.toString();
        return Promise.resolve();
      };
      // All four primary agent dirs present, but wcp-config.json opts into only claude.
      const stat = () => Promise.resolve({});
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/wcp-config.json' }).resolves(
        Buffer.from(JSON.stringify({ agents: ['claude'] }))
      );
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        linear: { type: 'stdio', command: 'npx', args: [], agentInclude: ['*'] },
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

      // Only Claude's output should be written.
      assert.exists(writes['/w/.mcp.json']);
      assert.notExists(writes['/w/.cursor/mcp.json']);
      assert.notExists(writes['/w/.vscode/mcp.json']);
      assert.notExists(writes['/w/.codex/config.toml']);
      assert.notExists(writes['/w/opencode.json']);
    });

    test('wcp-config.json content does NOT leak into output (no agents key, no numeric-indices object)', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body.toString();
        return Promise.resolve();
      };
      const stat = uri => {
        if (uri.fsPath === '/w/.claude') return Promise.resolve({});
        return Promise.reject({ code: 'ENOENT' });
      };
      const readFile = Sinon.stub();
      // wcp-config.json present with `agents` field — should be IGNORED by discovery.
      readFile.withArgs({ fsPath: '/w/.mcp/wcp-config.json' }).resolves(
        Buffer.from(JSON.stringify({ agents: ['claude'] }))
      );
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        linear: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'linear-mcp'],
          agentInclude: ['*'],
        },
      }));
      readFile.resolves(undefined);
      const readDirectory = Sinon.stub();
      readDirectory.withArgs(mcpDirUri).resolves([
        ['team.json', FILE],
        ['wcp-config.json', FILE],
      ]);
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

      const claudeOut = writes['/w/.mcp.json'];
      assert.exists(claudeOut);
      const parsed = JSON.parse(claudeOut);
      assert.notProperty(parsed.mcpServers, 'agents');
      // Verify no numeric-indexed pseudo-server snuck in (the spread-array bug).
      assert.notProperty(parsed.mcpServers, '0');
      assert.notProperty(parsed.mcpServers, '1');
      assert.hasAllKeys(parsed.mcpServers, ['linear']);
    });

    test('first run auto-generates .mcp/wcp-config.json from detected artifacts', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body.toString();
        return Promise.resolve();
      };
      // Only .cursor and .claude exist; opencode.json absent.
      const stat = uri => {
        if (uri.fsPath === '/w/.cursor' || uri.fsPath === '/w/.claude') {
          return Promise.resolve({});
        }
        return Promise.reject({ code: 'ENOENT' });
      };
      const readFile = Sinon.stub();
      // wcp-config.json doesn't exist (resolves undefined).
      readFile.resolves(undefined);
      const readDirectory = Sinon.stub();
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

      const generated = writes['/w/.mcp/wcp-config.json'];
      assert.exists(generated, 'expected wcp-config.json to be auto-generated');
      const parsed = JSON.parse(generated);
      assert.deepEqual(parsed.agents.sort(), ['claude', 'cursor']);
    });

    test('opencode is detected via opencode.json file at workspace root', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body.toString();
        return Promise.resolve();
      };
      // Only opencode.json exists; no .opencode/ dir, no other agents.
      const stat = uri => {
        if (uri.fsPath === '/w/opencode.json') return Promise.resolve({});
        return Promise.reject({ code: 'ENOENT' });
      };
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        linear: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-linear'],
          agentInclude: ['*'],
        },
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

      const opencodeOut = writes['/w/opencode.json'];
      assert.exists(opencodeOut, 'expected opencode.json to be written');
      const parsed = JSON.parse(opencodeOut);
      assert.equal(parsed.mcp.linear.type, 'local');
      assert.deepEqual(parsed.mcp.linear.command, [
        'npx',
        '-y',
        '@modelcontextprotocol/server-linear',
      ]);
      // No other agent dirs exist, so no other writes.
      assert.notExists(writes['/w/.cursor/mcp.json']);
      assert.notExists(writes['/w/.mcp.json']);
    });

    test('canonical server without filter + no --target → broadcast everywhere', async () => {
      const joinPath = makeJoinPath();
      const writes = {};
      const writeFile = (uri, body) => {
        writes[uri.fsPath] = body.toString();
        return Promise.resolve();
      };
      const stat = () => Promise.resolve({});
      const readFile = Sinon.stub();
      readFile.withArgs({ fsPath: '/w/.mcp/team.json' }).resolves(bufFromObj({
        unfiltered: { command: 'a' },
      }));
      readFile.resolves(undefined);
      const readDirectory = Sinon.stub();
      readDirectory.withArgs(mcpDirUri).resolves([['team.json', FILE]]);
      readDirectory.resolves([]);

      await broadcast.broadcastMcpToAllAgents({
        workspaceFolderUri: wsUri,
        mcpDirUri,
        // no target → broadcast everywhere
        joinPath,
        readFile,
        writeFile,
        readDirectory,
        stat,
      });

      // Server should appear in all four outputs (default agentInclude:['*']).
      assert.include(writes['/w/.cursor/mcp.json'], 'unfiltered');
      assert.include(writes['/w/.mcp.json'], 'unfiltered');
      assert.include(writes['/w/.vscode/mcp.json'], 'unfiltered');
      assert.include(writes['/w/.codex/config.toml'], 'unfiltered');
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
