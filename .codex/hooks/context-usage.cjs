const { randomUUID } = require('node:crypto');
const { withWriteStore, put } = require('./performance-store.cjs');
const { join } = require('node:path');

process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const event = JSON.parse(input);
  if (event.hook_event_name !== 'PostModelRequest') return;

  const record = {
    provider: 'codex',
    timestamp: new Date().toISOString(),
    sessionId: event.session_id ?? null,
    turnId: event.turn_id ?? null,
    agentId: event.agent_id ?? null,
    model: event.model ?? null,
    effort: event.reasoning_effort ?? event.effort ?? null,
    status: event.status ?? null,
    tokenUsage: event.token_usage ?? null,
  };

  withWriteStore(process.env.AI_PERFORMANCE_PROJECT || join(__dirname, '..', '..'), db => put(db, 'attempt', randomUUID(), record));
});
