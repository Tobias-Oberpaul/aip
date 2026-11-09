# AIP project context

AIP collects local AI work measurements, links them to tickets and serves a dashboard. Start with the feature closest to your task. Follow a deeper link only when its contract is relevant.

## Features

- [Dashboard](dashboard/README.md) covers the browser UI, filters, KPIs, heatmap and ticket drawer.
- [Website](website/README.md) covers the public site and its GitHub Pages build.
- [Design System](design-system/README.md) covers shared components, tokens and documentation navigation.
- [Telemetry](tool/telemetry/README.md) covers ingestion, SQLite, tickets, metrics, history import and recovery.
- [Integration and Release](tool/integration-and-release/README.md) covers the CLI, local server, runtime, setup and npm packaging.
- [Documentation](tool/documentation/README.md) covers the project map and agent guidance.

The link label is the exact epic name. The link points to its source folder,
including areas nested under `tool/`. Register new areas using
`npm run context -- epic "Epic name"`. Link feature and file notes from the epic README and store them beside the code they describe.

## Handoff

For unfinished work, keep one checkpoint in `.aip/handoffs/<ticket-id>.md` in the active checkout. Include the ticket ID, objective, worktree or branch, verified state, unresolved issue, next concrete step and links to relevant feature notes. In a fresh chat, create a new ticket and reference the previous ticket in its description. Keep the checkpoint short and omit secrets, transcript excerpts and tool output. A new agent should reconcile the note with the current worktree before continuing.
