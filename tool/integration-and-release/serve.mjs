import { context } from 'esbuild';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { importHistory } from '../telemetry/import-history.mjs';
import { projectDocPath, projectStructure } from '../documentation/context.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const project = resolve(args.find((arg) => arg !== '--codex-history') ?? process.env.INIT_CWD ?? process.cwd());
const title = `AI Performance - ${basename(project) || project}`.replace(/[&<>]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
})[character]);
if (args.includes('--codex-history')) await importHistory(project);
let assets, assetRevision, dataRevision, readAnalytics;
const databasePath = join(project, '.codex', 'performance.sqlite');
let observedDatabase, databaseIdentity, dashboardCache;

function dashboardVersion() {
  const file = statSync(databasePath, { bigint: true, throwIfNoEntry: false });
  const identity = file ? `${file.dev}:${file.ino}` : null;
  if (identity !== databaseIdentity) {
    const next = file ? new DatabaseSync(databasePath, { readOnly: true }) : null;
    next?.exec('PRAGMA busy_timeout = 2500');
    observedDatabase?.close();
    observedDatabase = next;
    databaseIdentity = identity;
    dashboardCache = undefined;
  }
  const version = observedDatabase?.prepare('PRAGMA data_version').get().data_version;
  return `${dataRevision}:${version ?? 'empty'}`;
}

async function dashboardResponse() {
  const version = dashboardVersion();
  if (dashboardCache?.version === version) return dashboardCache.result;
  const result = readAnalytics(project).then(({ project, hasLog, skipped, items, benchmark, contextDomains, chatContext }) => {
    const body = JSON.stringify({ project, hasLog, skipped, items, benchmark, contextDomains, chatContext });
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
    return { body, etag };
  });
  dashboardCache = { version, result };
  try { return await result; }
  catch (error) {
    if (dashboardCache?.result === result) dashboardCache = undefined;
    throw error;
  }
}
const revision = () => JSON.stringify([assetRevision, dataRevision]);
const dataBuild = await context({
  entryPoints: [join(app, 'tool/telemetry/data.mjs')], bundle: true, write: false,
  platform: 'node', format: 'esm',
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(import.meta.url)});` },
  plugins: [{
    name: 'analytics-data-live-reload',
    setup(builder) {
      builder.onEnd(async ({ errors, outputFiles }) => {
        if (errors.length) return;
        const [output] = outputFiles;
        if (output.hash === dataRevision) return;
        try {
          const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(output.contents).toString('base64');
          const next = await import(moduleUrl);
          if (typeof next.readAnalytics !== 'function') throw new Error('Missing readAnalytics export.');
          readAnalytics = next.readAnalytics;
          dataRevision = output.hash;
        } catch (error) {
          return { errors: [{ text: error.message }] };
        }
      });
    },
  }],
});
const build = await context({
  entryPoints: [join(app, 'dashboard/app.jsx'), join(app, 'dashboard/styles.css')],
  outdir: join(app, 'build'), bundle: true, write: false, jsx: 'automatic',
  alias: { '@': app }, define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'analytics-live-reload',
    setup(builder) {
      builder.onLoad({ filter: /styles\.css$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const config = join(app, 'dashboard/tailwind.config.cjs');
        const { css } = await postcss([tailwind(config)]).process(source, { from: path });
        return { contents: css, loader: 'css', watchFiles: [path, config] };
      });
      builder.onEnd(({ errors, outputFiles }) => {
        if (errors.length) return;
        const script = outputFiles.find((file) => file.path.endsWith('app.js'));
        const css = outputFiles.find((file) => file.path.endsWith('styles.css'));
        assetRevision = JSON.stringify([script.hash, css.hash]);
        assets = new Map([
          ['/styles.css', ['text/css', css.contents]],
          ['/app.js', ['text/javascript', script.contents]],
        ]);
      });
    },
  }],
});
await Promise.all([build.rebuild(), dataBuild.rebuild()]);
await Promise.all([build.watch(), dataBuild.watch()]);

function dashboardHtml() {
  return `<!doctype html><html lang="en" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script defer src="/app.js"></script>
  <script>
    const revision = ${JSON.stringify(revision())};
    async function checkForUpdate() {
      try {
        const response = await fetch('/__version');
        if (response.ok && (await response.text()) !== revision) {
          location.reload();
          return;
        }
      } catch {}
      setTimeout(checkForUpdate, 1000);
    }
    setTimeout(checkForUpdate, 1000);
  </script></html>`;
}

const server = createServer(async (request, response) => {
  const address = server.address();
  if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${address.port}`) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(dashboardHtml());
    return;
  }
  if (request.url === '/__version') {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(revision());
    return;
  }
  if (request.url.split('?')[0] === '/api/project-doc') {
    const notFound = () => {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'This document was not found in the project documentation.' }));
    };
    try {
      const note = new URL(request.url, 'http://127.0.0.1').searchParams.get('note') ?? '';
      const path = projectDocPath(project, note);
      if (!path) {
        notFound();
        return;
      }
      const expected = join(await realpath(project), path);
      const file = await realpath(expected);
      if (relative(expected, file) || !(await stat(file)).isFile()) {
        notFound();
        return;
      }
      const markdown = await readFile(file, 'utf8');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('X-AIP-Document-Path', path);
      response.end(markdown);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') notFound();
      else {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'The dashboard server could not read this document.' }));
      }
    }
    return;
  }
  if (['/api/performance', '/api/analytics'].includes(request.url.split('?')[0])) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.searchParams.get('view') === 'dashboard' && !url.searchParams.has('epic')) {
        const { body, etag } = await dashboardResponse();
        response.setHeader('Cache-Control', 'private, no-cache');
        response.setHeader('ETag', etag);
        const tags = request.headers['if-none-match']?.split(',') ?? [];
        if (tags.some(tag => ['*', etag].includes(tag.trim().replace(/^W\//, '')))) {
          response.writeHead(304).end();
        } else response.end(body);
        return;
      }
      const analytics = await readAnalytics(project, url.searchParams.get('epic'));
      response.end(JSON.stringify({ ...analytics, structure: projectStructure(project) }));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  const asset = assets.get(request.url);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', `${asset[0]}; charset=utf-8`);
  response.end(asset[1]);
});

server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  console.log(`AI Performance · http://127.0.0.1:${server.address().port}\nProject · ${project}`);
});
