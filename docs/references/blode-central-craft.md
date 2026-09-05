# Blode / Central: what the actual drawings do

5 September 2026. Read-only study of `../blode-icons`, following the user's rejection of the generated specimens. No reference artwork was edited, no additional model calls were made, and no release-quality generation is claimed.

[Construction study](../../.staging/blode-craft-study/index.html) · [Original / construction / filled sheet](../../.staging/blode-craft-study/construction-sheet.png) · [Source measurements](../../.staging/blode-craft-study/measurements.json) · [Selected path measurements](../../.staging/blode-craft-study/samples.json)

## The diagnosis

The previous pipeline preserved a few surface parameters while missing the construction that makes the family recognizable. A fixed stroke, grid, corner radius and valid program do not imply well-drawn contours, good negative space or coherent variants. The generated folder's rectangular body and separately attached tab demonstrate the difference.

Central and Cursor must not share one universal construction recipe. The actual Blode cloud has circular lobes and a blended shoulder; Minor Adventures describes Cursor's cloud as rounded straight segments, with freeform and circular curves rare in that family. Its article also describes local optical breaks, thinning and separate optical sizes. Those are family-specific decisions, not permission to mix recipes. [Minor Adventures](https://www.minoradventures.co/blog/the-making-of-cursors-icons)

## Current source inventory

Measured from `../blode-icons/packages/blode-icons-react/icons-svg`, rather than README or generated-component totals:

| Measurement | Result |
| --- | ---: |
| SVG source files | 4,357 |
| XML parse failures | 0 |
| Files with exactly `0 0 24 24` viewBox | 4,310 |
| Other viewBoxes | 47 |
| Names ending in `-filled` | 2,136 |
| Files with a corresponding opposite-finish name | 4,272 |
| Files containing explicit cubic/smooth-cubic commands | 4,124 |
| Icons with at least one effective stroke | 1,886 |
| Icons with more than one effective stroke width | 61 |
| Stroked elements at width 2 | 3,773 of 3,899 |
| Same-name files present in the selected Central corpus variants | 4,170 |

The inventory resolves inherited presentation attributes and inline style for paint counts. Mixed-width counts include inherited/default widths, explaining a difference from DESIGN.md's narrower 58-icon population. Cap/join defaults are included; a cap attribute on a closed contour does not imply a visible square or butt endpoint. Cubic-command counts describe representation, not independent curve designs or quality. One file has transforms; no claim is made that this inventory measures its transformed geometric bounds.

Only 186 files have exactly matching serialized shape attributes and effective paint with the corresponding Central file. This is not a geometric-difference count: optimized relative commands and decimal precision differ. For example the Central and Blode folder paths describe the same apparent design with different serialization. Do not label every byte difference a different aesthetic or use the whole mixed repository as one blindly homogeneous training set.

The repository's [DESIGN.md](../../../blode-icons/packages/blode-icons-react/DESIGN.md) is useful design intent, but its counts are not a substitute for the current source inventory.

## Nine drawings, broken down

### Folder: continuous contour and blended tab

[Source](../../../blode-icons/packages/blode-icons-react/icons-svg/folder-1.svg) · [Filled](../../../blode-icons/packages/blode-icons-react/icons-svg/folder-1-filled.svg)

The outlined body is a single closed contour, with path bounds x=3…21 and y=4…19. At stroke 2 its ink extends to x=2…22 and y=3…20. The filled path uses that expanded outer extent. Its main body corners have radius 3 on the stroke centerline; filled outer corners expand to radius 4.

The tab is part of that contour. Its rising/falling transition contains curved shoulders and a short diagonal. The visible straight diagonal has a 0.8126 horizontal / 1.2188 vertical displacement, approximately 56.3 degrees. It is not a generic 45-degree trapezoid attached to a rounded rectangle.

**Generator failure:** separate rectangle plus tab leaves an internal seam, an angular shoulder or excessive ink at the junction. A shared family construction must encode the tangent transitions and tab proportions.

### Camera: the filled interior is optically redrawn

[Source](../../../blode-icons/packages/blode-icons-react/icons-svg/camera-1.svg) · [Filled](../../../blode-icons/packages/blode-icons-react/icons-svg/camera-1-filled.svg)

The outer contour blends its centered roof into the shoulders. Outline path bounds are x=3…21 and y=4…20, giving ink bounds x=2…22 and y=3…21. The filled outer silhouette occupies those same extrema.

The outlined lens is centered at (12,13), radius 3. The filled lens cutout is centered at (12,12.5), radius 3.5. It moves upward by 0.5 and becomes larger as a cutout. This is directly visible in the source, not an inferred universal correction formula.

**Generator failure:** independently drawn camera paints change roof position and decoration. A mechanically expanded ring also misses the filled lens treatment. The outer family structure and optical interior must be modeled separately.

### Lock: white space has a job

[Source](../../../blode-icons/packages/blode-icons-react/icons-svg/lock.svg) · [Filled](../../../blode-icons/packages/blode-icons-react/icons-svg/lock-filled.svg)

The standalone outlined shackle is 8 units across on its centerline, with an open counter above the body. The keyhole is a quiet vertical stroke. In filled paint the shackle and body form one outer silhouette, with separate shackle and keyhole cutouts. The shackle opening is 6 units wide between x=9 and x=15.

**Generator failure:** shrinking an entire standalone lock into the folder's interior gives the shackle too little white space. Its ring/circle improvisation also puts a black intrusion into the lock body. Counter dimensions must be designed for the final displayed size, rather than inherited by uniformly shrinking a large icon.

### Folder + shield: composition changes the container

[Source](../../../blode-icons/packages/blode-icons-react/icons-svg/folder-shield.svg) · [Filled](../../../blode-icons/packages/blode-icons-react/icons-svg/folder-shield-filled.svg)

The shield occupies the lower-right part of the overall silhouette. The outlined folder stops before the badge and resumes around the remaining container. It does not continue underneath the badge. In filled paint the folder's boundary is cut back around the shield, and the badge has its own coherent solid shape.

**Generator failure:** repeatedly placing a small badge inside a complete container is the wrong composition. Reusable family parts need occlusion variants; copying a complete folder and laying a symbol over it is not enough.

### Cloud: asymmetric lobes with a resolved join

[Source](../../../blode-icons/packages/blode-icons-react/icons-svg/cloud.svg) · [Filled](../../../blode-icons/packages/blode-icons-react/icons-svg/cloud-filled.svg)

The left lobe is larger than the right. A short blended transition resolves the place where the larger lobe meets the smaller one, and the base is horizontal. The silhouette has a clear hierarchy; it is not an evenly spaced pile of circles.

**Generator implication:** a construction recipe must control relative lobe size, transition and base. Do not assume Cursor's polygon-derived cloud is the right recipe for Central.

### Coin lira: local thinning is intentional

[Source](../../../blode-icons/packages/blode-icons-react/icons-svg/coin-lira.svg) · [Design rationale](../../../blode-icons/packages/blode-icons-react/DESIGN.md)

The enclosing ring is width 2. Both the interior letter and diagonal are width 1.8. The source and design documentation agree that the smaller tier protects the interior from becoming too heavy. Hairline detail in the broader repository uses additional, explicitly smaller widths.

**Generator limitation:** one `Spec.stroke` and one emitted outline width cannot express these local roles. Add only measured, named family roles when needed; arbitrary per-element numbers would replace one failure with style drift.

### Eye, heart and magnifying glass: different contour problems

[Eye](../../../blode-icons/packages/blode-icons-react/icons-svg/eye-open.svg) · [Heart](../../../blode-icons/packages/blode-icons-react/icons-svg/heart.svg) · [Magnifying glass](../../../blode-icons/packages/blode-icons-react/icons-svg/magnifying-glass.svg)

The eye resolves a pointed outer silhouette around a centered pupil. The heart balances lobes, valley and tip in one continuous contour. The magnifying glass has a bowl and handle whose connection and relative lengths carry its apparent weight. The construction sheet shows their source anchors and Bézier handles. These observations are qualitative; the study does not pretend to have derived all their optical corrections from one screenshot.

## An existing compiler operation changes the source curves

A controlled probe puts the source folder through `Canvas.part` at scale 1 and its original placement. Its 48 segment-coordinate scalar values contain **20 changes**, with a maximum absolute change of **0.1094 units**. [Probe result](../../.staging/blode-craft-study/part-rounding.json)

The cause is `serialise(moved, { grid: this.spec.grid })` in `tools/canvas.ts`: it rounds the stored Bézier geometry to the quarter grid, not only the placement requested by the model. This measurement does not prove perceptual degradation on its own. It does prove that referencing a polished component is not exact reuse, and that tangent/curvature fidelity needs explicit checking.

The right distinction is between model-chosen construction parameters and compiler-owned curve geometry. Existing circle/arc primitives already calculate Bézier handles on the host. Extending that principle to blended contours is compatible with refusing raw path data from the model. It does not require turning an unconstrained SVG generator loose on the library.

## Consequences for the next generation experiment

1. Use a coherent Central subset at its actual 24/2 master as the first craft target. Keep Cursor's construction rules separate.
2. Add the smallest host-owned construction that makes the folder and camera transitions possible. Validate tangent joins and curvature as well as replay. A generic rounded polygon alone may not reproduce the blended shoulders; prove that capability against these paths first.
3. Preserve shared outer structure across paints, while allowing measured optical changes to counters and internal features. The camera supplies a concrete regression example.
4. Design compound-icon occlusion and badge space explicitly. The folder-shield is the composition reference for a future folder-lock, not a standalone lock shrunk inside an intact folder.
5. Expose local stroke roles only with measured evidence and style-owned values. The coin is a concrete need; do not build an arbitrary styling API.
6. Review generated drawings alongside real neighbors at native size and magnification. The prior 10/10 camera result is a failed evaluator example, not a quality target.

This study replaces the earlier assumption that varying stroke/radius and repeating primitive-only generation would be enough. The geometry capability and evaluator remain unfinished. The authorized round budget remains $50; recorded spend remains $1.9288466.
