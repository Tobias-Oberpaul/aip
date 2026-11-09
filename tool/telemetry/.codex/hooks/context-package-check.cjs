const fs = require('node:fs');
const { withStore, records } = require('./performance-store.cjs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const points = new Set([1, 2, 3, 5, 8, 13, 20]);
const root = process.env.AI_PERFORMANCE_PROJECT || join(__dirname, '..', '..');

function fingerprint() {
  const status = execFileSync('git', ['status', '--porcelain=v2', '--branch', '-z', '--no-renames', '--untracked-files=all', '--', '.', ':(exclude).codex/context-packages.json', ':(exclude).codex/context-usage.jsonl', ':(exclude).codex/performance.sqlite*'], {
    cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const hash = createHash('sha256').update(status);
  for (const entry of status.split('\0')) {
    const path = /^(?:\? |1 (?:\S+ ){7}|u (?:\S+ ){9})(.+)$/s.exec(entry)?.[1];
    if (!path) continue;
    const stat = fs.lstatSync(join(root, path), { throwIfNoEntry: false });
    if (stat) hash.update(JSON.stringify([path, stat.size, stat.mtimeMs]));
  }
  return hash.digest('hex');
}

function check(event) {
  if (!event.session_id || !event.turn_id || event.permission_mode === 'plan') return;
  const key = createHash('sha256').update(JSON.stringify([root, event.session_id, event.turn_id])).digest('hex');
  const baseline = join(tmpdir(), 'codex-context-package-' + key);
  if (event.hook_event_name === 'UserPromptSubmit') {
    if (!fs.existsSync(baseline)) fs.writeFileSync(baseline, fingerprint(), { flag: 'wx' });
    return;
  }
  if (event.hook_event_name !== 'Stop' && event.hook_event_name !== 'Interrupt') return;
  if (!fs.existsSync(baseline)) return;
  const before = fs.readFileSync(baseline, 'utf8');
  fs.rmSync(baseline, { force: true });
  if (event.hook_event_name !== 'Stop' || event.stop_hook_active || before === fingerprint()) return;

  const items = withStore(root, db => records(db, 'ticket'));
  const matches = items.flatMap(item => (item.subtasks ?? [])
    .filter(step => step.sessionId === event.session_id && step.turnId === event.turn_id)
    .map(step => ({ item, step })));
  const valid = matches.length === 1 && matches.every(({ item, step }) =>
    item.name?.trim() && typeof item.epic === 'string' && item.epic.trim() &&
    points.has(item.points) && Number.isFinite(Date.parse(item.startedAt)) &&
    ['fresh', 'continued'].includes(item.strategy) && step.name?.trim() &&
    ['implementation', 'feedback', 'handoff'].includes(step.kind) &&
    Number.isSafeInteger(step.workSeconds) && step.workSeconds >= 0);
  if (!valid) console.log(JSON.stringify({
    decision: 'block',
    reason: `Project change without a valid ticket record. Use the AI Performance record command to record this run exactly once (sessionId: ${event.session_id}, turnId: ${event.turn_id}). Attach feedback to the existing ticket. Every ticket needs an epic. For new work, record the title, estimate and start time. If the database is locked, report the blocker.`,
  }));
}

try { check(JSON.parse(fs.readFileSync(0, 'utf8'))); }
catch (error) { process.stderr.write('Ticket check: ' + error.message + '\n'); process.exitCode = 1; }
