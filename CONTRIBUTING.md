# Contributing

Read [AGENTS.md](AGENTS.md) for repository commands and engine invariants.
See [local setup](docs/local-setup.md) for source development, outputs and troubleshooting.

## Releases

Run `npm run changeset` from the repository root for user-facing package changes
and commit the generated file. CI opens a Version Packages PR and publishes after
it merges. See [release setup](.changeset/README.md) for trusted publishing.

## Historical showcase

The [showcase](docs/showcase.png) contains six concepts in both paints selected
from the ten-icon run on 2026-09-09. The other four had contour defects; it is not
a quality guarantee for the current workflow. Regenerate it with
`npx tsx packages/iconsmith/scripts/showcase-sheet.ts`.
