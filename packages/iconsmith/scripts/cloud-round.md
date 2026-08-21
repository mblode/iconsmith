# Cloud Agent spawn brief (template)

Paste this file — or the filled copy at `.staging/autoresearch/NEXT.md` —
into a **new** Cloud Agent at https://cursor.com/agents.

The `cursor-cloud` MCP can list/inspect Cloud Agents. It cannot launch one.
This VM has no spawn CLI or API token either. Do not invent a launcher.

## Repo and branch

- Repo: this iconsmith monorepo (same remote you are reading).
- Work ONLY on `iconsmith/autoresearch` or `cursor/autoresearch-c1f5`.
- Do not edit `cursor/filled-twins-c1f5`.
- Do not merge. Commit + push. If the floor drops, revert.

## Who writes what

A human wrote `packages/iconsmith/autoresearch.md`. You do not write it.
You edit the **generation pipeline** (one change), measure, keep or revert.
`program.md` + `scripts/loop.ts` and `lab.md` + `scripts/research.ts` stay
intact.

## Current metric / last keep

<!-- filled into NEXT.md after each measure -->

- metric: `{{METRIC}}`
- last keep: `{{LAST_KEEP}}`
- standing sha: `{{STANDING_SHA}}`

## The one leftover to attack

`{{LEFTOVER}}`

One change. Hacky complexity is a discard. A kin-row dump is a discard.
Do not volunteer `star`, `compass`, `quokka`, or `xyzzy`. Do not raise
`LIMITS.totalText`.

## Editable (globs; frozen wins)

```
packages/iconsmith/src/pipeline/**
packages/iconsmith/src/tools/**
packages/iconsmith/src/commands/**
packages/iconsmith/SKILL.md
```

Tests next to those files, and generate prompts under `pipeline/`, are
included. Not an unbounded dump.

## Frozen

```
packages/iconsmith/program.md
packages/iconsmith/lab.md
packages/iconsmith/autoresearch.md
packages/iconsmith/scripts/loop.ts
packages/iconsmith/scripts/research.ts
packages/iconsmith/scripts/autoresearch.ts
packages/iconsmith/scripts/gate.ts
packages/iconsmith/scripts/check-boundaries.ts
packages/iconsmith/scripts/cloud-round.md
packages/iconsmith/src/eval/blindspot.ts
packages/iconsmith/src/tools/render.ts
packages/iconsmith/bench/reconstruction.json
packages/iconsmith/bench/calibration.v1.json
packages/iconsmith/bench/noise-floor.json
package.json
```

Root lint toolchain / oxlint 1.78.0 stay put.

## Floor (any drop = revert)

- Tests you invoke (analog + recipe, plus the neighbour test of a touched
  file). Red tests are a crash, not a "worse score".
- Analog clean on every `PAINT_RECIPES` id, both paints.
- Twin-eval ≥ 0.99 outlined and filled, empty 0, when house files exist.
  Missing house is a skip, never a faked 1.000.
- Hold-outs stay unknown: `star`, `compass`, `quokka`, `xyzzy`.

## Advance (keep only if the floor holds AND one of these moves)

- Concept-correct net-new (probed name, clean in both paints).
- Fewer recipe-without-drawing holes.
- Twin-pair errors down.
- Gap errors down.

## After the edit

```bash
# from repo root
npm test --workspace=iconsmith -- src/pipeline/analog.test.ts src/pipeline/recipe.test.ts
# plus the test next to the file you touched
git add -- <editable paths only>
git commit -m "autoresearch: keep <id>"
git push -u origin HEAD
```

- Do not merge.
- Do not commit secrets, corpus, `results.tsv`, or `NEXT.md`.
- If the floor drops, `git reset --hard HEAD` (or revert the keep).
- Then run `npx tsx scripts/autoresearch.ts --rounds 1` from
  `packages/iconsmith` so the ledger and the next brief update.
