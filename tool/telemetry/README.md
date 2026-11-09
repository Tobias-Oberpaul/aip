# Measurement and attribution

Tickets hold the outcome and link runs by stable identifiers. Provider adapters capture available measurements in project-local SQLite. Codex attempts are persisted as they arrive, and imported history can supply context or recover gaps. Aggregate comparable units separately. Keep private data in Git-ignored local storage.

The recorder and Kiro hook prevent adding a different known chat to a ticket. The Kiro hook saves a conflicting run as unassigned. Legacy tickets spanning chats stay in project history and are excluded from the per-chat trend. The advisory can use any adapter with a measured context percentage. Codex currently supplies that measurement from saved usage events.

The early chat comparison uses the same per-chat cohort as the trend. Its project reference excludes every ticket linked to that chat, including legacy tickets that also link other chats.

The recorder validates ticket dates, estimates and subtask fields before saving. Both ticket writes and explicit run linking reject new Codex claims that overlap another ticket, including legacy claims for an entire session. An existing claim can be retained while editing other ticket fields.

Run `npm test` with a compatible Node runtime after changing attribution or persistence.

See [Local recovery](recovery.md) for snapshots and restore.

## Files

- `tool/telemetry/data.mjs` joins runs and attempts to tickets and computes the dashboard metrics.
- `tool/telemetry/record.mjs` writes and links records through the local CLI.
- `tool/telemetry/rollout.mjs` reads saved Codex measurements.
- `tool/telemetry/import-history.mjs` imports available history into the project.
- `tool/telemetry/.codex/hooks/context-history.cjs` persists sanitized measurement events.
- `tool/telemetry/.codex/hooks/performance-store.cjs` owns the shared SQLite store.
- `tool/telemetry/.codex/hooks/context-usage.cjs` captures direct Codex attempts.
- `tool/telemetry/.codex/hooks/context-package-check.cjs` verifies that changed work has a ticket.
- `tool/telemetry/.codex/context-packages.json` is the empty standalone ticket template.
- `tool/telemetry/.codex/hooks.json` configures standalone Codex capture.
- `tool/telemetry/.kiro/hooks/performance.json` configures standalone Kiro capture.
- `tool/telemetry/.kiro/hooks/performance-run.cjs` captures Kiro runs.
