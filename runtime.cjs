// Existing standalone hook configurations call this path.
const runtime = require('./tool/integration-and-release/runtime.cjs');

if (require.main === module) runtime.runFromCommandLine(__dirname);
module.exports = runtime;
