'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');
const TOML = require('@iarna/toml');

const converters = require('../../src/mcp-converters');
const log = require('../../src/log');

const sampleFlat = {
  linear: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-linear'],
    env: { LINEAR_API_KEY: 'x' },
    agentInclude: ['*'],
  },
  remote: {
    type: 'http',
    url: 'https://example.com',
    headers: { Authorization: 'Bearer x' },
    agentInclude: ['*'],
  },
};

const ctx = {
  cursorMcpUri: { fsPath: '/w/.cursor/mcp.json' },
  workspaceMcpUri: { fsPath: '/w/.mcp.json' },
  vscodeMcpUri: { fsPath: '/w/.vscode/mcp.json' },
  codexConfigUri: { fsPath: '/w/.codex/config.toml' },
};

suite('mcp-converters Suite', () => {
  setup(() => {
    Sinon.stub(log, 'error');
    Sinon.stub(log, 'warn');
    Sinon.stub(log, 'debug');
    Sinon.stub(log, 'info');
  });
  teardown(() => Sinon.restore());

  suite('cursor / claude / vscode JSON converters', () => {
    test('cursor wraps with mcpServers', () => {
      const buf = converters.cursorConverter.serialize(sampleFlat);
      const obj = JSON.parse(buf.toString());
      assert.hasAllKeys(obj, ['mcpServers']);
      assert.hasAllKeys(obj.mcpServers, ['linear', 'remote']);
    });

    test('claude wraps with mcpServers', () => {
      const buf = converters.claudeConverter.serialize(sampleFlat);
      const obj = JSON.parse(buf.toString());
      assert.deepEqual(Object.keys(obj), ['mcpServers']);
    });

    test('vscode wraps with servers (rename)', () => {
      const buf = converters.vscodeConverter.serialize(sampleFlat);
      const obj = JSON.parse(buf.toString());
      assert.deepEqual(Object.keys(obj), ['servers']);
      assert.notProperty(obj, 'mcpServers');
    });

    test('agentNames includes copilot alias on vscode converter', () => {
      assert.include(converters.vscodeConverter.agentNames, 'copilot');
      assert.include(converters.vscodeConverter.agentNames, 'vscode');
      assert.notInclude(converters.cursorConverter.agentNames, 'copilot');
    });
  });

  suite('codex TOML converter', () => {
    test('emits [mcp_servers.*] sections and preserves non-MCP TOML', async () => {
      const existing = TOML.stringify({
        model: 'gpt-5',
        approval_policy: 'auto',
        some_other: { nested: true },
      });
      const readFile = Sinon.stub().resolves(Buffer.from(existing));
      const buf = await converters.codexConverter.serialize(sampleFlat, {
        ...ctx,
        readFile,
      });
      const round = TOML.parse(buf.toString());
      assert.equal(round.model, 'gpt-5');
      assert.equal(round.approval_policy, 'auto');
      assert.deepEqual(round.some_other, { nested: true });
      assert.hasAllKeys(round.mcp_servers, ['linear', 'remote']);
      assert.equal(round.mcp_servers.linear.command, 'npx');
    });

    test('replaces existing [mcp_servers.*] entirely', async () => {
      const existing = TOML.stringify({
        mcp_servers: { stale: { command: 'old' } },
        keep: 'me',
      });
      const readFile = Sinon.stub().resolves(Buffer.from(existing));
      const buf = await converters.codexConverter.serialize(sampleFlat, {
        ...ctx,
        readFile,
      });
      const round = TOML.parse(buf.toString());
      assert.equal(round.keep, 'me');
      assert.notProperty(round.mcp_servers, 'stale');
      assert.hasAllKeys(round.mcp_servers, ['linear', 'remote']);
    });

    test('treats missing config.toml as empty', async () => {
      const readFile = Sinon.stub().rejects({ code: 'ENOENT' });
      const buf = await converters.codexConverter.serialize(sampleFlat, {
        ...ctx,
        readFile,
      });
      const round = TOML.parse(buf.toString());
      assert.hasAllKeys(round.mcp_servers, ['linear', 'remote']);
    });
  });

  suite('filterByAgent', () => {
    test('passes through servers with agentInclude:["*"] for any agent', () => {
      const out = converters.filterByAgent(sampleFlat, ['claude']);
      assert.hasAllKeys(out, ['linear', 'remote']);
      assert.notProperty(out.linear, 'agentInclude');
    });

    test('drops servers missing both agentInclude and agentExclude', () => {
      const flat = { stale: { command: 'a' } };
      const out = converters.filterByAgent(flat, ['claude']);
      assert.deepEqual(out, {});
      Sinon.assert.calledWithMatch(log.error, /must declare agentInclude or agentExclude/);
    });

    test('agentInclude:["*"] matches every agent', () => {
      const flat = { everywhere: { command: 'a', agentInclude: ['*'] } };
      assert.hasAllKeys(converters.filterByAgent(flat, ['claude']), ['everywhere']);
      assert.hasAllKeys(converters.filterByAgent(flat, ['cursor']), ['everywhere']);
      assert.hasAllKeys(converters.filterByAgent(flat, ['codex']), ['everywhere']);
    });

    test('agentExclude:["*"] drops the server from every agent', () => {
      const flat = { disabled: { command: 'a', agentExclude: ['*'] } };
      assert.deepEqual(converters.filterByAgent(flat, ['claude']), {});
      assert.deepEqual(converters.filterByAgent(flat, ['cursor']), {});
    });

    test('agentInclude limits to listed agents', () => {
      const flat = {
        only_claude: { command: 'a', agentInclude: ['claude'] },
      };
      assert.hasAllKeys(converters.filterByAgent(flat, ['claude']), ['only_claude']);
      assert.deepEqual(converters.filterByAgent(flat, ['cursor']), {});
    });

    test('agentExclude drops listed agents', () => {
      const flat = {
        not_codex: { command: 'a', agentExclude: ['codex'] },
      };
      assert.hasAllKeys(converters.filterByAgent(flat, ['claude']), ['not_codex']);
      assert.deepEqual(converters.filterByAgent(flat, ['codex']), {});
    });

    test('strips agentInclude/agentExclude from the emitted def', () => {
      const flat = {
        s: {
          command: 'a',
          agentInclude: ['claude'],
        },
      };
      const out = converters.filterByAgent(flat, ['claude']);
      assert.notProperty(out.s, 'agentInclude');
      assert.equal(out.s.command, 'a');
    });

    test('logs error and drops server when both keys are set', () => {
      const flat = {
        broken: {
          command: 'a',
          agentInclude: ['claude'],
          agentExclude: ['codex'],
        },
      };
      const out = converters.filterByAgent(flat, ['claude']);
      assert.deepEqual(out, {});
      Sinon.assert.calledWithMatch(log.error, /agentInclude.*agentExclude/);
    });

    test('copilot alias matches via vscode converter agentNames', () => {
      const flat = {
        copilot_only: { command: 'a', agentInclude: ['copilot'] },
      };
      const out = converters.filterByAgent(flat, converters.vscodeConverter.agentNames);
      assert.hasAllKeys(out, ['copilot_only']);
      // Should NOT match cursor:
      assert.deepEqual(
        converters.filterByAgent(flat, converters.cursorConverter.agentNames),
        {}
      );
    });
  });

  suite('knownAgentNames', () => {
    test('includes all converter names plus copilot alias', () => {
      assert.includeMembers(converters.knownAgentNames, [
        'cursor',
        'claude',
        'vscode',
        'codex',
        'copilot',
      ]);
    });
  });
});
