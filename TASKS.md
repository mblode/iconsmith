# icon-forge — build board

Agents tick their own boxes as work lands. One agent per section; do not edit another section's files. Every task is done only when `npm run check`, `npm run typecheck` and `npm run test` all pass.

## Ground rules

- **The invariant:** no model ever emits a coordinate. Primitives quantise, snap angles to 0/45/90, and take radii from the tier system. Off-spec geometry must be unrepresentable.
- Types live in `src/types.ts` and are already defined. Import from there; do not redefine.
- ESM: every relative import needs a `.js` extension.
- Ported `.mjs` sources are the reference implementation, already working and tested.
- Visual extent = path bbox + stroke width (half per side). Getting this wrong is the most common error in this domain.
- Similarity is calibrated against **0.737** — the measured median rendered-cosine between two mature icon sets drawing the same concept. A reconstruction near 1.0 means a bug.

---

## 0 — Scaffold ✅ done

- [x] `/scaffold-cli` layout, configs, CI, changesets, ultracite, lefthook
- [x] `src/types.ts` shared contract
- [x] Build emits `dist/cli.js` + `dist/index.js` + `.d.ts`; validation checklist green
- [x] Initial commit

## 1 — Geometry core (owner: main)

- [x] `src/geometry/path.ts` — parse, serialise, bbox via cubic extrema, translate, scale
- [x] `src/geometry/path.test.ts` — 12 tests ported to vitest

## 2 — Parts vocabulary (owner: agent `parts`)

- [x] `src/parts/shape.ts` — flatten, resample, fingerprint, distance
- [x] `src/parts/extract.ts` — cluster subpaths into parts; emit `parts.json`
- [x] `src/parts/shape.test.ts` — invariance tests (translation, scale, rotation, reflection)
- [x] Verify against blode-icons: 2,139 outline icons → ~2,223 parts, top 200 cover ~81%

## 3 — Canvas + DSL (owner: agent `canvas`)

- [x] `src/tools/canvas.ts` — constrained primitives, `toJSON`/`fromJSON`, `toSVG`
- [x] `src/tools/dsl.ts` — the icon language: icon/keyline/part/rect/circle/line/dot/center/fit
- [x] `src/tools/canvas.test.ts` — off-spec input must come out on-spec (the invariant)
- [x] `src/tools/dsl.test.ts` — `fit` on the wide keyline yields exactly 20.0×16.0

## 4 — Lint + render (owner: agent `checks`)

- [x] `src/tools/lint.ts` — centred, keyline, bleed, gap, density
- [x] `src/tools/render.ts` — png, contact sheet, inkVector, cosine
- [x] `src/tools/lint.test.ts` — each rule fires on a crafted violation and stays quiet otherwise
- [x] Confirm `cosine` reproduces the 0.737 baseline on known pairs

## 5 — AI-in-the-loop pipeline (owner: agent `pipeline`)

- [x] `src/pipeline/tools.ts` — AI SDK tool definitions wrapping canvas + lint + render
- [x] `src/pipeline/generate.ts` — `generateText` loop, render fed back as an image each turn
- [x] `src/pipeline/prompt.ts` — system prompt carrying the house spec and the DSL grammar
- [x] Graceful failure with no `ANTHROPIC_API_KEY`: `MissingApiKeyError`, thrown before any work; `cli.ts` already prints `.message` and exits 1, so no stack trace reaches a user

## 6 — Reconstruction eval (owner: agent `eval`)

- [x] `src/pipeline/eval.ts` — hold out N icons, generate from name+tags, score vs the real one
- [x] Report floor / baseline (0.737) / treatment / ceiling, not a bare number
- [x] `EvalReport.icons` carries per-icon scores; serialise it for `--output json` regression tracking (command wiring is section 7)
- [x] `src/pipeline/pipeline.test.ts` — 16 tests, whole loop and eval run against a scripted model with no network

## 7 — CLI wiring (owner: main, last)

- [x] `forge parts` / `draw` / `lint` / `eval` / `conform` commands
- [x] `--output json` on every command; data on stdout, logs on stderr
- [x] README usage matches actual behaviour

---

## 8 — Corpus loader + spec calibration (owner: agent `spec`)

The house spec was written from Cursor's article, but blode-icons is ~96% Central-derived. Central packs tighter than Cursor: a 2px `minGap` flags ~half of Central's own icons, and Cursor's ~3.75px equivalent flags 82–90%. **Cursor is the inspiration; the corpus is the specification.**

- [x] `src/corpus/load.ts` — read `corpus/`, index by symbol × variant, parse variant keys into `{ style, stroke, corner, radius }`
- [x] `src/corpus/measure.ts` — distributions for gap, corner radius, keyline extent, dot size
- [x] Recalibrate `SPEC` in `src/tools/canvas.ts` from measured values, not the article
- [x] Every changed constant documented with its measured basis and Cursor's differing value
- [x] `src/corpus/measure.test.ts` — 20 tests; corpus-backed ones skip when `corpus/` is absent

**Do not** silently adopt a constant that would flag the majority of the base set. Report anything where the corpus and the article disagree, rather than picking quietly.

Measured against `round-outlined-radius-3-stroke-2`, which is byte-identical to blode-icons' own SVGs — the house set _is_ a corpus variant. Changed: `minGap` 2 → 1, `clearance` 2.5 → 2, `radiusTiers` [0.25, 1, 2] → [0.5, 1, 2, 3] (and the size-conditioned split in `tierRadius` dropped; a flat set scores 78.4% against the corpus versus 23.9%), `dots` 1.5/2/2.5 → 2/2.5/3. Unchanged and confirmed: `canvas` 24, `stroke` 2 (97.5% of stroked shapes), `grid` 0.25, all four keylines (the top four joint extents in the set).

## 9 — Conform scoring against the corpus (owner: agent `pipeline`)

2,085 symbols × 30 finishes is a controlled test: construction held constant, finish varied.

- [x] `src/pipeline/conform.ts` — `compensateStroke` and `retierCorners`; style and cap changes are refused rather than faked, and so is anything on a filled variant
- [x] `forge conform --from <variant> --to <variant>` scored against Central's real answer (`src/commands/conform.ts` — **needs two lines in `cli.ts`, see below**)
- [x] Four numbers on the scale this experiment lives on: floor (do nothing) / treatment / rescale oracle / exact. Rendered cosine is the wrong instrument here — it scores 0.981 for doing nothing between adjacent strokes — so conform scores in path distance (px)
- [x] `src/pipeline/conform.test.ts` — 18 tests on synthetic geometry, no corpus needed
- [x] **Reproduction rate: 21.3% of attemptable pairs exactly, 6.8% of the full 870-pair grid.** Only 276 of 870 ordered pairs (31.7%) hold style and cap constant; the other 68.3% cross one of them and are refused. Within the attemptable set: radius-only 62.1% exact (median error 0.086px → 0.000px), stroke-only 4.7% exact (0.274px → 0.198px)

Measured residue, per the instruction not to explain it away: only 16-24% of stroke pairs are reproducible by _any_ affine fitted with the answer in hand, against the ~65% whose visual extent is held. Holding the extent is not the same as being a rescale of the source — the gap between those two figures is Central redrawing interior detail, and it is not synthesisable.

Known: changing stroke changes geometry in ~90% of icons, but median visual extent is held constant (delta 0.005), so the dominant transform is keyline compensation. The residue is real redrawing and will not be synthesised — measure it, do not explain it away.

## 10 — Cohort alignment (owner: agent `cohort`)

`folder-open` sits at cy 11.50 because every folder it swaps with sits at 11.50. The current `centred` rule flags that correct work as an error. Meanwhile the real defect is invisible to any per-icon rule: the folder family splits into y1=19.00 and y1=20.00 groups, so swapping `folder-download` for `folder-cloud` jumps the bottom edge 1px.

- [x] `cohort-align` (error) — icons in a family must share their box within tolerance (`src/tools/cohort.ts`; clustered per axis, so a family's legitimate width spread cannot hide the vertical rhythm it does keep)
- [x] `centred` drops to `warn`, suppressed when the icon agrees with its cohort — agreement is per edge: recentring moves both edges, so an icon sharing one with a sibling cannot be recentred without breaking an alignment
- [x] Cohort definition beyond name prefix — a `CohortManifest` (cohort name → members) overrides first-segment inference. Does not catch: unlisted semantic swaps (`play`/`pause`), singular/plural (`folder`/`folders`), or anything inside the outer box, e.g. a badge that moved
- [x] Report the real cohort splits across blode-icons — 116 split axes over 79 cohorts, 143 icons on the wrong side; `forge lint <files...>` prints them
