const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { withWriteStore, put, records, assertTicketContext } = require('../../.codex/hooks/performance-store.cjs');

const input = readFileSync(0, 'utf8').trim();
const event = input ? JSON.parse(input) : {};
const project = process.env.AI_PERFORMANCE_PROJECT || join(__dirname, '..', '..');
const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
const turnId = typeof event.turn_id === 'string' ? event.turn_id : null;
const id = sessionId && turnId ? `${sessionId}:${turnId}` : randomUUID();
const key = 'kiro/' + id;
withWriteStore(project, db => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare("SELECT body FROM records WHERE kind = 'run' AND id = ?").get(key);
    if (!previous) {
      const run = {
        id, provider: 'kiro', name: 'Kiro run', kind: 'implementation', sessionId, turnId,
        model: typeof event.model === 'string' ? event.model : null,
        ticketId: process.env.AI_PERFORMANCE_TICKET_ID || null,
        endedAt: new Date().toISOString(), workSeconds: null, metrics: [],
      };
      if (run.ticketId) {
        const ticket = records(db, 'ticket').find(item => item.id === run.ticketId) ?? {};
        const linked = records(db, 'run').filter(item => item.ticketId === run.ticketId);
        try {
          assertTicketContext(ticket, ticket, linked, [...linked, run]);
        } catch (error) {
          if (error.code !== 'AIP_CONTEXT_MISMATCH') throw error;
          run.ticketId = null;
          console.error('AIP saved this run unassigned. Create a new ticket for the new chat.');
        }
      }
      put(db, 'run', key, run);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});
