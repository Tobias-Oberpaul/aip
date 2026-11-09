# Integration and Release

The npm package ships the local dashboard, CLI and provider adapters. Enabling provider hooks is local to the clone. The runtime launcher locates a compatible Node executable. The public site is built separately from the local dashboard.

AIP setup adds repository-local ticket ownership as a separate section in `AGENTS.md`. After upgrading the package, run `npx aip init --context` from the project's root to add the rule without reconfiguring provider hooks. The refresh preserves existing project instructions and epic guidance.

Use `npm run test:package` to check installed behavior in a temporary Git clone.
Pull requests run telemetry, context and installed-package checks on Windows and Linux. The Linux job also builds the public site.

The dashboard requests `GET /api/performance?view=dashboard`. The server reuses
that compact response for the same SQLite data and analytics code version, and
honors `If-None-Match`. Unqualified analytics requests retain the full response.

## Files

- `tool/integration-and-release/cli.mjs` exposes the npm commands.
- `tool/integration-and-release/init.mjs` installs provider hooks or just the project-context files.
- `tool/integration-and-release/hook.cjs` dispatches enabled provider hooks.
- `tool/integration-and-release/runtime.cjs` selects Node with SQLite support and forwards the command.
- `tool/integration-and-release/serve.mjs` serves dashboard assets, data and project documentation. Restart it after route changes.
- `tool/integration-and-release/test-package.mjs` checks the packed package.
- `.github/workflows/checks.yml` runs the PR checks without publishing.
- `runtime.cjs` forwards existing standalone hook commands.
- `package.json` defines published files and stable commands.
