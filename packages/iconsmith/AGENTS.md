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
npx tsx scripts/architect-lab.ts # keyed compiler vs agent; no credits
npx tsx scripts/analog-lab.ts  # unkeyed analog replay; no agent
npx tsx scripts/select-lab.ts  # cheap SELECT islands; no agent
npx tsx scripts/reach-lab.ts [dir] [--arm analog|glyph|agent|harness]
npx tsx scripts/twin-eval.ts --house <dir> [--out <dir>] # both paints vs house files
npx tsx scripts/research.ts   # harness lab judge; 0 arrived, 1 not yet, 2 unscorable
npx tsx scripts/loop.ts --enable <ids> …   # policy campaign; refuses a dirty tree
```

`lab.md` is the standing instructions for the harness campaign (what you look at in `iconsmith view`). `program.md` is the standing instructions for the policy campaign. Neither file is written by its loop. Arrival is house-indistinguishable (panel clean, ≥1 `part` for keyed/unkeyed, keyed cosine ≥ 0.737; compile with parts may be ≥0.95; leak is ≥0.95 AND 0 part ops AND a model wrote the program). A host mark at ≥0.95 is reconstruction (`twin.ts`), not a leak; 0 parts is OK and sample cosine must stay null. N≥5 is a finding except compile, analog on unkeyed, and mark, where N=1 is decide.

`scripts/reach-lab.ts` writes `.staging/reach-10` — both paints of each icon, with a `.icon`, a brief and a normalised `Thinking` sidecar each — and asserts four invariants on the way past rather than reporting them on the page: both paints run as programs with ops (a comment is not a program), neither has a lint error, the two occupy one visual extent, and a `hole` is cut rather than painted over. It throws instead of staging a set that fails one.

**It does not choose the arm, and this is the point.** Each entry in `REACH_SET` names the arm the dashboard credited it to, that arm is asked for by name, and an arm this machine cannot run is a _recorded skip with a reason_ — never a drawing from somewhere else. A revision that drew all ten on the host reported `0 error(s)` about a generator it had never run, and made a set that could no longer fail. `--arm` overrides the whole set, which is how the invariants get exercised where no credential exists: `analog` and `glyph` need nothing, `agent` needs a gateway token and `harness` a coding-agent CLI. Findings are expected and only an `error` stops a run — `warn` is the tier that means "confirm this was deliberate", and the analog fallback trips plenty of them honestly.

After build, `iconsmith view [dir]` serves staged SVGs on a 24×24 grid (`--port`, `--open`). Each card shows every paint it can produce — outlined and filled, each with its own program and its own house-spec chain — and one status above them, taken from the union of every paint's findings and whatever the arm recorded in `slug.json`. The header counts that union: a recorded `severity: "error"` is an error even when the page's own lint is content. A declared `off-axis` is a **warn** carrying `Issue.declared`, not a waiver and not a pass: the modifier is permission to draw the diagonal and the warning is the prompt to confirm it is the drawing. Paints are linted through their canvas rather than their rendered SVG, because `parseIconSvg` keeps geometry and drops the declaration. A program the DSL refuses is a `dsl` **error** on the card, so a paint the page cannot draw is never just a missing thumbnail. The full QA chain is shown, checks that passed included, not only failures. `--against house` scores each slug against the house variant; filled cards use the filled variant. A staged `*.house.svg` sibling wins over a slug lookup, so a mark named `plus` can sit beside house `plus-large`. The mark on the scale is 0.737, not 1.0. Cosine ≥0.95 with `part` ops is reconstruction; without parts it is a leak _unless_ policy is `mark` (host twin matching the same construction). The card reads `slug.json` for policy (`compile`, `analog`, `mark`, `glyph`, …). Numbered samples in a concept directory (`pull-request/pull-request-1.svg`) compare against that concept. Staged `*.house.svg` copies are skipped as cards. The unnumbered file in the directory is labelled selected. Sidecars `*.brief.md`, `*.log.jsonl` and `*.icon` open as always-visible reasoning on the card. The host look writes `*.preview.png` and `*.audit.json` beside the same stem.

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
    canvas.ts         # constrained primitives; specAt({ size, stroke, radius }) is the cut
    dsl.ts            # the icon language the model writes
    twin.ts           # filled/outlined as one skeleton, two paints
    lint.ts           # house-spec checks; review() keeps the passes
    render.ts         # png / contact sheet / cosine similarity
    pipeline/           # BRIEF → PROPOSE → SELECT → DRAW → CHECK → SCORE
    route.ts          # those stages, swappable; a route is an arm (`analog`, `compile`, `direct`, `mark`, `part-first`)
    kind.ts           # DrawKind, CounterpartClass, MARK_TWINS
    marks.ts          # ten host twins, both finishes
    mark.ts           # DRAW: host twins via MARKS/twin.ts (no model)
    glyphs.ts         # ten house object forms, both finishes — asked for, not preferred
    glyph.ts          # DRAW: those object constructions (no model), on `unkeyed: "glyph"`
    thinking.ts       # the one shape an arm records; `clean` is derived, never passed
    reach.ts          # house file / mark / splice compile; else the `unkeyed` arm
    splice.ts         # base × badge: two house files, one compile
    search.ts         # the one vocabulary ranking, shared by three callers
    select.ts         # SELECT as competing policies, not five seeds of one
    reconstruct.ts    # keyed: compile house subpaths onto parts (not an agent)
    analog.ts         # lab: replay a Central kin, else a name-hinted family / kin / alias, else compose a named part, else unknown
    audit.ts          # host screenshot + vision look at a drawn SVG
    harness.ts        # an external agent CLI as a GenerateFn
    policy.default.json # the design language as data; the loop's only target
  corpus/             # every icon tree on this machine, measured
    sources.ts        # the registry, with a licence and a usage per set
    aliases.ts        # the words an icon answers to beyond its filename
    record.ts         # one record per drawing, not per file
  eval/               # the panel: what cosine cannot see
    blindspot.ts      # structural checks; frozen by program.md
  commands/           # the CLI surface; the only layer that may import anything
```

`scripts/check-boundaries.ts` enforces `geometry ← parts ← tools ← pipeline ← commands` on every `npm run check`. `corpus/` and `eval/` are outside that DAG, so their direction is a convention rather than a check — `pipeline/` takes a plain `ReadonlyMap` for aliases rather than importing `corpus/` for that reason.

## The one invariant

**The model never emits a coordinate.** It calls primitives (`rect`, `circle`, `arc`, `line`, `dot`, `part`) that quantise every node to the grid, take corner radii from the tier system, and place parts at named quarter-turns. The model chooses _what_ and _where_; `canvas.ts` chooses _how_.

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
- **Part coverage has two numbers too, and the gap between them is the point.** `iconsmith parts <dir> --coverage` reports concepts at least one part answers (548 of 2,201) beside concepts a _curated name_ answers (76). Provenance search reaches an order of magnitude more than the names do, so the wider number alone makes naming look finished and the narrower one alone makes the vocabulary look unreachable. `bench/part-coverage.v1.json` holds the backlog, and carries no timestamp on purpose: it is fully determined by the vocabulary and the store, so a diff in it means the numbers moved.
- **The alias table has two halves and only one of them is evidence.** `corpus/aliases.ts` widens `rankParts` from an icon's filename to the words its set says it means. blode's `_concepts.json` is both a source of those words and the concept list coverage is scored against, so folding it in takes coverage from 548/2,203 to 1,972 almost by construction. `loadAliases` therefore returns `independent` — sources that did not supply the concept list, today Central alone — and that is the quotable number: **548 → 926**. The drawer gets the full table; `--coverage` prints all three lines and labels the self-scored one. Same discipline as informative-vs-nominal concept coverage, one level up.
- **The extract is keyed off Central's component names, not its aliases.** 98 of the leading aliases are not the slug — `clipboard 2-sparkle` has a space, `Folder-sparkle` a capital — and the resulting rows match no SVG on disk, silently. `scripts/extract-central-metadata.ts` derives the slug from the component name and reconciles it against `corpus/corpus.json`, which is the authority on what a slug is called. 2,073 of 2,085 land; the 12 that do not are named rather than guessed at.
- **The harness arm ships the vocabulary or says it has none.** `harnessArm` writes `parts.json` into the scratch directory and names it in the brief. Without it the external arm is not the same experiment as the built-in loop — that loop's model has `listParts` and `part`, and an agent given a skill that promises `part` with no file to place from spends its whole timeout looking for one. Measured: 10-minute kill without, ~2 minutes with. The file is named parts plus the unnamed marks `searchParts` hits for this concept (the same shortlist SELECT uses) — not the 270 KB unnamed extract. `part` accepts a name or an id. The full list still goes to the DSL runner.
- **All model calls go through Vercel AI Gateway.** `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN`) is the credential; `ANTHROPIC_API_KEY` is not a substitute. The built-in loop, raster propose/critique, and the judge use namespaced ids (`anthropic/…`, `google/…`). Codex and Claude Code harness spawns get scratch-local / child-env routing so they do not rewrite `~/.codex` or `~/.claude`.
- **Similarity scores are calibrated against 0.737**, the measured median rendered-cosine between two mature icon sets drawing the same concept. A reconstruction scoring 1.0 is a bug; a score near 0.74 means "as close as a different professional set's take".

## Agent invariants

- Prefer `--output json`; the default `text` is for humans.
- The CLI never prompts, under any conditions. Provide every value as a flag.
- Mutating commands support `--dry-run`. Exit 0 on success, non-zero on failure.
- Core logic lives in `src/index.ts` and can back an MCP server; keep CLI-only concerns in `src/cli.ts`.
