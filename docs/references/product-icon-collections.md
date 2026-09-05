# Product icon references

Captured and researched 5 September 2026. Read alongside the [foundry plan](../plans/reference-guided-foundry.md). The ten existing foundry documents and engine vocabulary documentation were reviewed, together with Minor Adventures' case study and the primary product sources below.

## Extracted collection

The local collection is at `.staging/references/2026-09-05/`. This existing ignored location keeps third-party artwork and vendor bundles out of published source and out of the Central corpus. It is a reference capture, not an installed generator style. Production source permissions and conditioning rules were not changed.

- [Browse the SVG reference gallery](../../.staging/references/2026-09-05/index.html)
- [Comparison contact sheet](../../.staging/references/2026-09-05/contact-sheet.png)
- [Machine-readable index](../../.staging/references/2026-09-05/index.json)
- [Render verification](../../.staging/references/2026-09-05/render-checks.json)

| Collection | Captured | Coverage and limitations |
| --- | --- | --- |
| Raycast API catalog | 370 documented names, 740 original SVG files across light/dark appearances | Complete enumeration on the inspected documentation page. This is not a claim that the page contains every icon in the current native app. Aliases and repeated artwork remain separate documented names. |
| Linear public client | 36 named icon-related JavaScript modules; 40 static SVG forms extracted | 52 SVG expressions encountered; 12 dynamic/unsupported expressions retained as exclusions. This is a bounded subset referenced by the public login entry, not the complete application library. |
| Linear website | 234 SVG occurrences, 88 distinct geometry signatures | One homepage and its embedded product demonstrations. Gallery shows 65 unique small SVG candidates. Logos, decorative graphics and unidentified glyphs are not automatically a unified icon family. |
| Granola website | 69 SVG occurrences, 29 distinct geometry signatures | One homepage. Gallery shows 25 unique small candidates. Seven UI geometries and one brand geometry match Central exactly; Lucide also appears. Native application coverage is not established. |
| Granola public client | 34 JavaScript chunks captured from its download page | No complete usable icon was extracted by the strict static evaluator: 13 expressions were dynamic or empty templates. These are evidence of an acquisition limit, not 13 icons. |
| Minor Adventures / Cursor | 26 SVGs forming 13 before/after correction pairs, plus seven PNG figures | Case-study design evidence, not the complete Cursor library. |

Every collection has a `manifest.json` with source URLs, files, capture scope and exclusions. Original SVGs are retained. Derived website specimens include computed paint to preserve inherited colors and stroke values; they are not claimed to recover editable masters. Browser-state ordinals remain ordinals when a reliable name is unavailable.

## Linear

Linear's March 2026 refresh explicitly reduced icon prominence: fewer icons in some views, smaller sizes, and removal of unnecessary treatments such as colored team backgrounds. This makes contextual hierarchy part of the reference, rather than merely a path aesthetic. The article is by Charlie Aufmann and Maxime Heckel. [Linear's 2026 design refresh](https://linear.app/now/behind-the-latest-design-refresh)

The 2024 article discusses stronger neutral-icon contrast in light and dark modes. It concerns an earlier redesign and should not be treated as the specification for every current icon. [Linear's 2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)

**Measured from delivered code:** the captured shared Icon wrapper defaults to `size=16` and `viewBox="0 0 16 16"`. Static forms include checks, chevrons, user/member marks, labels, automation and coding-agent marks. Several are filled contours rather than live SVG strokes; a displayed outline does not imply a `stroke-width` attribute. The website sample includes 16-, 14- and 20-unit drawings, so it must not be collapsed into a universal 16-unit specification.

**Extraction method:** inspect the public login page's script URL, preserve its entry file, fetch the explicitly referenced named icon modules, parse their JavaScript syntax without executing it, and serialize only supported static SVG expressions. The default 16-unit wrapper is documented in extraction metadata. Dynamic paths, spreads and runtime-dependent children are excluded. Runtime color/size overrides are not reproduced by these default-form specimens.

Evidence: [client manifest](../../.staging/references/2026-09-05/linear-client/manifest.json), [website manifest](../../.staging/references/2026-09-05/linear-website/manifest.json).

## Raycast

Raycast's July 2022 redesign article credits James McDonald with its new icon set, describing a simple outline language with bolder strokes and consistent corner/stroke rules. Iconists separately lists Raycast as a client; those statements do not establish that one designer authored every current native glyph or that the 2022 and current sets are identical. Preserve the dated attribution. [Raycast redesign](https://www.raycast.com/blog/a-fresh-look-and-feel), [Iconists](https://iconists.co/)

The official API exposes named built-in icons for actions and list items and recommends them for consistency. The inspected enumeration has 370 names with separate light/dark image assets. [Official icon catalog](https://developers.raycast.com/api-reference/user-interface/icons-and-images)

**Measured:** all 740 downloaded SVGs have `viewBox="0 0 16 16"`; their documentation image dimensions are 32×32. Each includes a full-canvas documentation background, white or `#181c1f`. The transparent specimen copies remove only that verified background shape and set display dimensions to 16×16. Original bytes and source URLs remain untouched. Do not measure those background shapes as icon components or interpret 32px documentation display as another optical master.

The catalog includes filled variants, disabled states and repeated object families. Brand marks remain identifiable separately. It is especially useful for studying family consistency and semantic coverage, but raw byte uniqueness differs from the documented-name count because aliases/repeated artwork exist.

Names such as `ExclamationMark` and `Exclamationmark` differ only in capitalization. Filenames include a case-sensitive name hash to preserve both on macOS. An initial collision was detected by checksum verification and repaired by reacquiring the affected original.

Evidence: [Raycast manifest](../../.staging/references/2026-09-05/raycast/manifest.json).

## Granola

Iconists lists Granola among Central users. That is a primary vendor statement, not evidence that every Granola surface uses one unchanged Central variant. [Iconists](https://iconists.co/)

The homepage capture confirms a mixed population: eleven SVG occurrences explicitly carry Lucide classes. A geometry-token comparison against the real local Central corpus found 24 matching occurrences spanning eight unique geometries. Seven are UI geometries; the eighth is LinkedIn's brand mark. Matches include calendar, team/group, folder-add, feather, checklist and writing forms. Some source names are aliases with identical geometry.

The comparison ignores paint and compares geometry tokens. It establishes matching construction, not identical stroke/color treatment or full-product membership. The page's inline stroke variables vary with rendered usage; no global Granola stroke-width rule is inferred. Keep Central matches, explicitly identified Lucide shapes, brands and unclassified candidates in separate cohorts.

A public download-page bundle capture did not yield complete static icon components. Its empty SVG templates were explicitly rejected and removed from the extracted-artifact directory. Native Granola assets and a complete library remain unacquired; no sampled web page is labeled as that library.

Evidence: [Granola website manifest and exact matches](../../.staging/references/2026-09-05/granola-website/manifest.json), [client acquisition exclusions](../../.staging/references/2026-09-05/granola-client/manifest.json).

## Minor Adventures: usable optical evidence

The Cursor case study describes separately designed 16px and 24px masters, with 1.25px and 1.5px strokes, repeated components and local optical corrections. It distinguishes exploration, family overviews and final components. Those concerns remain relevant to an automated foundry even though this particular work was hand-drawn. [Minor Adventures case study](https://www.minoradventures.co/blog/the-making-of-cursors-icons)

The article's interactive controls expose original SVGs for seven junction-relief comparisons and six thinning comparisons. Both states were inspected and downloaded. These are stronger reference evidence than an arbitrary perturbation labeled “bad”: the designer explicitly supplies the before/after treatment. They still do not prove a universal preference across all styles or display conditions.

Use these pairs to test correction sensitivity, preserving the concept, treatment and original dimensions. Keep them out of sealed evaluation if the generator or repair critic has already seen them. A detector that recognizes their filenames has learned nothing about optics.

**Measured qualification:** all thirteen before assets have 16-unit viewBoxes, while all thirteen after assets have 24-unit viewBoxes. Render at the same intended CSS size before comparing. They are designer-labeled examples, but not numerically controlled single-variable perturbations; differences in master representation must not be misread as a local correction alone. All thirteen pairs have different source hashes.

Evidence: [13 correction pairs and seven contextual figures](../../.staging/references/2026-09-05/minor-adventures/manifest.json).

## Verification and next use

All 896 SVGs included in the gallery parsed and rendered to nonempty 48px checks with Sharp. The contact sheet was visually inspected. This verifies usable reference artifacts, not semantic labeling, exact runtime fidelity or production quality. Website effects depending on external definitions, animation or additional CSS may need further materialization.

The collection contains original files, derivative specimens, source capture records, extraction exclusions, a checksum inventory and acquisition scripts. Static JavaScript parsing never executed downloaded vendor code. No private notes, issue contents or authenticated workspace data were extracted.

Next, select a clean named cohort: Raycast documented icons, Linear's static client forms, or the identified Central geometry in Granola. Fit and qualify a profile independently using the audited experiment. Keep the mixed website samples as contextual evidence. No collection is automatically admitted to generation or redistributed as an Iconsmith library.
