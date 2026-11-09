import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
await Promise.all(['documentation-toc.css', 'product-header.css', 'tokens.css'].map(file =>
  copyFile(path('../design-system/' + file), path('./public/assets/' + file))));
await build({
  entryPoints: [path('./src/site.jsx')],
  outfile: path('./public/assets/site.js'),
  alias: { '@': path('..') },
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
