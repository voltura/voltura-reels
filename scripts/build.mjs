import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('dist', { recursive: true });
rmSync('dist/extension', { recursive: true, force: true });
cpSync('extension', 'dist/extension', { recursive: true });
await build({
  entryPoints: ['src/content.js'],
  outfile: 'dist/extension/content.js',
  bundle: true,
  target: 'chrome120',
  loader: { '.css': 'text', '.html': 'text' },
});
