const { DatabaseSync } = require('node:sqlite');
const { existsSync, mkdirSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { beforeWrite, afterWrite } = require('./performance-backup.cjs');

function openStore(project) {
  const directory = join(project, '.codex');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'performance.sqlite'));
  try {
    db.exec(`PRAGMA busy_timeout = 2500;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS transcripts (
        session_id TEXT PRIMARY KEY, source_size INTEGER NOT NULL, measurements TEXT NOT NULL
      ) WITHOUT ROWID;`);
    if (!db.prepare("SELECT 1 FROM records WHERE kind = 'meta' AND id = 'legacy-import'").get()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const insert = db.prepare('INSERT OR IGNORE INTO records VALUES (?, ?, ?)');
        if (!db.prepare("SELECT 1 FROM records WHERE kind = 'meta' AND id = 'legacy-import'").get()) {
          const tickets = join(directory, 'context-packages.json');
          const usage = join(directory, 'context-usage.jsonl');
          if (existsSync(tickets)) {
            const items = JSON.parse(readFileSync(tickets, 'utf8').replace(/^\uFEFF/, ''));
            if (!Array.isArray(items)) throw new Error('context-packages.json must contain a JSON array.');
            for (const ticket of items) {
              if (typeof ticket?.id !== 'string') throw new Error('A legacy ticket has no ID.');
              insert.run('ticket', ticket.id, JSON.stringify(ticket));
            }
          }
          let skipped = 0;
          if (existsSync(usage)) {
            for (const [index, line] of readFileSync(usage, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
              if (!line.trim()) continue;
              try {
                const row = JSON.parse(line);
                if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid usage row.');
                insert.run('attempt', 'legacy:' + index, JSON.stringify(row));
              } catch (error) {
                if (error instanceof SyntaxError || error.message === 'Invalid usage row.') skipped++;
                else throw error;
              }
            }
          }
          const history = join(directory, 'context-history');
          if (existsSync(history)) {
            const save = db.prepare('INSERT OR IGNORE INTO transcripts VALUES (?, ?, ?)');
            const names = readdirSync(history).map(name => ({
              name, match: name.match(/^rollout-(\d+)-([\da-f-]+)\.jsonl$/i),
            })).filter(entry => entry.match).sort((a, b) => Number(b.match[1]) - Number(a.match[1]));
            for (const { name, match } of names) {
              save.run(match[2], Number(match[1]), readFileSync(join(history, name), 'utf8'));
            }
          }
          insert.run('meta', 'legacy-import', JSON.stringify({ skipped, hadUsage: existsSync(usage) }));
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function withStore(project, action) {
  const db = openStore(project);
  try { return action(db); } finally { db.close(); }
}

function withWriteStore(project, action) {
  return withStore(project, db => {
    beforeWrite(project, db);
    const changes = db.prepare('SELECT total_changes() AS count');
    const before = changes.get().count;
    const result = action(db);
    if (changes.get().count !== before) afterWrite(project);
    return result;
  });
}

function records(db, kind) {
  return db.prepare('SELECT body FROM records WHERE kind = ? ORDER BY id').all(kind).map(({ body }) => JSON.parse(body));
}

function put(db, kind, id, value) {
  db.prepare('INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET body = excluded.body')
    .run(kind, id, JSON.stringify(value));
}

function ticketContexts(ticket, runs) {
  const contexts = new Set();
  const add = (provider, sessionId) => {
    if (typeof sessionId === 'string' && sessionId) contexts.add(JSON.stringify([provider, sessionId]));
  };
  for (const sessionId of Array.isArray(ticket.sessionIds) ? ticket.sessionIds : []) add('codex', sessionId);
  for (const step of Array.isArray(ticket.subtasks) ? ticket.subtasks : []) add('codex', step?.sessionId);
  for (const run of runs) add(run.provider, run.sessionId);
  return contexts;
}

function assertTicketContext(before, after, beforeRuns, afterRuns = beforeRuns) {
  const current = ticketContexts(after, afterRuns);
  if (current.size <= 1) return;
  const previous = ticketContexts(before, beforeRuns);
  if ([...current].some(context => !previous.has(context))) {
    const error = new Error('This ticket spans different chats. Create a new ticket for the new chat.');
    error.code = 'AIP_CONTEXT_MISMATCH';
    throw error;
  }
}

module.exports = { withStore, withWriteStore, records, put, assertTicketContext };
