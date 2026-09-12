# iconsmith

Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec.

## Commands

```bash
npm install        # setup (requires Node >= 24.11)
npm run build      # tsdown, outputs to dist/
npm run dev        # tsdown --watch
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run fix        # ultracite fix: format + lint autofix
npm run check      # ultracite check: lint + check:boundaries (CI)
npx tsx scripts/local-generate.ts --help # pinned-style generation
npx tsx scripts/local-campaign.ts --help # bounded development campaigns
```

Use [the local foundry workflow](../../docs/local-foundry.md) for generation and review.

Inspect exported SVGs and proof PNGs directly; there is no browser viewer.

## Architecture

```
src/
  cli.ts              # Commander entry point
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
    kind.ts           # DrawKind, CounterpartClass, MARK_TWINS
    marks.ts          # ten host twins, both finishes
    mark.ts           # DRAW: host twins via MARKS/twin.ts (no model)
    glyphs.ts         # ten house object forms, both finishes — asked for, not preferred
    glyph.ts          # DRAW: those object constructions (no model), on `unkeyed: "glyph"`
    reach.ts          # house file / mark / splice compile; else the `unkeyed` arm
    splice.ts         # base × badge: two house files, one compile
    search.ts         # the one vocabulary ranking, shared by three callers
    select.ts         # SELECT as competing policies, not five seeds of one
    mixture.ts        # sparse expert gate: compile / mark / analog / glyph / agent
    mixture.default.json # routing table the improve command may rewrite
    mixture.inventory.json # names-only pack slugs; overlay from commands/
    experiment.ts     # two-stage A/B of two experts (screen then decide)
    reconstruct.ts    # keyed: compile house subpaths onto parts (not an agent)
    analog.ts         # lab: replay a Central kin, else a name-hinted family / kin / alias, else compose a named part, else unknown
    decline.ts        # `ArmDeclinedError`: an arm with no answer, distinct from one that failed
    audit.ts          # host screenshot + vision look at a drawn SVG
    harness.ts        # an external agent CLI as a GenerateFn; `skillPath()` finds the SKILL.md it ships
    program.ts        # DRAW: the model writes a JS builder program, sandboxed; it emits a `.icon`
    policy.default.json # the design language as data
  corpus/             # every icon tree on this machine, measured
    sources.ts        # the registry, with a licence and a usage per set
    aliases.ts        # the words an icon answers to beyond its filename
    record.ts         # one record per drawing, not per file
  eval/               # the panel: what cosine cannot see
    blindspot.ts      # structural checks
  commands/           # the CLI surface; the only layer that may import anything
```

`scripts/check-boundaries.ts` enforces `geometry ← parts ← tools ← pipeline ← commands` on every `npm run check`. `corpus/` and `eval/` are outside that DAG, so their direction is a convention rather than a check — `pipeline/` takes a plain `ReadonlyMap` for aliases rather than importing `corpus/` for that reason.

## The one invariant

**The model never emits a coordinate.** It calls primitives (`rect`, `circle`, `arc`, `line`, `dot`, `part`) that quantise primitive construction inputs and part placement anchors to the grid, take corner radii from the tier system, and place parts at named quarter-turns. Host-derived tangencies and admitted source curve handles retain their geometry; the model cannot write them. The model chooses _what_ and _where_; `canvas.ts` chooses _how_.

This constrains geometry, not semantic correctness or visual family fit. The public author route retains the DSL until a matched comparison justifies a change. Direct SVG is permitted as an explicit development experiment outside the production pipeline; it must pass the same visual rubric.

**Two escapes exist, and both are asked for by name.** `canvas.raw(d)` takes path data verbatim, so any icon can enter a document. `canvas.line({ offAxis: true })` — `line ... off-axis` in the DSL — allows a segment off 0/45/90; without it, a segment more than `ANGLE_TOLERANCE` (6°) from every axis is refused rather than passed through. Both land in the `IconDoc` and are visible in review.

The angle escape is not a loophole to close. Off-axis edges are 29.3% of the set's stroked icons, and they are deliberate: they cluster on rational slopes — atan(1/2) = 26.57°, the 3-4-5 triangle's 36.87°/53.13°, atan(3) = 71.57° — because the edge runs between two grid points. `airdrop` is `M4 11L11 16.5`: grid-legal endpoints, 38.16°, 6.84° off 45°. The set's working convention is _endpoints on the grid_; the spec's is _angles at 0/45/90_, and one edge in seven shows they are not the same rule. Forcing every angle onto an axis would refuse to draw a third of the corpus. So the grid and radius guarantees are absolute; the angle guarantee is "on-axis unless the program says otherwise", which is the honest version.

## Gotchas

- **ESM only**: `"type": "module"`. Use `.js` extensions in imports; extensionless imports fail the NodeNext typecheck.
- **Two build entries**: `tsdown.config.ts` produces the research `dist/cli.js` and portable `dist-agent/cli.js`. Only `dist-agent/` ships in npm. Internal scripts import source by relative path; there is no public JS API.
- **Linting via ultracite**: run `npm run fix` / `npm run check`, never oxlint or oxfmt directly.
- **No chalk/ora, and nothing interactive**: use `styleText` from `node:util`. The CLI never prompts, so it has no prompt library and no `--no-input`; every value is a flag.
- **Visual extent ≠ path bbox.** A stroked icon's visual extent is its path bbox inflated by the stroke width, half per side. Comparing a stroked path bbox against a filled one conflates a rendering fact with a design fact, and it is the single mistake that has produced the most wrong measurements in this problem domain. `lint.ts` gets this right; keep it that way.
- **The 94% twin-extent figure is not the pass rate of the gate that reads it.** `lint.ts` and `SKILL.md` quote 94% of 2,085 pairs; that is a _signed longest-side_ statistic (`scripts/measure-filled.ts:607,633`), and it reproduces at 94.3%. `sameExtent` in `tools/twin.ts` compares _both axes_, and the same corpus gives 91.46% at a 0.01 tolerance — 178 pairs called an error, one in twelve of the designer's own drawings. That is why `EXTENT_TOL` is **0.5**, not 0.01: the max-axis delta is bimodal (p50 0.000, p90 0.004, p95 0.198), so everything in the 0.01–0.5 band is quantiser noise and a real mismatch clears 0.5 fourfold. Do not quote the 94% as though it described the tolerance, and do not tighten `EXTENT_TOL` back without re-measuring per-axis.
- **`extent` is an error in the primitive and a warn in two callers, and only those two.** `twinPairIssues` (`tools/twin.ts`) keeps it an error — for a model-drawn pair of two independently drawn paints, a mismatched extent really is evidence of a flood-fill or a restamp. `pipeline/pair.ts` demotes it in exactly two places: `softenExtent` for a house-divergent family (`arrow`, `check`, `chevron`, where the house files themselves fail the error gate), and `pairAdapted` unconditionally, because a twin `adaptProgram` derived is not evidence about anything the model did. Do not demote it at the primitive. **This also drops extent from the repair loop, and that is free rather than a price:** `harness.ts:516` filters the repair prompt to `severity === "error"`, so a demoted extent never reaches the model. On both demoted paths it has nothing true to tell it — against a derived twin a flood-fill _passes_ (the twin floods too) and a restamped ring is caught by `restampIssues` instead, and on a divergent family the house files fail the gate themselves. So do not promote it back to make repair see it: that re-blocks the drawings the demote unblocked (17 of 27 error-severity findings in a post-fix eval run; 11 of 42 paints carried extent as their sole error, and an error fails `paintAccepted` before the judge is called). It stays in `issues` and on the card, for a human.
- **The gap backlog compares against the house _vocabulary_, not house slugs.** blode draws a bin, a calendar and a camera — as `trash-1`, `calendar-1`, `camera-1` — so a raw slug comparison reports all three as things the set does not draw. That artefact is the difference between 145 names at 4+ packs and 62. `houseVocabulary` in `corpus/concepts.ts` is the correct denominator: slugs, unnumbered stems, concepts and slugified tags, 5,084 words.
- **`concepts propose` never writes `_concepts.json`.** It writes a `_concepts.proposed.json` beside the review files, and `concepts apply` is a separate command a person runs. The file's whole value is that one question has one _blessed_ answer, and a model filling it in silently removes exactly that property.
- **Concept coverage has two numbers and they are always printed together.** _Informative_ coverage counts concepts that are not the icon's own slug; _nominal_ counts everything. The proposer generates 1,522 `add-image → add-image` entries, which take nominal coverage to 99.8% and informative coverage nowhere — so a ">= 95% covered" criterion is satisfiable by writing the filenames back out. Those tautologies exist to _reserve_ a word so a tag cannot point `folder` at `folder-cloud`; they are never written to `_concepts.json`. Quote the informative number, or quote both.
- **Part coverage has two numbers too, and the gap between them is the point.** `iconsmith parts <dir> --coverage` reports concepts at least one part answers (548 of 2,201) beside concepts a _curated name_ answers (76). Provenance search reaches an order of magnitude more than the names do, so the wider number alone makes naming look finished and the narrower one alone makes the vocabulary look unreachable. `bench/part-coverage.v1.json` holds the backlog, and carries no timestamp on purpose: it is fully determined by the vocabulary and the store, so a diff in it means the numbers moved.
- **The alias table has two halves and only one of them is evidence.** `corpus/aliases.ts` widens `rankParts` from an icon's filename to the words its set says it means. blode's `_concepts.json` is both a source of those words and the concept list coverage is scored against, so folding it in takes coverage from 548/2,203 to 1,972 almost by construction. `loadAliases` therefore returns `independent` — sources that did not supply the concept list, today Central alone — and that is the quotable number: **548 → 926**. The drawer gets the full table; `--coverage` prints all three lines and labels the self-scored one. Same discipline as informative-vs-nominal concept coverage, one level up.
- **The extract is keyed off Central's component names, not its aliases.** 98 of the leading aliases are not the slug — `clipboard 2-sparkle` has a space, `Folder-sparkle` a capital — and the resulting rows match no SVG on disk, silently. `scripts/extract-central-metadata.ts` derives the slug from the component name and reconciles it against `corpus/corpus.json`, which is the authority on what a slug is called. 2,073 of 2,085 land; the 12 that do not are named rather than guessed at.
- **The harness arm ships the vocabulary or says it has none.** `harnessArm` writes `parts.json` into the scratch directory and names it in the brief. Without it the external arm is not the same experiment as the built-in loop — that loop's model has `listParts` and `part`, and an agent given a skill that promises `part` with no file to place from spends its whole timeout looking for one. Measured: 10-minute kill without, ~2 minutes with. The file is named parts plus the unnamed marks `searchParts` hits for this concept (the same shortlist SELECT uses) — not the 270 KB unnamed extract. `part` accepts a name or an id. The full list still goes to the DSL runner.
- **Research API calls go through Vercel AI Gateway by default.** The public skill uses the host agent account and makes no API calls. `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN`) is the credential; `ANTHROPIC_API_KEY` is not a substitute. OpenRouter is a second generate arm: `OPENROUTER_API_KEY` plus `--model thinkingmachines/inkling` (or `openrouter/…`). `thinkingmachines/inkling:free` is the same weights, but OpenRouter allowlists that slug to listed agentic apps and 403s this CLI; the generate arm therefore defaults to the billed slug. The built-in loop, raster propose/critique, and the judge use namespaced ids (`anthropic/…`, `google/…`). Codex and Claude Code harness spawns get scratch-local / child-env routing so they do not rewrite `~/.codex` or `~/.claude`.
- **The `program` arm gives the model a loop, not a coordinate.** `pipeline/program.ts` lets a model write a JavaScript _builder_ program instead of writing the `.icon` out by hand: the DSL has no arithmetic on purpose, so eight teeth around a ring is eight authored lines and eight chances to drift. The JavaScript is not a second icon format — host functions append DSL lines, and the emitted program goes through the same `run` from `tools/dsl.ts` as every other arm, so lint, twin and replay are unchanged. Two things keep the one invariant: there is no `raw` host function (exactly as `raw` has no DSL word, and the sandbox has no filesystem, network or `eval` to reach one through), and `completeProgram` is asserted on the way out — **the emitted `.icon` must replay to a byte-identical document, so anything the DSL cannot express fails rather than being promised against in prose.** That assertion is also what makes the `place.*` helpers safe to grow: a helper that computed something unsayable would fail it.
- **The `program` sandbox is `run` (vercel-labs), and every host call must be awaited.** It is QuickJS on a worker thread, which is what makes executing a model's JavaScript something other than `eval`. Three consequences worth knowing before you extend the host surface. Every call crosses the worker bridge, so a dropped `await` detaches the request and its line lands late or not at all — the runtime catches it (`RUN_DETACHED_BRIDGE_REQUEST`) and `runProgram` records it, because a silently reordered program could move a cutter ahead of the solid it cuts. The runtime scrubs host error detail on the way back to the guest: every throw reaches the program as `Host function failed.`, so `runProgram` wraps every host function to keep the real reason on the host side — and then drops the runtime's scrubbed copy, or one fault would land as two errors, the second saying nothing. And **a `place.*` helper is one bridge call that loops host-side, so `maxBridgeRequests` does not bound it**: `MAX_PLACEMENTS` is that missing bound, and a new helper that loops needs it too. `place.mirror` is deliberately absent — reflecting what was already emitted needs a second pass over the lines, and a half-working helper is worse than none.
- **`place.*` centres on the _turned_ extent, and the fixture that proves it is not square.** A quarter turn transposes a part, and `Canvas.part` places the turned bbox's top-left at the coordinate the program emits — so a helper that offsets by the unturned width puts every odd-turned copy out by `(h - w) / 2`. `tools/dsl.ts`'s `placePart` makes the same transposition for the same reason. This shipped once because `program.test.ts` used a 2×2 part, against which the bug is invisible; the fixture is 2×5 now, and the assertions are on each element's measured bbox centre rather than on emitted coordinates.
- **The `program` arm's brief is `systemPrompt` + `conceptPrompt`, not its own.** The arm exists to be compared against `agent` — a loop instead of an unrolled list — and an experiment is only worth its credential when that is the _only_ difference. So it calls the same two builders `generate.ts` calls and appends `CALLING_CONVENTION` in place of the tool list; it resolves its vocabulary through `harness.ts`'s exported `vocabularyFor`, so both arms address the same marks including the id-only search hits. A revision that hand-rolled a four-line brief would have scored thin-brief-versus-rich-brief and reported it as loop-versus-unrolled. If you add a briefing input to `GenerateOptions`, it belongs in the shared builders, not in one arm.
- **Similarity scores are calibrated against 0.737**, the measured median rendered-cosine between two mature icon sets drawing the same concept. A reconstruction scoring 1.0 is a bug; a score near 0.74 means "as close as a different professional set's take".

## Agent invariants

- Prefer `--output json`; the default `text` is for humans.
- The CLI never prompts, under any conditions. Provide every value as a flag.
- Check each command's `--help` before using mutation flags. `draw` and `new` refuse existing output files unless `--force` is explicit; they have no `--dry-run`. Exit 0 on success, non-zero on failure.
- Core logic lives under `src/` behind the deliberately narrow re-export surface in `src/index.ts` (see its header); keep CLI-only concerns in `src/cli.ts`.

## Boolean geometry and preserved reference curves

`tools/boolean.ts` owns curve-aware union/subtraction through pinned Paper.js. The model selects existing solid groups through `combine`; it never supplies path data. The DSL's `union` and `subtract` combine the last two filled groups. The document retains a nested Boolean recipe, so exact replay can validate the result. Operations fail atomically when operands are invalid or fully erased. Post-composition transforms are refused: place/size operands first. This does not implement stroke expansion or general path offsets. Legacy `hole` remains the contained even-odd counter operation; union overlapping cutters before subtracting when parity cancellation would be wrong.

A pinned Spec may opt into `partGeometry: "source"` to preserve admitted reference contours under a transform while snapping their placement to the grid. The default remains `grid`. The model does not choose curve handles; source and Boolean-derived control/intersection points are host-owned, not independently snapped model coordinates. Do not flatten those curves or snap computed intersections to the placement grid. This qualifies the earlier blanket grid statement for these explicitly selected host-derived contours.

Static spec constants now live in `tools/spec.ts` and are re-exported by `canvas.ts`. Import that static module directly when only constants are needed.

`trim` extends the composition recipe to outlined centerlines: remove the left path sections inside a closed right cutter, preserving source curves and normal round caps. Filled union/subtraction semantics are unchanged. Compiler revision 2 records trim and explicit zero-radius serialization; old revision-1 artifacts remain viewable, but cannot be silently replayed as revision 2.

Compiler revision 4 adds optional family-tier circular fillets to `line` via `r`. Repeat the first vertex to close the contour. The model selects grid vertices and a radius tier; geometry/rounded-line.ts computes tangent points and handles, which are host-derived and must not be independently grid-snapped. Overlapping fillets, reversals and unsupported filled/knockout expansion are rejected. The recipe retains the radius through serialization and transforms. Old compiler-3 SVGs remain viewable; replay requires their original compiler, not silent reinterpretation.

Compiler revision 5 preserves computed normal offsets and cap radii for filled diagonal bars and their knockout geometry. Grid snapping those derived offsets changed a requested1.5-unit body into1.4142 and a2.5-unit body into2.8284. Model endpoints still snap; the calculated stroke envelope does not. Width and replay regressions live in tools/diagonal-width.test.ts. Historical compiler4 artifacts remain separate; recompile an unchanged program only into a new revision/output.

Compiler revision6 expands rounded line strokes through pinned PathKit1.0.0 in tools/stroke.ts. Radius remains a centerline parameter from outlined tiers for both paints. Closed rounded lines remain rings; interior union is not implicit. The host initializes WASM before synchronous Canvas calls and resolves its external asset with createRequire; static tools/spec.ts does not import it. Expansion works at100x internal resolution to reduce curve approximation, then returns to icon units without grid snapping. Paths are disposed even on failure. Tests cover bounds, ring counters, Boolean cutters, transforms, atomic failure and replay. Old revisions remain separate.

Compiler7 adds explicit `solid` for closed rounded lines in filled paint. Canvas unions expanded stroke and centerline interior via the existing Boolean boundary. Optional flag survives DSL/tool schema, document, transforms and replay. Missing radius, open contour or outlined paint refuses before mutation. The compiler never infers interior fill for old rounded rings. Reverse twin adaptation refuses solid contours rather than dropping their meaning.

Compiler8 preserves exact derived axial stroke boundaries and their centers, including fractional native-master widths. Axial filled lines and direct line knockouts now use the shared bar constructor; knockouts retain the line recipe and selected target instead of being reinterpreted as grid-snapped rectangles. Tests cover horizontal/vertical fractional widths, positioning, transforms, selected-target placement and exact replay. Historical compiler7 artifacts remain separate; never silently reinterpret their revision.

Compiler9 supports selected `strokeJoin: "miter"` (fixed miter limit4, round caps) and zero-radius styles with empty positive-radius tiers. Use `line ... r0` for a sharp contour and repeat the first vertex to close it; add `solid` only for a closed filled silhouette. Without solid, a closed filled line is an expanded ring. In a miter style, omitted line radius defaults to0; positive corner requests require declared tiers. The host preserves closure, expands miters and uses nonzero fill rules for the ring/interior union. SVG and filled expansion share the join policy. Painted miter bounds drive pair size, centering and bleed checks; centerline bbox stays available separately. Existing round defaults remain. Historical compiler8 artifacts require their original compiler; never silently rewrite their revision. This is representational support, not a qualified new-style library.

Compiler10 repairs direct legacy holes on nonzero parents. Serialization subtracts the contained parity-composed cutters from the nonzero parent through the existing Boolean kernel; it does not concatenate same-winding holes into the parent. Hole recipes remain editable and replayable. Ordinary evenodd parents retain their prior serialization. Overlapping legacy holes retain parity; use explicit cutter union/subtraction when overlap should also be removed. Historical compiler9 artifacts remain separate.

Compiler11 adds selected `strokeCap: "square"`; omitted cap stays round. SVG strokes, expanded filled lines and arcs, line knockouts, exposed trim ends and painted bounds share this cap policy. Closed contours ignore cap choice; dot roles remain round discs. Diagonal square caps extend in both tangent and normal directions, so bounds come from expansion rather than half-width padding. Preserve historical compiler10 artifacts and use a fresh revision/output.

Compiler12 allows an explicitly closed `line ... r0 solid` (or a positive declared radius) inside an outlined icon. It renders that element as the same expanded stroke plus filled interior used in filled paint, rather than stroking its boundary again. Use this for solid small modifiers such as play; the surrounding icon stays outlined. The solid flag survives existing recipes/replay/transforms. Painted bounds and mixed spacing use the modifier as zero-width ink, and feature diagnostics cover it. Trim refuses solid modifiers; it remains a centerline operation. Open or missing-radius solid contours still refuse. Historical compiler11 artifacts remain separate.

Compiler13 adds optional spec-pinned `detailStroke` and `line ... detail`. Only the named role is model-selected; its positive width must not exceed the family stroke. Existing lines keep their previous width. The role survives documents, transforms, nested trim and filled expansion; derived painted widths drive bounds and mixed-weight gaps. Solid detail modifiers remain already-filled ink. Use explicit filled subtraction for detail counters; legacy detail line holes and automatic twin adaptation refuse instead of silently losing weight. This is a line capability, not arbitrary per-path weights or free curve handles. Preserve historical compiler12 artifacts and use a fresh revision/output.

Compiler14 extends the existing named detail role to arcs through DSL, model tools, builder, recipes, transforms, trim and filled expansion. Filled arcs now use the shared PathKit stroke expansion for both round and square caps; the former round annular section omitted caps despite claiming otherwise. Independent raster comparisons cover outlined versus filled ink. Preserve historical compiler13 artifacts and create a fresh revision/output. This adds no free curve handles or per-path numeric widths.

Compiler16 replaces parity-based hole rendering with solid minus union(cutters). Each cutter retains its own fill rule, including nonzero expanded line caps. One resolver feeds SVG, nested Boolean operands and filled bounds. Repeated and overlapping holes cannot restore ink, and boundary-crossing cutters cannot add ink. Existing recipe syntax and constrained primitive construction remain; historical compiler15 artifacts require their original revision. This supersedes compiler10 legacy-hole parity semantics.

Compiler17 adds optional family-tier `radius` to filled Boolean recipes and `subtract r1` / `union r1` in the DSL. Only sharp operand intersections receive host-owned circular fillets. Preserve other corners and contours, reject infeasible or crossing results atomically, and retain radius through DSL/document replay. Smooth adjacent cubic segments may share a fillet tangency run; derived points are never grid snapped. No generic offset or global smoothing is implied. Historical artifacts remain separate.

Compiler18 defaults admitted part placement to source-preserving contours with grid-snapped anchors. Extracted and local source parts retain unquantized handles and native dimensions. Explicit partGeometry grid remains a diagnostic comparison mode. Preserve compiler17 artifacts under their original revision; new revisions use compiler18. This does not turn a source centerline into a filled boundary or solve mixed source paint semantics.

Compiler19 preserves host-admitted source ink with optional part `sourceFillRule` (nonzero or evenodd). Only closed source contours may carry it; outlined compositions render those contours as fixed ink instead of stroking their boundaries again. The DSL cannot choose or override this metadata. Admission still compares native16/24 pixels and refuses unsupported or incompatible paint. Compound outlined trim now subtracts the cutter from cloned individual contours, avoiding Paper compound-path failures and child-list mutation. Preserve compiler18 artifacts; use new revisions for new work.

Compiler20 expands open source parts through the same curve-aware stroke kernel as native primitives. One source part remains one editable part recipe; derived centerlines support fit bounds and are rebuilt during transforms/replay. They are host metadata, not model coordinates. Expanded parts can be whole Boolean operands/cutters. Source-preserving curves are never flattened into grid-snapped bars. Independent native raster comparisons cover round/square caps. Preserve compiler19 artifacts and use fresh revisions.

Compiler21 adds explicit numeric centre placement for parts: `part name centered at x,y`. The host derives the turned and scaled top-left, then applies the existing family-grid quantisation. Legacy numeric `at x,y` remains top-left and named `at anchor` remains centre-based so stored programs replay unchanged. Preserve compiler20 artifacts and use fresh revisions.
