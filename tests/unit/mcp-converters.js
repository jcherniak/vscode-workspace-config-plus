'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');
const TOML = require('smol-toml');

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

  suite('opencode JSON converter', () => {
    const opencodeCtx = {
      opencodeConfigUri: { fsPath: '/w/opencode.json' },
    };

    test('transforms canonical (stdio) to opencode local schema', () => {
      const out = converters._transformToOpencode({
        linear: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-linear'],
          env: { LINEAR_API_KEY: 'x' },
        },
      });
      assert.deepEqual(out.linear, {
        type: 'local',
        enabled: true,
        command: ['npx', '-y', '@modelcontextprotocol/server-linear'],
        environment: { LINEAR_API_KEY: 'x' },
      });
    });

    test('transforms canonical (http) to opencode remote schema', () => {
      const out = converters._transformToOpencode({
        api: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer x' },
        },
      });
      assert.deepEqual(out.api, {
        type: 'remote',
        enabled: true,
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      });
    });

    test('infers local type when type missing but command present', () => {
      const out = converters._transformToOpencode({
        s: { command: 'foo', args: ['a'] },
      });
      assert.equal(out.s.type, 'local');
      assert.deepEqual(out.s.command, ['foo', 'a']);
    });

    test('passes timeout through', () => {
      const out = converters._transformToOpencode({
        s: { type: 'stdio', command: 'foo', timeout: 5000 },
      });
      assert.equal(out.s.timeout, 5000);
    });

    test('serialize section-merges into existing opencode.json (preserves tools/agent keys)', async () => {
      const existing = {
        tools: { foo: { enabled: true } },
        agent: { default: 'claude-3-5-sonnet' },
      };
      const readFile = Sinon.stub().resolves(Buffer.from(JSON.stringify(existing)));
      const buf = await converters.opencodeConverter.serialize(
        { linear: { type: 'stdio', command: 'npx', args: ['x'] } },
        { ...opencodeCtx, readFile }
      );
      const round = JSON.parse(buf.toString());
      assert.deepEqual(round.tools, { foo: { enabled: true } });
      assert.equal(round.agent.default, 'claude-3-5-sonnet');
      assert.equal(round.mcp.linear.type, 'local');
    });

    test('serialize replaces existing mcp section entirely', async () => {
      const existing = {
        mcp: { stale: { type: 'local', command: ['old'] } },
        keep: 'me',
      };
      const readFile = Sinon.stub().resolves(Buffer.from(JSON.stringify(existing)));
      const buf = await converters.opencodeConverter.serialize(
        { fresh: { type: 'stdio', command: 'new', args: [] } },
        { ...opencodeCtx, readFile }
      );
      const round = JSON.parse(buf.toString());
      assert.equal(round.keep, 'me');
      assert.notProperty(round.mcp, 'stale');
      assert.hasAllKeys(round.mcp, ['fresh']);
    });

    test('serialize treats missing opencode.json as empty', async () => {
      const readFile = Sinon.stub().rejects({ code: 'ENOENT' });
      const buf = await converters.opencodeConverter.serialize(
        { linear: { type: 'stdio', command: 'npx', args: [] } },
        { ...opencodeCtx, readFile }
      );
      const round = JSON.parse(buf.toString());
      assert.deepEqual(Object.keys(round), ['mcp']);
      assert.hasAllKeys(round.mcp, ['linear']);
    });

    test('opencode converter has detectFiles for opencode.json', () => {
      assert.deepEqual(converters.opencodeConverter.detectFiles, ['opencode.json']);
    });

    test('opencode is in allConverterNames + agentNames includes opencode', () => {
      assert.include(converters.allConverterNames, 'opencode');
      assert.include(converters.opencodeConverter.agentNames, 'opencode');
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

  suite('normalizeMcpJson (lenient unwrap)', () => {
    test('unwraps mcpServers wrapper', () => {
      const flat = converters.normalizeMcpJson({
        mcpServers: { linear: { command: 'a' } },
      });
      assert.deepEqual(flat, { linear: { command: 'a' } });
    });

    test('unwraps servers wrapper (vscode)', () => {
      const flat = converters.normalizeMcpJson({
        servers: { linear: { command: 'a' } },
      });
      assert.deepEqual(flat, { linear: { command: 'a' } });
    });

    test('unwraps mcp_servers wrapper (codex)', () => {
      const flat = converters.normalizeMcpJson({
        mcp_servers: { linear: { command: 'a' } },
      });
      assert.deepEqual(flat, { linear: { command: 'a' } });
    });

    test('passes through already-flat input', () => {
      const flat = converters.normalizeMcpJson({ linear: { command: 'a' } });
      assert.deepEqual(flat, { linear: { command: 'a' } });
    });

    test('returns empty object on null/undefined/array input', () => {
      assert.deepEqual(converters.normalizeMcpJson(null), {});
      assert.deepEqual(converters.normalizeMcpJson(undefined), {});
      assert.deepEqual(converters.normalizeMcpJson(['a']), {});
    });

    test('knownWrapKeys exposes all converter wrap keys', () => {
      assert.includeMembers(converters.knownWrapKeys, [
        'mcpServers',
        'servers',
        'mcp_servers',
      ]);
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
