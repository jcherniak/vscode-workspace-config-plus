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

    joinPathStub.withArgs(testFolderUri, '.vscode').returns(vscodeDirUri);
    joinPathStub.withArgs(testFolderUri, '.cursor').returns(cursorDirUri);
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

    const setupRelativePattern = (dirUri, localName, sharedName, patternResult) => {
       createRelativePatternStub
        .withArgs(dirUri, `{${localName},${sharedName}}`)
        .returns(patternResult);
    };

    const assertGenerateWatcherCall = (pattern, folderUri, targetUri, sharedUri, localUri) => {
      Sinon.assert.calledWithMatch(
        generateFileSystemWatcherStub,
        {
          globPattern: pattern,
          folderUri,
          vscodeFileUri: targetUri,
          sharedFileUri: sharedUri,
          localFileUri: localUri,
          createFileSystemWatcher: Sinon.match.func,
          readFile: Sinon.match.func,
          writeFile: Sinon.match.func,
        }
      );
    };

    const assertMergeFilesCall = (targetUri, sharedUri, localUri) => {
      Sinon.assert.calledWithMatch(
        mergeConfigFilesStub,
        {
          vscodeFileUri: targetUri,
          sharedFileUri: sharedUri,
          localFileUri: localUri,
          readFile: Sinon.match.func,
          writeFile: Sinon.match.func,
        }
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
      setupRelativePattern(cursorDirUri, 'settings.local.json', 'settings.shared.json', { pattern: 'cursor-settings-pattern' });
      setupJoinPathForFile(cursorDirUri, 'launch', launchCursorFileUri, launchCursorSharedUri, launchCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'launch.local.json', 'launch.shared.json', { pattern: 'cursor-launch-pattern' });
      setupJoinPathForFile(cursorDirUri, 'tasks', tasksCursorFileUri, tasksCursorSharedUri, tasksCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'tasks.local.json', 'tasks.shared.json', { pattern: 'cursor-tasks-pattern' });
      setupJoinPathForFile(cursorDirUri, 'mcp', mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      setupRelativePattern(cursorDirUri, 'mcp.local.json', 'mcp.shared.json', { pattern: 'cursor-mcp-pattern' });

      setupJoinPathForFile(vscodeDirUri, 'settings', settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'settings.local.json', 'settings.shared.json', { pattern: 'vscode-settings-pattern' });
      setupJoinPathForFile(vscodeDirUri, 'launch', launchVscodeFileUri, launchVscodeSharedUri, launchVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'launch.local.json', 'launch.shared.json', { pattern: 'vscode-launch-pattern' });
      setupJoinPathForFile(vscodeDirUri, 'tasks', tasksVscodeFileUri, tasksVscodeSharedUri, tasksVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'tasks.local.json', 'tasks.shared.json', { pattern: 'vscode-tasks-pattern' });
      setupJoinPathForFile(vscodeDirUri, 'mcp', mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      setupRelativePattern(vscodeDirUri, 'mcp.local.json', 'mcp.shared.json', { pattern: 'vscode-mcp-pattern' });

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
      setupRelativePattern(vscodeDirUri, 'settings.local.json', 'settings.shared.json', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      const expectedCallCount = 4;
      assert.deepEqual(generateFileSystemWatcherStub.callCount, expectedCallCount);
      assert.deepEqual(mergeConfigFilesStub.callCount, expectedCallCount);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${vscodeDirUri.fsPath}`);

      assertGenerateWatcherCall(pattern, testFolderUri, settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri);
      assertMergeFilesCall(settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri);
    });

    test('Should initialize mcp.json correctly using .cursor (when preferred)', async () => {
      statStub.withArgs(cursorDirUri).resolves({ type: 2 });
      setupJoinPathForFile(cursorDirUri, 'mcp', mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      const pattern = { pattern: 'cursor-mcp-pattern' };
      setupRelativePattern(cursorDirUri, 'mcp.local.json', 'mcp.shared.json', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      assertGenerateWatcherCall(pattern, testFolderUri, mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      assertMergeFilesCall(mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${cursorDirUri.fsPath}`);
    });

    test('Should initialize mcp.json correctly using .vscode (when .cursor absent)', async () => {
      statStub.withArgs(cursorDirUri).rejects({ code: 'ENOENT' });
      statStub.withArgs(vscodeDirUri).resolves({ type: 2 });

      setupJoinPathForFile(vscodeDirUri, 'mcp', mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      const pattern = { pattern: 'vscode-mcp-pattern' };
      setupRelativePattern(vscodeDirUri, 'mcp.local.json', 'mcp.shared.json', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      assertGenerateWatcherCall(pattern, testFolderUri, mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      assertMergeFilesCall(mcpVscodeFileUri, mcpVscodeSharedUri, mcpVscodeLocalUri);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${vscodeDirUri.fsPath}`);
    });

    test('Should initialize settings.json correctly using .cursor (when preferred)', async () => {
      statStub.withArgs(cursorDirUri).resolves({ type: 2 });
      setupJoinPathForFile(cursorDirUri, 'settings', settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri);
      const pattern = { pattern: 'cursor-settings-pattern' };
      setupRelativePattern(cursorDirUri, 'settings.local.json', 'settings.shared.json', pattern);

      await lib.initializeWorkspaceFolder({ folderUri: testFolderUri, ...callbacks });

      assertGenerateWatcherCall(pattern, testFolderUri, settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri);
      assertMergeFilesCall(settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri);
      Sinon.assert.calledWith(logInfoStub, `Using configuration directory: ${cursorDirUri.fsPath}`);
    });
  });
});
