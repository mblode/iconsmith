---
name: iconsmith
description: Draw a spec-compliant icon for an existing stroke icon set by writing a constrained DSL program instead of SVG path data, then verify it with iconsmith lint. Use when adding an icon to a design system, matching an existing icon set's style, or fixing an icon that lints off-spec.
---

# Drawing an icon with iconsmith

You are drawing one icon into a set of thousands. The set's consistency is the product, so **you never write a coordinate into a path**. You write a short program in the icon DSL; the library places the geometry, quantising every node to the grid, snapping angles, and taking corner radii from a measured tier set. You choose _what_ and _where_. The canvas chooses _how_.

This is not a style guide you can drift away from. Off-spec geometry is unrepresentable in this language: there is no op that takes path data.

## The loop

1. Read the concept. Decide what object to draw — the object noun, not the intent. `search` is a magnifying glass.
2. Pick a keyline (below) and write a `.icon` program.
3. `iconsmith draw icon.icon > icon.svg` — parse errors go to stderr and the exit code is non-zero. Fix them before going on.
4. `iconsmith lint icon.svg --keyline <name>` — fix every `error`. Warnings are a prompt to check a choice was made, not a rule.
5. Look at the SVG rendered at 16px. Lint checks the spec, not the drawing: a centred rectangle of the right size lints perfectly and is an icon of nothing. You are the only check on whether it reads as the thing.
6. Stop. An icon that draws clean, lints clean and reads correctly is finished. The commonest way to make a good icon worse is one more change it did not need.

```bash
npx iconsmith draw cloud-check.icon > cloud-check.svg
npx iconsmith lint cloud-check.svg --keyline wide
npx iconsmith --output json lint cloud-check.svg   # machine-readable
```

`draw` writes SVG on stdout and diagnostics on stderr, so the redirect above always produces a valid file. Both commands exit non-zero on an error and 0 on warnings alone. Every command takes `--output json`; the default text output is for humans.

## The house spec

Every number here is measured from the set, not chosen. They are quoted from `SPEC` in `src/tools/canvas.ts`, which is what the primitives and the linter both read.

| constant | value | what it is |
| --- | --- | --- |
| `canvas` | 24 | the viewBox is 24×24; y grows downward, (0,0) is top-left |
| `stroke` | 2 | round caps, round joins — the width every outlined shape is drawn at, and 0 under `finish filled` |
| `grid` | 0.25 | every coordinate lands on a 0.25 step; the primitives quantise for you |
| `clearance` | 2 | clear space kept in from the canvas edge |
| `minGap` | 1 | clear space between two strokes not meant to touch |
| `radiusTiers` | 0.5, 1, 2, 3 | the only corner radii; ask for one and the nearest legal tier is drawn |
| `fillRadiusTiers` | 0.5, 1, 1.5, 2, 3, 4 | the same, under `finish filled`: the outlined tiers offset by half a stroke, because a filled edge is a boundary and a stroked one is a centre line |
| `minFeature` | 1.5 | the narrowest a filled shape or hole may be; below it the feature closes up at 16px |

Outlined is the default and the set's main variant: suggest mass with an enclosing outline rather than by filling one. `finish filled` switches to the set's solid variant, where a shape _is_ its silhouette and interior white is cut with `hole`. Pick one at the top of the program and stay in it — a mixture is neither variant.

### Keylines

The canonical visual extents. Pick the one that suits the concept and keep the whole drawing inside it. Visual extent means the path bounds inflated by the stroke, half a width on each side — that is what a reader sees, and confusing it with the path bounds is the commonest measurement mistake in this domain. Under `finish filled` the two are the same thing, because the path already is the boundary; the keylines themselves do not move, which is measured rather than assumed.

| keyline     | extent |
| ----------- | ------ |
| `circle`    | 20×20  |
| `landscape` | 20×18  |
| `portrait`  | 18×20  |
| `square`    | 18×18  |
| `tall`      | 16×20  |
| `wide`      | 20×16  |

`iconsmith lint --keyline` currently accepts only `circle`, `square`, `tall` and `wide`; the `keyline` op in a program accepts all six.

### Dots

A dot is a solid disc, sized by the role it plays, as a visual diameter.

| role | diameter | what it is |
| --- | --- | --- |
| `terminal` | 2 | ends a stroke |
| `more` | 2.5 | one of an ellipsis, or a list bullet |
| `floating` | 3 | a separate interior mark — a dice pip, an eye, a day on a calendar |
| `node` | 4 | a point the drawing is _about_ — a dot-grid cell, a bezier handle, a data point, the centre of a target |

## The grammar

One op per line. Whitespace-separated. `#` starts a comment where a token starts, so a `#` inside a cohort key survives.

```text
icon     <slug>
keyline  circle | landscape | portrait | square | tall | wide
finish   outlined | filled
part     <name> [at <x>,<y> | at <anchor>] [size <n> | fill] [turn cw|half|ccw] [flip]
rect     <x>,<y> <w>x<h> [r<n>]
circle   <cx>,<cy> r<n>
hole     rect <x>,<y> <w>x<h> [r<n>]  |  circle <cx>,<cy> r<n>
line     <x>,<y> <x>,<y> [<x>,<y> ...] [off-axis]
dot      <cx>,<cy> [terminal|more|floating|node]
center                      -- recentre everything on (12,12)
fit                         -- scale everything to the declared keyline
cohort   [<name>]           -- scale everything to the family's measured extent
```

- **`rect`** — bodies, screens, cards, frames. `r<n>` asks for a radius; the nearest legal tier for that shape is what gets drawn. Default 2.
- **`circle`** — heads, lenses, clock faces, buttons.
- **`line`** — a polyline through two or more points. Arrows, ticks, connectors, chart lines. A segment within 6° of 0/45/90 is pulled onto the axis; one further out is **refused** unless the line says `off-axis`. About one edge in seven in this set is off-axis, so it is a real choice — make it on purpose, and keep both endpoints on the grid.
- **`hole`** — cut a rect or a circle out of the solid drawn most recently. Filled icons only, and it is how interior white is made: 45% of the set's filled icons knock at least one hole out of a solid, so a ring is `circle` then `hole circle`, and a card with a slot is `rect` then `hole rect`. The hole has to sit inside the solid it cuts — a piece hanging outside would paint ink rather than remove it, and is refused.
- **`dot`** — a solid disc with one of the four roles above. Default `terminal`.
- **`part`** — place a shape from the set's extracted vocabulary by name. Prefer this over drawing a common form from scratch: it is _the same_ folder, chevron or magnifier the rest of the set already uses, which is the whole point. A bare `<x>,<y>` names the part's top-left; a named anchor names its centre. Anchors: `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`. `size <n>` sets the long axis; `fill` scales the part to the declared keyline. `turn` names a quarter — `cw`, `half`, `ccw`, never an angle, because only the quarters keep every node on the grid. `flip` mirrors the part, and is applied before the turn. Ask for `flip` on purpose: a check mark, a comma and every letterform are chiral, so an implicit mirror is a backwards glyph rather than an orientation. Parts come from a `parts.json` for the set, passed as `iconsmith draw prog.icon --parts parts.json`; without one, `part` has nothing to place.
- **`finish`** — `outlined` (the default: a stroked skeleton) or `filled` (solid shapes). Declare it before you draw anything, because a corner radius and a dot diameter both mean different things under each. Filled changes three things and nothing else: `hole` becomes available, `line` is refused because an open run of points encloses nothing and so paints nothing, and corners come from the filled radius tiers (0.5, 1, 1.5, 2, 3, 4 — the outlined tiers shifted by half a stroke, since a filled edge is a boundary where a stroked one is a centre line). Keylines, clearance and centring are unchanged: a filled icon and its outlined twin occupy the same visual extent in 94% of the set's pairs.
- **`center`** — recentre the drawing's content on (12,12).
- **`fit`** — scale the drawing to the declared keyline. Once, near the end.
- **`cohort`** — scale the drawing onto the measured extent of the family it joins, when the family has one. Use it **instead of** `fit`: they are the same operation against different targets, so a `fit` after a `cohort` throws the inherited extent away, and is refused rather than silently obeyed. Where the two disagree the family wins — a 1px disagreement is a visible jump when one icon swaps for another.

`fill`, `center`, `fit` and `cohort` exist so you never do spatial arithmetic. Scaling to a keyline and centring on content are pure functions of what has been drawn, so code does them exactly and you do not have to.

### Examples

A tick inside a cloud, drawn from the vocabulary and one line:

```icon
icon cloud-check
keyline wide
part cloud fill
line 9,13 11,15 15,11
fit
```

A document with two text lines, drawn from primitives only:

```icon
icon file-text
keyline portrait
rect 4,3 16x18 r2
line 8,10 16,10
line 8,14 13,14
fit
```

The same subject as a solid, where the lens and the flash are holes rather than strokes:

```icon
icon camera
keyline landscape
finish filled

rect 8,3 8x4 r2          # viewfinder hump
rect 2,6 20x15 r4        # body
hole circle 12,13.5 r4.5 # lens
hole circle 18,9 r1      # flash
```

A clock face, and the `-off` slash that every negated variant in the set runs NW to SE:

```icon
icon clock-off
keyline circle
circle 12,12 r9
line 12,7 12,12 16,12
line 4,4 20,20
fit
```

## What the linter checks

Fix every `error`. A `warn` is a prompt to confirm the choice was deliberate.

| rule | severity | meaning |
| --- | --- | --- |
| `empty` | error | nothing was drawn |
| `keyline` | error | the icon declared a keyline and its visual extent misses it; warn when it declares none and matches none |
| `bleed` | error | geometry runs outside the live area |
| `substance` | error | there is too little ink for this to be an icon |
| `cut` | warn | shapes knock out of each other by the wrong amount |
| `gap` | warn | two strokes sit closer than `minGap` without touching (outlined only) |
| `feature` | warn | a filled shape or hole is narrower than `minFeature` (filled only — filled shapes are meant to touch, so `gap` has nothing to say about them) |
| `off-axis` | warn | a straight run leaves 0/45/90 |
| `centred` | warn | content centre is not (12,12), and the family does not agree |
| `cohort-align` | warn | the icon sits off the extent of the family it swaps with |
| `density` | warn | more ink than the set draws at this size |

When a warning and the drawing disagree, the drawing usually wins — but say why. Reaching for the ordinary solution is the rule: an icon that is _correct_ but drawn in its own dialect is worse than one that is plain and drawn in the set's.
