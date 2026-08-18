# icon-forge

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
  tools/              # what the model is allowed to touch
    canvas.ts         # constrained primitives; off-spec geometry is unrepresentable
    dsl.ts            # the icon language the model writes
    lint.ts           # house-spec checks
    render.ts         # png / contact sheet / cosine similarity
  pipeline/           # the loop
```

## The one invariant

**The model never emits a coordinate.** It calls primitives (`rect`, `circle`, `line`, `dot`, `part`) that quantise to the grid, snap angles to 0/45/90, and take corner radii from the tier system. The model chooses _what_ and _where_; `canvas.ts` chooses _how_.

This is what prevents style drift. A model emitting free path data writes drift into a set at the rate it writes icons; a model calling `rect()` cannot. Any change that lets raw geometry through from a model breaks the guarantee the project exists to provide.

## Gotchas

- **ESM only**: `"type": "module"`. Use `.js` extensions in imports; extensionless imports fail the NodeNext typecheck.
- **Dual build**: `tsdown.config.ts` produces `cli.js` (shebang) and `index.js` (+ `.d.ts`). Do not merge them, and do not add a shebang to `src/cli.ts`.
- **Linting via ultracite**: run `npm run fix` / `npm run check`, never oxlint or oxfmt directly.
- **No chalk/ora, and nothing interactive**: use `styleText` from `node:util`. The CLI never prompts, so it has no prompt library and no `--no-input`; every value is a flag.
- **Visual extent ≠ path bbox.** A stroked icon's visual extent is its path bbox inflated by the stroke width, half per side. Comparing a stroked path bbox against a filled one conflates a rendering fact with a design fact, and it is the single mistake that has produced the most wrong measurements in this problem domain. `lint.ts` gets this right; keep it that way.
- **Similarity scores are calibrated against 0.737**, the measured median rendered-cosine between two mature icon sets drawing the same concept. A reconstruction scoring 1.0 is a bug; a score near 0.74 means "as close as a different professional set's take".

## Agent invariants

- Prefer `--output json`; the default `text` is for humans.
- The CLI never prompts, under any conditions. Provide every value as a flag.
- Mutating commands support `--dry-run`. Exit 0 on success, non-zero on failure.
- Core logic lives in `src/index.ts` and can back an MCP server; keep CLI-only concerns in `src/cli.ts`.
