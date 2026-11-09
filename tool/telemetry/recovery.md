# Local recovery

The shared write path creates a verified daily snapshot before the first write and batches updates to the rolling copy. The archive is per clone. Recovery is performed through the CLI and requires a matching preview version. The pre-restore state is saved for undo.

## Files

- `tool/telemetry/.codex/hooks/performance-backup.cjs` owns snapshots, verification and restore. See [backup details](.codex/hooks/performance-backup.md).
- `tool/telemetry/history.test.mjs` exercises snapshot creation and CLI recovery in a temporary database.
