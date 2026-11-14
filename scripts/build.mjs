import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
cpSync('extension', 'dist/extension', { recursive: true });
