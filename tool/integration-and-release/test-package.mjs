import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npmPath = process.env.npm_execpath;
if (!npmPath) throw new Error('Run this smoke test with npm run test:package.');
const npm = (args, cwd, input) => execFileSync(process.execPath, [npmPath, ...args], {
  cwd, input, encoding: 'utf8', timeout: 120000,
});
const project = mkdtempSync(join(tmpdir(), 'ai-performance-package-'));
const file = (...parts) => join(project, ...parts);
const cli = (args, input) => npm(['exec', '--', 'aip', ...args], project, input);
const callHook = (dir, role, payload) => execFileSync(process.execPath, [file(dir, 'hooks', 'ai-performance.cjs'), role], {
  cwd: project, encoding: 'utf8', input: JSON.stringify(payload),
});
try {
  const [pack] = JSON.parse(npm(['pack', '--json', '--pack-destination', project], process.cwd()));
  // npm 8 may report a scoped path in JSON while writing an unscoped filename.
  const archive = resolve(project, pack.filename.replace(/^@/, '').replace('/', '-'));
  assert.ok(existsSync(archive), archive);
  assert.ok(pack.files.every(({ path }) =>
    !/^\.codex\/|^website\/|performance\.sqlite|context-usage\.jsonl|context-packages\.json|context-history\//.test(path)));
  execFileSync('git', ['init', '-q'], { cwd: project });
  writeFileSync(file('package.json'), '{"name":"release-smoke","version":"1.0.0","private":true}');
  npm(['install', '-D', archive, '--no-audit', '--no-fund', '--fetch-retries=0'], project);
  const db = file('.codex', 'performance.sqlite');
  const marker = file('.codex', 'ai-performance-enabled.json');
  assert.ok(!existsSync(db) && !existsSync(marker));
  assert.equal(cli(['--version']).trim(), pack.version);

  mkdirSync(file('.codex'));
  const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing', timeout: 2 }] }] } };
  writeFileSync(file('.codex', 'hooks.json'), JSON.stringify(old));
  const projectInstructions = '# Project instructions\n';
  writeFileSync(file('AGENTS.md'), projectInstructions);
  cli(['init', '--context']);
  assert.ok(!existsSync(marker));
  const ownership = /^Record each change in the local AIP database.*$/m;
  assert.match(readFileSync(file('AGENTS.md'), 'utf8'), ownership);
  const contextPath = file('CONTEXT.md');
  assert.match(readFileSync(contextPath, 'utf8'), /## Handoff/);
  writeFileSync(contextPath, '# Custom project index\n');
  cli(['init', '--codex', '--kiro']);
  let instructions = readFileSync(file('AGENTS.md'), 'utf8');
  assert.ok(instructions.startsWith(projectInstructions));
  assert.match(instructions, /npx aip record list ticket/);
  assert.match(instructions, /npx aip context check/);
  assert.match(instructions, ownership);
  assert.equal(readFileSync(contextPath, 'utf8'), '# Custom project index\n');
  const config = readFileSync(file('.codex', 'hooks.json'), 'utf8');
  assert.deepEqual(JSON.parse(config).hooks.Stop[0], old.hooks.Stop[0]);
  const customEpicRule = 'Prefer the epic already assigned in the project tracker.';
  writeFileSync(file('AGENTS.md'), instructions
    .replace(/<!-- aip-ticket-ownership -->[\s\S]*?<!-- \/aip-ticket-ownership -->\n/, '')
    .replace('<!-- /aip-epic-steering -->', customEpicRule + '\n<!-- /aip-epic-steering -->'));
  cli(['init', '--context']);
  instructions = readFileSync(file('AGENTS.md'), 'utf8');
  assert.ok(instructions.includes(customEpicRule));
  assert.match(instructions, ownership);
  assert.equal(readFileSync(file('.codex', 'hooks.json'), 'utf8'), config);
  cli(['init', '--context']);
  assert.equal(readFileSync(file('AGENTS.md'), 'utf8'), instructions);
  cli(['init', '--codex', '--kiro']);
  assert.equal(readFileSync(file('AGENTS.md'), 'utf8'), instructions);
  assert.equal(readFileSync(file('.codex', 'hooks.json'), 'utf8'), config);

  cli(['context', 'epic', 'Release']);
  const releaseNote = file('release', 'README.md');
  assert.ok(existsSync(file('release')));
  assert.match(readFileSync(contextPath, 'utf8'), /^# Custom project index[\s\S]*\[Release\]\(release\/README\.md\)/);
  writeFileSync(releaseNote, '# Release\n\n- `release/publish.mjs` publishes the package.\n');
  cli(['context', 'epic', 'Release']);
  assert.match(readFileSync(releaseNote, 'utf8'), /publishes the package/);
  assert.throws(() => cli(['record', 'ticket', '-'], JSON.stringify({
    id: 'wrong-epic', name: 'Spelling check', epic: 'release',
  })), error => /Use an exact epic name/.test(error.stderr));

  const codex = { hook_event_name: 'PostModelRequest', session_id: 'test-session', turn_id: 'codex-turn',
    token_usage: { total_tokens: 123 } };
  const kiro = { session_id: 'kiro-session', turn_id: 'kiro-turn' };
  callHook('.codex', 'codex-usage', codex);
  callHook('.kiro', 'kiro-run', kiro);
  assert.ok(existsSync(db));
  const originalDatabase = readFileSync(db);
  for (const provider of ['.codex', '.kiro']) {
    const launcher = file(provider, 'hooks', 'ai-performance.cjs');
    writeFileSync(launcher, readFileSync(launcher, 'utf8').replace(
      '@tobiasoberpaul/aip/hook', '@tobiasoberpaul/ai-performance/hook',
    ));
  }
  cli(['init', '--codex', '--kiro']);
  assert.deepEqual(readFileSync(db), originalDatabase);
  for (const provider of ['.codex', '.kiro']) {
    assert.match(readFileSync(file(provider, 'hooks', 'ai-performance.cjs'), 'utf8'), /@tobiasoberpaul\/aip\/hook/);
  }
  execFileSync('git', ['check-ignore', '.codex/performance.sqlite', '.codex/ai-performance-enabled.json'], { cwd: project });
  cli(['record', 'ticket', '-'], JSON.stringify({
    id: 'SMOKE-1', name: 'Installed package test', epic: 'Release',
    subtasks: [{ sessionId: codex.session_id, turnId: codex.turn_id, name: 'Codex run', kind: 'implementation', workSeconds: 4 }],
  }));
  assert.throws(() => cli(['record', 'link', 'kiro/kiro-session:kiro-turn', 'SMOKE-1']),
    error => /Create a new ticket for the new chat/.test(error.stderr));
  cli(['record', 'ticket', '-'], JSON.stringify({ id: 'SMOKE-2', name: 'Separate Kiro ticket', epic: 'Release' }));
  cli(['record', 'link', 'kiro/kiro-session:kiro-turn', 'SMOKE-2']);
  cli(['disable']);
  assert.ok(!existsSync(marker));
  callHook('.codex', 'codex-usage', { ...codex, token_usage: { total_tokens: 500 } });
  callHook('.kiro', 'kiro-run', { ...kiro, turn_id: 'disabled-turn' });

  const installedCli = file('node_modules', '@tobiasoberpaul', 'aip', 'tool', 'integration-and-release', 'cli.mjs');
  const server = spawn(process.execPath, [installedCli, 'serve'], { cwd: project, stdio: ['ignore', 'pipe', 'inherit'] });
  const ended = new Promise(resolve => server.once('exit', resolve));
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 20000);
      server.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      ended.then(code => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
    });
    const [page, css, api] = await Promise.all(['/', '/styles.css', '/api/analytics'].map(route => fetch(url + route)));
    assert.equal(page.status, 200);
    assert.equal(css.status, 200);
    assert.match(await css.text(), /\.bg-background/);
    const analytics = await api.json();
    assert.equal(api.status, 200, analytics.error);
    const codexTicket = analytics.items.find(item => item.id === 'SMOKE-1');
    const kiroTicket = analytics.items.find(item => item.id === 'SMOKE-2');
    assert.equal(codexTicket.tokens, 123);
    assert.deepEqual(codexTicket.subtasks.map(step => step.provider), ['codex']);
    assert.deepEqual(kiroTicket.subtasks.map(step => step.provider), ['kiro']);
    assert.deepEqual(analytics.structure.map(({ name, folder }) => [name, folder]), [['Release', 'release']]);
    assert.deepEqual(analytics.structure[0].features[0].files, ['release/publish.mjs']);
    const dashboardUrl = url + '/api/performance?view=dashboard';
    const compact = await fetch(dashboardUrl);
    const etag = compact.headers.get('etag');
    assert.equal(compact.status, 200);
    assert.ok(etag);
    const dashboard = await compact.json();
    assert.deepEqual(dashboard.items, analytics.items);
    assert.equal(dashboard.quotaWindows, undefined);
    const conditional = { headers: { 'If-None-Match': etag } };
    assert.equal((await fetch(dashboardUrl, conditional)).status, 304);
    cli(['record', 'ticket', '-'], JSON.stringify({ id: 'SMOKE-1', name: 'Updated package test', epic: 'Release' }));
    const updatedDashboard = await fetch(dashboardUrl, conditional);
    assert.equal(updatedDashboard.status, 200);
    assert.notEqual(updatedDashboard.headers.get('etag'), etag);
    assert.equal((await updatedDashboard.json()).items.find(item => item.id === 'SMOKE-1').name, 'Updated package test');
    const index = await fetch(url + '/api/project-doc?note=index.md');
    assert.equal(index.headers.get('x-aip-document-path'), 'CONTEXT.md');
    assert.match(await index.text(), /Custom project index/);
    const note = await fetch(url + '/api/project-doc?note=release/README.md');
    assert.equal(note.status, 200);
    assert.equal(note.headers.get('x-aip-document-path'), 'release/README.md');
    assert.match(await note.text(), /publishes the package/);
    const outsideDocs = await fetch(url + '/api/project-doc?note=..%2F..%2FAGENTS.md');
    assert.equal(outsideDocs.status, 404);
    assert.equal((await fetch(url + '/api/project-doc?note=AGENTS.md')).status, 404);
    rmSync(contextPath);
    const legacyNote = file('docs', 'context', 'features', 'release', 'README.md');
    mkdirSync(file('docs', 'context', 'features', 'release'), { recursive: true });
    writeFileSync(file('docs', 'context', 'index.md'), '# Legacy index\n\n- [Release](features/release/README.md)\n');
    writeFileSync(legacyNote, '# Legacy release');
    const legacy = await fetch(url + '/api/project-doc?note=index.md');
    assert.equal(legacy.headers.get('x-aip-document-path'), 'docs/context/index.md');
    assert.match(await legacy.text(), /Legacy index/);
    for (const path of ['features/release/README.md', 'docs/context/features/release/README.md']) {
      const legacyDocument = await fetch(url + '/api/project-doc?note=' + path);
      assert.equal(legacyDocument.status, 200);
      assert.equal(await legacyDocument.text(), '# Legacy release');
    }
    assert.deepEqual(analytics.unassignedRuns, []);
  } finally {
    server.kill();
    await ended;
  }
  console.log('Verified npm installation, opt-in, hook capture, disable, and installed dashboard.');
  console.log('Archive:', pack.filename);
  console.log('Integrity:', pack.integrity);
} finally {
  rmSync(project, { recursive: true, force: true });
}
