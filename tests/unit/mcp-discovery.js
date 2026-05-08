'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');

const discovery = require('../../src/mcp-discovery');
const log = require('../../src/log');

const FILE = 1;
const DIR = 2;

suite('mcp-discovery Suite', () => {
  setup(() => {
    Sinon.stub(log, 'warn');
    Sinon.stub(log, 'debug');
  });
  teardown(() => Sinon.restore());

  suite('classifyMcpDirEntries', () => {
    test('picks up *.json files at top level alphabetically, local.json last', () => {
      const { definitions } = discovery.classifyMcpDirEntries([
        ['team.json', FILE],
        ['local.json', FILE],
        ['alpha.json', FILE],
      ]);
      assert.deepEqual(
        definitions.map(d => d.name),
        ['alpha.json', 'team.json', 'local.json']
      );
    });

    test('local.json is always last so personal overrides win', () => {
      const { definitions } = discovery.classifyMcpDirEntries([
        ['local.json', FILE],
        ['zeta.json', FILE],
      ]);
      assert.deepEqual(
        definitions.map(d => d.name),
        ['zeta.json', 'local.json']
      );
    });

    test('picks up <name>.<priority>.js generators in priority order', () => {
      const { generators } = discovery.classifyMcpDirEntries([
        ['runtime.50.js', FILE],
        ['dynamic.10.js', FILE],
        ['fallback.99.js', FILE],
      ]);
      assert.deepEqual(
        generators.map(g => `${g.name}@${g.priority}`),
        ['dynamic.10.js@10', 'runtime.50.js@50', 'fallback.99.js@99']
      );
    });

    test('breaks priority ties alphabetically', () => {
      const { generators } = discovery.classifyMcpDirEntries([
        ['zeta.50.js', FILE],
        ['alpha.50.js', FILE],
      ]);
      assert.deepEqual(generators.map(g => g.name), ['alpha.50.js', 'zeta.50.js']);
    });

    test('ignores subdirectories', () => {
      const { definitions, generators } = discovery.classifyMcpDirEntries([
        ['team.json', FILE],
        ['lib', DIR],
        ['nested', DIR],
      ]);
      assert.lengthOf(definitions, 1);
      assert.lengthOf(generators, 0);
    });

    test('ignores .js files without a priority segment (helpers)', () => {
      const { generators } = discovery.classifyMcpDirEntries([
        ['helpers.js', FILE],
        ['lib.js', FILE],
        ['real.10.js', FILE],
      ]);
      assert.deepEqual(generators.map(g => g.name), ['real.10.js']);
    });

    test('returns empty arrays for non-array input', () => {
      const result = discovery.classifyMcpDirEntries(null);
      assert.deepEqual(result, { definitions: [], generators: [] });
    });

    test('excludes wcp-config.json (reserved filename)', () => {
      const { definitions } = discovery.classifyMcpDirEntries([
        ['team.json', FILE],
        ['wcp-config.json', FILE],
      ]);
      assert.deepEqual(definitions.map(d => d.name), ['team.json']);
    });

    test('reserved filename set is exposed for testing', () => {
      assert.isTrue(discovery._RESERVED_FILENAMES.has('wcp-config.json'));
    });
  });

  suite('readMcpDir', () => {
    test('returns classified entries on success', async () => {
      const readDirectory = Sinon.stub().resolves([
        ['team.json', FILE],
        ['runtime.10.js', FILE],
      ]);
      const result = await discovery.readMcpDir({ fsPath: '/x/.mcp' }, readDirectory);
      assert.lengthOf(result.definitions, 1);
      assert.lengthOf(result.generators, 1);
    });

    test('returns empty on read error and logs warn', async () => {
      const readDirectory = Sinon.stub().rejects(new Error('boom'));
      const result = await discovery.readMcpDir({ fsPath: '/x/.mcp' }, readDirectory);
      assert.deepEqual(result, { definitions: [], generators: [] });
    });
  });
});
