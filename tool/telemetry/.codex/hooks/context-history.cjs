const { createReadStream } = require('node:fs');
const { readdir, stat } = require('node:fs/promises');
const { Readable } = require('node:stream');
const { withStore, withWriteStore } = require('./performance-store.cjs');
const { basename, join } = require('node:path');
const { createInterface } = require('node:readline');

const sessionPattern = /([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.jsonl$/i;
const snapshotHeader = '{"format":2}\n';

async function list(directory, options) {
  try {
    return await readdir(directory, options);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function* transcripts(directory, sessions, depth = 0) {
  for (const entry of await list(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (depth < 3 && entry.isDirectory() && /^\d{2,4}$/.test(entry.name)) {
      yield* transcripts(path, sessions, depth + 1);
    }
    if (!entry.isFile() || !entry.name.startsWith('rollout-')) continue;
    const id = entry.name.match(sessionPattern)?.[1];
    if (sessions.has(id)) yield { id, path };
  }
}

async function* savedTranscripts(project, sessions) {
  for (const id of sessions.keys()) {
    const row = withStore(project, db => db.prepare('SELECT measurements FROM transcripts WHERE session_id = ?').get(id));
    if (row) yield { id, input: Readable.from([row.measurements]) };
  }
}

const numeric = (value) => Number.isFinite(value) ? value : undefined;
const string = (value) => typeof value === 'string' ? value : undefined;
const usageFields = (usage) => ({
  total_tokens: numeric(usage?.total_tokens),
  input_tokens: numeric(usage?.input_tokens),
  cached_input_tokens: numeric(usage?.cached_input_tokens),
  output_tokens: numeric(usage?.output_tokens),
  reasoning_output_tokens: numeric(usage?.reasoning_output_tokens),
});
const windowFields = (window) => ({
  window_minutes: numeric(window?.window_minutes),
  resets_at: numeric(window?.resets_at),
  used_percent: numeric(window?.used_percent),
});

function measurement(event) {
  const { type, payload, timestamp } = event ?? {};
  if (!payload) return;
  if (type === 'turn_context') {
    return { type, payload: { turn_id: string(payload.turn_id), model: string(payload.model),
      effort: string(payload.effort ?? payload.reasoning_effort) } };
  }
  if (type !== 'event_msg') return;
  if (payload.type === 'task_started' || payload.type === 'task_complete') {
    return { type, timestamp: string(timestamp), payload: { type: payload.type, turn_id: string(payload.turn_id) } };
  }
  if (payload.type !== 'token_count') return;
  const info = payload.info;
  const limits = payload.rate_limits;
  return { type, timestamp: string(timestamp), payload: {
    type: 'token_count',
    info: {
      total_token_usage: usageFields(info?.total_token_usage),
      last_token_usage: usageFields(info?.last_token_usage),
      model_context_window: numeric(info?.model_context_window),
    },
    rate_limits: {
      limit_id: string(limits?.limit_id),
      primary: windowFields(limits?.primary),
      secondary: windowFields(limits?.secondary),
    },
  } };
}

async function saveTranscript(project, source, id) {
  if (!source || !id || basename(source).match(sessionPattern)?.[1] !== id) return false;
  let size;
  try {
    size = (await stat(source)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const existing = withStore(project, db => db.prepare(`SELECT source_size, instr(measurements, ?) = 1 AS current_format
    FROM transcripts WHERE session_id = ?`).get(snapshotHeader, id));
  if (!size || (existing && (existing.source_size > size ||
      (existing.source_size === size && existing.current_format)))) return false;
  const lines = createInterface({ input: createReadStream(source, { end: size - 1 }), crlfDelay: Infinity });
  const output = [];
  for await (const line of lines) {
    if (!/"(?:token_count|task_started|task_complete|turn_context)"/.test(line)) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const record = measurement(event);
    if (record) output.push(JSON.stringify(record));
  }
  if (!output.length) return false;
  return withWriteStore(project, db => db.prepare(`INSERT INTO transcripts VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET source_size = excluded.source_size, measurements = excluded.measurements
    WHERE excluded.source_size > transcripts.source_size OR
      (excluded.source_size = transcripts.source_size AND instr(transcripts.measurements, ?) <> 1)`)
    .run(id, size, snapshotHeader + output.join('\n') + '\n', snapshotHeader).changes > 0);
}

async function runHook(project = process.env.AI_PERFORMANCE_PROJECT || join(__dirname, '..', '..')) {
  const event = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
  if (!event.session_id) return;
  if (event.transcript_path) {
    await saveTranscript(project, event.transcript_path, event.session_id);
    return;
  }
  const home = process.env.CODEX_HOME || join(require('node:os').homedir(), '.codex');
  for await (const source of transcripts(join(home, 'sessions'), new Set([event.session_id]))) {
    await saveTranscript(project, source.path, source.id);
  }
}

if (require.main === module) runHook().catch(error => {
  console.error('Analytics history:', error.message);
  process.exitCode = 1;
});

module.exports = { transcripts, savedTranscripts, saveTranscript, runHook };
