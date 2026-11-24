import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('dist', { recursive: true });
rmSync('dist/extension', { recursive: true, force: true });
cpSync('extension', 'dist/extension', { recursive: true });
await build({
  entryPoints: { content: 'src/content.js', shorts: 'src/shorts-content.js' },
  outdir: 'dist/extension',
  bundle: true,
  target: 'chrome120',
  loader: { '.css': 'text', '.html': 'text' },
});
