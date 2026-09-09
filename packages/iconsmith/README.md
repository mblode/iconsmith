# Iconsmith engine

The local CLI, drawing geometry, DSL, generation pipeline, and evaluation tools.

Start with the [repository quickstart](../../README.md) and [local setup guide](../../docs/local-setup.md). Run commands from the repository root:

```bash
npm ci
npm run build:local
npm run iconsmith -- draw examples/square-check.icon -o square-check.svg
npm run iconsmith -- lint square-check.svg
npm run generate:local -- --help
```

This private workspace has no npm release or package API. Internal scripts import source modules directly. Read [AGENTS.md](AGENTS.md) for design invariants and [the foundry guide](../../docs/local-foundry.md) for pinned-style generation inputs.
