# autoresearch.md

The standing instructions for the **offline** analog/recipe campaign. **A
human writes this file; `scripts/autoresearch.ts` reads it and cannot write
it.** It is not the artefact under optimisation. The policy campaign
(`program.md` + `scripts/loop.ts`) and the harness campaign (`lab.md` +
`scripts/research.ts`) stay intact. This loop does not raise
`LIMITS.totalText`, does not add a lint toolchain to a workspace, and does
not unpin oxlint 1.78.0.

The loop refuses to start if this file is missing. Every ledger row records
its hash, so an iteration can be attributed to the instructions that were in
force when it ran.

This is the Karpathy org, not his `train.py`. One change per round. Measure,
edit one editable surface, remeasure, keep or revert. `accept.ts` already
rejected naive single-set `val_bpb` as selection on noise; this scoreboard
is not "unknown rate went down" (that is gamed by drawing hubs) and is not
a growing `ANALOG_KINS` dump.

## What the loop may change

Only the paths in the `editable` block. A kept iteration commits those files
to `iconsmith/autoresearch` and nothing else. The branch tip is the champion;
`git log iconsmith/autoresearch` is the record of what survived. `results.tsv`
is untracked.

```editable
packages/iconsmith/src/pipeline/analog.ts
packages/iconsmith/src/pipeline/recipe.ts
```

Families, recipe → family mapping, and the name-hint table. Not a volunteer
glyph. Not a kin-row dump as the win condition. One construction or one
mapping per round.

## What it may never change

```frozen
packages/iconsmith/program.md
packages/iconsmith/lab.md
packages/iconsmith/autoresearch.md
packages/iconsmith/scripts/loop.ts
packages/iconsmith/scripts/research.ts
packages/iconsmith/scripts/autoresearch.ts
packages/iconsmith/scripts/gate.ts
packages/iconsmith/scripts/check-boundaries.ts
packages/iconsmith/src/eval/blindspot.ts
packages/iconsmith/src/tools/render.ts
packages/iconsmith/bench/reconstruction.json
packages/iconsmith/bench/calibration.v1.json
packages/iconsmith/bench/noise-floor.json
```

Lint authority stays at the repo root. Bench calibrations stay measured.

## How an iteration is decided

Three outcomes, not two: `keep | discard | crash`. A crash is not a bad
score — the arms did not both run.

**Floor (any drop = discard; tests red = crash).**

- The vitest file set the loop invokes (`analog.test.ts`, `recipe.test.ts`
  by default; `npm run test` plus typecheck under `--floor full`).
- Analog `clean` on the fixed recipe set (every `PAINT_RECIPES` id, both
  paints).
- Compile twin-eval, when house files exist: outlined mean ≥ 0.99, filled
  mean ≥ 0.99, empty 0. Missing house is a logged skip — never a faked 1.000.
- Hold-outs below stay `unknown`. Drawing them is a discard.

**Advance (keep only if every floor holds AND one of these improves).**

- More probed names that are concept-correct AND clean in both paints.
- Fewer recipe-without-drawing holes (a recipe id with no family program).
- Twin-pair **errors** down (empty tile, extent, restamp).
- Gap **errors** down (warns are not this number).

A tiny gain that adds hacky complexity is a discard. Adding twenty kin rows
to move "unknown rate" is a discard. Volunteering `star` is a discard.

```holdout
star
compass
quokka
xyzzy
```

```probed
home
house
cactus
lighthouse
telescope
checkmark
wall-clock
plus-sign
heart
bell
lock
ring
mushroom
hourglass
sailboat
```

## NEVER STOP

When `--rounds` is large (overnight is `--rounds 50`) the loop does not
stop because a round was a keep, a discard, or "good enough". It walks the
playbook, one change per round, until N is spent. Exhausted playbook rows
are idle, not invented work. `--rounds` omitted defaults to **1** so a
forgotten invocation cannot run overnight on a dirty hypothesis; pass
`--rounds 50` to leave it running. Do not ask the human mid-loop.

## What to try

One item per round. Skip an item that is already true.

1. **recipe-drawings** — Wire a remaining recipe-without-drawing (a
   `PAINT_RECIPES` id with no family program). Skip if every recipe already
   draws in both paints.
2. **cactus-gap** — Close a documented analog gap *error* on cactus. Skip
   if cactus has no gap error in either paint.
3. **tower-tube-gap** — Close a documented analog gap *error* on tower /
   lighthouse or telescope. Skip if those names have no gap error.
4. **checkmark-clean** — Make `checkmark` stay clean in both paints if a
   regression appears. Skip if both paints are already clean.
5. **home-family** — `home` / `house` is in the 20-set and still unknown.
   Add one roof+body family in `analog.ts` (hint may cover `house`). Not a
   kin dump. Skip if analog already draws `home` as a named family.
6. **heart-recipe** — Heart already has a family. Add a paint recipe only
   if that mapping is still missing. Skip if `recipeFor("heart")` fires.
7. **bell-recipe** — Bell already has a family. Add a paint recipe only if
   that mapping is still missing. Skip if `recipeFor("bell")` fires.

## What not to try

- Do not raise `LIMITS.totalText`.
- Do not add oxlint, oxfmt, or ultracite to a workspace.
- Do not unpin oxlint from 1.78.0.
- Do not volunteer glyphs or the hold-outs.
- Do not grow `ANALOG_KINS` as the win.
- Do not write this file, `program.md`, `lab.md`, the gates, or `render.ts`.
- Do not commit corpus, `results.tsv`, OpenRouter keys, or staging dumps.
