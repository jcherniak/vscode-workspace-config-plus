'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');

const {
  callbacks,
  // Import specific URIs needed
  vscodeDirUri, cursorDirUri,
  settingsVscodeFileUri, settingsVscodeSharedUri, settingsVscodeLocalUri,
  settingsCursorFileUri, settingsCursorSharedUri, settingsCursorLocalUri,
  mcpCursorFileUri, mcpCursorSharedUri, mcpCursorLocalUri
} = require('../data');
const fileHandler = require('../../src/file-handler');
const watcher = require('../../src/watcher');

suite('watcher Suite', () => {
  const firstWatcher = { dispose: () => null };
  const secondWatcher = { dispose: () => null };
  const thirdWatcher = { dispose: () => null };
  const fourthWatcher = { dispose: () => null };

  /** @type {Sinon.SinonStub} */
  let firstWatcherDisposeStub;
  /** @type {Sinon.SinonStub} */
  let secondWatcherDisposeStub;
  /** @type {Sinon.SinonStub} */
  let thirdWatcherDisposeStub;
  /** @type {Sinon.SinonStub} */
  let fourthWatcherDisposeStub;

  setup(() => {
    // Reset watchers map for each test
    watcher._fileSystemWatchers = {};
    // Example watchers for disposal tests
    watcher._fileSystemWatchers['first'] = [firstWatcher, secondWatcher];
    watcher._fileSystemWatchers['second'] = [thirdWatcher, fourthWatcher];

    firstWatcherDisposeStub = Sinon.stub(firstWatcher, 'dispose');
    secondWatcherDisposeStub = Sinon.stub(secondWatcher, 'dispose');
    thirdWatcherDisposeStub = Sinon.stub(thirdWatcher, 'dispose');
    fourthWatcherDisposeStub = Sinon.stub(fourthWatcher, 'dispose');
  });

  teardown(() => {
    Sinon.restore();
  });

  suite('generateFileSystemWatcher Suite', () => {
    /** @type {Sinon.SinonFakeTimers} */
    let clock;
    /** @type {Sinon.SinonStub} */
    let registerSharedFileSystemWatcherStub;
    /** @type {Sinon.SinonStub} */
    let mergeFilesStub;
    const initialTime = 1629162959014; // Keep sample time
    const { generateFileSystemWatcher } = watcher;

    // Define a sample glob pattern object (as created by createRelativePattern)
    const sampleGlobPattern = { pattern: '{*.local.json,*.shared.json}' };
    // Use a consistent folderUri (representing the workspace folder root)
    const workspaceFolderUri = 'my-project';

    // --- Args object for a test case using .cursor and mcp files ---
    const argsCursorMcp = {
      ...callbacks, // Include readFile, writeFile, createFileSystemWatcher etc.
      globPattern: sampleGlobPattern, // The pattern generated for the active dir
      folderUri: workspaceFolderUri,  // Root workspace folder URI
      // URIs passed based on active dir (.cursor) and file type (mcp)
      vscodeFileUri: mcpCursorFileUri, // Target file URI
      sharedFileUri: mcpCursorSharedUri,
      localFileUri: mcpCursorLocalUri,
    };
    let handleFileEvent; // To capture the internal callback

    setup(() => {
      clock = Sinon.useFakeTimers();
      clock.tick(initialTime);
      // Stub the internal registration function
      registerSharedFileSystemWatcherStub = Sinon.stub(
        watcher,
        '_registerSharedFileSystemWatcher'
      ).callsFake((_glob, _createWatcherFn, _folderUri, callbackFn) => {
        // Capture the event handler callback passed to the internal function
        handleFileEvent = callbackFn;
      });
      mergeFilesStub = Sinon.stub(fileHandler, 'mergeConfigFiles').resolves();
    });

    teardown(() => {
      handleFileEvent = null;
      clock.restore(); // Restore clock
    });

    test('Should call mergeConfigFiles on file event', async () => {
      generateFileSystemWatcher(argsCursorMcp);
      // Simulate an event for the shared file
      await handleFileEvent(argsCursorMcp.sharedFileUri);
      Sinon.assert.calledOnce(mergeFilesStub);
      Sinon.assert.calledWithMatch(mergeFilesStub, {
        vscodeFileUri: argsCursorMcp.vscodeFileUri, // Check target URI
        sharedFileUri: argsCursorMcp.sharedFileUri,
        localFileUri: argsCursorMcp.localFileUri,
      });
    });

    test('Should not merge twice on duplicate events in rapid succession', async () => {
      generateFileSystemWatcher(argsCursorMcp);
      await handleFileEvent(argsCursorMcp.sharedFileUri);
      clock.tick(349); // Advance time less than threshold
      await handleFileEvent(argsCursorMcp.sharedFileUri);
      Sinon.assert.calledOnce(mergeFilesStub);
    });

    test('Should merge again if same file event happens outside the cache boundary', async () => {
      generateFileSystemWatcher(argsCursorMcp);
      await handleFileEvent(argsCursorMcp.localFileUri);
      clock.tick(351); // Advance time more than threshold
      await handleFileEvent(argsCursorMcp.localFileUri);
      Sinon.assert.calledTwice(mergeFilesStub);
    });

    test('Should call internal register function correctly', () => {
       generateFileSystemWatcher(argsCursorMcp);
       Sinon.assert.calledOnce(registerSharedFileSystemWatcherStub);
       const callArgs = registerSharedFileSystemWatcherStub.firstCall.args;

       // Assert arguments passed to _registerSharedFileSystemWatcher:
       assert.deepEqual(callArgs[0], argsCursorMcp.globPattern, 'Arg 0: globPattern');
       assert.strictEqual(callArgs[1], argsCursorMcp.createFileSystemWatcher, 'Arg 1: createFileSystemWatcher function');
       assert.strictEqual(callArgs[2], argsCursorMcp.folderUri, 'Arg 2: workspace folderUri');
       assert.isFunction(callArgs[3], 'Arg 3: handleFileEvent callback');
    });
  });

  suite('_registerSharedFileSystemWatcher Suite', () => {
    /** @type {Sinon.SinonStub} */
    let createFileSystemWatcherStub;
    /** @type {Sinon.SinonStub} */
    let onDidChangeStub;
    /** @type {Sinon.SinonStub} */
    let onDidCreateStub;
    /** @type {Sinon.SinonStub} */
    let onDidDeleteStub;

    const mockWatcherInstance = {
      onDidChange: () => null,
      onDidCreate: () => null,
      onDidDelete: () => null,
    };
    // Use a representative directory URI from test data
    const testDirUri = cursorDirUri;
    const testPattern = { pattern: '{*.local,*.shared}.json' };
    const handleEventCallback = Sinon.spy(); // Use a spy for the callback

    // Mock disposables returned by event listeners
    const disposableChange = { dispose: Sinon.spy() };
    const disposableCreate = { dispose: Sinon.spy() };
    const disposableDelete = { dispose: Sinon.spy() };

    setup(() => {
      // Stub the actual VS Code API wrapper
      createFileSystemWatcherStub = Sinon.stub(
        callbacks, // Stub the function within the callbacks object
        'createFileSystemWatcher'
      )
        .withArgs(testPattern) // Expect it to be called with the pattern
        .returns(mockWatcherInstance); // Return our mock watcher

      // Stub the event listener registration methods
      onDidChangeStub = Sinon.stub(mockWatcherInstance, 'onDidChange').returns(disposableChange);
      onDidCreateStub = Sinon.stub(mockWatcherInstance, 'onDidCreate').returns(disposableCreate);
      onDidDeleteStub = Sinon.stub(mockWatcherInstance, 'onDidDelete').returns(disposableDelete);

      // Reset the callback spy and internal watcher map
      handleEventCallback.resetHistory();
      watcher._fileSystemWatchers = {};
    });

    test('Should create watcher and subscribe to events', () => {
      watcher._registerSharedFileSystemWatcher(
        testPattern,
        callbacks.createFileSystemWatcher,
        testDirUri.uri, // Pass the URI string from the test data object
        handleEventCallback
      );

      // Verify createFileSystemWatcher was called
      Sinon.assert.calledOnceWithExactly(createFileSystemWatcherStub, testPattern);

      // Verify event subscriptions
      Sinon.assert.calledOnceWithExactly(onDidChangeStub, handleEventCallback);
      Sinon.assert.calledOnceWithExactly(onDidCreateStub, handleEventCallback);
      Sinon.assert.calledOnceWithExactly(onDidDeleteStub, handleEventCallback);
    });

    test('Should store disposables under the provided folder URI', () => {
      watcher._registerSharedFileSystemWatcher(
        testPattern,
        callbacks.createFileSystemWatcher,
        testDirUri.uri, // Pass the URI string
        handleEventCallback
      );

      // Check if the disposables are stored correctly in the internal map
      assert.exists(watcher._fileSystemWatchers[testDirUri.uri]);
      assert.deepEqual(watcher._fileSystemWatchers[testDirUri.uri], [
        disposableChange,
        disposableCreate,
        disposableDelete,
      ]);
    });
  });

  suite('disposeAllWatchers Suite', () => {
    test('Should invoke dispose on all watcher disposables', () => {
      watcher.disposeAllWatchers();
      assert.isTrue(firstWatcherDisposeStub.calledOnce);
      assert.isTrue(secondWatcherDisposeStub.calledOnce);
      assert.isTrue(thirdWatcherDisposeStub.calledOnce);
      assert.isTrue(fourthWatcherDisposeStub.calledOnce);
    });
  });

  suite('disposeWorkspaceWatcher Suite', () => {
    test('Should invoke dispose on all disposables for workspace', () => {
      watcher.disposeWorkspaceWatcher('first');
      assert.isTrue(firstWatcherDisposeStub.calledOnce);
      assert.isTrue(secondWatcherDisposeStub.calledOnce);
      assert.isFalse(thirdWatcherDisposeStub.calledOnce);
      assert.isFalse(fourthWatcherDisposeStub.calledOnce);
    });
  });
});
