---
name: iconsmith
description: Draw a spec-compliant icon for an existing stroke icon set by writing a constrained DSL program instead of SVG path data, then verify it with iconsmith lint. Use when adding an icon to a design system, matching an existing icon set's style, or fixing an icon that lints off-spec.
---

# Drawing an icon with iconsmith

You are drawing one icon into a set of thousands. The set's consistency is the product, so **you never write a coordinate into a path**. You write a short program in the icon DSL; the library places the geometry, constraining model-selected placement to the grid and taking corner radii from a measured tier set. Host-derived curves, Boolean intersections and stroke envelopes retain their geometry without independently snapping their handles. You choose _what_ and _where_. The canvas chooses _how_.

The DSL constrains placement and construction. There is no op that takes path data, but semantic correctness and visual family fit still require inspection.

## Authoring contract

This reference describes the DSL, not an autonomous generation route. Follow the request and pinned revision supplied by the calling workflow. Compile with its real checker and inspect the native and enlarged proofs. A compiler pass does not prove meaning or family fit; independent AI review determines acceptance under the frozen rubric.

Compiler correction and named visual repair have separate bounded allowances under the original deadline. Retain the previous candidate before each repair. Use only the supplied reference drawings; missing vocabulary is not permission to copy another set.

## Contents

- The house spec
- The grammar
- What the linter checks
- Continuous rounded contours
- Native optical placement

## The house spec

Every number here is measured from the set, not chosen. They are quoted from `SPEC` in `src/tools/canvas.ts`, which is what the primitives and the linter both read.

| constant | value | what it is |
| --- | --- | --- |
| `canvas` | 24 | the viewBox is 24×24; y grows downward, (0,0) is top-left |
| `stroke` | 2 | round caps, round joins: the width every outlined shape is drawn at, and 0 under `finish filled` |
| `grid` | 0.25 | model-selected placement uses a 0.25 step; host-derived geometry is preserved |
| `clearance` | 2 | clear space kept in from the canvas edge |
| `minGap` | 1 | clear space between two strokes not meant to touch |
| `radiusTiers` | 0.5, 1, 2, 3 | the only corner radii; ask for one and the nearest legal tier is drawn |
| `fillRadiusTiers` | 0.5, 1, 1.5, 2, 3, 4 | the same, under `finish filled`: the outlined tiers offset by half a stroke, because a filled edge is a boundary and a stroked one is a centre line |
| `minFeature` | 1.5 | the narrowest a filled shape or hole may be; below it the feature closes up at 16px |

Outlined is the default and the set's main variant: suggest mass with an enclosing outline rather than by filling one. `finish filled` switches to the set's solid variant, where a shape _is_ its silhouette and interior white is cut with `hole`. Declare one global paint. House-supported solid modifiers in outlined paint and named detail roles are allowed; conflicting finish declarations are refused.

### House voice

The set is Central / [blode-icons](https://blode.co/icons): those numbers, this stroke. [Cursor's icon essay](https://minoradventures.co/blog/the-making-of-cursors-icons) and [Lucide's design guide](https://lucide.dev/contribute/icon-design-guide) describe the same craft: technical drawing, closed forms, optical keylines, one stroke, no decoration: and they are not the spec. Cursor packs looser (min gap ~3.75, clearance 2.5); Lucide pads 1px. Where they disagree, the corpus wins.

Draw the ordinary solution. Median four elements, one dominant mass of 18–20u, empty 4×4 corners, optical centre (12,12). On-axis unless the subject itself is a slope. Closed over open. Filled construction follows the reference family: open strokes expand, enclosed bodies may become solid silhouettes, and structural counters remain open. Recurring elements (the wifi fan, a tray, a handle) stay the same across the set. Tall subjects stay tall; wide ones stay wide: squashing either into a square is the toy look. An icon that is correct but drawn in its own dialect is worse than one that is plain and drawn in the set's.

### Keylines

The canonical visual extents. Pick the one that suits the concept and keep the whole drawing inside it. Visual extent means the path bounds inflated by the stroke, half a width on each side: that is what a reader sees, and confusing it with the path bounds is the commonest measurement mistake in this domain. Under `finish filled` the two are the same thing, because the path already is the boundary; the keylines themselves do not move, which is measured rather than assumed.

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
| `floating` | 3 | a separate interior mark: a dice pip, an eye, a day on a calendar |
| `node` | 4 | a point the drawing is _about_: a dot-grid cell, a bezier handle, a data point, the centre of a target |

## The grammar

One op per line. Whitespace-separated. `#` starts a comment where a token starts, so a `#` inside a cohort key survives.

```text
icon     <slug>
keyline  circle | landscape | portrait | square | tall | wide
finish   outlined | filled
source-exact <binding>       -- host-issued reconstruction binding; requires its resolver
part     <name> [at <x>,<y> | at <anchor> | centered at <x>,<y>] [size <n> | fill] [turn cw|half|ccw] [flip]
rect     <x>,<y> <w>x<h> [r<n>]
circle   <cx>,<cy> r<n>
arc      <cx>,<cy> r<n> quarter|half|three-quarter from top|right|bottom|left [ccw] [detail]
diamond  <cx>,<cy> r<n>
subtract                         -- last two filled solid groups: first minus second
union                            -- merge last two filled solid groups
trim                             -- outlined: remove first path inside second closed shape
hole     rect <x>,<y> <w>x<h> [r<n>]  |  circle <cx>,<cy> r<n>
line     <x>,<y> <x>,<y> [<x>,<y> ...] [off-axis]
dot      <cx>,<cy> [terminal|more|floating|node]
center                      -- recentre everything on (12,12)
fit                         -- scale everything to the declared keyline
cohort   [<name>]           -- scale everything to the family's measured extent
```

- **`source-exact`**: reconstruction only, using an opaque host-issued binding to an admitted source and exact spec. Such programs contain only the matching `icon`, `finish` and `source-exact` operations. This operation accepts no placement parameters or path strings and requires the matching host resolver; it is not available in the ordinary author route.
- **`rect`**: bodies, screens, cards, frames. `r<n>` asks for a radius; the nearest legal tier for that shape is what gets drawn. Default 2.
- **`circle`**: heads, lenses, clock faces, buttons.
- **`arc`**: an open circular arc. Same cubics as `circle`. Name a pole (`top` / `right` / `bottom` / `left`), a sweep (`quarter` / `half` / `three-quarter`), and optionally `ccw`. Wifi fans, umbrella canopies, C-shapes, the lobes of an S. A curve is never a polyline of grid points. Filled, the stroke expands into an annular sector: the ink the outline already occupied, not a pie of the sweep.
- **`diamond`**: a square rotated 45°. `r` is centre to vertex, so every edge sits on 45°/135°. A compass needle, a card suit, a lozenge. Not a star. A kite that is only grid-legal (unequal diagonals) is off-axis and is a `line … off-axis`, not this op.
- **Tall open arches**: a half arc does not need to carry the whole height. Extend each endpoint with a straight segment along its tangent, then join the legs to the body below. At a shared tangent endpoint, the round caps are contained within the continuous stroke silhouette; they do not inherently create a blob. This separates arch width from height. Leave white space between the inside of the arch and the body's top ink. In filled paint, union the expanded arc and leg strokes before combining with the body. Render and inspect the opening; do not declare the vocabulary incapable merely because an arc sitting directly on the body's top stroke closes it.
- **`line`**: a polyline through two or more points. Arrows, ticks, connectors, chart lines. A segment within 6° of 0/45/90 is pulled onto the axis; one further out is **refused** unless the line says `off-axis`. About one edge in seven in this set is off-axis, so it is a real choice: make it on purpose, and keep both endpoints on the grid. If the stroke is a curve, use `arc` or `circle`. A diamond that should be on 45° is `diamond`, not a polyline of unequal run and rise.
- **`subtract` / `union`**: true curve-aware Boolean operations on the last two filled solid groups, including their counters. Draw the base, draw the cutter, then `subtract`; cutters may cross the outer edge. Union overlapping cutters first to avoid XOR cancellation. Place and size operands before combining: post-composition transforms are refused. Recipes retain their primitives and admitted parts; no model-authored paths. These Boolean commands combine existing solids; filled `line` and `arc` primitives supply stroke expansion. Automatic clearance offsets are not supplied.

- **`hole`**: cut a rect or a circle out of the solid drawn most recently. Filled icons only, and it is how interior white is made: 45% of the set's filled icons knock at least one hole out of a solid, so a ring is `circle` then `hole circle`, and a card with a slot is `rect` then `hole rect`. Draw the hole immediately after that solid: a mark between `circle` and `hole` takes the knockout and the circle ships as a solid disc. Name the solid with `cutFrom` when you have to come back to it. Cutters are unioned, then subtracted from that solid. Overlapping or repeated holes never restore ink; a cutter crossing the boundary only removes the overlapping portion. `hole line` cuts expanded segments with the configured caps. Union several body shapes before cutting an opening through all of them.
- **`dot`**: a solid disc with one of the four roles above. Default `terminal`.
- **`part`**: place a shape from the set's extracted vocabulary by name or id. Prefer this over drawing a common form from scratch: it is _the same_ folder, chevron or magnifier the rest of the set already uses, which is the whole point. A bare `at <x>,<y>` names the part's top-left; `centered at <x>,<y>` explicitly names its centre; a named anchor after `at` also names the centre. Prefer `centered at` for a modifier whose intended centre is known, so the host derives the turned and scaled top-left. That derived origin is snapped to the family grid, so a fractional extent can place the achieved centre within half a grid step of the requested point. Anchors: `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`. `size <n>` sets the long axis; `scale <factor>` preserves an explicit multiplier; `fill` scales the part to the declared keyline. `turn` names a quarter: `cw`, `half`, `ccw`, never an angle, within the constrained placement vocabulary; admitted source handles remain host-owned. `flip` mirrors the part, and is applied before the turn. Ask for `flip` on purpose: a check mark, a comma and every letterform are chiral, so an implicit mirror is a backwards glyph rather than an orientation. Parts come from a `parts.json` for the set, passed as `iconsmith draw prog.icon --parts parts.json`; without one, `part` has nothing to place. An unnamed mark is addressed by the `id` in that file (`part p0123`), which is what the brief lists when search hits one.
- **`finish`**: `outlined` (the default: a stroked skeleton) or `filled` (solid shapes). Declare it near the top for readability. It is a global property: the compiler resolves it before drawing regardless of where the declaration appears; conflicting declarations are refused. Filled enables transparent counters and solid primitives. Open lines and arcs expand with the selected caps and weights; an explicitly closed rounded line remains a ring unless `solid` is selected. Rectangular boundary radii use the filled tiers; rounded line radii describe the centerline. Use the selected native master spec, and author the counterpart explicitly when paint topology or detail roles differ.

### Twins (outlined ↔ filled)

Before drawing, state the construction in the working review: body, counter, modifier polarity, attachment and clearance. Tie those choices to the admitted references; distinguish target reconstruction from a novel combination. Preserve the object, its proportions and its visual extent across paints. Decide which regions are body, openings and modifiers before drawing the filled variant. An open stroke scaffold expands to the same ink; an enclosed object can become a solid silhouette with its identifying marks cut out. A structural opening such as a ring stays open, but an outlined object does not automatically become a hollow shell. Replacing a stroke with a default-radius rectangle changes its end geometry and can pinch a shackle or create a bulge. The compiler expands open lines and arcs with the configured width and caps.

94% of 2,085 house pairs share visual extent; 45% knock a hole; 2,078 of 2,085 filled icons carry no stroke. Keylines, clearance and centre do not move.

**Outlined → filled**

1. **Choose the body**: use house-supported solid boundaries for enclosed objects; retain a ring where the opening is structural. Let the host compute stroke envelopes. Do not automatically flood every closed stroke.
2. **Knock out**: canvas through a ring or an interior mark becomes `hole`. Inner radius shrinks by ½ stroke. A plus inside a circle is a white plus, not a plus drawn on top.
3. **Expand open strokes**: keep each two-point `line` and each `arc` on the same skeleton. In filled mode the compiler expands them to solid strokes with the configured width and caps. Split an outlined polyline into two-point lines, then `union` overlapping segments where needed. Do not substitute default-radius rectangles: their corners and endpoints can change the silhouette.
4. **Keep the gap**: overlapping layers stay separated by white at least a stroke wide. The gap is a hole or a cut, not a second stroke.
5. **Simplify**: filled is a shadow of the object, not an invert of every stroke. Drop hatch that would become unreadable cutouts.

**Filled → outlined**: inset the silhouette by ½ stroke; holes become inner strokes (or drop if too thin); 2-wide rects become `line`s; do not add a new metaphor.

Do not flood-fill the path bbox (that grows the icon); invert the line drawing; run a bar through a hollow ring (timeline crescents); bury a solid inside another element; mix a stroke into a filled icon; or use conflicting `finish` declarations.

A plus. Outlined is two `line`s (house `plus-large` is four open strokes from the hub); filled is one evenodd compound, or two 2-wide `rect`s on the same centre-lines, each bar half a stroke past both endpoints so the two occupy the same visual extent. Two crossing `line`s under `finish filled`, followed by `union`, preserve the configured stroke and caps. Do not flood the bounding box.

A ring is the same skeleton: `circle`, or `circle` then `hole circle` immediately after. A mark between them ships a solid disc. `fit` to the same keyline does not hide a missing knockout: pairing after `fit` has to read the construction, not the box.

A cloud upload supports two valid treatments: a solid cloud with a negative arrow, or an open cloud with a separate positive arrow, as in Blode's cloud-simple-upload-filled. Choose from the reference family rather than banning either polarity. For a negative arrow, union the cloud body before cutting connected strokes. For a separate positive arrow, preserve cloud mass and design a rounded clearance opening around the arrow; an oversized box or sharp diamond is a poor proxy. A closed rounded `line ... r1 solid` can build the cutter without raw paths. Its filled boundary includes half the stroke beyond the centerline, so account for that expansion when sizing clearance. Inspect the roof, lower opening ends and arrow separately at native size; rounding only the cutter apex does not guarantee rounded Boolean intersection corners. Use explicit `subtract r1` (or another filled family tier) when those new corners need circular fillets. This preserves existing body and cutter corners, rejects a radius that cannot fit, and does not apply global smoothing.

A clock. Outlined is a ring plus hands as a polyline from the centre (`circle 12,12 r9` and `line 12,7 12,12 16,12`). Filled is a solid disc with the hands cut out, `hole` immediately after the disc: not a ring restamped as a disc, and not hands drawn on top of a filled face.

A check. Outlined is an open tick stroke. Filled is a badge disc with the tick cut out (evenodd). Not a thick tick, and not a tick drawn on top of a disc.

A home. Outlined is one closed pentagon: roof peak and walls as the outer stroke. Filled is that silhouette (body plus a roof seated on the eaves), not a frame-and-dot and not a door nobody asked for.

A heart. House compile is one evenodd compound of two lobes and a point. Outlined is that closed silhouette, not three circles. Filled is the same compound, not a disc and not three circles restamped as solids.

A shield. House compile is one heater silhouette. Outlined is that closed outline: peaked top, sides, a point: not a 45° diamond with a cap. Filled is the same body (a mass seated on a diamond point).

A zap. House compile is one bolt silhouette. Outlined is that closed lightning, not a frame-and-dot. Filled is the same zigzag as three bars on the bolt's centre-lines.

A pause is two rounded uprights. A play is a right-pointing triangle, not a chevron. An arrow-right is a shaft plus a chevron head. A chevron-right is the head alone. A bookmark is a tall ribbon with a V bite at the foot. A share is three nodes and two connectors, not a hub tree. An airdrop is a dome, two off-axis beams, a stem, and a seated capsule. An airplane is a jet silhouette, not a paper dart.

Do not volunteer a star. Analog has no star family. A diamond is a compass needle; a chevron or four diamonds is not the house star.

These are constructions, not glyphs to volunteer for an unasked name.

A strike-through. Two half-arcs of one circle, plus a bar. Not a zigzag S.

```icon
icon strikethrough
keyline circle
arc 12,12 r9 half from left
arc 12,12 r9 half from left ccw
line 3,12 21,12
fit
```

```icon
icon plus
keyline square
line 4,12 20,12
line 12,4 12,20
```

```icon
icon plus
keyline square
finish filled
rect 3,11 18x2
rect 11,3 2x18
```

```icon
icon clock
keyline circle
finish filled
circle 12,12 r10
hole rect 11,7 2x6
hole rect 12,11 5x2
fit
```

- **`center`**: recentre the drawing's content on (12,12).
- **`fit`**: scale the drawing to the declared keyline. Once, near the end.
- **`cohort`**: scale the drawing onto the measured extent of the family it joins, when the family has one. Use it **instead of** `fit`: they are the same operation against different targets, so a `fit` after a `cohort` throws the inherited extent away, and is refused rather than silently obeyed. Where the two disagree the family wins: a 1px disagreement is a visible jump when one icon swaps for another.

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

A compass. The needle is a `diamond`, not a kite of unequal diagonals: those sit 20° off 135°.

```icon
icon compass
keyline circle
circle 12,12 r9
diamond 12,12 r5
fit
```

Wifi. Concentric upper half-arcs plus an emitter below, so the visual box is `wide` 20×16 rather than a drifted 20×11.5 fan.

```icon
icon wifi
keyline wide
arc 12,14 r9 half from left
arc 12,14 r6 half from left
arc 12,14 r3 half from left
dot 12,19 terminal
fit
```

A microscope. Optical stack on `tall` 16×20 so the stage stays at x=4–20: portrait 18×20 would put that bar in the 4×4 corners. Neighbours 1px apart on the centre-line, never a 0.50px almost-touch.

```icon
icon microscope
keyline tall
circle 12,5 r2
rect 10.5,8 3x6 r1
circle 12,17 r2
line 5,20.5 19,20.5
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
| `gap` | warn | two strokes sit closer than `minGap` without touching (outlined only). Measured edge-to-edge along flattened polylines, not vertex-to-vertex: crossing marks are coincident, staggered parallels report the perpendicular gap. |
| `feature` | warn | a filled shape or hole is narrower than `minFeature` (filled only: filled shapes are meant to touch, so `gap` has nothing to say about them) |
| `hole` | error | a knockout sits inside an earlier uncut disc but cut a later mark (filled only). The disc ships solid: `cutFrom` the ring, or draw `hole` immediately after it. |
| `off-axis` | warn | a straight run leaves 0/45/90 (outlined only: an expanded fill's joins are the flattener's angles, not a decision) |
| `centred` | warn | content centre is not (12,12), and the family does not agree |
| `cohort-align` | warn | the icon sits off the extent of the family it swaps with |
| `density` | warn | more ink than the set draws at this size |

When a warning and the drawing disagree, the drawing usually wins: but say why. Reaching for the ordinary solution is the rule: an icon that is _correct_ but drawn in its own dialect is worse than one that is plain and drawn in the set's.

Saying `off-axis` does not silence the `off-axis` warning, and is not meant to. The modifier is permission to _draw_ the diagonal: without it the canvas refuses the segment outright: and the warning is the prompt to confirm the diagonal is the drawing. So a declared diagonal reads as "confirm this", an undeclared one never gets past `draw`, and the rule still has something to say about every icon it measures. Expect one `off-axis` warn per element per distinct heading: a `line … off-axis` closing a kite is two headings and two warns, not four.

A 0.5px air gap is not a construction: move the strokes to 1px or knock one out of the other. Off-keyline is legal: Central's key shapes are guidelines: but treat it as a prompt to check the size was chosen, not drifted. A wifi fan that lands at 20×11.5 has drifted; `wide` is 20×16.

### Trim an outlined contour

`trim` consumes the last two groups under `finish outlined`: keep the first path only outside the second closed shape. The cutter disappears. Curves remain curves and exposed ends use the normal round stroke cap. The cutter cuts the centerline, so allow for half the stroke width at the new ends when designing badge clearance. Place operands first; post-composition transforms are refused. `union` and `subtract` remain filled-only. No free path data is accepted.

## Continuous rounded contours

`line x,y x,y ... r1 [off-axis]` optionally rounds the polyline centerline with the selected family radius tier. Repeat the first vertex at the end to close the contour. Vertices still use the placement grid; the compiler computes tangent circular fillets and their handles. Use this for a new rounded polygon such as a ribbon or tab, rather than joining separately capped strokes. The radius must fit adjacent edges; choose a smaller tier or revise the vertices when it does not. In filled mode the same centerline and radius produce an expanded round stroke. A closed contour remains a hollow ring, not a filled interior. It can be unioned or subtracted like other filled groups. Direct rounded `hole line` remains unsupported; use a rounded line followed by `subtract`. Omit `r` for the existing sharp-centerline behavior (the stroke itself still has round joins).

Compiler7 adds `solid` to a closed rounded line in filled paint: `line x,y ... x,y r1 solid [off-axis]`. It explicitly unions the centerline interior with its expanded stroke, preserving the outlined visual extent. Use this for a solid ribbon parent, then subtract a separately unioned check. Without `solid`, a closed rounded line remains a hollow ring. Open lines and missing radius refuse `solid`; outlined paint permits explicit closed solid modifiers (compiler12). Never silently convert a solid parent back to outlined; author the counterpart explicitly.

Compiler9 supports selected `strokeJoin: "miter"` (fixed miter limit4, round caps) and zero-radius styles with empty positive-radius tiers. Use `line ... r0` for a sharp contour and repeat the first vertex to close it; add `solid` for a closed filled silhouette or an explicitly supported solid outlined modifier. Without solid, a closed filled line is an expanded ring. In a miter style, omitted line radius defaults to0; positive corner requests require declared tiers. The host preserves closure, expands miters and uses nonzero fill rules for the ring/interior union. SVG and filled expansion share the join policy. Painted miter bounds drive pair size, centering and bleed checks; centerline bbox stays available separately. Existing round defaults remain. Historical compiler8 artifacts require their original compiler; never silently rewrite their revision. This is representational support, not a qualified new-style library.

Compiler11 adds selected `strokeCap: "square"`; omitted cap stays round. SVG strokes, expanded filled lines and arcs, line knockouts, exposed trim ends and painted bounds share this cap policy. Closed contours ignore cap choice; dot roles remain round discs. Diagonal square caps extend in both tangent and normal directions, so bounds come from expansion rather than half-width padding. Preserve historical compiler10 artifacts and use a fresh revision/output.

Compiler12 allows an explicitly closed `line ... r0 solid` (or a positive declared radius) inside an outlined icon. It renders that element as the same expanded stroke plus filled interior used in filled paint, rather than stroking its boundary again. Use this for solid small modifiers such as play; the surrounding icon stays outlined. The solid flag survives existing recipes/replay/transforms. Painted bounds and mixed spacing use the modifier as zero-width ink, and feature diagnostics cover it. Trim refuses solid modifiers; it remains a centerline operation. Open or missing-radius solid contours still refuse. Historical compiler11 artifacts remain separate.

### Detail weight

When the selected spec declares `detailStroke`, append `detail` to a line or arc to use that measured weight, for example `line 8,12 16,12 detail` or `arc 12,12 r6 half from bottom detail`. The surrounding ring can retain the normal stroke. The role also works with `r`, `solid`, filled line expansion and outlined trim, and remains fixed through transforms. Use it only when the supplied neighbors support lighter detail. Do not invent a numeric width; a style without `detailStroke` refuses this role. For filled counters, build detail lines and arcs as filled cutters and subtract their union explicitly. Author both paints; automatic twin adaptation does not infer detail optics.

Compiler14 expands filled arcs with the same cap policy and named detail weight as outlined arcs. Curved bodies and tangent straight extensions can share `detail` without a weight step. Round caps are part of the expanded contour; union overlapping cutters before subtraction.

### Native optical placement

The canonical viewport stays24 units; a native pixel coordinate is the canonical coordinate multiplied by `spec.size / 24`. A straight stroke exactly one native pixel wide can occupy a full pixel row or column when its center is on a native half-pixel. An even integer pixel width aligns at integer centers. Fractional widths and curves naturally retain antialiasing. Choose allowed grid placements with that relationship in mind, then inspect the rendered result at1x and2x. Do not snap every shape indiscriminately: a centered thin stem may correctly straddle two columns, and shifting it for darker pixels can visibly miscenter the symbol.

In local foundry runs, the real checker writes `<paint>.native.png`, `<paint>.retina.png` and `<paint>.pixels.json`. The JSON contains native/retina dimensions, hashes of those exact PNGs, and grayscale `rows[y][x]` in local zero-based image pixels, with0black and255white. Use these supplied files instead of constructing a separate raster helper or guessing dependency paths. These coordinates refer to each individual paint, not the combined `native.png` strip or the24-unit viewport.

Compare both foreground contrast and counter separation; clearing a gap by erasing its neighboring stroke is not progress. Do not treat normal antialiasing alone as a defect. Report actual lost distinctions, broken contours, imbalance or inconsistent weight. Preserve pinned style values; if those values create an unresolved optical tradeoff, record the observed limitation rather than changing the spec or claiming universal pixel perfection.

## Rounded Boolean intersections

`subtract r1` and `union r1` explicitly round sharp intersections of the two operands with a circular filled-boundary fillet. Choose an exact value from the selected spec's `fillRadiusTiers`. Omit the radius for unchanged Boolean edges. The host computes tangent points on the original straight or curved contours; models never supply handles. Existing corners away from the intersections remain unchanged. No sharp intersections, infeasible radii, overlapping fillets, or changed topology cause an atomic refusal. Reduce the tier or change the construction; never hide that failure. `trim` does not accept a radius.

Admitted parts preserve their source curves by default; placement anchors remain grid constrained. For paired icons, prefer separately admitted outlined centerlines and filled boundaries when available. Scaling a centerline does not reproduce an outward stroke expansion. Keep a filled source compound intact so its counters survive. Source reuse is composition or reconstruction, never proof of novel shape generation.
