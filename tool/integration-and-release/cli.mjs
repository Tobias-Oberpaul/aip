#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
const help = `AI Performance

Usage:
  aip serve [project] [--codex-history]
  aip init --codex [--kiro]
  aip init --kiro
  aip init --context
  aip disable
  aip record <arguments>
  aip import-history [project]
  aip backup list
  aip backup preview <name>
  aip backup restore <name> <version>
  aip context check [base]
  aip context epic <name>
  aip --version

Run init, disable and backup from the target Git repository root.`;

try {
  if (command === 'init' || command === 'disable') {
    const { init, disable } = await import('./init.mjs');
    if (command === 'init') await init(process.cwd(), args);
    else {
      if (args.length) throw new Error('disable does not accept arguments.');
      await disable(process.cwd());
    }
  } else if (command === 'serve' || command === 'record') {
    process.argv.splice(2, 1);
    // npm may retain INIT_CWD from a calling script. The CLI targets its working directory.
    process.env.INIT_CWD = process.cwd();
    if (command === 'serve') await import('./serve.mjs');
    else await import('../telemetry/record.mjs');
  } else if (command === 'import-history') {
    if (args.length > 1) throw new Error('import-history accepts one project path.');
    const { importHistory } = await import('../telemetry/import-history.mjs');
    const { saved, found, total } = await importHistory(resolve(args[0] ?? process.cwd()));
    console.log(`Saved ${saved} session snapshot(s). Found ${found} of ${total} ticket sessions in Codex history.`);
  } else if (command === 'backup') {
    const [operation, name, version] = args;
    const project = process.cwd();
    const { default: backups } = await import('../telemetry/.codex/hooks/performance-backup.cjs');
    let result;
    if (operation === 'list' && args.length === 1) result = backups.list(project);
    else if (operation === 'preview' && args.length === 2) result = backups.preview(project, name);
    else if (operation === 'restore' && args.length === 3) result = backups.restore(project, name, version);
    else throw new Error('Usage: aip backup list | preview <name> | restore <name> <version>');
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'context') {
    const { checkContext, contextIndexPath, registerEpic } = await import('../documentation/context.mjs');
    if (args[0] === 'epic' && args.length === 2) {
      const folder = registerEpic(process.cwd(), args[1]);
      console.log(`Epic registered in ${contextIndexPath(process.cwd())} · ${folder}/`);
    } else if (args[0] === 'check' && args.length <= 2) {
      const { missingFiles, missingNotes, invalidEpics, misplacedFiles } = checkContext(process.cwd(), args[1]);
      for (const path of missingNotes) console.error(`Missing feature note: ${path}`);
      for (const path of missingFiles) console.error(`Missing file reference: ${path}`);
      for (const name of invalidEpics) console.error(`Duplicate epic or mismatched folder: ${name}`);
      for (const path of misplacedFiles) console.error(`File does not match its documented epic folder: ${path}`);
      if (missingFiles.length || missingNotes.length || invalidEpics.length || misplacedFiles.length) process.exitCode = 1;
      else console.log('Project context covers the new source files.');
    } else throw new Error('Usage: aip context check [base] | aip context epic <name>');
  } else if (command === '--version' || command === '-v') {
    console.log(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
  } else if (!command || command === '--help' || command === '-h') {
    console.log(help);
  } else {
    throw new Error(`Unknown command: ${command}. Run aip --help.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
