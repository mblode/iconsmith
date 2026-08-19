# iconsmith

Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec.

## Commands

```bash
npm install        # setup (requires Node >= 24.11)
npm run build      # tsdown, outputs to dist/
npm run dev        # tsdown --watch
npm run test       # vitest run --passWithNoTests
npm run typecheck  # tsc --noEmit
npm run fix        # ultracite fix: format + lint autofix
npm run check      # ultracite check: lint (CI)
```

## Architecture

```
src/
  cli.ts              # Commander entry point
  index.ts            # Public API exports
  types.ts            # Shared type definitions
  geometry/           # pure path maths — no I/O, no deps
    path.ts           # parse/serialise, bbox via cubic extrema, transforms
  parts/              # the vocabulary
    shape.ts          # fingerprint + distance (position/scale/rotation invariant)
    extract.ts        # cluster every subpath in a set into named parts
    vocabulary.ts     # the names; matched onto an extraction by shape, not id
  tools/              # what the model is allowed to touch
    canvas.ts         # constrained primitives; off-spec geometry is unrepresentable
    dsl.ts            # the icon language the model writes
    lint.ts           # house-spec checks
    render.ts         # png / contact sheet / cosine similarity
  pipeline/           # the loop
```

## The one invariant

**The model never emits a coordinate.** It calls primitives (`rect`, `circle`, `line`, `dot`, `part`) that quantise every node to the grid, take corner radii from the tier system, and place parts at named quarter-turns. The model chooses _what_ and _where_; `canvas.ts` chooses _how_.

This is what prevents style drift. A model emitting free path data writes drift into a set at the rate it writes icons; a model calling `rect()` cannot. Any change that lets raw geometry through from a model breaks the guarantee the project exists to provide.

**Two escapes exist, and both are asked for by name.** `canvas.raw(d)` takes path data verbatim, so any icon can enter a document. `canvas.line({ offAxis: true })` — `line ... off-axis` in the DSL — allows a segment off 0/45/90; without it, a segment more than `ANGLE_TOLERANCE` (6°) from every axis is refused rather than passed through. Both land in the `IconDoc` and are visible in review.

The angle escape is not a loophole to close. Off-axis edges are 29.3% of the set's stroked icons, and they are deliberate: they cluster on rational slopes — atan(1/2) = 26.57°, the 3-4-5 triangle's 36.87°/53.13°, atan(3) = 71.57° — because the edge runs between two grid points. `airdrop` is `M4 11L11 16.5`: grid-legal endpoints, 38.16°, 6.84° off 45°. The set's working convention is _endpoints on the grid_; the spec's is _angles at 0/45/90_, and one edge in seven shows they are not the same rule. Forcing every angle onto an axis would refuse to draw a third of the corpus. So the grid and radius guarantees are absolute; the angle guarantee is "on-axis unless the program says otherwise", which is the honest version.

## Gotchas

- **ESM only**: `"type": "module"`. Use `.js` extensions in imports; extensionless imports fail the NodeNext typecheck.
- **Dual build**: `tsdown.config.ts` produces `cli.js` (shebang) and `index.js` (+ `.d.ts`). Do not merge them, and do not add a shebang to `src/cli.ts`.
- **Linting via ultracite**: run `npm run fix` / `npm run check`, never oxlint or oxfmt directly.
- **No chalk/ora, and nothing interactive**: use `styleText` from `node:util`. The CLI never prompts, so it has no prompt library and no `--no-input`; every value is a flag.
- **Visual extent ≠ path bbox.** A stroked icon's visual extent is its path bbox inflated by the stroke width, half per side. Comparing a stroked path bbox against a filled one conflates a rendering fact with a design fact, and it is the single mistake that has produced the most wrong measurements in this problem domain. `lint.ts` gets this right; keep it that way.
- **The gap backlog compares against the house _vocabulary_, not house slugs.** blode draws a bin, a calendar and a camera — as `trash-1`, `calendar-1`, `camera-1` — so a raw slug comparison reports all three as things the set does not draw. That artefact is the difference between 145 names at 4+ packs and 62. `houseVocabulary` in `corpus/concepts.ts` is the correct denominator: slugs, unnumbered stems, concepts and slugified tags, 5,084 words.
- **`concepts propose` never writes `_concepts.json`.** It writes a `_concepts.proposed.json` beside the review files, and `concepts apply` is a separate command a person runs. The file's whole value is that one question has one _blessed_ answer, and a model filling it in silently removes exactly that property.
- **Concept coverage has two numbers and they are always printed together.** _Informative_ coverage counts concepts that are not the icon's own slug; _nominal_ counts everything. The proposer generates 1,522 `add-image → add-image` entries, which take nominal coverage to 99.8% and informative coverage nowhere — so a ">= 95% covered" criterion is satisfiable by writing the filenames back out. Those tautologies exist to _reserve_ a word so a tag cannot point `folder` at `folder-cloud`; they are never written to `_concepts.json`. Quote the informative number, or quote both.
- **Similarity scores are calibrated against 0.737**, the measured median rendered-cosine between two mature icon sets drawing the same concept. A reconstruction scoring 1.0 is a bug; a score near 0.74 means "as close as a different professional set's take".

## Agent invariants

- Prefer `--output json`; the default `text` is for humans.
- The CLI never prompts, under any conditions. Provide every value as a flag.
- Mutating commands support `--dry-run`. Exit 0 on success, non-zero on failure.
- Core logic lives in `src/index.ts` and can back an MCP server; keep CLI-only concerns in `src/cli.ts`.
