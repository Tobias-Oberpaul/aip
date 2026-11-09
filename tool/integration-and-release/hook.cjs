const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runNode } = require('./runtime.cjs');

const marker = '.codex/ai-performance-enabled.json';
const handlers = {
  'codex-check': '../telemetry/.codex/hooks/context-package-check.cjs',
  'codex-usage': '../telemetry/.codex/hooks/context-usage.cjs',
  'codex-history': '../telemetry/.codex/hooks/context-history.cjs',
  'kiro-run': '../telemetry/.kiro/hooks/performance-run.cjs',
};

function run(project, handler) {
  if (!Object.hasOwn(handlers, handler)) throw new Error('Unknown AI Performance hook.');
  let enabled;
  try {
    enabled = JSON.parse(readFileSync(join(project, marker), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!enabled[handler.split('-')[0]]) return;
  runNode(join(__dirname, handlers[handler]), [], {
    cwd: project, env: { ...process.env, AI_PERFORMANCE_PROJECT: project },
  });
}

module.exports = { marker, run };
