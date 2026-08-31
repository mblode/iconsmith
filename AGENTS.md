# iconsmith (monorepo)

Icon generation that cannot drift, because the model never emits a coordinate.

## Layout

```
apps/web/            the blode.co/iconsmith site and the Studio client
apps/agent/          the eve agent, and the drawing pipeline it runs
packages/iconsmith/  geometry, parts, the DSL, the pipeline, eval
packages/contract/   what the client and the agent must agree on
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
  tasks with the cwd set to the workspace. Move the directory and twelve
  corpus-gated tests stop running without failing. **The canary is the skipped
  count, not the total.** Those twelve are gated with `describe.skipIf` /
  `it.skipIf`, which still *collects* them, so an absent corpus reports them as
  skipped and leaves the total untouched — `1397 (98 files)` either way, of which
  1385 pass and 12 skip with no corpus on disk. So `0 skipped` means the corpus
  was found and `12 skipped` means it was not; a drop in the *total* is test-count
  drift, a different fault. Update both numbers when you add tests, or neither is
  a canary. The gated twelve live in `corpus/measure.test.ts` (5),
  `pipeline/bench.test.ts` (2), `pipeline/reconstruct.test.ts` (2), and one each
  in `scripts/demo.test.ts`, `eval/conformance.test.ts` and
  `parts/vocabulary.test.ts`.
- **A cloud checkout has no corpus, and cannot get one.** `load.ts` says it: "it
  is not shipped with iconsmith. Pass `--corpus <dir>` to point at one." There is
  no fetch script, no npm package, and no public source — it is 247MB of Central
  drawn 30 ways plus seven third-party packs that `licence.ts` exists to keep out
  of a generation. So on any machine but the author's, those twelve skip, and
  every constant they hold the spec to (the 29.3% off-axis rate, `minGap`,
  `minFeature`) is unverified rather than wrong. **Do not synthesise one to make
  them run.** A single-variant directory built out of `blode-icons` satisfies the
  loader and measures a different population, which turns a gate that honestly
  skips into one that runs and reports nothing — the same fault as a canary that
  cannot fire, wearing a green tick. What you *can* do is check a rule against a
  real set directly: `blode-icons` is public, and is one of the two populations
  `lint.ts` quotes the off-axis rate from.
- **The corpus is ignored by full path: `/packages/iconsmith/corpus/`.** Not a bare
  `corpus/`, which has no anchor and so matches a directory at any depth, including
  `packages/iconsmith/src/corpus/`, which silently hid new source files there from
  `git add`. Not `/corpus/` either, which anchors to the repo root where no corpus
  lives and ignores nothing, staging 62,550 SVGs.
- **The lint toolchain is declared only at the repo root.** `ultracite` dispatches
  to `oxlint` and `oxfmt` by bare import, so all three have to resolve from the
  same `node_modules`. Adding any of them to a workspace splits the install and
  breaks `npm run check` with a confusing "cannot find package" error.
- **`turbo.json` marks `test` uncached on purpose.** Turbo hashes git-tracked
  inputs and the corpus is gitignored, so a cached pass could stand in for a run
  that silently skipped the corpus tests.
- **`oxlint` is pinned to exactly 1.78.0.** 1.79 dropped `react/react-compiler`,
  which ultracite 7.10.5's react preset still sets, so the pair fails to parse any
  config that extends it. Unpin only after checking `apps/web` still lints.
- **Nothing here is published.** `packages/iconsmith` is `private: true` with no
  `version`, no `bin` and no `files`; changesets and the Release workflow are
  gone, having failed on every push for want of anything to release. The CLI is
  still built and still works — `pipeline/harness.ts` symlinks `dist/cli.js` onto
  PATH so the spawned drawing model can run `iconsmith draw` to check its own
  work — it is simply no longer a `bin` anyone installs. Do not re-add npm
  metadata to make a tool feel finished.
- **The lint configs are per workspace and they disagree on purpose.**
  `apps/web`, `apps/agent` and `packages/contract` ignore `**/*.md`;
  `packages/iconsmith` formats its markdown. Aligning them would reflow prose in
  one direction or stop checking it in the other. There is no config at the repo
  root, which is why `npx ultracite` fails there and `npm run check` (turbo,
  fanning out) is the command to use.
- Root-level files are covered by no pre-commit job and by no `turbo check`. If
  you edit `turbo.json` or the root `package.json`, check them yourself.
