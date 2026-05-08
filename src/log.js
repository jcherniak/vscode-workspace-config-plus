'use strict';

// Two sink modes:
//  - VSCode mode: write into a vscode.OutputChannel (initialized via initialize()).
//  - CLI / console mode: write to stderr with a plain prefix (set via initializeConsole()).
//
// Tests mostly stub the four level functions directly (Sinon.stub(log, 'info') etc.)
// and don't care about the sink, so adding the console sink is non-breaking.

let _consoleSink = false;
let _consoleSilent = false;

const _stamp = () => new Date().toLocaleString('sv');

const write = (msg, logLevel) => {
  if (_consoleSink) {
    if (_consoleSilent && logLevel !== 'ERROR' && logLevel !== 'WARN') {
      return;
    }
    const stream = logLevel === 'ERROR' || logLevel === 'WARN' ? process.stderr : process.stdout;
    stream.write(`[${_stamp()}] [${logLevel}] ${msg}\n`);
    return;
  }
  if (module.exports._outputChannel) {
    module.exports._outputChannel.appendLine(
      `[${_stamp()}] [${logLevel}] ${msg}`
    );
  }
};

const debug = msg => {
  write(msg, 'DEBUG');
};

const error = msg => {
  write(msg, 'ERROR');
};

const info = msg => {
  write(msg, 'INFO');
};

const warn = msg => {
  write(msg, 'WARN');
};

const initialize = createChannel => {
  _consoleSink = false;
  module.exports._outputChannel = createChannel('Workspace Config+');
};

// CLI-mode initializer. `silent` suppresses INFO/DEBUG (only ERROR/WARN reach stderr),
// matching the `wcp run --silent` flag used by hooks.
const initializeConsole = ({ silent = false } = {}) => {
  _consoleSink = true;
  _consoleSilent = Boolean(silent);
  module.exports._outputChannel = undefined;
};

const dispose = () => {
  if (_consoleSink) {
    _consoleSink = false;
    return;
  }
  if (module.exports._outputChannel) {
    module.exports._outputChannel.dispose();
  }
};

module.exports = {
  debug,
  error,
  info,
  warn,
  initialize,
  initializeConsole,
  dispose,
  // Private, exported for unit testing
  _outputChannel: undefined,
};
