'use strict';

const { assert } = require('chai');
const discovery = require('../../src/generator-discovery');

suite('generator-discovery Suite', () => {
  suite('parseGeneratorFilename Suite', () => {
    test('Should parse a valid generator filename', () => {
      const p = discovery.parseGeneratorFilename('settings.generator.team-alpha.42.js');
      assert.deepInclude(p, {
        baseName: 'settings',
        slug: 'team-alpha',
        priority: 42,
        filename: 'settings.generator.team-alpha.42.js',
      });
    });

    test('Should return null when pattern does not match', () => {
      assert.isNull(discovery.parseGeneratorFilename('settings.shared.json'));
      assert.isNull(discovery.parseGeneratorFilename('settings.generator.only.js'));
    });
  });

  suite('collectGeneratorsForBase Suite', () => {
    const FT = discovery.VSCODE_FILETYPE_FILE;
    /** @type {[string, number][]} */
    const entries = [
      ['readme.md', FT],
      ['tasks.generator.zz.500.js', FT],
      ['tasks.generator.aa.2.js', FT],
      ['tasks.generator.bb.10.js', FT],
      ['settings.generator.xx.10.js', FT],
      ['subdir', 2],
    ];

    test('Should filter by basename and sort by priority then filename', () => {
      const list = discovery.collectGeneratorsForBase(entries, 'tasks');
      assert.deepEqual(list.map(x => x.filename), [
        'tasks.generator.aa.2.js',
        'tasks.generator.bb.10.js',
        'tasks.generator.zz.500.js',
      ]);
    });
  });
});
