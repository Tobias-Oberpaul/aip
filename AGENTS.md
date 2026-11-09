# Project telemetry

The local `.codex/performance.sqlite` database holds tickets, usage and measurements. Use `npm run record -- list ticket` to inspect tickets and `npm run record -- ticket -` with JSON on stdin to create or update a ticket. Keep the database and its journal out of Git.

Record each change in the local AIP database of the repository that is changed, regardless of where the chat started. When work changes multiple repositories, record each repository's part in its own ticket.

For each implementation package, record one outcome under its epic. Record the title, initial story-point estimate and start time before implementation and retain them during follow-up. Attach rework on the same outcome to the existing ticket.

Write a short `description` for each new ticket covering the goal, relevant context and expected result. Keep the title concise.

Keep each ticket in one chat or context window. Start a new ticket for a fresh context and reference the previous ticket in the description when continuing unfinished work.

Before creating a ticket, check this project's epic list and the distinct epic names from `npm run record -- list ticket`. Use the exact name of the most specific epic that matches the primary outcome. Keep follow-ups on the original ticket and epic. Avoid spelling variants and one-off epics named after individual tickets.

- **Dashboard** covers ticket lists, charts, filters, scores and dashboard layout.
- **Telemetry** covers measurement, local persistence, attribution and history import.
- **Integration and Release** covers agent hooks, installation, npm packaging and releases.
- **Documentation** covers the public site and integration guides.

Treat **AI Performance** as the historical umbrella epic. For work spanning several areas, use the epic that best describes the main result for the user.

Begin the first visible progress update for a new implementation package with a ticket block. Format the line as `` **Ticket · <title>** `<points> SP` ``, with the points in inline code. Follow it with a blank line and one Markdown horizontal rule (`---`). Use the exact title and initial estimate stored in the ticket. For rework, use the existing ticket title and estimate. Repeat the block in the final reply so the ticket stays visible when progress updates are collapsed.

Add each Codex implementation, feedback or handoff turn exactly once under the ticket's `subtasks` with its real session ID, turn ID and measured duration in seconds. Preserve existing subtasks when updating the array. Record completion in `completedAt` and explicit acceptance separately in `acceptedAt`.

Use `npm start` to inspect local data. Run `npm run import-history` to preserve available measurements before removing old Codex sessions.

For recovery, use `npm run backup -- list` and `npm run backup -- preview <name>` to inspect local snapshots. Restore only when the user has authorized the selected snapshot, using `npm run backup -- restore <name> <version>` with the version from its preview. Report the undo snapshot returned by the command.

<!-- aip-project-context -->
## Resource Bound Documentation

Start at `CONTEXT.md` for project work and read only the matching feature note. Follow file references when more detail is needed.

Use the epic names and source folders in the index. Put feature code under its epic's folder. Keep the epic README and deeper notes beside the source they describe. Register a durable new epic with `npm run context -- epic "Epic name"` before creating its first ticket. Keep shared entry points in the repository root.

Update the matching note in the same turn when you add a feature or change a contract. Add every new source or configuration file as a backticked path in the owning note. Add a deeper file note only when it captures a non-obvious contract. Run `npm run context -- check` before finishing a code change.

For an unfinished handoff, update the local checkpoint for the same ticket using the index's format. Read it only when resuming that ticket.
<!-- /aip-project-context -->
