import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import store from './.codex/hooks/performance-store.cjs';
import { projectEpics } from '../documentation/context.mjs';

const [kind, file, target] = process.argv.slice(2);
const project = resolve(target ?? process.env.INIT_CWD ?? process.cwd());
const kinds = ['ticket', 'run', 'quota'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const amount = value => Number.isFinite(value) && value >= 0;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const runKinds = ['implementation', 'feedback', 'handoff'];

function validateTicket(ticket) {
  const { subtasks, sessionIds, turnIds, points } = ticket;
  if (points != null && !amount(points)) throw new Error('Invalid story-point estimate.');
  for (const field of ['startedAt', 'completedAt', 'acceptedAt']) {
    if (ticket[field] != null && !timestamp(ticket[field])) throw new Error(`Invalid ticket date: ${field}.`);
  }
  for (const ids of [sessionIds, turnIds]) {
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every(nonempty))) {
      throw new Error('Legacy session and turn IDs must be arrays of nonempty strings.');
    }
  }
  if (subtasks === undefined) return;
  if (!Array.isArray(subtasks)) throw new Error('Ticket subtasks must be an array.');
  const seen = new Set();
  for (const step of subtasks) {
    if (!nonempty(step?.sessionId) || !nonempty(step.turnId) || !nonempty(step.name) ||
        !runKinds.includes(step.kind) || (step.workSeconds != null && !amount(step.workSeconds))) {
      throw new Error('A ticket subtask needs a session ID, turn ID, name, valid kind and optional nonnegative duration.');
    }
    const key = JSON.stringify([step.sessionId, step.turnId]);
    if (seen.has(key)) throw new Error('Duplicate Codex run in ticket subtasks.');
    seen.add(key);
  }
}

function codexClaims(ticket) {
  if (Array.isArray(ticket.subtasks)) return ticket.subtasks.filter(step => nonempty(step?.sessionId) && nonempty(step.turnId));
  if (!Array.isArray(ticket.sessionIds)) return [];
  const turns = Array.isArray(ticket.turnIds) ? ticket.turnIds : [undefined];
  return ticket.sessionIds.flatMap(sessionId => turns.map(turnId => ({ sessionId, turnId })));
}

function claimsOverlap(a, b) {
  return a.sessionId === b.sessionId && (a.turnId === b.turnId || a.turnId === undefined || b.turnId === undefined);
}

function assertUnclaimed(tickets, ticketId, claims) {
  if (tickets.some(ticket => ticket.id !== ticketId &&
      codexClaims(ticket).some(existing => claims.some(claim => claimsOverlap(existing, claim))))) {
    throw new Error('The Codex run already belongs to another ticket.');
  }
}

function validate(record) {
  if (!nonempty(record?.id)) throw new Error('Each record needs a stable ID.');
  if (kind === 'ticket') {
    if (!nonempty(record.name) || !nonempty(record.epic)) throw new Error('A ticket needs a name and epic.');
    if (record.description != null && typeof record.description !== 'string') throw new Error('A ticket description must be text.');
    if (record.subtasks != null && !Array.isArray(record.subtasks)) throw new Error('Ticket subtasks must be an array.');
    return record;
  }
  if (!nonempty(record.provider)) throw new Error('A provider is required.');
  if (kind === 'run') {
  if (!nonempty(record.name) || !runKinds.includes(record.kind)) {
      throw new Error('A run needs a name and kind (implementation, feedback or handoff).');
    }
    if (record.workSeconds != null && !amount(record.workSeconds)) throw new Error('Invalid run duration.');
    if (record.metrics != null && (!Array.isArray(record.metrics) ||
        record.metrics.some(metric => !nonempty(metric?.unit) || !amount(metric.value)))) {
      throw new Error('Run metrics need a unit and a nonnegative value.');
    }
    return { ...record, metrics: record.metrics ?? [], workSeconds: record.workSeconds ?? null };
  }
  if (!nonempty(record.account) || !nonempty(record.unit) || !timestamp(record.periodStart) ||
      !timestamp(record.periodEnd) || Date.parse(record.periodStart) >= Date.parse(record.periodEnd) ||
      !timestamp(record.observedAt) || !amount(record.used) || (record.limit != null && !amount(record.limit)) ||
      (record.overage != null && !amount(record.overage))) {
    throw new Error('Quota records need account, unit, period, observation time and observed usage.');
  }
  return record;
}

if (!['migrate', 'list', 'link', ...kinds].includes(kind) || (kind !== 'migrate' && !file)) {
  throw new Error('Usage: npm run record -- migrate | list <kind> | link <provider/run-id> <ticket-id> | <ticket|run|quota> <json-file|-> [project]');
}

const accessStore = ['list', 'migrate'].includes(kind) ? store.withStore : store.withWriteStore;
if (kind === 'list' && file === 'unassigned') {
  const { readAnalytics } = await import('./data.mjs');
  const { unassignedRuns } = await readAnalytics(project);
  console.log(JSON.stringify(unassignedRuns, null, 2));
} else accessStore(kind === 'link' ? resolve(process.env.INIT_CWD ?? process.cwd()) : project, db => {
  if (kind === 'migrate') {
    console.log('Local telemetry database is ready.');
  } else if (kind === 'list') {
    if (!kinds.includes(file)) throw new Error('Unknown record kind.');
    console.log(JSON.stringify(store.records(db, file), null, 2));
  } else if (kind === 'link') {
    db.exec('BEGIN IMMEDIATE');
    try {
      const ticketRow = db.prepare("SELECT body FROM records WHERE kind = 'ticket' AND id = ?").get(target ?? '');
      if (!ticketRow) throw new Error('Unknown ticket.');
      const ticket = JSON.parse(ticketRow.body);
      const linkedRuns = store.records(db, 'run').filter(run => run.ticketId === target);
      const row = db.prepare("SELECT body FROM records WHERE kind = 'run' AND id = ?").get(file);
      if (row) {
        const run = { ...JSON.parse(row.body), ticketId: target };
        store.assertTicketContext(ticket, ticket, linkedRuns, [...linkedRuns, run]);
        store.put(db, 'run', file, run);
      } else {
        const [, sessionId, turnId] = file.match(/^codex\/([^:]+):([^:]+)$/) ?? [];
        if (!sessionId || !store.records(db, 'attempt').some(entry => entry.sessionId === sessionId && entry.turnId === turnId)) {
          throw new Error('Unknown run.');
        }
        const tickets = store.records(db, 'ticket');
        const claim = { sessionId, turnId };
        assertUnclaimed(tickets, target, [claim]);
        if (!codexClaims(ticket).some(existing => claimsOverlap(existing, claim))) {
          if (!ticket.subtasks) throw new Error('Convert this legacy ticket to subtasks before linking additional runs.');
          const updated = { ...ticket, subtasks: [...ticket.subtasks,
            { sessionId, turnId, name: 'Codex run', kind: 'implementation', workSeconds: null }] };
          store.assertTicketContext(ticket, updated, linkedRuns);
          store.put(db, 'ticket', target, updated);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } else {
    const record = validate(JSON.parse(readFileSync(file === '-' ? 0 : resolve(file), 'utf8').replace(/^\uFEFF/, '')));
    const id = kind === 'ticket' ? record.id : `${record.provider}/${record.id}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT body FROM records WHERE kind = ? AND id = ?').get(kind, id);
      const before = previous ? JSON.parse(previous.body) : {};
      const updated = { ...before, ...record };
      if (kind === 'ticket') {
        if (before.epic !== updated.epic) {
          const epics = projectEpics(project);
          if (epics.length && !epics.some(epic => epic.name === updated.epic)) {
            throw new Error('Use an exact epic name from the project context index or register one with aip context epic.');
          }
        }
        if (updated.subtasks == null) {
          if (updated.sessionIds) delete updated.subtasks;
          else updated.subtasks = [];
        }
        validateTicket(updated);
        const previousClaims = codexClaims(before);
        const addedClaims = codexClaims(updated).filter(claim => !previousClaims.some(previous =>
          previous.sessionId === claim.sessionId && (previous.turnId === undefined || previous.turnId === claim.turnId)));
        if (addedClaims.length) assertUnclaimed(store.records(db, 'ticket'), id, addedClaims);
        store.assertTicketContext(before, updated, store.records(db, 'run').filter(run => run.ticketId === id));
      }
      if (kind === 'run' && updated.ticketId) {
        const ticketRow = db.prepare("SELECT body FROM records WHERE kind = 'ticket' AND id = ?").get(updated.ticketId);
        if (ticketRow) {
          const ticket = JSON.parse(ticketRow.body);
          const linkedRuns = store.records(db, 'run').filter(run => run.ticketId === updated.ticketId);
          store.assertTicketContext(ticket, ticket, linkedRuns,
            [...linkedRuns.filter(run => run.provider !== updated.provider || run.id !== updated.id), updated]);
        }
      }
      store.put(db, kind, id, updated);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
});
