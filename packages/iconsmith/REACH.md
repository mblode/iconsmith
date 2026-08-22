# Reach: new icons that belong in Central

## What changed

`iconsmith new` was a thin shell over the agent loop. Every name hired a model to write DSL, including names that already have a house file. Keyed compile scores 0.999 on `pull-request`; N=5 agent redraws of the same file scored 0.58–0.79. The product path is now host DRAW first.

Open Collider is the reason this exists (direct prompting clusters on the obvious; volume of distant constructions plus a curator moves). It is not a module in this repo. There is no academic-domain injection, no “be original” prompt line, and no closed catalog of parasitology × Spotify.

## Product path

`reach()` classifies the kind of gap, then draws:

| Gap | Arm | Model |
| --- | --- | --- |
| MARKS key (`plus`, `plus-filled`) | host twin | no |
| House file exists | compile house paths onto parts; unmatched subpaths become local house parts | no |
| `base-badge` and both halves exist (`folder-clock`) | splice badge into the bottom-right slot, then compile | no |
| Unkeyed object | mixture: analog (kin / family / name hint) first; agent only if analog is unknown or dirty | analog: no / agent: yes |
| `--analog` | lab path: replay a Central kin, else `stack` / `trays` / `hub` | no |
| `--agent`, or analog `--look` that cannot name the object | tool-calling loop | yes |

Unkeyed analog without `--look` replays a Central file that is the same object under another name (`wifi-full` for `wifi`, `finger-print-1` for `fingerprint`). That compile is how existing icons feed the design: house path data, host `part` ops, no agent polyline. Names with no kin use a name hint so `database` is trays and `unicorn` is a hub. With `--look`, those constructions collide and vision keeps the one that reads as the named object. Cosine against a house file stays `null` on analog. Keyed compile may sit at ≥0.95; that is reconstruction.

## Look

Outlined finish is not “must show a hole”. A bar, line, or dot may be solid — the stroke is the subject. Only closed masses (rings, frames, tiles, bodies) must show canvas inside. 24px antialiasing is not a finish fail. `render.ts` stays frozen.

## Out of scope

- `src/tools/render.ts`, `scripts/loop.ts`, `scripts/gate.ts`, `lab.md` as a loop target
- Copying house motifs (flag swallowtail, layout-grid corners, minus-large hairline, ban slash chirality)
- Treating more-vertical 0.707 as a failed reconstruction
- Expanding MARKS except as analog seeds

## Verification

```bash
# from packages/iconsmith
npx tsx scripts/analog-lab.ts
npx tsx scripts/architect-lab.ts
npx vitest run src/pipeline/analog.test.ts src/pipeline/audit.test.ts \
  src/pipeline/reach.test.ts src/pipeline/splice.test.ts src/pipeline/route.test.ts
node dist/cli.js new plus          # host mark, no key
node dist/cli.js new database      # mixture → analog trays, no key
```
