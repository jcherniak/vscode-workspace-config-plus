'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');

const fileHandler = require('../../src/file-handler');
const lib = require('../../src/lib');
const log = require('../../src/log');
const {
  callbacks: dataCallbacks,
  vscodeDirUri,
  cursorDirUri,
  settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri,
  launchVscodeFileUri, launchVscodeSharedUri, launchVscodeLocalUri,
  tasksVscodeFileUri, tasksVscodeSharedUri, tasksVscodeLocalUri,
  mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri,
  settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri,
  launchCursorFileUri, launchCursorSharedUri, launchCursorLocalUri,
  tasksCursorFileUri, tasksCursorSharedUri, tasksCursorLocalUri,
  mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri,
  claudeDirUri, codexDirUri, geminiDirUri, sharedMcpDirUri,
  settingsClaude, mcpClaude, workspaceMcpFileUri,
} = require('../data');
const watcher = require('../../src/watcher');

suite('lib Suite', () => {
  let generateFileSystemWatcherStub;
  let mergeConfigFilesStub;
  let joinPathStub;
  let createRelativePatternStub;
  let statStub;
  let logInfoStub;
  let logDebugStub;

  const testFolderUri = 'foo';
  let callbacks;

  setup(() => {
    callbacks = { ...dataCallbacks };
    generateFileSystemWatcherStub = Sinon.stub(watcher, 'generateFileSystemWatcher');
    mergeConfigFilesStub = Sinon.stub(fileHandler, 'mergeConfigFiles');
    joinPathStub = Sinon.stub(callbacks, 'joinPath');
    createRelativePatternStub = Sinon.stub(callbacks, 'createRelativePattern');
    statStub = Sinon.stub(callbacks, 'stat');
    logInfoStub = Sinon.stub(log, 'info');
    logDebugStub = Sinon.stub(log, 'debug');

    statStub.withArgs(cursorDirUri).resolves({ type: 2 });
    statStub.withArgs(vscodeDirUri).resolves({ type: 2 });
    statStub.withArgs(claudeDirUri).rejects({ code: 'ENOENT' });
    statStub.withArgs(codexDirUri).rejects({ code: 'ENOENT' });
    statStub.withArgs(geminiDirUri).rejects({ code: 'ENOENT' });
    statStub.withArgs(sharedMcpDirUri).rejects({ code: 'ENOENT' });

    joinPathStub.withArgs(testFolderUri, '.vscode').returns(vscodeDirUri);
    joinPathStub.withArgs(testFolderUri, '.cursor').returns(cursorDirUri);
    joinPathStub.withArgs(testFolderUri, '.claude').returns(claudeDirUri);
    joinPathStub.withArgs(testFolderUri, '.codex').returns(codexDirUri);
    joinPathStub.withArgs(testFolderUri, '.gemini').returns(geminiDirUri);
    joinPathStub.withArgs(testFolderUri, '.mcp').returns(sharedMcpDirUri);
  });

  teardown(() => {
    Sinon.restore();
  });

  suite('deactivate Suite', () => {
    test('Should handle deactivation correctly', () => {
      const logDisposeStub = Sinon.stub(log, 'dispose');
      const disposeAllWatchersStub = Sinon.stub(watcher, 'disposeAllWatchers');
      logInfoStub.resetHistory();
      lib.deactivate();
      assert.isTrue(
        logInfoStub.calledOnceWithExactly(
          'Deactivating and disposing all watchers'
        )
      );
      assert.isTrue(disposeAllWatchersStub.calledOnce);
      assert.isTrue(logDisposeStub.calledOnce);
    });
  });

  suite('handleWorkspaceFolderUpdates Suite', () => {
    let initializeWorkspaceFolderStub;
    let disposeWorkspaceWatcherStub;

    setup(() => {
      initializeWorkspaceFolderStub = Sinon.stub(
        lib,
        'initializeWorkspaceFolder'
      );
      disposeWorkspaceWatcherStub = Sinon.stub(
        watcher,
        'disposeWorkspaceWatcher'
      );
    });

    test('Should handle falsy value for added folders', () => {
      lib.handleWorkspaceFolderUpdates({});
      assert.isFalse(initializeWorkspaceFolderStub.called);
    });

    test('Should handle non-array value for added folders', () => {
      lib.handleWorkspaceFolderUpdates({ added: 7 });
      assert.isFalse(initializeWorkspaceFolderStub.called);
    });

    test('Should properly initialize added folders', () => {
      const added = [{ uri: 'foo/bar' }, { uri: 'baz/qux' }];
      lib.handleWorkspaceFolderUpdates({
        added,
        ...callbacks,
      });
      assert.deepInclude(initializeWorkspaceFolderStub.firstCall.firstArg, {
        folderUri: added[0].uri,
        stat: callbacks.stat,
        readDirectory: callbacks.readDirectory,
      });
      assert.isFunction(initializeWorkspaceFolderStub.firstCall.firstArg.stat);
    });

    test('Should handle falsy value for removed folders', () => {
      lib.handleWorkspaceFolderUpdates({});
      assert.isFalse(disposeWorkspaceWatcherStub.called);
    });

    test('Should handle non-array value for removed folders', () => {
      lib.handleWorkspaceFolderUpdates({ removed: 'why' });
      assert.isFalse(initializeWorkspaceFolderStub.called);
    });

    test('Should properly handle removed folders', () => {
      const removed = [{ uri: 'bar/foo' }, { uri: 'qux/baz' }];
      lib.handleWorkspaceFolderUpdates({ removed });
      assert.isTrue(disposeWorkspaceWatcherStub.calledTwice);
      assert.isTrue(
        disposeWorkspaceWatcherStub.calledWithExactly(removed[0].uri)
      );
      assert.isTrue(
        disposeWorkspaceWatcherStub.calledWithExactly(removed[1].uri)
      );
    });
  });

  suite('initializeLog Suite', () => {
    test('Should initialize log correctly', () => {
      const createOutputChannel = () => {
        return 7;
      };
      const logInitializeStub = Sinon.stub(log, 'initialize');
      lib.initializeLog(createOutputChannel);
      assert.isTrue(
        logInitializeStub.calledOnceWithExactly(createOutputChannel)
      );
    });
  });

  suite('initializeWorkspaceFolder Suite', () => {

    const setupJoinPathForFile = (dirUri, baseName, targetUri, sharedUri, localUri) => {
      joinPathStub.withArgs(dirUri, `${baseName}.json`).returns(targetUri);
      joinPathStub.withArgs(dirUri, `${baseName}.shared.json`).returns(sharedUri);
      joinPathStub.withArgs(dirUri, `${baseName}.local.json`).returns(localUri);
    };

    const setupRelativePattern = (dirUri, baseName, patternResult) => {
      createRelativePatternStub
        .withArgs(dirUri, `{${baseName}.local.json,${baseName}.shared.json,${baseName}.generator.*.*.js}`)
        .returns(patternResult);
    };

    const assertGenerateWatcherCall = (
      pattern,
      folderUri,
      configDirUri,
      configBaseName,
      targetUri,
      sharedUri,
      localUri,
    ) => {
      Sinon.assert.calledWithMatch(
        generateFileSystemWatcherStub,
        {
          globPattern: pattern,
          mergeArgs: Sinon.match(
            m =>
              m.folderUri === folderUri &&
              m.vscodeFileUri === targetUri &&
              m.sharedFileUri === sharedUri &&
              m.localFileUri === localUri &&
              m.workspaceFolderUri === folderUri &&
              m.configDirUri === configDirUri &&
              m.configFileBaseName === configBaseName &&
              typeof m.readFile === 'function' &&
              typeof m.writeFile === 'function' &&
              typeof m.joinPath === 'function' &&
              typeof m.readDirectory === 'function',
          ),
          createFileSystemWatcher: Sinon.match.func,
        }
      );
    };

    const assertMergeFilesCall = (
      targetUri,
      sharedUri,
      localUri,
      configDirUri,
      configBaseName,
    ) => {
      Sinon.assert.calledWithMatch(
        mergeConfigFilesStub,
        Sinon.match(
          m =>
            m.folderUri === testFolderUri &&
            m.vscodeFileUri === targetUri &&
            m.sharedFileUri === sharedUri &&
            m.localFileUri === localUri &&
            m.workspaceFolderUri === testFolderUri &&
            m.configDirUri === configDirUri &&
            m.configFileBaseName === configBaseName &&
            typeof m.readFile === 'function' &&
            typeof m.writeFile === 'function' &&
            typeof m.joinPath === 'function' &&
            typeof m.readDirectory === 'function',
        ),
      );
    };

    test('Should do nothing if neither .cursor nor .vscode exists', async () => {
      statStub.withArgs(cursorDirUri).rejects({ code: 'ENOENT' });
      statStub.withArgs(vscodeDirUri).rejects({ code: 'ENOENT' });

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      Sinon.assert.notCalled(generateFileSystemWatcherStub);
      Sinon.assert.notCalled(mergeConfigFilesStub);
      Sinon.assert.calledWith(logInfoStub, Sinon.match(/No configuration directory found/));
    });

    test('Should use .cursor and .vscode when both exist', async () => {
      statStub.withArgs(cursorDirUri).resolves({ type: 2 });
      statStub.withArgs(vscodeDirUri).resolves({ type: 2 });

      setupJoinPathForFile(cursorDirUri, 'settings', settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'settings', { pattern: 'cursor-settings-pattern' });
      setupJoinPathForFile(cursorDirUri, 'launch', launchCursorFileUri, launchCursorSharedUri, launchCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'launch', { pattern: 'cursor-launch-pattern' });
      setupJoinPathForFile(cursorDirUri, 'tasks', tasksCursorFileUri, tasksCursorSharedUri, tasksCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'tasks', { pattern: 'cursor-tasks-pattern' });
      setupJoinPathForFile(cursorDirUri, 'mcp', mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'mcp', { pattern: 'cursor-mcp-pattern' });

      setupJoinPathForFile(vscodeDirUri, 'settings', settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'settings', { pattern: 'vscode-settings-pattern' });
      setupJoinPathForFile(vscodeDirUri, 'launch', launchVscodeFileUri, launchVscodeSharedUri, launchVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'launch', { pattern: 'vscode-launch-pattern' });
      setupJoinPathForFile(vscodeDirUri, 'tasks', tasksVscodeFileUri, tasksVscodeSharedUri, tasksVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'tasks', { pattern: 'vscode-tasks-pattern' });
      setupJoinPathForFile(vscodeDirUri, 'mcp', mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'mcp', { pattern: 'vscode-mcp-pattern' });

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      const expectedCallCount = 8;
      assert.deepEqual(generateFileSystemWatcherStub.callCount, expectedCallCount);
      assert.deepEqual(mergeConfigFilesStub.callCount, expectedCallCount);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${cursorDirUri.fsPath}`);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${vscodeDirUri.fsPath}`);
    });

    test('Should use .vscode if only .vscode exists', async () => {
      statStub.withArgs(cursorDirUri).rejects({ code: 'ENOENT' });
      statStub.withArgs(vscodeDirUri).resolves({ type: 2 });

      setupJoinPathForFile(vscodeDirUri, 'settings', settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri);
      const pattern = { pattern: 'vscode-settings-pattern' };
      setupRelativePattern(vscodeDirUri, 'settings', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      const expectedCallCount = 4;
      assert.deepEqual(generateFileSystemWatcherStub.callCount, expectedCallCount);
      assert.deepEqual(mergeConfigFilesStub.callCount, expectedCallCount);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${vscodeDirUri.fsPath}`);

      assertGenerateWatcherCall(pattern, testFolderUri, vscodeDirUri, 'settings', settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri);
      assertMergeFilesCall(settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri, vscodeDirUri, 'settings');
    });

    test('Should initialize mcp.json correctly using .cursor (when preferred)', async () => {
      statStub.withArgs(cursorDirUri).resolves({ type: 2 });
      setupJoinPathForFile(cursorDirUri, 'mcp', mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      const pattern = { pattern: 'cursor-mcp-pattern' };
      setupRelativePattern(cursorDirUri, 'mcp', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      assertGenerateWatcherCall(pattern, testFolderUri, cursorDirUri, 'mcp', mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      assertMergeFilesCall(mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri, cursorDirUri, 'mcp');
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${cursorDirUri.fsPath}`);
    });

    test('Should initialize mcp.json correctly using .vscode (when .cursor absent)', async () => {
      statStub.withArgs(cursorDirUri).rejects({ code: 'ENOENT' });
      statStub.withArgs(vscodeDirUri).resolves({ type: 2 });

      setupJoinPathForFile(vscodeDirUri, 'mcp', mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      const pattern = { pattern: 'vscode-mcp-pattern' };
      setupRelativePattern(vscodeDirUri, 'mcp', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      assertGenerateWatcherCall(pattern, testFolderUri, vscodeDirUri, 'mcp', mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      assertMergeFilesCall(mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri, vscodeDirUri, 'mcp');
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${vscodeDirUri.fsPath}`);
    });

    test('Should initialize settings.json correctly using .cursor (when preferred)', async () => {
      statStub.withArgs(cursorDirUri).resolves({ type: 2 });
      setupJoinPathForFile(cursorDirUri, 'settings', settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri);
      const pattern = { pattern: 'cursor-settings-pattern' };
      setupRelativePattern(cursorDirUri, 'settings', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      assertGenerateWatcherCall(pattern, testFolderUri, cursorDirUri, 'settings', settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri);
      assertMergeFilesCall(settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri, cursorDirUri, 'settings');
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${cursorDirUri.fsPath}`);
    });

    suite('.claude special-casing', () => {
      setup(() => {
        statStub.withArgs(cursorDirUri).rejects({ code: 'ENOENT' });
        statStub.withArgs(vscodeDirUri).rejects({ code: 'ENOENT' });
        statStub.withArgs(claudeDirUri).resolves({ type: 2 });
      });

      test('settings: maps shared+personal -> .claude/settings.local.json', async () => {
        joinPathStub.withArgs(claudeDirUri, 'settings.shared.json').returns(settingsClaude.sharedUri);
        joinPathStub.withArgs(claudeDirUri, 'settings.personal.json').returns(settingsClaude.personalUri);
        joinPathStub.withArgs(claudeDirUri, 'settings.local.json').returns(settingsClaude.localUri);
        const pattern = { pattern: 'claude-settings-pattern' };
        createRelativePatternStub
          .withArgs(claudeDirUri, '{settings.personal.json,settings.shared.json,settings.generator.*.*.js}')
          .returns(pattern);

        await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

        Sinon.assert.calledWithMatch(
          generateFileSystemWatcherStub,
          {
            globPattern: pattern,
            mergeArgs: Sinon.match(
              m =>
                m.vscodeFileUri === settingsClaude.localUri &&
                m.sharedFileUri === settingsClaude.sharedUri &&
                m.localFileUri === settingsClaude.personalUri &&
                m.configDirUri === claudeDirUri &&
                m.configFileBaseName === 'settings'
            ),
          }
        );
      });

      test('mcp: maps shared+local -> workspace-root /.mcp.json', async () => {
        joinPathStub.withArgs(claudeDirUri, 'mcp.shared.json').returns(mcpClaude.sharedUri);
        joinPathStub.withArgs(claudeDirUri, 'mcp.local.json').returns(mcpClaude.localUri);
        joinPathStub.withArgs(testFolderUri, '.mcp.json').returns(workspaceMcpFileUri);
        const pattern = { pattern: 'claude-mcp-pattern' };
        createRelativePatternStub
          .withArgs(claudeDirUri, '{mcp.local.json,mcp.shared.json,mcp.generator.*.*.js}')
          .returns(pattern);

        await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

        Sinon.assert.calledWithMatch(
          generateFileSystemWatcherStub,
          {
            globPattern: pattern,
            mergeArgs: Sinon.match(
              m =>
                m.vscodeFileUri === workspaceMcpFileUri &&
                m.sharedFileUri === mcpClaude.sharedUri &&
                m.localFileUri === mcpClaude.localUri &&
                m.configDirUri === claudeDirUri &&
                m.configFileBaseName === 'mcp'
            ),
          }
        );
      });

      test('launch and tasks are skipped (no watcher, no merge)', async () => {
        joinPathStub.withArgs(claudeDirUri, 'settings.shared.json').returns(settingsClaude.sharedUri);
        joinPathStub.withArgs(claudeDirUri, 'settings.personal.json').returns(settingsClaude.personalUri);
        joinPathStub.withArgs(claudeDirUri, 'settings.local.json').returns(settingsClaude.localUri);
        joinPathStub.withArgs(claudeDirUri, 'mcp.shared.json').returns(mcpClaude.sharedUri);
        joinPathStub.withArgs(claudeDirUri, 'mcp.local.json').returns(mcpClaude.localUri);
        joinPathStub.withArgs(testFolderUri, '.mcp.json').returns(workspaceMcpFileUri);
        createRelativePatternStub.returns({ pattern: 'p' });

        await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

        const baseNames = mergeConfigFilesStub.getCalls().map(c => c.args[0].configFileBaseName);
        assert.deepEqual(baseNames.sort(), ['mcp', 'settings']);
      });
    });
  });
});
