const { join } = require('node:path');
const { runHook } = require('../../tool/telemetry/.codex/hooks/context-history.cjs');

runHook(join(__dirname, '..', '..')).catch(error => {
  console.error('Analytics history:', error.message);
  process.exitCode = 1;
});
