import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import historyStore from './.codex/hooks/context-history.cjs';
import store from './.codex/hooks/performance-store.cjs';

const { transcripts, saveTranscript } = historyStore;

export async function importHistory(project, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  const packages = store.withStore(project, db => store.records(db, 'ticket'));
  const sessions = new Set();
  for (const ticket of packages) {
    for (const step of ticket?.subtasks ?? []) if (step?.sessionId) sessions.add(step.sessionId);
    for (const id of ticket?.sessionIds ?? []) sessions.add(id);
  }
  const found = new Set();
  let saved = 0;
  for (const name of ['sessions', 'archived_sessions']) {
    if (!sessions.size) break;
    for await (const { id, path } of transcripts(join(codexHome, name), sessions)) {
      found.add(id);
      if (await saveTranscript(project, path, id)) saved++;
    }
  }
  return { saved, found: found.size, total: sessions.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { saved, found, total } = await importHistory(resolve(process.argv[2] ?? process.cwd()));
  console.log(`Saved ${saved} session snapshot(s). Found ${found} of ${total} ticket sessions in Codex history.`);
}
