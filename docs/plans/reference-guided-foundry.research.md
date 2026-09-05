# Reference-guided foundry: research and tool decision

Researched 5 September 2026. Primary sources and the current checkout inform this memo. Product capabilities described below are documented unless explicitly marked locally tested. Recommendations and proposed experiments are our judgments.

## Updated decision: fully AI-generated; retain SVG delivery

The user subsequently clarified that artwork must be 100% AI-generated. The earlier hybrid human-authoring recommendation has been removed. Use Iconsmith for automated inference, construction, optical correction and evaluation. Neither Figma nor Glyphs is required in the generation path. The following tool research remains useful for optional downstream viewing/export, but human master editing and mandatory human aesthetic approval are out of scope. AI evaluation can be automated; world-class perceptual quality still needs empirical evidence.

## Tool ownership

Iconsmith's generated programs, style revisions and generated masters are authoritative. SVG is the portable delivery format. Optional exports to Figma or Glyphs must not introduce mandatory editing or a second independently writable production master.

### What Glyphs 4 actually adds

Released 27 July 2026, Glyphs 4 adds a New Icon Set document with `.glyphsicons` extension, image dimensions, multiple-master interpolation, and PNG/SVG/PDF export. It also offers pen points, improved curve transitions, component editing and scripting improvements. These are directly relevant to master design and fine optical corrections. The launch page lists macOS 12+, a 30-day trial and USD/EUR 319 full / 199 upgrade pricing. Verify checkout pricing before buying. [Glyphs 4 announcement](https://glyphsapp.com/news/glyphs-4-create-love-the-process)

Local inspection: `/Applications/Glyphs 4.app` reports version **4.0.1**, build **4004**. Opening it displayed an expired-trial dialog. No purchase, licensing change, master edit or export was attempted. A real round-trip remains untested.

### Automation is promising, with a specific unproven edge

The current `glyphs-cli` documentation supports `glyphs run` with the Glyphs Python API, explicit saving, app-build selection, plugin selection and JSON export reports. Its documented export formats are OpenType/WOFF/WOFF2; native `.glyphsicons` → SVG automation was not established by this documentation. The CLI relies on a Mac Glyphs installation. This makes it plausible for a pinned authoring/export job, not a drop-in dependency for the current Linux CI or hosted generation path. [Current CLI documentation](https://pypi.org/project/glyphs-cli/)

The March announcement's thread contains earlier limitations and subsequently added features. Do not copy its old “cannot save” limitation or old `glyphs edit` examples over the current `run` documentation. [Developer announcement](https://forum.glyphsapp.com/t/command-line-tool-for-glyphs/36022)

The official Python documentation exposes the application model. Test the exact image-export method and `.glyphsicons` handling against build 4004 before designing an adapter around them. [Glyphs Python API](https://docu.glyphsapp.com/)

### Comparison for Iconsmith

| Need | Glyphs 4 | Iconsmith + SVG pipeline | Decision |
| --- | --- | --- | --- |
| Curve/optical inspection | Dedicated drawing and component tools | Automated corrections and rendered specimens | Optional inspection only. |
| Related weights/masters | Documented interpolation | Would require explicit supported interpolation | Generate discrete masters first; interpolation is optional. |
| New semantic concepts from references | No equivalent capability established | Existing agent/parts/tournament foundation | Iconsmith owns generation. |
| Product asset extraction and evidence | Not established as product crawler | Existing corpus adapters can be extended | Iconsmith owns ingestion. |
| Linux/server execution | Glyphs native runtime is Mac-based | Current TS engine and Linux CI | Keep Glyphs out of the request path. |
| Runtime delivery | Exports images and fonts | SVGs already used by Studio | SVG first; fonts only for a named consumer. |
| Reliable automatic round-trip | Requires experiment | Program replay already a core concept | No automatic two-way synchronization. |

Master compatibility is a real constraint: equal point structure, ordering and related contours matter to interpolation. Independently generated outlines do not become interpolatable simply because their names match. Optical size can require different topology, so a discrete master is valid and often preferable. [Glyphs interpolation handbook](https://handbook.glyphsapp.com/interpolation/), [compatibility tutorial](https://glyphsapp.com/learn/multiple-masters-part-2-keeping-your-outlines-compatible)

Corner components show useful precedent for reusable contour treatments. They inspire named compiler operations, not a requirement to embed Glyphs' internal object model in TypeScript. [Corner components](https://handbook.glyphsapp.com/components/corner/)

`glyphsLib` bridges Glyphs files and UFO; its project description does not establish full support for every new Glyphs 4 icon feature. Do not assume a lossless Linux substitute without fixtures. FontTools is useful for inspecting real font outlines and mappings when a reference product ships icons as fonts. Neither requires replacing the runtime SVG pipeline. [glyphsLib](https://github.com/googlefonts/glyphsLib), [FontTools](https://fonttools.readthedocs.io/en/latest/ttLib/index.html)

## What excellent systems teach us

**Cursor:** separate 16px/1.25px and 24px/1.5px masters, recurring constructions, optical corrections, and a maintained delivery system. Use the article as documented intent; original product assets still need acquisition and measurement. Its lessons support a specimen-driven foundry, not a claim that exact style can be recovered from prose. [Designer case study](https://www.minoradventures.co/blog/the-making-of-cursors-icons)

**Central:** a coordinated family of many variants is already the engine's foundation. Preserve it as a regression baseline while removing its status as a universal law. [Central](https://iconists.co/central)

**OpenAI and X:** Iconists lists both clients. That is authorship evidence, not a downloadable specification. Capture named product surfaces and versions separately. Twitter's documented historical transition included two product styles and a separate presentation family; don't mix them or include emoji/logos in a product-icon population. [Iconists](https://iconists.co/), [Twitter designer case study](https://griffdesigns.com/twitter)

**SF Symbols:** typography alignment, weights, scales and rendering behavior demonstrate that a symbol system includes use context. Borrow the evaluation idea, not unverified numerical rules for another family. [Apple SF Symbols](https://developer.apple.com/sf-symbols/)

**Material Symbols:** optical size, weight, fill and grade are different dimensions. The documentation illustrates why apparent weight on a dark surface and optical scale cannot be reduced to one stroke parameter. SVG and font delivery coexist. [Material Symbols guide](https://developers.google.com/fonts/docs/material_symbols)

**Linear:** the supplied 2024 redesign article and 2026 Karri thread are different projects. They support designing a language and testing it within the real product. They are not icon geometry specifications. [2024 article](https://linear.app/now/how-we-redesigned-the-linear-ui), [2026 thread](https://x.com/karrisaarinen/status/2032160761255284814)

## Extraction and inference limits

Source SVG geometry, displayed visual extent and optical intent are distinct. Preserve transforms, inherited paint and source viewBox; retain source units alongside normalized measurements. Bounding boxes that include strokes differ from path bounds. A raster image cannot uniquely determine stroke centerlines, radii or construction history. [SVG coordinate and bounding-box specification](https://www.w3.org/TR/SVG2/coords.html)

Extract known product surfaces, reconcile a capture manifest, retain originals and report missing coverage. A DOM snapshot contains only the states visited. Prefer real vector exports/fonts over raster tracing. Explicitly reject unsupported SVG features before measurement instead of silently dropping them.

Inference should produce candidate rules with sample counts, distributions, counterexamples and confidence. Separate published design intent, measured evidence and inferred judgments using the existing policy provenance model. Hold out entire concept families across masters and finishes. A reconstruction metric cannot prove ability to invent a new icon that belongs in a set.

## Deferred editor experiment

Only add a Glyphs bridge for a named downstream consumer. Verify generated-master import and repeatable SVG export, preserving native dimensions, contours, component relationships and names. No manual geometry correction is part of the qualifying production path. The bridge is outside the current execution sequence.

## Generation research: useful ideas, not a replacement compiler

Iconix (CHI 2026) organizes exploration around semantic richness and visual complexity, using image-conditioned sequences. Its reported user study supports structured exploration; it does not establish exact vector construction or production-family conformance. Adopt the distinction between metaphor choice and level of detail in the brief/specimen workflow. [Iconix abstract](https://arxiv.org/abs/2602.00738)

DiffVG differentiates through rasterization so vector parameters can be optimized against image-space objectives. That is relevant to controlled fitting of approved geometry, but pixel similarity alone cannot infer semantic part roles or optical intent. Keep it as a later measurement experiment rather than adding a native/Python optimization stack to the current tracer bullet. [DiffVG project](https://people.csail.mit.edu/tzumao/diffvg/)

SVGDreamer uses diffusion-guided vector optimization and semantic decomposition to improve generated vectors. Its public abstract reports improvements in editability, diversity and visual quality; it does not prove Iconsmith's required family-wide constraints. It could inform the existing proposal stage, but accepting its arbitrary output paths as final programs would bypass this repository's defining invariant. [SVGDreamer abstract](https://arxiv.org/abs/2312.16476)

These are scoped readings of the authors' abstracts/project material, not reproduced benchmarks or a claim to exhaust all generative-vector research. The engineering decision remains: separate concept exploration from constrained construction, then test both style and meaning.

## Research verdict

Use Iconsmith for fully automated reference analysis, semantic construction, optical correction, family consistency and artifact admission. Keep SVG delivery. Figma and Glyphs are optional viewers/export consumers. The [subsequent first-principles audit](reference-guided-foundry.audit.md) adds generation/evaluation research and supersedes the earlier sequencing: prove the generation and evaluation loop before investing in editor integration or library scale.
