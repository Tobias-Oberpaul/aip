const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const dailyName = /^\d{4}-\d{2}-\d{2}\.sqlite$/;
const backupName = /^(?:latest|\d{4}-\d{2}-\d{2}|before-restore-[\da-f-]+)\.sqlite$/;
const archive = project => join(project, '.codex', 'backups');
const database = project => join(project, '.codex', 'performance.sqlite');
const interval = 10000;

function remove(path) {
  rmSync(path, { force: true });
}

function inspect(db, schema = 'main') {
  if (db.prepare(`PRAGMA ${schema}.quick_check`).get().quick_check !== 'ok') {
    throw new Error('The SQLite backup failed its integrity check.');
  }
  const counts = db.prepare(`SELECT kind, count(*) AS count FROM ${schema}.records GROUP BY kind`).all();
  const byKind = Object.fromEntries(counts.map(({ kind, count }) => [kind, count]));
  const { count: sessions } = db.prepare(`SELECT count(*) AS count FROM ${schema}.transcripts`).get();
  return { tickets: byKind.ticket ?? 0, attempts: byKind.attempt ?? 0, runs: byKind.run ?? 0, sessions };
}

function snapshot(source, directory, name) {
  const target = join(directory, name);
  const temporary = join(directory, '.' + randomUUID() + '.tmp');
  try {
    source.prepare('VACUUM INTO ?').run(temporary);
    const check = new DatabaseSync(temporary, { readOnly: true });
    try { inspect(check); } finally { check.close(); }
    renameSync(temporary, target);
  } finally {
    remove(temporary);
  }
}

const errorPath = (directory, stage) => join(dirname(directory), `performance-backup-${stage}.error`);

function noteFailure(directory, stage, error) {
  try { writeFileSync(errorPath(directory, stage), error.message); } catch {}
  console.error(`AI Performance ${stage} backup: ${error.message}`);
}

function beforeWrite(project, db) {
  const directory = archive(project);
  const name = new Intl.DateTimeFormat('sv-SE').format(new Date()) + '.sqlite';
  if (existsSync(join(directory, name))) return;
  try {
    mkdirSync(directory, { recursive: true });
    // Reserve the live database so concurrent writers cannot replace today's first snapshot.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!existsSync(join(directory, name))) {
        const source = new DatabaseSync(database(project), { readOnly: true });
        try { snapshot(source, directory, name); } finally { source.close(); }
      }
    } finally { db.exec('ROLLBACK'); }
    const days = readdirSync(directory).filter(name => dailyName.test(name)).sort().reverse();
    for (const old of days.slice(30)) remove(join(directory, old));
    remove(errorPath(directory, 'daily'));
  } catch (error) { noteFailure(directory, 'daily', error); }
}

function startWorker(directory, project) {
  const lock = join(directory, '.worker');
  try {
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 300000) remove(lock);
    closeSync(openSync(lock, 'wx'));
  } catch (error) {
    if (error.code === 'EEXIST') return;
    throw error;
  }
  const child = spawn(process.execPath, [__filename, project], {
    cwd: dirname(process.execPath), detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.on('error', error => {
    remove(lock);
    noteFailure(directory, 'latest', error);
  });
  child.unref();
}

function afterWrite(project) {
  const directory = archive(project);
  try {
    mkdirSync(directory, { recursive: true });
    closeSync(openSync(join(directory, '.pending'), 'a'));
    startWorker(directory, project);
  } catch (error) { noteFailure(directory, 'latest', error); }
}

async function refreshLatest(project) {
  const directory = archive(project);
  const pending = join(directory, '.pending');
  const inProgress = join(directory, '.in-progress');
  const hasWork = () => existsSync(pending) || existsSync(inProgress);
  let failures = 0;
  try {
    while (hasWork()) {
      try {
        const latest = join(directory, 'latest.sqlite');
        if (existsSync(latest)) await delay(Math.max(0, interval - (Date.now() - statSync(latest).mtimeMs)));
        // New writes can enqueue another snapshot while this one is running.
        if (existsSync(pending)) renameSync(pending, inProgress);
        if (!existsSync(database(project))) return;
        const source = new DatabaseSync(database(project), { readOnly: true });
        try {
          source.exec('PRAGMA busy_timeout = 2500');
          snapshot(source, directory, 'latest.sqlite');
        } finally { source.close(); }
        remove(inProgress);
        remove(errorPath(directory, 'latest'));
        failures = 0;
      } catch (error) {
        noteFailure(directory, 'latest', error);
        failures += 1;
        if (failures === 3) return;
        await delay(1000 * failures);
      }
    }
  } finally { remove(join(directory, '.worker')); }
  if (hasWork()) startWorker(directory, project);
}

function entry(path, name) {
  const { mtimeNs, size, ino } = statSync(path, { bigint: true });
  return { name, savedAt: Number(mtimeNs / 1000000n), version: `${mtimeNs}:${size}:${ino}` };
}

function list(project) {
  const directory = archive(project);
  const names = existsSync(directory) ? readdirSync(directory) : [];
  const backups = names.filter(name => backupName.test(name)).flatMap(name => {
    try { return [entry(join(directory, name), name)]; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }).sort((a, b) => b.savedAt - a.savedAt);
  const errors = ['daily', 'latest'].flatMap(stage => {
    try { return [stage + ': ' + readFileSync(errorPath(directory, stage), 'utf8')]; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  });
  return { backups, errors };
}

function backupPath(project, name) {
  if (typeof name !== 'string' || !backupName.test(name)) throw new Error('Invalid backup name.');
  return join(archive(project), name);
}

function preview(project, name) {
  const path = backupPath(project, name);
  const info = entry(path, name);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const counts = inspect(db);
    if (entry(path, name).version !== info.version) throw new Error('The backup changed. Open its preview again.');
    return { ...info, ...counts };
  } finally { db.close(); }
}

function restore(project, name, version) {
  const path = backupPath(project, name);
  const directory = archive(project);
  const undo = 'before-restore-' + randomUUID() + '.sqlite';
  if (!existsSync(database(project))) throw new Error('The live database is missing.');
  const target = new DatabaseSync(database(project));
  try {
    target.exec('PRAGMA busy_timeout = 2500');
    if (entry(path, name).version !== version) throw new Error('The backup changed. Open its preview again.');
    beforeWrite(project, target);
    target.prepare('ATTACH DATABASE ? AS saved').run(path);
    if (entry(path, name).version !== version) throw new Error('The backup changed. Open its preview again.');
    inspect(target, 'saved');
    target.exec('BEGIN IMMEDIATE');
    try {
      const source = new DatabaseSync(database(project), { readOnly: true });
      try { snapshot(source, directory, undo); } finally { source.close(); }
      target.exec(`DELETE FROM main.records;
        INSERT INTO main.records (kind, id, body) SELECT kind, id, body FROM saved.records;
        DELETE FROM main.transcripts;
        INSERT INTO main.transcripts (session_id, source_size, measurements)
          SELECT session_id, source_size, measurements FROM saved.transcripts;
        COMMIT;`);
    } catch (error) {
      target.exec('ROLLBACK');
      throw error;
    }
  } finally { target.close(); }
  afterWrite(project);
  return { undo };
}

if (require.main === module) refreshLatest(process.argv[2]).catch(error => console.error(error.message));
module.exports = { beforeWrite, afterWrite, list, preview, restore };
