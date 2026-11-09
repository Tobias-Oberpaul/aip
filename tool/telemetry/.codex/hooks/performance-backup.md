# SQLite backup lifecycle

The first writer reserves the live SQLite database before creating the daily snapshot. A separate connection creates a consistent copy, verifies it, and publishes it with a rename. The rolling worker claims pending work with an in-progress marker and clears it after publishing the copy. New writes can queue another snapshot during that work. On failure the worker records the error and makes up to two retries with increasing delays. A later write can restart the worker and resume a job that still failed.

Restore checks the selected snapshot version, saves an undo copy and replaces the live records and transcripts in a transaction. Exercise the recovery path with a temporary database.
