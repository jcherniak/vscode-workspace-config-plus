'use strict';

const { assert } = require('chai');
const Sinon = require('sinon');

const gitignoreCheck = require('../../src/gitignore-check');
const log = require('../../src/log');

const workspaceRootUri = { fsPath: '/work', uri: '/work' };
const targetFileUri = { fsPath: '/work/.mcp.json', uri: '/work/.mcp.json' };
const gitignoreUri = { fsPath: '/work/.gitignore', uri: '/work/.gitignore' };

const baseDeps = () => {
  const joinPath = (base, name) => {
    if (base === workspaceRootUri && name === '.gitignore') return gitignoreUri;
    return { fsPath: `${base.fsPath}/${name}`, uri: `${base.fsPath}/${name}` };
  };
  return { joinPath };
};

suite('gitignore-check Suite', () => {
  setup(() => {
    Sinon.stub(log, 'info');
    Sinon.stub(log, 'error');
    Sinon.stub(log, 'debug');
    Sinon.stub(log, 'warn');
  });
  teardown(() => Sinon.restore());

  suite('warnIfTargetNotIgnored', () => {
    test('does nothing when target is already gitignored', async () => {
      const readFile = Sinon.stub().resolves(Buffer.from('.mcp.json\n'));
      const showWarningMessage = Sinon.stub().resolves(undefined);
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
      });
      Sinon.assert.notCalled(showWarningMessage);
    });

    test('shows warning when target is not ignored', async () => {
      const readFile = Sinon.stub().resolves(Buffer.from('node_modules\n'));
      const showWarningMessage = Sinon.stub().resolves(undefined);
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
      });
      Sinon.assert.calledOnce(showWarningMessage);
      const [msg] = showWarningMessage.firstCall.args;
      assert.match(msg, /\.mcp\.json/);
    });

    test('treats missing .gitignore as no rules and warns', async () => {
      const readFile = Sinon.stub().rejects({ code: 'ENOENT' });
      const showWarningMessage = Sinon.stub().resolves(undefined);
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
      });
      Sinon.assert.calledOnce(showWarningMessage);
    });

    test('appends path to .gitignore when user chooses Add', async () => {
      const readFile = Sinon.stub().resolves(Buffer.from('node_modules\n'));
      const writeFile = Sinon.stub().resolves();
      const showWarningMessage = Sinon.stub().resolves('Add to .gitignore');
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        writeFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
      });
      Sinon.assert.calledOnce(writeFile);
      const [uri, buf] = writeFile.firstCall.args;
      assert.equal(uri, gitignoreUri);
      assert.include(buf.toString(), '.mcp.json');
    });

    test('persists suppression when user chooses Don\'t warn', async () => {
      const readFile = Sinon.stub().resolves(Buffer.from(''));
      const showWarningMessage = Sinon.stub().resolves("Don't warn for this file");
      const workspaceState = {
        get: Sinon.stub().returns([]),
        update: Sinon.stub().resolves(),
      };
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
        workspaceState,
      });
      Sinon.assert.calledOnce(workspaceState.update);
      const [key, value] = workspaceState.update.firstCall.args;
      assert.equal(key, gitignoreCheck._suppressionStateKey);
      assert.deepEqual(value, ['.mcp.json']);
    });

    test('skips when relPath is in suppression list', async () => {
      const readFile = Sinon.stub();
      const showWarningMessage = Sinon.stub();
      const workspaceState = {
        get: Sinon.stub().returns(['.mcp.json']),
        update: Sinon.stub(),
      };
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
        workspaceState,
      });
      Sinon.assert.notCalled(readFile);
      Sinon.assert.notCalled(showWarningMessage);
    });

    test('respects gitignoreWarning=silent setting', async () => {
      const readFile = Sinon.stub();
      const showWarningMessage = Sinon.stub();
      const getConfiguration = Sinon.stub().returns({
        get: Sinon.stub().returns('silent'),
      });
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
        getConfiguration,
      });
      Sinon.assert.notCalled(readFile);
      Sinon.assert.notCalled(showWarningMessage);
    });

    test('does nothing if showWarningMessage is not a function', async () => {
      const readFile = Sinon.stub();
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri,
        readFile,
        joinPath: baseDeps().joinPath,
      });
      Sinon.assert.notCalled(readFile);
    });

    test('skips when target resolves outside workspace', async () => {
      const readFile = Sinon.stub();
      const showWarningMessage = Sinon.stub();
      await gitignoreCheck.warnIfTargetNotIgnored({
        workspaceRootUri,
        targetFileUri: { fsPath: '/elsewhere/.mcp.json' },
        readFile,
        joinPath: baseDeps().joinPath,
        showWarningMessage,
      });
      Sinon.assert.notCalled(showWarningMessage);
    });
  });

  suite('_isIgnored helper', () => {
    test('matches glob patterns from gitignore', () => {
      assert.isTrue(gitignoreCheck._isIgnored('*.json\n', '.mcp.json'));
      assert.isTrue(gitignoreCheck._isIgnored('.mcp.json', '.mcp.json'));
      assert.isFalse(gitignoreCheck._isIgnored('node_modules\n', '.mcp.json'));
    });
  });

  suite('_toPosixRelative helper', () => {
    test('converts to forward-slash relative path', () => {
      const rel = gitignoreCheck._toPosixRelative('/work', '/work/sub/file.json');
      assert.equal(rel, 'sub/file.json');
    });
  });
});
