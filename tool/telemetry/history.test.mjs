import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chatContextAdvisory, readAnalytics } from './data.mjs';
import { importHistory } from './import-history.mjs';
import store from './.codex/hooks/performance-store.cjs';
import backups from './.codex/hooks/performance-backup.cjs';

test('chat effort compares five recent tickets against the low-context baseline', () => {
  const ticket = (percent, rate, completedAt, points = 1) => ({
    startContext: { percent }, completedAt, points, tokens: rate * points, tokensPerPoint: rate,
  });
  const baseline = Array.from({ length: 5 }, (_, i) => ticket(24, 100, i));
  const recent = Array.from({ length: 5 }, (_, i) => ticket(25, 130, i + 10, 3));
  const tickets = [...baseline, ticket(25, 5000, 6), ...recent];
  const { comparisons, elevated } = chatContextAdvisory({ percent: 45 }, tickets);
  assert.equal(comparisons.tokens.baseline.rate, 100);
  assert.equal(comparisons.tokens.recent.rate, 130);
  assert.deepEqual(elevated, ['tokens']);
  assert.deepEqual(chatContextAdvisory({ percent: 24 }, tickets).comparisons, {});
  assert.deepEqual(chatContextAdvisory({ percent: 45 }, [...baseline.slice(1), ...recent]).comparisons, {});
  assert.equal(chatContextAdvisory({ percent: 95 }, []).limitWarning, true);
});

test('a ticket accepts more runs in its chat and rejects another known chat', () => {
  const ticket = { subtasks: [{ sessionId: 'original' }] };
  assert.doesNotThrow(() => store.assertTicketContext(ticket,
    { subtasks: [...ticket.subtasks, { sessionId: 'original' }] }, []));
  assert.throws(() => store.assertTicketContext(ticket,
    { subtasks: [...ticket.subtasks, { sessionId: 'next' }] }, []), { code: 'AIP_CONTEXT_MISMATCH' });
});

test('ticket writes reject invalid subtasks and claims already owned by another ticket', async () => {
  const project = await mkdtemp(join(tmpdir(), 'aip-ticket-integrity-'));
  try {
    const record = (id, fields) => execFileSync(process.execPath,
      [fileURLToPath(new URL('./record.mjs', import.meta.url)), 'ticket', '-', project],
      { input: JSON.stringify({ id, name: id, epic: 'Example', ...fields }), stdio: 'pipe' });
    const step = { sessionId: 'chat', turnId: 'one', name: 'Work', kind: 'implementation', workSeconds: 30 };
    record('owner', { subtasks: [step] });
    assert.throws(() => record('duplicate', { subtasks: [step] }), /already belongs to another ticket/);
    assert.throws(() => record('legacy', { sessionIds: ['chat'] }), /already belongs to another ticket/);
    assert.throws(() => record('owner', { subtasks: [null] }), /A ticket subtask needs/);
    assert.throws(() => record('owner', { subtasks: [step, step] }), /Duplicate Codex run/);
    record('other-turn', { sessionIds: ['chat'], turnIds: ['two'] });
    record('owner', { description: 'Retain the turn.' });
    const tickets = store.withStore(project, db => store.records(db, 'ticket'));
    assert.deepEqual(tickets.map(ticket => ticket.id), ['other-turn', 'owner']);
    assert.deepEqual(tickets[1].subtasks, [step]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('daily and latest backups support preview, restore and undo', async () => {
  const project = await mkdtemp(join(tmpdir(), 'aip-backup-test-'));
  try {
    const write = id => store.withWriteStore(project, db => store.put(db, 'ticket', id, { id }));
    const tickets = () => store.withStore(project, db => store.records(db, 'ticket').map(ticket => ticket.id));
    assert.deepEqual(tickets(), []);
    assert.deepEqual(backups.list(project).backups, []);
    write('first');
    write('second');
    const daily = backups.list(project).backups.find(entry => /^\d/.test(entry.name));
    assert.equal(backups.preview(project, daily.name).tickets, 0);
    for (let i = 0; i < 65; i++) {
      if (backups.list(project).backups.some(entry => entry.name === 'latest.sqlite') &&
          backups.preview(project, 'latest.sqlite').tickets === 2) break;
      await delay(200);
    }
    assert.equal(backups.preview(project, 'latest.sqlite').tickets, 2);
    write('third');
    for (let i = 0; i < 65; i++) {
      if (backups.preview(project, 'latest.sqlite').tickets === 3) break;
      await delay(200);
    }
    assert.equal(backups.preview(project, 'latest.sqlite').tickets, 3);
    assert.equal(backups.preview(project, daily.name).tickets, 0);
    const cli = (...args) => JSON.parse(execFileSync(process.execPath,
      [fileURLToPath(new URL('../integration-and-release/cli.mjs', import.meta.url)), 'backup', ...args], { cwd: project, encoding: 'utf8' }));
    assert.ok(cli('list').backups.some(entry => entry.name === daily.name));
    const { version } = cli('preview', daily.name);
    assert.equal(version, daily.version);
    assert.throws(() => backups.restore(project, daily.name, 'stale'), /backup changed/);
    const { undo } = cli('restore', daily.name, version);
    assert.deepEqual(tickets(), []);
    assert.equal(backups.preview(project, undo).tickets, 3);
    backups.restore(project, undo, backups.preview(project, undo).version);
    assert.deepEqual(tickets(), ['first', 'second', 'third']);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('the rolling backup recovers after a failed publication without another write', async () => {
  const project = await mkdtemp(join(tmpdir(), 'aip-backup-retry-'));
  const directory = join(project, '.codex', 'backups');
  const latest = join(directory, 'latest.sqlite');
  try {
    store.withStore(project, db => store.put(db, 'ticket', 'one', { id: 'one' }));
    await mkdir(latest, { recursive: true });
    await utimes(latest, new Date(0), new Date(0));
    await writeFile(join(directory, '.pending'), '');
    const worker = spawn(process.execPath,
      [fileURLToPath(new URL('./.codex/hooks/performance-backup.cjs', import.meta.url)), project],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    const closed = once(worker, 'close');
    const timeout = setTimeout(() => worker.kill(), 6000);
    try {
      const reported = once(worker.stderr, 'data').then(([chunk]) => String(chunk));
      const failure = await Promise.race([reported, closed.then(() => '')]);
      assert.match(failure, /AI Performance latest backup/);
      await rm(latest, { recursive: true });
      assert.deepEqual(await closed, [0, null]);
      assert.equal(backups.preview(project, 'latest.sqlite').tickets, 1);
    } finally {
      clearTimeout(timeout);
      worker.kill();
      await closed;
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('efficiency scores compare complete tickets across story-point sizes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'analytics-score-test-'));
  try {
    store.withStore(project, db => {
      for (const [id, points, tokens, workSeconds] of [
        ['three', 3, 300, 180], ['five', 5, 500, 300], ['eight', 8, 3200, 1920],
        ['open', 3, 3000, 1800], ['partial', 5, 5000, 3000], ['unestimated', 0, 4000, 1800],
      ]) {
        const step = { name: 'Implementation', kind: 'implementation', sessionId: 'session', turnId: id, workSeconds };
        const subtasks = id === 'partial' ? [step, { ...step, turnId: 'missing', workSeconds: null }] : [step];
        store.put(db, 'ticket', id, {
          id, name: id, points, subtasks, epic: id === 'three' ? 'AI Analytics' : 'Other',
          completedAt: id === 'open' ? null : '2026-11-06T08:00:00Z',
        });
        store.put(db, 'attempt', id, { sessionId: 'session', turnId: id, tokenUsage: { total_tokens: tokens } });
      }
    });
    const analytics = await readAnalytics(project);
    assert.deepEqual(analytics.benchmark, { tokensPerPoint: 250, workSecondsPerPoint: 150 });
    const items = Object.fromEntries(analytics.items.map(item => [item.id, item]));
    assert.equal(items.three.tokensPerPoint, 100);
    assert.equal(items.five.workSecondsPerPoint, 60);
    for (const id of ['three', 'five', 'eight']) {
      const score = id === 'eight' ? 63 : 250;
      assert.equal(items[id].tokenScore, score);
      assert.equal(items[id].timeScore, score);
    }
    for (const id of ['open', 'partial', 'unestimated']) {
      assert.equal(items[id].tokenScore, null);
      assert.equal(items[id].timeScore, null);
    }
    assert.equal(items.partial.tokensPerPoint, null);
    assert.equal(items.unestimated.workSecondsPerPoint, null);
    assert.deepEqual(analytics.epics, ['AI Performance', 'Other']);
    const filtered = await readAnalytics(project, 'AI Performance');
    assert.deepEqual(filtered.benchmark, analytics.benchmark);
    assert.deepEqual(analytics.contextDomains.tokensPerPoint, { maxValue: 400, maxContext: 100, hasUnknown: true });
    assert.deepEqual(filtered.contextDomains, analytics.contextDomains);
    assert.deepEqual(filtered.items, [items.three]);
    assert.deepEqual(await readAnalytics(project, 'AI Analytics'), filtered);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('project retains measurements after the Codex transcript disappears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'analytics-history-test-'));
  try {
    const project = join(root, 'project');
    const config = join(project, '.codex');
    const codexHome = join(root, 'codex');
    const archive = join(codexHome, 'archived_sessions');
    const sessionId = '01234567-1234-1234-1234-123456789abc';
    const turnId = 'measured-turn';
    const transcript = join(archive, `rollout-test-${sessionId}.jsonl`);
    const hooks = join(config, 'hooks');
    await mkdir(hooks, { recursive: true });
    await mkdir(archive, { recursive: true });
    await writeFile(join(config, 'context-packages.json'), JSON.stringify([{
      id: 'ticket', epic: 'Analytics', points: 2, completedAt: '2026-11-06T07:01:00Z',
      subtasks: [{ name: 'Measure', kind: 'implementation', sessionId, turnId, workSeconds: 60 }],
    }]));
    await writeFile(join(config, 'context-usage.jsonl'), JSON.stringify({
      sessionId, turnId, tokenUsage: { total_tokens: 150 },
    }) + '\n');
    const event = (type, payload, timestamp) => ({ type, payload, timestamp });
    const message = (type, fields, timestamp) => event('event_msg', { type, ...fields }, timestamp);
    const tokens = (used, info) => message('token_count', {
      info, rate_limits: { primary: { window_minutes: 300, resets_at: 1793952000, used_percent: used } },
    });
    const events = [
      tokens(10),
      message('task_started', { turn_id: turnId }, '2026-11-06T07:00:00Z'),
      event('turn_context', { turn_id: turnId, model: 'test-model', effort: 'medium', instructions: 'private content' }),
      event('response_item', { content: 'private content' }),
      tokens(12, {
        total_token_usage: { total_tokens: 150 },
        last_token_usage: { total_tokens: 150, input_tokens: 100 },
        model_context_window: 1000,
      }),
      message('task_complete', { turn_id: turnId, last_agent_message: 'private content' }, '2026-11-06T07:01:00Z'),
    ];
    await writeFile(transcript, events.slice(0, -1).map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.deepEqual(await importHistory(project, codexHome), { saved: 1, found: 1, total: 1 });
    await writeFile(transcript, events.map(row => JSON.stringify(row)).join('\n') + '\n');
    const hook = join(hooks, 'context-history.cjs');
    await copyFile(new URL('./.codex/hooks/context-history.cjs', import.meta.url), hook);
    await copyFile(new URL('./.codex/hooks/performance-store.cjs', import.meta.url), join(hooks, 'performance-store.cjs'));
    await copyFile(new URL('./.codex/hooks/performance-backup.cjs', import.meta.url), join(hooks, 'performance-backup.cjs'));
    execFileSync(process.execPath, [hook], { input: JSON.stringify({
      hook_event_name: 'Stop', transcript_path: transcript, session_id: sessionId,
    }) });
    assert.deepEqual(await importHistory(project, codexHome), { saved: 0, found: 1, total: 1 });
    store.withStore(project, db => {
      const { measurements } = db.prepare('SELECT measurements FROM transcripts').get();
      db.prepare('UPDATE transcripts SET measurements = ?').run(
        measurements.replace(/^.*\n/, '').replace(',"effort":"medium"', ''),
      );
    });
    assert.equal((await readAnalytics(project)).items[0].subtasks[0].effort, null);
    assert.deepEqual(await importHistory(project, codexHome), { saved: 1, found: 1, total: 1 });
    const before = await readAnalytics(project);
    assert.equal(before.tokens, 150);
    assert.equal(before.attempts, 1);
    assert.equal(before.items[0].startContext.percent, 10);
    assert.equal(before.items[0].quotaUsed, 2);
    assert.equal(before.items[0].workSeconds, 60);
    assert.equal(before.items[0].subtasks[0].model, 'test-model');
    assert.equal(before.items[0].subtasks[0].effort, 'medium');
    const measurements = store.withStore(project, db => db.prepare('SELECT measurements FROM transcripts').all());
    assert.equal(measurements.length, 1);
    assert.doesNotMatch(measurements[0].measurements, /private content/);
    await rm(transcript);
    await rm(join(config, 'context-packages.json'));
    await rm(join(config, 'context-usage.jsonl'));
    assert.deepEqual(await importHistory(project, codexHome), { saved: 0, found: 0, total: 1 });
    assert.deepEqual(await readAnalytics(project), before);

    const record = (kind, value) => execFileSync(process.execPath,
      [fileURLToPath(new URL('./record.mjs', import.meta.url)), kind, '-', project],
      { input: JSON.stringify(value) });
    const kiroRun = { id: 'run-1', provider: 'kiro', name: 'Review', kind: 'feedback',
      workSeconds: 30, metrics: [{ unit: 'credits', value: 2.4 }] };
    record('run', kiroRun);
    assert.equal((await readAnalytics(project)).unassignedRuns[0].provider, 'kiro');
    record('run', { ...kiroRun, ticketId: 'ticket' });
    record('run', kiroRun);
    record('quota', { id: 'november', provider: 'kiro', account: 'team',
      periodStart: '2026-11-01', periodEnd: '2026-12-01', observedAt: '2026-11-06',
      unit: 'credits', used: 21, limit: 100, overage: 0 });
    const mixed = await readAnalytics(project);
    assert.equal(mixed.items[0].tokens, 150);
    assert.equal(mixed.items[0].workSeconds, 90);
    assert.deepEqual(mixed.items[0].subtasks.find(run => run.provider === 'kiro').metrics, kiroRun.metrics);
    assert.equal(mixed.quotaSnapshots[0].used, 21);
    assert.equal(mixed.unassignedRuns.length, 0);

    const kiroHooks = join(project, '.kiro', 'hooks');
    await mkdir(kiroHooks, { recursive: true });
    const kiroHook = join(kiroHooks, 'performance-run.cjs');
    await copyFile(new URL('./.kiro/hooks/performance-run.cjs', import.meta.url), kiroHook);
    for (let retry = 0; retry < 2; retry++) {
      execFileSync(process.execPath, [kiroHook], { input: JSON.stringify({
        session_id: 'kiro-session', turn_id: 'kiro-turn', prompt: 'private content',
      }), env: { ...process.env, AI_PERFORMANCE_TICKET_ID: '' } });
    }
    const kiroCaptured = (await readAnalytics(project)).unassignedRuns;
    assert.equal(kiroCaptured.length, 1);
    assert.equal(kiroCaptured[0].provider, 'kiro');
    assert.deepEqual(kiroCaptured[0].metrics, []);
    assert.doesNotMatch(JSON.stringify(kiroCaptured), /private content/);

    const usageHook = join(hooks, 'context-usage.cjs');
    await copyFile(new URL('./.codex/hooks/context-usage.cjs', import.meta.url), usageHook);
    execFileSync(process.execPath, [usageHook], { input: JSON.stringify({
      hook_event_name: 'PostModelRequest', session_id: 'new-codex-session', turn_id: 'new-turn',
      token_usage: { total_tokens: 50 },
    }) });
    const unassigned = (await readAnalytics(project)).unassignedRuns;
    assert.equal(unassigned.find(run => run.provider === 'codex').tokens, 50);
    execFileSync(process.execPath, [usageHook], { input: JSON.stringify({
      hook_event_name: 'PostModelRequest', session_id: sessionId, turn_id: turnId,
      token_usage: { total_tokens: 50 },
    }) });
    assert.equal((await readAnalytics(project)).items[0].tokens, 200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
