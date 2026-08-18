# iconsmith (monorepo)

Icon generation that cannot drift, because the model never emits a coordinate.

## Layout

```
packages/iconsmith/   the CLI and library, the only published workspace
apps/web/             the blode.co/iconsmith site
```

Each workspace has its own `AGENTS.md`. Read the one for the workspace you are
working in; `packages/iconsmith/AGENTS.md` carries the design invariants and is
the important one.

## Commands

Run these from the repo root; every one is a turbo passthrough that fans out to
whichever workspaces define the task.

```bash
npm install        # setup (requires Node >= 24.11)
npm run build
npm run test
npm run typecheck
npm run check      # lint + the layering check
npm run fix
```

## Gotchas

- **The corpus lives at `packages/iconsmith/corpus`, and must stay there.**
  `src/corpus/load.ts` defaults to a cwd-relative `"corpus"`, and turbo runs
  tasks with the cwd set to the workspace. Move the directory and five
  corpus-gated tests stop running without failing. The test count is the canary:
  it is 374 across 24 files, and a drop means the corpus is not where the code
  expects it.
- **`corpus/` in `.gitignore` is deliberately unanchored.** A leading slash would
  only match a repo-root corpus and would stage 62,550 SVGs.
- **The lint toolchain is declared only at the repo root.** `ultracite` dispatches
  to `oxlint` and `oxfmt` by bare import, so all three have to resolve from the
  same `node_modules`. Adding any of them to a workspace splits the install and
  breaks `npm run check` with a confusing "cannot find package" error.
- **`turbo.json` marks `test` uncached on purpose.** Turbo hashes git-tracked
  inputs and the corpus is gitignored, so a cached pass could stand in for a run
  that silently skipped the corpus tests.
- Root-level files are covered by no pre-commit job and by no `turbo check`. If
  you edit `turbo.json` or the root `package.json`, check them yourself.
