# Documentation

The project index routes agents to one feature note at a time. Feature notes state the behavior, constraints and verification path. List new source and configuration files as backticked repository-relative paths on bullet lines. Use a deeper file note for contracts that need a separate reference.

The index registers the canonical ticket epic name and its source folder. Use
`npm run context -- epic "Epic name"` to create an area. Put its detailed notes
beside the resources they describe and link them from the epic README. The local
check compares new code paths against these notes and checks ownership. It reads
Git and Markdown without a model call. The dashboard opens the same root index
and follows the same links. Projects with an existing `docs/context/index.md`
can continue using that layout.

## Files

- `tool/documentation/context.mjs` registers epics, reads the project map and checks file ownership, including epic folders nested beneath a product area.
