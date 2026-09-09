# iconsmith (monorepo)

Icon generation that cannot drift, because the model never emits a coordinate.

## Layout

```
packages/iconsmith/  geometry, parts, the DSL, the pipeline, eval
```

Read `packages/iconsmith/AGENTS.md` before editing the engine; it carries the
design invariants. The website, Studio, Eve service, and browser viewer are removed.

## Commands

Run these from the repo root. Build, typecheck and fix fan out through Turbo;
test and check also run root guards. The local commands target only the engine.

```bash
npm install        # setup (requires Node >= 24.11)
npm run build:local # engine only; sufficient for the README quickstart
npm run iconsmith -- --help
npm run generate:local -- --help
npm run build
npm run test
npm run typecheck
npm run check      # lint + the layering check
npm run fix
npm run check:dead    # Knip unused files, exports and dependencies
npm run check:foundry # cheap root configuration guards
npm run verify       # serialized integrated checks with immutable evidence
```

## Gotchas

- **The corpus lives at `packages/iconsmith/corpus`, and must stay there.**
  `src/corpus/load.ts` defaults to a cwd-relative `"corpus"`, and turbo runs
  tasks with the cwd set to the workspace. Move the directory and twelve
  corpus-gated tests stop running without failing. **The canary is the skipped
  count, not the total.** Those twelve are gated with `describe.skipIf` /
  `it.skipIf`, which still *collects* them, so an absent corpus reports them as
  skipped and leaves the total untouched. Check the skipped count: `0 skipped`
  means the corpus was found; `12 skipped` means it was absent. Total test counts
  change with the source tree and are not a corpus-presence check. The gated twelve live in `corpus/measure.test.ts` (5),
  `pipeline/bench.test.ts` (2), `pipeline/reconstruct.test.ts` (2), and one each
  in `eval/conformance.test.ts` and `parts/vocabulary.test.ts`; the twelfth is
  the real bell source fixture in
  `scripts/family-parts.test.ts`. A single skip can indicate that this exact source
  is missing even when the remaining corpus is present. Seven additional
  source-admission controls in `scripts/family-parts.test.ts` require the sibling
  `blode-icons` checkout; those skips are separate from the corpus canary.
  The retained D492 crop test in `scripts/raster-proposal-feasibility.test.ts`
  skips if its private staging image is absent; that diagnostic skip is also
  separate from the twelve corpus-gated tests.
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
  config that extends it. Unpin only after checking the installed Ultracite preset still loads.
- **Nothing here is published.** `packages/iconsmith` is `private: true` with no
  `version`, no `bin` and no `files`; changesets and the Release workflow are
  gone, having failed on every push for want of anything to release. The CLI is
  still built and still works — `pipeline/harness.ts` symlinks `dist/cli.js` onto
  PATH so the spawned drawing model can run `iconsmith draw` to check its own
  work — it is simply no longer a `bin` anyone installs. Do not re-add npm
  metadata to make a tool feel finished.
- **The lint config lives in `packages/iconsmith`.** It formats its Markdown.
  There is no root Ultracite config; run `npm run check` from the root.
- Root configuration invariants are checked by `npm run check:foundry`, wired
  into pre-commit and `npm run check`. Root JSON/YAML formatting still needs a
  scoped `npx oxfmt --check` when those files change.

## Foundry history

Read [docs/foundry-log.md](docs/foundry-log.md) before continuing foundry work.
First read the short startup section of [the footgun log](docs/foundry-footguns.md),
then search it by symptom before opening more history or repeating an experiment.
Use the relevant prior failure and a changed-variable rationale to avoid rerunning
known dead ends. This log is lessons, not a second execution checklist.
Keep it updated with every material decision and experiment, including failures,
misconfigured runs, offline probes, costs, evidence paths and unresolved findings.
Append corrections and superseding decisions; do not erase failed attempts or
rewrite their original artifacts. Record paid intent/reservation before calling
providers and reconcile actual/unknown costs before ending the session. Retain
small durable receipts in `docs/log/`; leave large/private reference assets and
the corpus in their existing locations. This log is required by the user.

When backfilling research or deciding whether to repeat an experiment, use
`claude-code-search` (`ccs`) across the current project and its former
`icon-forge` path, then consult [the research history](docs/project-research-history.md)
and its source index. Attribute historical claims to their records; do not treat
old assistant prose as verified research or merge historical costs into a new round.
