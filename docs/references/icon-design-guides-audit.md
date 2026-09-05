# What the generator must know about icon design

5 September 2026. Fresh XML audit of 4,357 sibling Blode SVGs, direct source inspection of camera, coin and folder-shield, and visual inspection of the existing nine-icon construction sheet. This extends, rather than replaces, [the source construction study](blode-central-craft.md). [Measurement receipt](../log/blode-design-guide-audit-2026-09-05.json).

## Evidence from the drawings

The fresh inventory confirms 4,310 files with a 24×24 viewBox, 1,886 effectively stroked files and 61 files mixing effective stroke widths. Inheritance and inline style are resolved. Of 3,899 stroked elements, 3,773 use width 2. The other 47 viewBoxes and the narrower strokes must not silently become universal style rules.

- **Camera counters are designed, not merely inverted.** The outline lens has center (12,13) and radius 3. The filled cutout has center (12,12.5) and radius 3.5. Its increased diameter and upward correction survive direct inspection of the SVG path numbers. Mechanical stroke expansion cannot make that design decision.
- **Local weight is meaningful.** Coin-lira uses a 2-unit enclosing ring and 1.8-unit letter/diagonal strokes. Uniform width is an inadequate model of this source family; unrestricted arbitrary width is also inappropriate. A measured detail role is the smallest plausible extension when a generation requires it.
- **Occlusion is part of composition.** Folder-shield's folder contour ends before the shield. Its filled counterpart leaves negative space around the badge. An interrupted outline can be correct family behavior. A critic must identify a malformed join rather than demand universal continuity.
- **Serialization is not appearance.** The audit finds 227 closed and 154 open stroked path subpaths carrying square caps. Closed subpaths do not expose endpoint caps. Inferring the family's visible terminal style by counting attributes alone is wrong.
- **Cutouts need correct topology.** 1,354 files contain filled even-odd elements. This is evidence that winding and holes matter, not proof of which editor or Boolean operation created them. Union/subtraction can construct a silhouette; it does not choose its proportions or smooth a poorly designed join.
- **Curves need geometric fidelity.** 4,124 files contain cubic/smooth-cubic commands. That count does not measure craft. Inspect tangent direction, curvature changes and silhouette; preserve source handles instead of snapping every control point to a placement grid.

## Reading the three guides critically

[Lucide's guide](https://lucide.dev/contribute/icons/design-principles) specifies its own 24px, 2px stroke family, rounded terminals, size-dependent corner radii and usually 2px visual gaps. It also prioritizes clarity and balance when rules conflict. Adopt its native-size, density, smooth-curve and neighbor-comparison checks; keep the numerical requirements specific to Lucide. Round line joins do not substitute for rounding the centerline's corners.

[Streamline's Figma guide](https://blog.streamlinehq.com/designing-icons-in-figma/) emphasizes editable Booleans, reusable components, variants, key shapes and evaluation of recognition, consistency and legibility. Its sequence starts with several proportions, then a related series. For this pipeline, retain editable construction recipes and compare a small family across different proportions before expanding the corpus. Pixel snapping should not damage curve handles or deliberate optical corrections.

[Glyphs' webfont tutorial](https://glyphsapp.com/learn/creating-an-icon-webfont) covers PUA mappings, metrics, sidebearings, path direction, extrema, overlap removal and font export. It explicitly discusses coordinate rounding and possible conversion inaccuracies. This supports careful outline/export validation, not a requirement to author icons in a font editor. Its legacy browser advice and promotional comparison with SVG are not a contemporary format benchmark. SVG is itself vector-based. The linked page does not establish Glyphs 4's current capabilities.

## Decisions for the local AI pipeline

1. Keep the editable style-bound program as the source and SVG as the primary output. Figma can be a review surface; Glyphs can be an optional font export stage. Neither is necessary to achieve fully AI-authored geometry.
2. Specify a design brief per family: intended display sizes, silhouettes, key shapes, corner/terminal vocabulary, local detail weights, counter treatment, modifier placement and allowed optical exceptions. Do not mix Lucide, Central and Cursor into one averaged specification.
3. Generate a small family containing circular, square, wide, tall and modified subjects. Pair consistency alone is insufficient; preserve actual UI replacement cohorts, not every shared filename prefix.
4. Evaluate visible ink and negative space at native size, alongside genuine neighbors. Use geometry checks for clipping, topology, smooth joins and replay. Use visual review for recognition, balance and density. A 16px downsample is not a designed 16px master.
5. Qualify the reviewer on shipped intentional interruptions and deliberately broken examples before trusting its rejection or a 10/10 score. Current review evidence remains unqualified.

No new geometry capability is added solely because a guide mentions it. The next capability should answer an observed, reproducible drawing failure. No training run or paid provider call was made for this analysis.

## Follow-up verification and the remaining design gap

Reopened all three supplied URLs and independently recounted the sibling XML files: 4,357 SVGs, 4,310 with a 24×24 viewBox, 1,886 effectively stroked files, 61 mixing effective stroke widths. Re-read camera-1, its filled counterpart, coin-lira and folder-shield directly, and inspected the nine-subject construction sheet. These confirm the examples above; the inventory is not a count of individually reviewed designs.

The missing design contract is relational: identify the family neighbors, then state which proportions, negative spaces and component relationships must survive a new concept. A global stroke/radius/grid specification cannot express the camera's larger, higher filled counter or the folder's deliberate badge clearance. Smooth tangent joins alone cannot establish an appropriate cloud silhouette either.

Use the existing brief/revision/checker boundaries. The next author brief should name (1) recognizable metaphor and essential details, (2) real comparison neighbors, (3) shared parent and modifier placement, (4) outline-versus-fill optical differences, and (5) intended native sizes. Review the rendered outcome against those explicit relationships. Keep technical replay/topology results separate from optical acceptance. This is a Deepen-mode architecture recommendation, not a new module or an implemented quality gate.

For a fully AI-authored local workflow, an editor migration does not address this gap. Keep the editable program and deterministic SVG output; use an editor only when a concrete inspection or export task needs it. The supplied Glyphs tutorial dates from 2014 with updates in 2022 and does not establish current Glyphs 4 icon-authoring capabilities.

## Mixed paint and the limits of SVG labels

Directly re-read sibling `play-circle.svg`: its small play mark is a solid rounded triangle. Its enclosing ring is also serialized as a filled even-odd path, despite having the visual appearance of an outline. The sharp Central reference expresses the same paint relationship with a filled triangle and an actual stroked circle. Therefore neither the filename's outlined/filled variant nor a count of `stroke` attributes fully describes the visible construction.

This distinction explains a reproduced generated-icon failure: A069 forced a small play modifier into a hollow triangle, whose counter had no enclosed transparent component at either 24px or the 16px downsample. Compiler12 now supports the existing closed-line `solid` operation inside an outlined icon, retains its editable recipe, and measures its already-filled ink without expanding it again. This capability fixes representational scope; it does not automatically choose the correct size, weight or parent clearance. See D059/D060 and A070 in the foundry log for separate derived and fresh-author evidence.

A family brief consequently needs to specify component roles as well as whole-icon variants: enclosing outline, solid signal, negative-space counter, and intentionally interrupted parent. Infer these roles from rendered references and path geometry, then check the resulting relationships at the intended size.

## Detail-weight capability probe

Five source currency icons (lira, pesos, rand, rupees and won) each use a 2-unit ring with 1.8-unit detail paths. A diagnostic copy changing only the detail width to2 increases the rasterized detail ink area by9.8–12.8% at24px and9.9–11.3% at16px. The ring geometry is unchanged. The native and enlarged comparisons show a consistently heavier inner symbol, especially at crossings. This is evidence of a lost source relationship, not a numerical aesthetic score or proof that every heavier variant is unacceptable.

Current selected-style serialization still applies one global stroke to every non-solid outlined element; line expansion also reads that same global width. Merely adding a prompt instruction cannot preserve these source widths. A future minimal extension should let an author choose a **named detail role**, with its width pinned in the family specification; it should not permit arbitrary per-path widths. The role must survive recipes and transforms, affect stroke expansion and actual painted bounds, and be used by spacing diagnostics. Existing default-width programs must retain their output. A fresh author trial must then show the model choosing the role appropriately; host uniformization is diagnostic evidence only.

The five comparisons and source hashes are recorded in `docs/log/detail-weight-proof-2026-09-05.json`; private renderings are in `.staging/foundry-round-1/detail-weight-proof-01`. No source files were changed, no capability has been added for this probe, and no provider was called.
