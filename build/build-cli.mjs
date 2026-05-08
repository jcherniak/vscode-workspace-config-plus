#!/usr/bin/env node
// Bundles the CLI entry into a single self-contained dist/wcp.js.
// Output is a Node CommonJS bundle with shebang + executable bit; users can
// `cp dist/wcp.js ~/.local/bin/wcp` and run it directly.
//
// Notable choices:
//   - Platform: 'node' so esbuild keeps Node built-ins external.
//   - Format: 'cjs' because our sources are CommonJS (require/module.exports).
//   - Bundle: true (we want a SINGLE file).
//   - All runtime deps (deepmerge, ignore, jsonc-parser, @iarna/toml, mri, prompts)
//     are inlined.

import { build } from 'esbuild';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const entry = path.join(root, 'src', 'cli', 'index.js');
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, 'wcp.js');

await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: outFile,
  // jsonc-parser's CJS build uses a UMD wrapper that does dynamic
  // `require('./impl/format')` etc., which esbuild can't bundle. Alias it
  // to its ESM bundled build, which inlines all internals into one file.
  alias: {
    'jsonc-parser': path.join(root, 'node_modules/jsonc-parser/lib/esm/main.js'),
  },
  // Banner adds the shebang line so the bundle is directly executable.
  banner: { js: '#!/usr/bin/env node' },
  // Keep only Node built-ins external; everything else is inlined.
  external: [],
  // Smaller output and faster startup; sourcemaps optional via WCP_SOURCEMAP=1.
  minify: false,
  sourcemap: process.env.WCP_SOURCEMAP === '1',
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

// Make it executable.
await chmod(outFile, 0o755);

const meta = result.metafile;
const totalBytes = Object.values(meta.outputs).reduce((acc, o) => acc + o.bytes, 0);
process.stdout.write(
  `\nBuilt ${path.relative(root, outFile)} (${(totalBytes / 1024).toFixed(1)} KiB)\n`
);

// Quick verification: confirm the file starts with the shebang.
const head = (await readFile(outFile, 'utf8')).slice(0, 200);
if (!head.startsWith('#!/usr/bin/env node')) {
  process.stderr.write('ERROR: bundle missing shebang!\n');
  process.exit(1);
}
