import { cpSync, rmSync, existsSync } from 'node:fs';
if (!existsSync('node_modules/@sparticuz/chromium/bin/chromium.br')) throw new Error('Binário serverless do Chromium não encontrado. Execute npm ci.');
rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
console.log('Frontend preparado em dist/. A API é compilada pela Vercel.');
