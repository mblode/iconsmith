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

- [ ] `src/pipeline/tools.ts` — AI SDK tool definitions wrapping canvas + lint + render
- [ ] `src/pipeline/generate.ts` — `generateText` loop, render fed back as an image each turn
- [ ] `src/pipeline/prompt.ts` — system prompt carrying the house spec and the DSL grammar
- [ ] Graceful failure with no `ANTHROPIC_API_KEY`: clear error, non-zero exit, no stack trace

## 6 — Reconstruction eval (owner: agent `eval`)

- [ ] `src/pipeline/eval.ts` — hold out N icons, generate from name+tags, score vs the real one
- [ ] Report floor / baseline (0.737) / treatment / ceiling, not a bare number
- [ ] `--output json` emits per-icon scores for regression tracking

## 7 — CLI wiring (owner: main, last)

- [ ] `forge parts` / `draw` / `lint` / `eval` commands
- [ ] `--output json` on every command; data on stdout, logs on stderr
- [ ] README usage matches actual behaviour
