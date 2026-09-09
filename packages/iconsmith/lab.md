# lab.md

Standing instructions for the **harness** campaign. A human (or this agent) writes this file; `scripts/research.ts` reads demo output and cannot write this file. Steering happens here.

`scripts/loop.ts` is a different campaign: it only mutates `src/pipeline/policy.default.json`, refuses a dirty tree, and spends a full benchmark. Do not run it to fix findings in exported SVGs and proof PNGs. This file is the control surface for that visual / reach problem.

## What “perfect” means

Not cosine 1.0. Two mature sets drawing the same concept agree at **0.737**. Compile with parts may be ≥0.95 — that is reconstruction. A leak is ≥0.95 AND zero `part` ops AND a model wrote the program. A host mark matching the same construction at ≥0.95 is reconstruction (`twin.ts`), not a leak. Arrival is _indistinguishable from a house icon on the measures we trust_:

| gate | keyed (answer key on disk) | unkeyed (reach) | mark (host twin) |
| --- | --- | --- | --- |
| structural panel | clean | clean | clean |
| `part` ops | ≥ 1 | ≥ 1 | 0 is OK |
| cosine | ≥ 0.737. Compile with parts may be ≥0.95; leak is ≥0.95 AND 0 `part` ops AND a model wrote the program. | must be `null` | must be `null` (house look-alikes live on `house.cosine`) |

N=1 is the **screen** for agent draws. Compile, analog on unkeyed, and mark are deterministic: N=1 is a **decision**, and the gates still apply. N≥5 is the decision for SELECT islands. `scripts/research.ts` encodes that.

## One change per iteration

A win with three diffs tells you nothing. Hypothesis in `LAB_HYPOTHESIS` when you run the demo, then `npx tsx scripts/research.ts`. Keep or revert from the exit code (0 arrived on the decision set, 1 not yet, 2 cannot score).

## Frozen

The same paths `program.md` freezes, plus this file. Do not move `render.ts` knobs, do not let `raw` reach the model, do not edit `scripts/gate.ts` to make a drawing pass.

## Architecture

Keyed and unkeyed are different products. A coding agent writing DSL is the wrong machine for both when used as the only path:

- **Keyed** — compile house subpaths onto vocabulary parts (`compileIcon`). Measured on `pull-request`: cosine **0.999**, panel clean. N=5 agent draws of the same concept were 0.58–0.79. Do not spend tokens rediscovering a file. `scripts/architect-lab.ts` is the check.
- **Unkeyed** — analog replay of a stroked neighbor through the same compiler, retitled as the concept. For `database` that neighbor is `server` (stacked trays), not `storage` (a filled dock — the tag-search false friend). Cosine stays `null`; the panel and `part` ops are the gates. Remaining N−1 slots at DEMO_N>1 can still be SELECT islands, not five seeds of `auto`.
- **Mark** — host twins via `ROUTES.mark` / `twin.ts`. No model. Cosine on the sample stays `null`; 0 `part` ops is the construction. House look-alikes live on `house.cosine` only when `MARK_TWINS` classifies the slug as the same construction or the same concept.

Do not mutate a compile or analog winner in place; there is nothing to evolve on a hit that already cleared the gates.

## What to try next

- Unkeyed sample 1 is analog replay of stroked `server`. Remaining DEMO_N−1 slots are SELECT islands (`slug`, `tagged`, `exact`, `contrast`, `empty`), not five seeds of `slug`. Independent draws from one shortlist are luck on one hill. `npx tsx scripts/select-lab.ts` is the cheap check (no agent): if diversity is ~0, drawing is wasted.
- Confirm the winning _policy_, then keep that island and drop the others. Do not mutate the winner in place — that is the local max.
- Analog of `server` is supposed to look like stacked trays. If a SELECT island still reads as a filled dock, `tagged` matched `storage`; `empty` is the control.
- Do not re-open `folder-open` until `folder-open` the part name is not a badge-gap body.

## Stop

Both demo concepts **arrived** on a decision set (N≥5, or compile / unkeyed analog / mark at N=1), panel clean, parts used where the product requires them, keyed cosine ≥ 0.737 (compile with parts may be ≥0.95; leak is ≥0.95 AND 0 part ops AND a model wrote the program). Then stop. Further gains are Slice 1 (`rebaseline`), not more demo chrome.
