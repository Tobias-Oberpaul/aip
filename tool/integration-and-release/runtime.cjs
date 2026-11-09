const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { delimiter, join, resolve } = require('node:path');

function runNode(script, args, options = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const executable = process.platform === 'win32' ? 'node.exe' : 'node';
  const candidates = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    .map(directory => join(directory.replace(/^"|"$/g, ''), executable));
  if (process.platform === 'win32') {
    candidates.push(join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin', executable));
  }
  const node = major > 22 || (major === 22 && minor >= 13) ? process.execPath : candidates.find(candidate =>
    existsSync(candidate) && spawnSync(candidate, ['-e',
      "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1); require('node:sqlite')",
    ], { stdio: 'ignore', windowsHide: true }).status === 0);
  if (!node) throw new Error('AI Performance requires Node.js 22.13 or newer. Add it to PATH and restart your terminal and agent.');
  const child = spawnSync(node, [script, ...args], { stdio: 'inherit', windowsHide: true, ...options });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

function runFromCommandLine(base = __dirname) {
  const [script, ...args] = process.argv.slice(2);
  try { runNode(resolve(base, script), args); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

if (require.main === module) runFromCommandLine();

module.exports = { runNode, runFromCommandLine };
