import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export const contextMarker = '<!-- aip-project-context -->';
export const contextIndexFile = 'CONTEXT.md';
const legacyDirectory = 'docs/context';
const legacyIndex = legacyDirectory + '/index.md';

export function contextIndexPath(project) {
  return !existsSync(join(project, contextIndexFile)) && existsSync(join(project, legacyIndex))
    ? legacyIndex : contextIndexFile;
}
const epicSteering = `Use the project index as the epic list. Reuse its exact epic names on tickets
and place new feature code in the matching folder. Use aip context epic to
scaffold a durable area of work. Keep shared entry points in the root.

`;
export const legacyContextSteering = `${contextMarker}
## Resource Bound Documentation

For project work, start at \`docs/context/index.md\`. Read only the matching
feature note and follow its file references as needed. Read the source for
current implementation details.

In the same turn, update the relevant note when you add a feature, change a
contract or add a project file. List each new source or configuration path as
a backticked path in the owning feature note. Create a linked feature note only
when no existing note fits. Add a linked file note only for detail worth
retrieving separately. Keep notes short and describe intent, boundaries and
verification. Check coverage before finishing with \`npx aip context check\`.

${epicSteering}At a handoff of unfinished work, update the local checkpoint for that ticket
using the index's handoff format. For a named continuation, read only that
checkpoint and the linked feature notes before resuming.
<!-- /aip-project-context -->
`;
export const previousContextSteering = legacyContextSteering.replace(epicSteering, '');
export const contextSteering = legacyContextSteering.replace(legacyIndex, contextIndexFile)
  .replace('Add a linked file note only for detail worth',
    'Keep each note beside the source it describes. Add a linked file note only for detail worth');

export const contextIndex = `# Project context

Start with the closest feature. Follow its source references only as needed.
A feature note should summarize its purpose, constraints and verification, then list its
source files using backticked paths relative to the project root. Link a
deeper note beside the source when a file has a contract that needs its own page.

## Features

Register an epic with aip context epic "Epic name". Its link label is the
exact ticket epic and its slug is the source folder. Put a focused feature
note in the source folder when the epic needs more detail.

## Handoff

For unfinished work, keep one short local checkpoint in
\`.aip/handoffs/<ticket-id>.md\`. Record the objective, worktree or branch,
verified state, open issue, next step and relevant project-context links.
In a fresh chat, create a new ticket and reference the previous ticket in its
description. Omit transcript excerpts, secrets and tool output. Resolve
ambiguous checkpoints against the worktree before making changes.
`;

const codeFile = /(?:^|\/)(?:Dockerfile(?:\.[^/]+)?|Makefile)$|\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|cs|php|c|h|cpp|hpp|vue|svelte|html|css|scss|sql|sh|ps1|json|ya?ml|toml)$/i;
const generated = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock)$/;

function git(project, args) {
  return execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const epicLink = /^-[ \t]+\[([^\]\r\n]+)\]\((?:\.\/)?([a-z0-9-]+(?:\/[a-z0-9-]+)*)\/README\.md\)/gm;
const legacyEpicLink = /^-[ \t]+\[([^\]\r\n]+)\]\((?:\.\/)?features\/([a-z0-9-]+)\/README\.md\)/gm;
const markdownPath = /^(?:(?:[\w-]+|\.(?:codex|kiro))\/)*[\w.-]+\.md$/i;

function epicFolder(name) {
  return name.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function projectEpics(project) {
  const legacy = contextIndexPath(project) === legacyIndex;
  const indexPath = join(project, legacy ? legacyIndex : contextIndexFile);
  if (!existsSync(indexPath)) return [];
  return [...readFileSync(indexPath, 'utf8').matchAll(legacy ? legacyEpicLink : epicLink)].map(([, name, folder]) => ({
    name, folder, note: (legacy ? 'features/' : '') + folder + '/README.md',
  }));
}

export function projectDocPath(project, note) {
  if (!markdownPath.test(note)) return null;
  const index = contextIndexPath(project);
  if (note === contextIndexFile || note === 'index.md' || note === index) return index;
  if (index === legacyIndex) return note.startsWith(legacyDirectory + '/') ? note : legacyDirectory + '/' + note;
  return projectEpics(project).some(epic => note.startsWith(epic.folder + '/')) ? note : null;
}

export function projectStructure(project) {
  const legacy = contextIndexPath(project) === legacyIndex;
  return projectEpics(project).map(epic => {
    const notes = new Set([epic.note]);
    const features = [];
    for (const note of notes) {
      const path = join(project, legacy ? legacyDirectory : '', note);
      if (!existsSync(path)) {
        features.push({ note, name: epic.name, files: [], missing: true });
        continue;
      }
      const body = readFileSync(path, 'utf8');
      const prefix = posix.dirname(epic.note) + '/';
      for (const [, link] of body.matchAll(/\]\(([\w./-]+\.md)(?:#[^\s)]*)?\)/gi)) {
        const target = posix.normalize(posix.join(posix.dirname(note), link));
        if (target.startsWith(prefix) && markdownPath.test(target)) notes.add(target);
      }
      const name = body.match(/^# (.+)/m)?.[1] ?? epic.name;
      const files = [...new Set([...body.matchAll(/^[ \t]*-[ \t]+`([^`\r\n]+)`/gm)].map(match => match[1]))];
      features.push({ note, name, files });
    }
    return { ...epic, features };
  });
}

export function registerEpic(project, input) {
  const name = input.trim();
  const folder = epicFolder(name);
  if (!folder || /[\[\]\r\n]/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(folder)) {
    throw new Error('Choose an epic name that can be used as a folder name.');
  }
  const indexName = contextIndexPath(project);
  const legacy = indexName === legacyIndex;
  const indexPath = join(project, indexName);
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : contextIndex;
  const registered = projectEpics(project).find(epic => posix.basename(epic.folder) === folder || epic.name === name);
  if (registered && (registered.name !== name || posix.basename(registered.folder) !== folder)) {
    throw new Error(`The epic "${registered.name}" already owns ${registered.folder}/.`);
  }
  const sourceFolder = registered?.folder ?? folder;
  const note = (legacy ? 'features/' : '') + sourceFolder + '/README.md';
  const notePath = join(project, legacy ? legacyDirectory : '', note);
  mkdirSync(join(project, sourceFolder), { recursive: true });
  if (legacy) mkdirSync(join(project, legacyDirectory, 'features', folder), { recursive: true });
  if (!existsSync(notePath)) {
    writeFileSync(notePath, '# ' + name + '\n\nDescribe the purpose, boundaries and verification here.\n\n## Files\n', { flag: 'wx' });
  }
  if (!registered) {
    const entry = `- [${name}](${note})`;
    const heading = /^## Features[ \t]*\r?$/m;
    const updated = heading.test(index)
      ? index.replace(heading, line => line.trimEnd() + '\n\n' + entry) + (index.endsWith('\n') ? '' : '\n')
      : index.trimEnd() + '\n\n## Features\n\n' + entry + '\n';
    writeFileSync(indexPath, updated);
  }
  return sourceFolder;
}

export function checkContext(project, base = 'HEAD') {
  const indexName = contextIndexPath(project);
  const indexPath = join(project, indexName);
  const index = readFileSync(indexPath, 'utf8');
  const notes = indexName === legacyIndex
    ? [...new Set([...index.matchAll(/\]\((?:\.\/)?(features\/[\w-]+\.md)\)/g)].map(match => match[1]))] : [];
  const documented = new Set();
  const missingNotes = [];
  const invalidEpics = [];
  const owners = new Map();
  const folders = new Set();
  const names = new Set();
  for (const epic of projectStructure(project)) {
    if (posix.basename(epic.folder) !== epicFolder(epic.name) || folders.has(epic.folder) || names.has(epic.name)) invalidEpics.push(epic.name);
    folders.add(epic.folder);
    names.add(epic.name);
    for (const feature of epic.features) {
      if (feature.missing) missingNotes.push(feature.note);
      for (const file of feature.files) {
        documented.add(file);
        if (!owners.has(file)) owners.set(file, new Set());
        owners.get(file).add(epic.folder);
      }
    }
  }
  for (const note of notes) {
    const path = join(project, legacyDirectory, note);
    if (!existsSync(path)) {
      missingNotes.push(note);
      continue;
    }
    const body = readFileSync(path, 'utf8');
    for (const match of body.matchAll(/^[ \t]*-[ \t]+`([^`\r\n]+)`/gm)) documented.add(match[1]);
  }
  let additions;
  try {
    const revision = git(project, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}']).trim();
    additions = git(project, ['diff', '--no-renames', '--name-only', '--diff-filter=A', '-z', revision, '--']);
  } catch (error) {
    if (base !== 'HEAD' || !/Needed a single revision/i.test(String(error.stderr))) throw error;
    additions = git(project, ['ls-files', '--cached', '-z']);
  }
  const untracked = git(project, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = [...new Set((additions + untracked).split('\0'))]
    .filter(file => codeFile.test(file) && !generated.test(file) && existsSync(join(project, file))).sort();
  const missingFiles = files.filter(file => !documented.has(file));
  const misplacedFiles = files.filter(file => {
    const assigned = owners.get(file);
    return file.includes('/') && !file.startsWith('.') && assigned &&
      (assigned.size !== 1 || !file.startsWith([...assigned][0] + '/'));
  });
  return { missingFiles, missingNotes, invalidEpics, misplacedFiles };
}
