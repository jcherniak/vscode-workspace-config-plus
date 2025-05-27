'use strict';

const { assert } = require('chai');
const jsoncParser = require('jsonc-parser');
const Sinon = require('sinon');

const {
  callbacks,
  // Import necessary URIs from data
  settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri,
  mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri,
  mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri
} = require('../data');
const fileHandler = require('../../src/file-handler');
const log = require('../../src/log');

suite('file handler Suite', () => {
  /** @type {Sinon.SinonStub} */
  let readFileStub;
  // Keep a consistent fileUri for the _loadConfigFromFile suite setup
  const loadConfigTestFileUri = settingsVscodeSharedUri;
  const config = { 'window.zoomLevel': -1 };
  const contents = JSON.stringify(config);
  const buffer = Buffer.from(contents);

  setup(() => {
    // Setup for _loadConfigFromFile suite
    readFileStub = Sinon.stub(callbacks, 'readFile')
      .withArgs(loadConfigTestFileUri)
      .callsFake(() => buffer);
  });

  teardown(() => {
    Sinon.restore();
  });

  suite('_loadConfigFromFile Suite', () => {
    /** @type {Sinon.SinonStub} */
    let parseStub;
    const _loadConfigFromFile = fileHandler._loadConfigFromFile;

    setup(() => {
      parseStub = Sinon.stub(jsoncParser, 'parse')
        .withArgs(contents, [])
        .callsFake(() => config);
    });

    test('Should return undefined when file does not exist', async () => {
      readFileStub.callsFake(() => undefined);
      assert.isUndefined(
        await _loadConfigFromFile(loadConfigTestFileUri, callbacks.readFile)
      );
      assert.isFalse(parseStub.called);
    });

    test('Should return config object on valid json/jsonc', async () => {
      assert.deepEqual(
        await _loadConfigFromFile(loadConfigTestFileUri, callbacks.readFile),
        config
      );
    });

    test('Should throw error on invalid json/jsonc', async () => {
      parseStub.callsFake((_c, errors) => {
        errors.push('oops');
      });
      try {
        await _loadConfigFromFile(loadConfigTestFileUri, callbacks.readFile);
        assert.fail('Should have thrown');
      } catch (e) {
        assert.deepEqual(
          e.message,
          `Failed to parse contents of: ${loadConfigTestFileUri.fsPath}`
        );
      }
    });
  });

  suite('mergeConfigFiles Suite', () => {
    /** @type {Sinon.SinonStub} */
    let loadConfigFromFileStub;
    /** @type {Sinon.SinonStub} */
    let loadTargetFileStub; // Renamed for clarity
    /** @type {Sinon.SinonStub} */
    let writeFileStub;
    /** @type {Sinon.SinonStub} */
    let logInfoStub;
    /** @type {Sinon.SinonStub} */
    let logDebugStub;
    /** @type {Sinon.SinonStub} */
    let logErrorStub;

    // Use settings URIs for default setup, tests can override
    const defaultTargetFileUri = settingsVscodeFileUri;
    const defaultSharedFileUri = settingsVscodeSharedUri;
    const defaultLocalFileUri = settingsVscodeLocalUri;
    const mergeConfigFiles = fileHandler.mergeConfigFiles;

    // Sample data (can be reused/adapted for mcp)
    const baseTargetConfig = {
      foo: 'abc',
      'window.zoomLevel': 0,
      bar: 'def',
    };
    const sharedArrayCombineConfig = {
      foo: false,
      'editor.rulers': [100],
      '[typescript]': {
        'editor.dragAndDrop': false,
        'editor.tabCompletion': 'on',
      },
      [fileHandler._arrayMergeKey]: 'combine',
    };
    const localArrayCombineConfig = {
      foo: true,
      'window.zoomLevel': 1,
      'editor.rulers': [80],
      '[typescript]': {
        'editor.dragAndDrop': true,
        'editor.autoIndent': false,
      },
      baz: false,
      [fileHandler._arrayMergeKey]: 'combine',
    };
    const expArrayCombineConfig = {
      foo: true,
      'window.zoomLevel': 1,
      'editor.rulers': [100, 80],
      '[typescript]': {
        'editor.dragAndDrop': true,
        'editor.tabCompletion': 'on',
        'editor.autoIndent': false,
      },
      [fileHandler._arrayMergeKey]: 'combine',
      baz: false,
    };
    const finalExpArrayCombineConfig = {
      ...baseTargetConfig,
      ...expArrayCombineConfig,
    };
    const expArrayCombineConfigNoExplicitMerge = JSON.parse(
      JSON.stringify(finalExpArrayCombineConfig)
    );
    delete expArrayCombineConfigNoExplicitMerge[fileHandler._arrayMergeKey];

    const sharedArrayOverwriteConfig = {
      foo: false,
      'editor.rulers': [100],
      '[typescript]': {
        'editor.dragAndDrop': false,
        'editor.tabCompletion': 'on',
      },
      // Note the casing in the value, added intentionally to provide
      // defensive testing and ensure we aren't pedantic about case.
      [fileHandler._arrayMergeKey]: 'OVERwrite',
    };
    const sharedConfigNoArrayMerge = JSON.parse(
      JSON.stringify(sharedArrayOverwriteConfig)
    );
    delete sharedConfigNoArrayMerge[fileHandler._arrayMergeKey];
    const localArrayOverwriteConfig = {
      foo: true,
      'window.zoomLevel': 1,
      'editor.rulers': [80],
      '[typescript]': {
        'editor.dragAndDrop': true,
        'editor.autoIndent': false,
      },
      [fileHandler._arrayMergeKey]: 'overwrite',
      baz: false,
    };
    const localConfigNoArrayMerge = JSON.parse(
      JSON.stringify(localArrayOverwriteConfig)
    );
    delete localConfigNoArrayMerge[fileHandler._arrayMergeKey];
    const expArrayOverwriteConfig = {
      foo: true,
      'window.zoomLevel': 1,
      bar: 'def',
      'editor.rulers': [80],
      '[typescript]': {
        'editor.dragAndDrop': true,
        'editor.tabCompletion': 'on',
        'editor.autoIndent': false,
      },
      [fileHandler._arrayMergeKey]: 'overwrite',
      baz: false,
    };

    // --- MCP Specific Sample Data ---
    const mcpBaseTargetConfig = {
      "mcp.feature.one": true,
      "mcp.common.setting": "base"
    };
    const mcpSharedConfig = {
      "mcp.common.setting": "shared",
      "mcp.shared.only": "hello",
      "mcp.array": ["shared1", "shared2"],
      [fileHandler._arrayMergeKey]: 'combine', // Default combine for mcp test
    };
    const mcpLocalConfig = {
      "mcp.common.setting": "local", // Overrides shared
      "mcp.local.only": "world",
      "mcp.array": ["local1"],
    };
    const mcpExpectedCombined = {
      "mcp.feature.one": true, // From base target
      "mcp.common.setting": "local", // Local overrides shared and base
      "mcp.shared.only": "hello",
      "mcp.local.only": "world",
      "mcp.array": ["shared1", "shared2", "local1"], // Combined array
      [fileHandler._arrayMergeKey]: 'combine', // Merged array key
    };
    const mcpExpectedOverwrite = {
       "mcp.feature.one": true,
      "mcp.common.setting": "local",
      "mcp.shared.only": "hello",
      "mcp.local.only": "world",
      "mcp.array": ["local1"], // Overwritten array
      [fileHandler._arrayMergeKey]: 'overwrite',
    };

    setup(() => {
      loadConfigFromFileStub = Sinon.stub(fileHandler, '_loadConfigFromFile');
      // Default stubbing for settings files
      loadTargetFileStub = loadConfigFromFileStub.withArgs(
        defaultTargetFileUri,
        callbacks.readFile
      );
      loadConfigFromFileStub
        .withArgs(defaultSharedFileUri, callbacks.readFile)
        .resolves(sharedArrayCombineConfig); // Use .resolves for Promises
      loadConfigFromFileStub
        .withArgs(defaultLocalFileUri, callbacks.readFile)
        .resolves(localArrayCombineConfig);
      loadTargetFileStub.resolves(baseTargetConfig);

      writeFileStub = Sinon.stub(callbacks, 'writeFile').resolves(); // Assume writeFile succeeds
      logDebugStub = Sinon.stub(log, 'debug');
      logErrorStub = Sinon.stub(log, 'error');
      logInfoStub = Sinon.stub(log, 'info');
    });

    // --- Existing tests using default (settings) URIs ---
    // (These tests remain largely unchanged as they test the core merge logic,
    // which is independent of the specific file type name like 'settings' or 'mcp')
    // ... (keep existing tests: 'Should return early...', 'Should handle nonexistent...', etc.) ...

    test('Should return early with no custom files exist', async () => {
      loadConfigFromFileStub.withArgs(defaultSharedFileUri, callbacks.readFile).resolves(undefined);
      loadConfigFromFileStub.withArgs(defaultLocalFileUri, callbacks.readFile).resolves(undefined);
      await mergeConfigFiles({
        vscodeFileUri: defaultTargetFileUri,
        sharedFileUri: defaultSharedFileUri,
        localFileUri: defaultLocalFileUri,
        ...callbacks,
      });
      // Should attempt to load shared and local (2 calls)
      Sinon.assert.calledTwice(loadConfigFromFileStub);
      Sinon.assert.notCalled(loadTargetFileStub); // Doesn't load target if shared/local absent
      Sinon.assert.notCalled(writeFileStub);
    });

    test('Should return early when there are no changes to be made', async () => {
       // Calculate expected merge result first for setup
       const expectedMerged = fileHandler.getMergedConfigs({
          sharedConfig: sharedArrayCombineConfig,
          localConfig: localArrayCombineConfig
       });
       // Stub the target file load to return exactly the merged result
      loadTargetFileStub.resolves(expectedMerged);

      await mergeConfigFiles({
        vscodeFileUri: defaultTargetFileUri,
        sharedFileUri: defaultSharedFileUri,
        localFileUri: defaultLocalFileUri,
        ...callbacks,
      });
      // Shared, Local, Target loaded (3 calls)
      Sinon.assert.calledThrice(loadConfigFromFileStub);
      Sinon.assert.notCalled(writeFileStub);
    });

    // ... (rest of existing tests using default URIs are assumed to be here and unchanged) ...

    // --- NEW MCP Specific Tests ---
    test('MCP: Should merge mcp.shared and mcp.local into mcp.json (combine arrays)', async () => {
      // Arrange: Stub file loading for MCP files
      loadConfigFromFileStub.withArgs(mcpCursorSharedUri, callbacks.readFile).resolves(mcpSharedConfig);
      loadConfigFromFileStub.withArgs(mcpCursorLocalUri, callbacks.readFile).resolves(mcpLocalConfig);
      loadConfigFromFileStub.withArgs(mcpCursorFileUri, callbacks.readFile).resolves(mcpBaseTargetConfig);

      // Act
      await mergeConfigFiles({
        vscodeFileUri: mcpCursorFileUri, // Use MCP URIs
        sharedFileUri: mcpCursorSharedUri,
        localFileUri: mcpCursorLocalUri,
        ...callbacks,
      });

      // Assert
      Sinon.assert.calledWith(logInfoStub, `Updating config in ${mcpCursorFileUri.fsPath}`);
      // Check that writeFile was called with the correct target URI and merged content
      Sinon.assert.calledOnceWithExactly(
        writeFileStub,
        mcpCursorFileUri,
        Buffer.from(JSON.stringify({ ...mcpBaseTargetConfig, ...mcpExpectedCombined }, null, 2)),
        { create: true, overwrite: true }
      );
    });

    test('MCP: Should merge mcp files correctly with array overwrite', async () => {
      // Arrange: Modify shared/local configs for this test
      const mcpSharedOverwrite = { ...mcpSharedConfig, [fileHandler._arrayMergeKey]: 'overwrite' };
      const mcpLocalOverwrite = { ...mcpLocalConfig, [fileHandler._arrayMergeKey]: 'overwrite' }; // Ensure local also specifies it or inherits

      loadConfigFromFileStub.withArgs(mcpCursorSharedUri, callbacks.readFile).resolves(mcpSharedOverwrite);
      loadConfigFromFileStub.withArgs(mcpCursorLocalUri, callbacks.readFile).resolves(mcpLocalOverwrite);
      loadConfigFromFileStub.withArgs(mcpCursorFileUri, callbacks.readFile).resolves(mcpBaseTargetConfig);

      // Act
      await mergeConfigFiles({
        vscodeFileUri: mcpCursorFileUri,
        sharedFileUri: mcpCursorSharedUri,
        localFileUri: mcpCursorLocalUri,
        ...callbacks,
      });

      // Assert
      Sinon.assert.calledWith(logInfoStub, `Updating config in ${mcpCursorFileUri.fsPath}`);
      Sinon.assert.calledOnceWithExactly(
        writeFileStub,
        mcpCursorFileUri,
        Buffer.from(JSON.stringify({ ...mcpBaseTargetConfig, ...mcpExpectedOverwrite }, null, 2)),
        { create: true, overwrite: true }
      );
    });

    test('MCP: Should handle missing mcp.local correctly', async () => {
      // Arrange
      loadConfigFromFileStub.withArgs(mcpCursorSharedUri, callbacks.readFile).resolves(mcpSharedConfig);
      loadConfigFromFileStub.withArgs(mcpCursorLocalUri, callbacks.readFile).resolves(undefined); // Local is missing
      loadConfigFromFileStub.withArgs(mcpCursorFileUri, callbacks.readFile).resolves(mcpBaseTargetConfig);

      // Expected result is base + shared
      const expectedMerged = { ...mcpBaseTargetConfig, ...mcpSharedConfig };

      // Act
      await mergeConfigFiles({
        vscodeFileUri: mcpCursorFileUri,
        sharedFileUri: mcpCursorSharedUri,
        localFileUri: mcpCursorLocalUri,
        ...callbacks,
      });

      // Assert
      Sinon.assert.calledWith(logInfoStub, `Updating config in ${mcpCursorFileUri.fsPath}`);
      Sinon.assert.calledOnceWithExactly(
        writeFileStub,
        mcpCursorFileUri,
        Buffer.from(JSON.stringify(expectedMerged, null, 2)),
        { create: true, overwrite: true }
      );
    });

     test('MCP: Should handle missing mcp.shared correctly', async () => {
      // Arrange
      loadConfigFromFileStub.withArgs(mcpCursorSharedUri, callbacks.readFile).resolves(undefined); // Shared is missing
      loadConfigFromFileStub.withArgs(mcpCursorLocalUri, callbacks.readFile).resolves(mcpLocalConfig);
      loadConfigFromFileStub.withArgs(mcpCursorFileUri, callbacks.readFile).resolves(mcpBaseTargetConfig);

       // Expected result is base + local
      const expectedMerged = { ...mcpBaseTargetConfig, ...mcpLocalConfig };

      // Act
      await mergeConfigFiles({
        vscodeFileUri: mcpCursorFileUri,
        sharedFileUri: mcpCursorSharedUri,
        localFileUri: mcpCursorLocalUri,
        ...callbacks,
      });

      // Assert
      Sinon.assert.calledWith(logInfoStub, `Updating config in ${mcpCursorFileUri.fsPath}`);
      Sinon.assert.calledOnceWithExactly(
        writeFileStub,
        mcpCursorFileUri,
        Buffer.from(JSON.stringify(expectedMerged, null, 2)),
        { create: true, overwrite: true }
      );
    });

    // --- End of MCP Tests ---

  });
});
