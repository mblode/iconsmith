# autoresearch.md

The standing instructions for the **generation-pipeline meta-loop**. **A
human writes this file; `scripts/autoresearch.ts` reads it and cannot write
it.** It is not the artefact under optimisation. The policy campaign
(`program.md` + `scripts/loop.ts`) and the harness campaign (`lab.md` +
`scripts/research.ts`) stay intact. This loop does not raise
`LIMITS.totalText`, does not add a lint toolchain to a workspace, and does
not unpin oxlint 1.78.0.

The loop refuses to start if this file is missing. Every ledger row records
its hash, so an iteration can be attributed to the instructions that were in
force when it ran.

This is the Karpathy org, not his `train.py`. The product is: run
`scripts/autoresearch.ts` here. It edits the generation codebase in process
(playbook and/or OpenRouter), measures, and keeps or `git reset`s. Cursor
Cloud Agents are not this loop. There is no `NEXT.md`, no spawn brief, and
nothing to paste into cursor.com/agents.

The training surface is the generation pipeline (pipeline / tools /
commands / tests / SKILL / generate prompts), not two analog files. One
change per round.

`accept.ts` already rejected naive single-set `val_bpb` as selection on
noise; this scoreboard is not "unknown rate went down" (that is gamed by
drawing hubs) and is not a growing `ANALOG_KINS` dump.

## What the loop may change

Only paths that match the `editable` block and do not match `frozen`.
Globs are directory prefixes, not a licence to dump. A kept iteration
commits those files on the current branch (or `--branch`) and nothing
else. `results.tsv` is untracked under `.staging/`.

```editable
# Generation pipeline. One change per round. Not an unbounded dump of kins,
# glyphs, prompts, or generated SVG.
packages/iconsmith/src/pipeline/**
packages/iconsmith/src/tools/**
packages/iconsmith/src/commands/**
packages/iconsmith/SKILL.md
```

That includes tests next to those files (`*.test.ts` under the same
directories) and the generate prompts that steer the model
(`src/pipeline/prompt.ts`, `src/pipeline/prompt.baseline.txt`). Analog and
recipe stay editable because they live under `pipeline/`. `render.ts` is
under `tools/` and is **frozen** below — frozen wins.

Families, recipe → family mapping, name-hint tables, SELECT / DRAW / CHECK
steering, SKILL wording, command surfaces. Not a volunteer glyph. Not a
kin-row dump as the win condition. One construction, one mapping, or one
pipeline/tool/command/skill edit per round.

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
package.json
```

Lint authority stays at the repo root (`oxlint` stays pinned at 1.78.0).
Bench calibrations stay measured. `render.ts` knobs stay the ones 0.737
was taken under. Do not raise `LIMITS.totalText`. Do not volunteer glyphs
or the hold-outs.

## How an iteration is decided

Three outcomes, not two: `keep | discard | crash`. A crash is not a bad
score — the arms did not both run.

**Floor (any drop = discard; tests red = crash).**

- The tests the loop invokes: `analog.test.ts` and `recipe.test.ts` by
  default, plus the test file next to a touched source; `npm run test`
  plus typecheck under `--floor full`.
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
Raising `LIMITS.totalText` is a discard. A dump of files (more than one
change plus its neighbour test) is a discard.

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

`--rounds N` applies one in-process change per round until N is spent.
A keep, a discard, or "good enough" does not stop the loop. Exhausted
playbook rows are idle, not invented work and not a brief for another
agent. `--rounds` omitted defaults to **1** so a forgotten invocation
cannot run overnight on a dirty hypothesis; pass `--rounds 50` to leave
it running. Do not ask the human mid-loop.

OpenRouter is used when `OPENROUTER_API_KEY` is set, or when
`/tmp/openrouter.env` contains that key. The key is never committed.

## What to try

One item per round. Skip an item that is already true. Apply the rest
in process — playbook hardcode and/or one OpenRouter find/replace.

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
   Add one roof+body family in `analog.ts` (whole-name hint may cover
   `house`; `tree-house` stays unknown). Not a kin dump. Skip if analog
   already draws `home` as a named family.
6. **heart-recipe** — Heart already has a family. Add a paint recipe only
   if that mapping is still missing. Skip if `recipeFor("heart")` fires.
7. **bell-recipe** — Bell already has a family. Add a paint recipe only if
   that mapping is still missing. Skip if `recipeFor("bell")` fires.
8. **skill-steer** — One edit to `SKILL.md` or `prompt.ts` /
   `prompt.baseline.txt` that steers the model toward a remaining house
   paint recipe or a remaining probed name. Skip if no such leftover
   remains. Apply in process; do not write a spawn brief.
9. **twin-pair** — One pipeline/tools edit that drops a twin-pair **error**
   (empty / extent / finish) on a probed name. Skip if `twinPairErrors` is
   0. Apply in process; do not invent a hacky restamp.
10. **gap-error** — One pipeline/tools edit that drops a gap **error** on a
    probed name. Skip if gap errors are 0. Apply in process.

## What not to try

- Do not raise `LIMITS.totalText`.
- Do not add oxlint, oxfmt, or ultracite to a workspace.
- Do not unpin oxlint from 1.78.0.
- Do not volunteer glyphs or the hold-outs.
- Do not grow `ANALOG_KINS` as the win.
- Do not write this file, `program.md`, `lab.md`, the gates, `render.ts`,
  or an unbounded dump under `pipeline/`.
- Do not commit corpus, `results.tsv`, OpenRouter keys, or staging dumps.
- Do not merge. If the floor drops, revert.
