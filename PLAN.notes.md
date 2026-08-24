# PLAN.notes.md

Deviations, in the form `PLAN.md said / the code required / what was done`.
Kept because `PLAN.md` asks for it and because a plan that is only ever right
in hindsight teaches nothing.

---

## 2026-08-19 — `npx tsx` is not what runs the scripts

**The plan said** `npx tsx scripts/loop.ts`, `npx tsx scripts/gate.ts`, and so on
throughout `PLAN.md`'s Verification block.

**The code required** something, and it is not obvious which. `tsx` is in
neither `package.json`; `npx tsx` fetches it from the network on every run.
Bare `node scripts/loop.ts` does **not** work either: Node 24 strips types but
does not remap a `.js` specifier onto a `.ts` file, and every script imports
`../src/…js`. Confirmed by `import("./scripts/loop.ts")` →
`ERR_MODULE_NOT_FOUND ... src/eval/blindspot.js`.

`node scripts/check-boundaries.ts` works only because that file imports nothing
from `src/`, which is why the gap went unnoticed.

**Taken:** `npx tsx` for anything importing `src/`, `node` for the standalone
scripts. Left as a known cost rather than adding a dependency in the middle of
other work. If the scripts are going to be run often, `tsx` belongs in
`devDependencies` so the version is pinned and the run is offline.

## 2026-08-19 — the Central alias result is two numbers, not one

**The plan said** wire Central's aliases into `pipeline/search.ts` and re-measure
part coverage against `bench/part-coverage.v1.json`.

**The code required** the measurement be split by source. Coverage is scored
against the concept list in blode's `_concepts.json` — and that same file is the
richest available source of blode aliases. Feeding it to the search takes
coverage from 548/2,203 to 1,954 (88.7%), almost all of it by construction: every
key in that file points at a slug the set draws, so aliasing it makes it
reachable by definition. It is the same trap `corpus/concepts.ts` documents for
informative-vs-nominal concept coverage, one level up, and it would have been
reported as an eight-fold improvement.

**Taken:** `loadAliases` returns two tables. `independent` holds only sources
that did not supply the concept list — today, Central alone. The drawer gets the
full table, because a model looking for a shape should reach every word anyone
wrote down and the tautology costs it nothing; coverage gets both and
`iconsmith parts --coverage` prints three lines with the self-scored one
labelled `(scored against itself)`.

Measured, same parts, same concept list:

| channel | covered | of 2,203 |
|---|---|---|
| provenance only (the old number) | 548 | 24.9% |
| + Central's aliases (independent) | **926** | **42.1%** |
| + blode's own concept map | 1,972 | 89.6% — scored against itself |
| a curated name (unchanged) | 76 | 3.5% |

The honest headline is 548 → 926.

## 2026-08-19 — no `aliases` field on `IconRecord`; `tags` already was one

**The plan said** add `aliases: string[]` and `title: string | null` to
`IconRecord` and bump `RECORD_SCHEMA_VERSION`.

**The code required** neither. `IconRecord.tags` is already "words the set says
this icon also answers to" — it is what blode's `icons-data/*.json` tags are —
so a second field would be a second name for one idea and every consumer would
have to read both. `title` in the bundle is the aliases comma-joined, in all
2,086 entries; it is a copy of a list, not a title. `createdAt` is one shared
bulk-import timestamp for ~2,000 of them, so it dates the scrape.

**Taken:** Central's aliases go into `tags` and its category into `category`.
No field added, so no schema bump: the record's *shape* is unchanged and the
version signals shape. `concepts` deliberately stays empty for Central — a
concept is the single canonical answer to an intent, blessed by hand, and a list
of synonyms is not a claim about canonicality.

## 2026-08-19 — the extract is keyed off the component name, not the first alias

**The plan said** map `IconCirclePerson` → `circle-person`, verifying that the
first alias is always the slug.

**The code required** the opposite direction. The assertion fails 98 times:
`clipboard 2-sparkle` carries a space, `Folder-sparkle` a capital. The component
names are machine-derived and consistent; the aliases are typed by hand. Keying
off the aliases would have produced 98 rows no SVG on disk answers to, and the
failure is silent — the search simply never matches them.

**Taken:** key off `slugOf(componentName)`, then reconcile against
`corpus/corpus.json`, which is the authority on what a slug is *called*. 2,073
of 2,085 icons on disk end up with metadata. The remaining 12 are genuine
spelling divergences between the component and the filename — `threed` vs `3-d`,
`douple-check` (a typo on disk) vs `double-checkmark`, `fourk` vs `4-k` — and
the extractor names them rather than guessing.

## 2026-08-20 — the harness ships named parts, not the whole extraction

**The plan said** the external arm is the same experiment as the built-in loop,
so it has to have the vocabulary.

**The code required** a file the agent can actually address. `part` looks up a
name. A house extraction is ~1,100 shapes of which ~60 carry one; the rest is
~270 KB of path data `part` cannot use. Shipping the lot, plus inviting `part`
in the brief, is what made the first demo run to the 10-minute kill: the agent
read the file looking for names and spent the rest of the budget on geometry.

**Taken:** write only the named parts. The full list still goes to `runDsl`, so
a program that names an id is not refused. A list of only unnamed parts is
treated as no vocabulary, and the brief says so.

## 2026-08-19 — the derived table is not committed

**The plan said** build into `.corpus/`, gitignored, for the provenance reason
`.gitignore` gives for `central.json` itself.

**No deviation** — recorded because it is the decision most likely to be undone
by someone who finds the file useful. A table of a proprietary set's editorial
labels in an MIT-licensed repo is the same question the bundle raised, with the
same answer. `scripts/extract-central-metadata.ts` rebuilds it in about a
second.

## 2026-08-20 — the skill is copied into scratch, like the parts file

**The plan said** `codex exec --sandbox workspace-write` with the brief pointing
at the packaged `SKILL.md`.

**The code required** the skill to live inside the scratch directory. The
sandbox cannot read a path in the repo, so the first tracer returned exit 0
without writing `icon.icon`. Node's `spawn({ timeout })` also only signals the
direct child, and the nested Codex binary kept the second sample open past ten
minutes. `--approve-for-me` cannot be combined with `--sandbox`; it already
implies workspace-write.

**Taken:** copy `SKILL.md` into the scratch directory when the file exists, kill
the process group on timeout, and pass `--approve-for-me` instead of
`--sandbox`. Same shape as shipping `parts.json`: a capability named in the
brief has to be a file the agent can open.

## 2026-08-20 — house extraction test needs more than 5s under load

**The plan said** `npm run test` is the canary.

**The code required** `lands every name on a part of the real extraction` to
extract the whole house set. Alone it is ~4.6s; in a parallel vitest run it
hit the default 5s timeout. Unrelated to this pass's files.

**Taken:** 15s timeout on that one test.

## 2026-08-20 — the demo asked the wrong two questions

**The plan said** keyed `folder-open`, unkeyed `pull-request` as reach.

**The code required** the opposite of the second. `corpus/.../pull-request.svg`
exists. Treating it as invention meant no cosine, while the agent drew a git
graph from memory. `folder-open` as a *part name* is a closed body with a
badge gap, not the open flap, so the reconstruction placed a false friend.
`iconsmith` was not on PATH in the scratch dir, so the skill's `draw`/`lint`
loop could not run. Four of five folder samples were identical.

**Taken:** keyed concept is `pull-request` against its house SVG. Reach is
`database`, which is actually missing. Symlink `dist/cli.js` into scratch as
`iconsmith` and prepend that dir to PATH.

N=5 then showed the next ranking bug. Cosine-first selected pull-request sample
4 at 0.950 (0 parts, house graph minus the incoming chevron) and database
sample 1 (0 parts, a three-shelf box). Selection now ranks `partsFound` after
the panel and before cosine. Re-picked from the same samples: pull-request-5
(0.936, 3 parts) and database-2 (3 parts, stacked cylinders).

## 2026-08-20 — the harness shortlist was the built-in loop's `listParts`

**The plan said** ship named parts only; the agent searches `parts.json` itself.

**The code required** the unnamed marks from `pull-request.svg`. `part` already
accepts an id. Tags on the demo concept (`branch`, `git`, `Code`) ranked
`sparkle` and `code-tree` above the house nodes; `database` as a name ranked
`brain` via aliases. The agent assembled those.

**Taken:** named parts plus `searchParts` hits whose provenance names the slug
(or `*-${slug}` / contains the slug). If that list is empty (a real gap), fall
back to tag hits whose `seenIn` contains the tag. Brief lists ids. N=1 then
drew a pull-request at 0.792 / 6 parts and a four-part cylinder stack.

## 2026-08-21 — twins are one skeleton, two paints

**The plan said** Slice 3 would give filled a knockout, its own radius rule,
and an inverted gap rule, so filled was a facet of one icon rather than a
second drawing.

**The code required** those three, and they landed: `hole`, `fillRadiusTiers`
(the outlined tiers offset by half a stroke), lint `feature` (solids are meant
to touch, so the gap rule inverts to a minimum width). What Slice 3 did not
name is the construction itself. `marks.ts` still wrote two programs by hand —
`finish === "filled" ? rect : line` — so every twin was a second composition,
not a derived paint.

Visual extent is path bbox + `inkWidth` (0 when filled). Comparing a filled
bbox to an outlined *path* bbox is the mistake the measurement already named,
and it is what made filled look larger.

A mechanical "every closed stroke becomes a ring" is the wrong construction.
Heart, airplane, battery body are shadows — solids. Circle-plus and donut are
knockouts. The composer chooses `solid*` vs `ring` / `frame`. Ban's filled
slash may stay a horizontal bar (simplify) while outlined keeps the diagonal —
Wolf: filled simplifies, it does not invert.

**Taken:** the construction is a host-side language (`src/tools/twin.ts`: bar /
ring / frame / solid), so a twin is derived rather than rewritten. The drawer
still writes DSL and never a coordinate; the same rules are in `SKILL.md`.

## 2026-08-24 — a filled paint's ink scaled with it, and its twin came apart

**The plan said** Slice 3 gives filled its own knockout, radius rule and
inverted gap rule, and the twin `extent` rule holds both paints to one visual
extent — measured at 94% of 2,085 pairs within 0.01u.

**The code required** two more things, and neither was true. Both were found by
asking why a filled diagonal could not round-trip through its own program.

**One: `fit` scaled the ink.** Six lines reproduce it.

```ts
const c = new Canvas([], { finish: "filled" });
c.line({ points: [[4, 12], [14, 12]] });   // bar is 2 thick, the spec stroke
fitKeyline(c, "square");                    // bar was 3 thick
```

Under a stroked finish the ink is applied at render by `stroke-width`, so a
scale never touches it. Under a filled finish `#filledBar` has already expanded
the stroke into the path, so the caps and the bar's own width scaled with
everything else and the drawing came out heavier than the house draws it. A
filled `circle` or `rect` is unaffected — a disc's radius and a slab's height
are design dimensions — so the rule is not "filled scales wrong" but "a stroke
that has been expanded carries ink where a dimension is expected".

Nothing downstream saw it. `twinPairIssues` compares the two paints' visual
extents, and both were scaled by the same wrong factor, so they still agreed:
the check passed because two errors cancelled. The only report on record that
noticed is the independent review of the one accepted campaign pair, *"The
heavy filled nodes and bars feel uneven"*, PQ 6.

**Two: the derived twin was not the same drawing.** `line` snaps each vertex
against the previous *snapped* one, so a polyline is a chain: the dart
`line 4,12 20,6 13,12 20,18 4,12 off-axis` lands its third vertex on
`13.5,12.5`. `adaptProgram` split the *source text*, so each filled bar got the
raw `13,12` and re-snapped from its own start — bar 2 ended at `13.5,12.5`
while bar 3 began at `13,12`, and the filled twin came apart at every joint.
`paperplane` had the same split written out by hand, with the same drift. No
rule looked for it, because a bounding box is set by the outer vertices and
those agreed.

**Taken:** three changes, and they only work together.

- `#filledBar` keeps the `line` op and its two points, whatever it paints —
  the square-ended rect for an axial bar, the round-capped stadium for a
  diagonal. Emitting a `rect` threw the skeleton away and `raw` could not be
  re-emitted through a primitive at all, so `transform` scaled ink in both
  cases and `programFromDoc` dropped the `raw` ones from the program entirely.
- `fitKeyline` solves `k · skeleton + ink = target` rather than
  `k · painted = target`, with `Canvas.skeletonBbox` and `Canvas.inkExtent`
  telling the two apart. Stroked drawings always had that constant term; filled
  ones were assumed to have none, "where the path already is the boundary",
  which is true of a disc and false of a bar.
- `adaptProgram` splits the chain the stroked paint actually drew, by running
  the one op through a scratch canvas — `line` snaps only within itself, so
  nothing else in the program can change the answer. `paperplane` now derives
  its filled paint instead of repeating it.

Measured after: the bar holds the spec stroke through a fit, every bar of a
derived twin starts where the stroked paint's vertex is, both paints report one
visual extent, and a filled diagonal is `programComplete` — so it can pass an
acceptance gate that asks the program to be the drawing.

The deeper shape is still worth naming: fill expansion happens at
**construction**, in `line()`, rather than at **render**. Keeping the op and its
points is what makes that survivable, but the document still stores paint
beside skeleton. Moving the expansion into `toSVG` would make it
finish-independent outright. Not needed for any of the above, and not a change
to make in passing.
