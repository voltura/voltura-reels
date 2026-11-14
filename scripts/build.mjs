import { cpSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('dist', { recursive: true });
cpSync('extension', 'dist/extension', { recursive: true });
await build({
  entryPoints: ['src/content.js'],
  outfile: 'dist/extension/content.js',
  bundle: true,
  target: 'chrome120',
  loader: { '.css': 'text', '.html': 'text' },
});
