# Local foundry

The primary workflow is local: reference files → coding-agent CLI → constrained
icon program → host compiler → native-size visual review → saved SVG library.
No public web app, deployed Eve agent, database or API judge is required.

## Public agent draft workflow

A fresh clone includes an original MIT reference family and a complete drawing
brief at [examples/starter/AGENT.md](../examples/starter/AGENT.md). After `npm ci`
and `npm run build:local`, open the checkout in your signed-in coding agent:

```bash
codex --model YOUR_CODEX_MODEL "Read examples/starter/AGENT.md and execute its drawing task."
```

Or use Claude Code:

```bash
claude "Read examples/starter/AGENT.md and execute its drawing task."
```

Select a Codex model available to your account. These commands use the user's
normal agent session and permissions. They produce a draft through the existing
constrained DSL and pinned checker; they do not invoke the independent contained
review pipeline. The brief requires actual proof inspection and records missing
visual inspection explicitly. The output retains `craftApproved: false`.

The real checker command used by the brief is:

```bash
node --import tsx packages/iconsmith/scripts/style-check.ts examples/starter/revision.json 24 starter-draft outlined
```

The agent first creates a fresh `starter-draft` directory and writes its
`outlined.icon`. The checker compiles that program, validates exact replay,
retains structural findings and renders proof images. Use a new directory when
one already exists. The example's family is illustrative and unvalidated.

## Advanced contained foundry

`generate:local` is an advanced host-orchestrated pipeline. Its legacy default
host route is disabled by containment guards; signing into Codex and Claude
alone does not make that route available. Do not use the former no-manifest
`generate:local` example for public onboarding or bypass its guards.

A configured `--native-route` needs an immutable Docker image, verified native
Linux executables and runtime assets, isolated authentication files, and the
supported author/reviewer identities declared by the adapters. It also requires
the frozen route hash and an original parent deadline. These user-specific
runtime inputs are not bundled with a clone. The remaining sections describe
that advanced route's evidence and review contracts, not prerequisites for the
public agent draft workflow above.

The canonical contained pipeline removes inherited API keys and provider
overrides and has no API fallback. Actual model identity and native process
outputs are retained in its review receipts. Positive review alone does not
qualify its critic or approve the artwork.
Subscription consumption is recorded separately from actual API spending. The
API experiment ledger is `.staging/foundry-round-1/budget.json`; consult its current
receipts and the append-only foundry log for charges and outstanding reservations.

For a frozen development campaign, `local-campaign.ts --concurrency <1-16>`
controls how many independent concept/master requests may run simultaneously.
Use `--concurrency 16 --max-requests 16` on a new campaign directory to admit a
batch of at most sixteen pairs. Keep the manifest, revision, runtime, library,
meanings and optional family-packet arguments from the campaign's dry run, then
add `--execute`. `--concurrency 1` retains sequential execution. Concurrency is
part of the immutable campaign identity and cannot change when resuming it;
diagnostic finalization remains sequential.

Each pair keeps the same author, reviewers, prompts, compiler, repair limits and
quality gates. Its deadline starts when admitted, and its process and native-call
accounting remain separate. Results retain manifest order even when requests
finish out of order. STOP or a containment/source failure prevents queued work;
already admitted requests settle before the driver returns. `--max-requests`
bounds total newly dispatched requests across all workers. Concurrent execution
increases peak subscription usage and resource demand without increasing that
total. This improves batch throughput; single-pair latency is unchanged. Live
speedup depends on model latency, available resources and provider throttling.

Check a selected-style pair locally:

```sh
node --import tsx packages/iconsmith/scripts/style-check.ts path/to/revision.json large path/to/pair-directory
```

The directory must contain `outlined.icon` and `filled.icon`. The command compiles
both against the pinned revision, verifies exact replay and paint identity, checks
individual declared keylines and geometry plus pair consistency, and writes SVGs,
192px previews, a pair at the selected master’s native size, pixel-preserving
`*.proof.png` sheets and `checks.json`. Structural errors produce a
nonzero exit. Empty findings do not approve craft. `tsx` is an exact workspace dev
dependency, so normal repository installation supplies the runner.

Each check now retains the submitted programs, rendered artifacts and report in a
new `check-*` directory. Compile failures retain their programs and failure report,
and set the latest `checks.json` to `exactReplay: false`. Known latest SVG, artifact
and preview files are cleared before each check; previous successful images remain
only in their historical snapshots. The checker
also emits `preview-16.png`. The report identifies this as native when the selected
master is 16px, otherwise a downsample. Rendering at 16px alone does not establish
that the geometry was designed as a separate optical master. Standalone checks use the tsx import hook. Author attempts use the bundled checker directly, so the sandbox needs neither repository source access nor the tsx runtime.

For spatial review of one exported SVG:

```sh
node --import tsx packages/iconsmith/scripts/review-proof.ts path/to/icon.svg path/to/new-proof-directory 16
```

The optional final argument is the native size (default24). The proof separates
an enlarged vector render from actual native 1x/2x raster pixels, enlarged by
integer factors with nearest-neighbor sampling. It shows black-on-white and a
monochrome white-on-black inversion. Separate `native.png` and `retina.png` preserve
the original sample dimensions. Orientation labels use the canonical24x24 viewport.
These views do not themselves establish a separately designed optical master.

For a style that requires only one paint, append `outlined` or `filled` to the
checker command. Only that program is required, and the report records `paints`
and `pairChecked: false`. Omitting the argument continues to require and validate
both paints. A single-paint result is never evidence of pair consistency.


The runner preserves `attempt-1` through at most `attempt-3`. Every attempt pins
inputs, authors programs, performs a real structural check, and submits neutral
rendered images to the restricted independent reviewer. The reviewer sees no author
rationale or previous scores. `local-review.ts` requires successful image reads,
unchanged evidence hashes, a successful process, recorded model identity and complete
structured answers. It also supplies exact host-derived grayscale matrices for
small native PNGs, so reviewers can verify pixel-gap observations against measured
values. These numbers do not establish semantics or taste.

Observed semantic, style, optical or family failures can trigger targeted repair.
Repeating an artifact stops before another reviewer call. A repair must improve at
least one failed/uncertain dimension without regressing another; otherwise the prior
valid candidate remains selected. Structural failure during repair also retains
that prior candidate. Every attempt and rejected repair stays on disk.

The selected artifact files are copied to the output root. `delivery.json` names
`selectedAttempt`, all attempts and the stop reason. `status: delivered` only means
the author delivered valid files. `qualityStatus` distinguishes `review-clear`,
`needs-repair`, `review-uncertain`, `review-incomplete`, `representation-blocked` and `not-reviewed`. Only a
structurally delivered, reviewer-clear result exits0. The critic remains unqualified:
`craftApproved` and `instrumentQualified` stay false even when all answers pass.
Every author must produce `author-review.json` with an `unresolved` array of distinct `{id, kind, description}` limitations. `kind` is `representation` or `visual`; an empty array means no known or uncertain defects. Each defect names a failed requirement and evidence. Intentional rendering tradeoffs belong in review.md when readability, continuity, centering and family consistency are preserved. Representation means a missing DSL or admitted-part capability; an omitted line or misplaced element repairable with existing primitives is visual. A representation limitation stops before spending another reviewer call. Visual limitations veto a positive independent review and become repair targets. Repairs must not introduce new limitations. Missing or malformed reports fail delivery. Optional `review.md` preserves detailed prose; neither an empty report nor positive prose establishes visual acceptance.

Choose references for the actual subject as well as the overall style. A family-wide
sheet without a related parent contour left A044 with a bookmark silhouette that
passed structural checks but differed visibly from shipped bookmarks. A047 improved
it after receiving base bookmark and bookmark-plus neighbors. Preserve these
selection decisions in the run brief so a result can be reproduced.

When a repeated parent contour is already admitted, use the existing named-part
vocabulary and source-preserving geometry instead of rebuilding its rounded joins
from disconnected strokes. Attribute that contour to its source. A new modifier
composition is distinct from a newly drawn contour; a composition that reproduces
an existing target is a reconstruction control, not evidence of novel generation.
Inspect native-size results either way. Source provenance and exact replay do not
approve the new composition’s optical balance.

For filled concave transitions, distinguish the boundary of the positive silhouette
from the boundary of a negative cutter. Rounded cutters can still intersect straight
sides at a sharp angle. A057 retained the editable Boolean program and constructed
positive arc envelopes with small positive cap pieces before subtracting the shared
check. All four ticket mouth joins measured tangent, with the source opening height
retained. This is a measured ticket construction, not a universal rounding rule.
See [the comparison receipt](log/positive-mouth-comparison-2026-09-05.json).
A separate PathKit stroke-expansion probe also produced tangent mouths, but its
opening differed from the source. It remains isolated. A subsequent audit found roughly30-degree internal
cap-to-arc joins in A057 despite tangent outer mouths, so the ticket does not
establish that existing primitives can produce a fully smooth transition.
The PathKit probe has under0.07-degree explicit join deviations in the same
region; broader stroke-expansion validation is now warranted. Mechanical expansion still cannot choose the
optical counter adjustments observed in the source camera.

Compiler6 supports rounded `line ... r1` in filled paint as a round stroke
outline, including Boolean subtraction. Its centerline radius matches outlined
paint. A closed line is a ring; it does not automatically become a solid parent.
The compiler preserves the recipe and computes at higher internal resolution
to avoid coarse curve approximation. See
[the compiler6 proof](log/rounded-stroke-compiler6-2026-09-05.json).

Compiler7 adds explicit `solid` to closed rounded lines in filled paint.
This fills the centerline interior as well as its expanded stroke, with
unchanged editable vertices/radius. Use it for solid parent contours, then
subtract the modifier counter. The existing line without this flag stays a
ring. [Bookmark derivation](log/solid-bookmark-compiler7-2026-09-05.json)
removes A058's slit, but is not a fresh author or craft qualification run.

Native Claude review should request `--json-schema` and consume the CLI result's
`structured_output`, validating required fields and enum values locally. A060
returned contradictory free-form verdict fields; A061's schema removed that
ambiguity on the same pair. This establishes response-format behavior only.
The reviewer still made inaccurate geometric claims and is not craft-qualified.
See [the falsification receipt](log/bookmark-critic-2026-09-05.json).

Filled feature warnings include surviving contours in resolved Boolean output.
The report gives both construction units and native pixels. It tests short-axis
bounding boxes, not arbitrary local thickness: narrow diagonal slots and local
necks can still evade this check. Intermediate cutters removed by later unions
do not create phantom warnings. Native-size inspection remains required.

Account for each intended hole in the resolved filled result. A065's author
dismissed a tiny flagged contour as Boolean bookkeeping, but nonzero point
containment confirmed a real unintended hole. A feature too small to see at
native size is still a construction defect. Inspect the resolved geometry;
repair unexpected holes or report them as unresolved. Prompt guidance is not
an enforced topology gate or evidence of reviewer qualification.

Compiler9 supports selected `strokeJoin: "miter"` (fixed miter limit4, round caps) and zero-radius styles with empty positive-radius tiers. Use `line ... r0` for a sharp contour and repeat the first vertex to close it; add `solid` only for a closed filled silhouette. Without solid, a closed filled line is an expanded ring. In a miter style, omitted line radius defaults to0; positive corner requests require declared tiers. The host preserves closure, expands miters and uses nonzero fill rules for the ring/interior union. SVG and filled expansion share the join policy. Painted miter bounds drive pair size, centering and bleed checks; centerline bbox stays available separately. Existing round defaults remain. Historical compiler8 artifacts require their original compiler; never silently rewrite their revision. This is representational support, not a qualified new-style library.

Compiler10 repairs direct legacy holes on nonzero parents. Serialization subtracts the contained parity-composed cutters from the nonzero parent through the existing Boolean kernel; it does not concatenate same-winding holes into the parent. Hole recipes remain editable and replayable. Ordinary evenodd parents retain their prior serialization. Overlapping legacy holes retain parity; use explicit cutter union/subtraction when overlap should also be removed. Historical compiler9 artifacts remain separate.

Compiler11 adds selected `strokeCap: "square"`; omitted cap stays round. SVG strokes, expanded filled lines and arcs, line knockouts, exposed trim ends and painted bounds share this cap policy. Closed contours ignore cap choice; dot roles remain round discs. Diagonal square caps extend in both tangent and normal directions, so bounds come from expansion rather than half-width padding. Preserve historical compiler10 artifacts and use a fresh revision/output.

Compiler12 allows an explicitly closed `line ... r0 solid` (or a positive declared radius) inside an outlined icon. It renders that element as the same expanded stroke plus filled interior used in filled paint, rather than stroking its boundary again. Use this for solid small modifiers such as play; the surrounding icon stays outlined. The solid flag survives existing recipes/replay/transforms. Painted bounds and mixed spacing use the modifier as zero-width ink, and feature diagnostics cover it. Trim refuses solid modifiers; it remains a centerline operation. Open or missing-radius solid contours still refuse. Historical compiler11 artifacts remain separate.

Compiler14 extends `detail` to arcs and expands round filled arc caps through the same stroke kernel as square caps. Curved symbols can now share the pinned interior weight with their straight extensions. The [euro repair evidence](log/detail-arc-euro-2026-09-06.json) verifies the fixed width/cap geometry and documents the remaining16px optical tradeoff. Both independent reviews passed, while the author limitation kept the run in `needs-repair`; this is not craft approval.

The checker also saves `<paint>.native.png`, `<paint>.retina.png` and `<paint>.pixels.json` in each retained check. Matrices use local zero-based `rows[y][x]`,0black/255white, with dimensions and SHA-256 binding to the corresponding PNG. Read these for exact samples without a custom rendering script. Failed checks clear their latest copies along with the previews. The standalone proof command writes the same information as `pixels.json`.

The [native weight ablation](log/native-weight-ablation-2026-09-06.json) improves the euro gaps by changing detail weight alone; the [yen control](log/native-weight-yen-2026-09-06.json) shows that the same change reduces bar contrast in an existing placement. The [native-author repair](log/native-weight-yen-repair-2026-09-06.json) restores full bar contrast with a clear counter by repositioning only the yen bars. This supports joint weight/placement design for native masters, not a global thinner-stroke rule, training requirement or qualified family default.

Pilot evidence must not credit the same artifact to different concepts. Identical geometry may legitimately serve multiple declared variants of one concept. Instrument trials require exactly one forward and one reverse presentation, both bound to the same valid `evidenceHash`; different pair IDs cannot reuse that hash within a defect class. Collectors must compute it from the canonical stimulus content, excluding order and labels, and retain the source evidence. The gate validates those identities but cannot authenticate absent source files or qualify taste from supplied hashes alone.

The canonical command now requires `--meanings <json-file>`: an array of3–12 distinct, plausible concept labels including the exact requested concept, for example `["bookmark-plus", "bookmark-check", "bookmark-minus"]`. Reserve `uncertain`, `pass` and `fail` for the host; uncertainty is added automatically. Freeze alternatives and their order before generation, with comparable specificity and genuinely confusable distractors.

The image reviewer receives those alternatives without being told which answer is intended. Its literal selection remains in `independent-review/review.json`; `meaning-observation.json` records the host comparison, and a wrong selection triggers a semantic repair. `semantic-plan.json` retains the intended label and confusion set outside the reviewer’s allowed image directory. This removes direct answer disclosure from the recognition question; it does not establish free recognition, calibrated confusion sets or an independently qualified final evaluator.

The [counterbalanced recognition assay](log/meaning-assay-2026-09-06.json) identified20/20previously exposed reference icons correctly in both alternative orders. Only3/4questions with the intended answer omitted elicited uncertainty in both orders, so its frozen protocol failed. The remaining bell/lamp control may itself be visually ambiguous; keep that distinction when diagnosing the reviewer. This is development recognition evidence, not a qualified semantic or aesthetic acceptance instrument. [Protocol and alternatives](log/meaning-assay-protocol-2026-09-06.json) and [image/usage verification](log/meaning-assay-verification-2026-09-06.json) preserve the complete denominator and limitations.

Local author packets contain only the selected optical master's specs, parts and references. The checker and generated artifacts bind to this derived revision; delivery also records `sourceRevisionHash` for the original input. Other masters' source geometry stays out of the supplied packet. Master selection alone is not a sealed holdout guarantee; the canonical author also uses the restricted runtime described below.

An [isolated-runtime experiment](log/read-boundary-2026-09-06.json) demonstrated native author commands with root reads denied and a narrow checker runtime allowed. It denied corpus/history/source/installed-icon reads and reproduced existing SVG/native/proof bytes exactly. The canonical launcher now prepares this runtime for each author attempt. It bundles the real checker into `checker.mjs`, allows only its resolved runtime packages and required system files, and denies other command reads, outside writes and networking. `runtime-preflight.json` must show successful packet access and actual permission-denied errors for excluded reads, writes, a symlink and networking before a model is called. Missing files or a refused server connection do not count as permission enforcement. `runtime.json` records the checker hash, source inputs, dependency versions and filesystem grants; edits to these protected files, the checker or its dependency links make delivery fail. Per-package links let attempt directories outside the repository resolve the same allowed runtime without exposing the rest of node_modules. The installed Codex binary must support these permission profiles; there is no fallback to broader access. Source exclusions, preloaded context and non-command tool access still require verification before claiming a sealed pilot.

The canonical author receives the reference sheet as an explicit image attachment. Repair attempts also receive immutable, clearly labelled previous-candidate proof sheets. Each attempt retains ordered attachment hashes in `author-images.json`; the author cannot change those inputs without failing delivery. JSON process events are retained in `author.json`. These attachments establish the initial image input path. Final delivery separately requires tool-returned PNG bytes matching each final proof, recorded in `author-inspection.json`. The host resolves and verifies the exact persisted native session; missing traces or unmatched final proofs fail delivery. Native sessions are retained because the terse exec JSON stream omits image tool calls. Initial attachments cannot satisfy this check. Image exposure still does not prove attention or accurate visual judgment.

The style review receives `construction-evidence.json`: declared source stroke widths normalized to the24-unit grid, with hashes for candidate SVGs, proof PNGs, reference SVGs and the reference sheet. Reference entries use neutral sheet indices. The critic uses these facts for numerical claims and judges perceptual harmony separately; unequal weights can be deliberate. The measurement path supports flat SVGs and root inheritance. Unsupported presentation features or missing viewBoxes report unavailable. Expanded filled-contour thickness is explicitly unmeasured, so an empty stroke list is not a zero-width claim. These facts do not establish aesthetic approval or style calibration.

Every admitted reference also has an indexed `reference-<index>-proof.png` showing its unchanged source drawing at the candidate native size,1x/2x, on both surfaces. `reference-proofs.json` binds source and proof hashes and explicitly makes no optical-master claim. These proofs are protected author attachments and required independent-review reads. Construction facts include declared caps on open stroked subpaths; closed rings have no cap endpoints, and expanded filled terminal geometry remains unmeasured.

Canonical author startup also performs an offline context preflight. It disables plugins, memories and skill search for that invocation, discovers visible local skill paths and applies per-skill disabled overrides until no catalog remains. No global configuration is edited. `context-preflight.json` records hashes, counts and bounded discovery probes; it is protected from author mutation. The actual persisted native trace is checked again before delivery, so an unexpected skill catalog or plugin recommendation block fails delivery. This narrows ambient context but is not by itself proof of complete holdout closure. The per-skill mechanism follows [official OpenAI documentation](https://learn.chatgpt.com/docs/build-skills).


A generated composition can optionally seed the local author:

```sh
node --import tsx packages/iconsmith/scripts/local-generate.ts jellyfish .staging/new-jellyfish --revision path/to/revision.json --master large --model YOUR_CODEX_MODEL --meanings path/to/meanings.json --sketch path/to/composition.png --sketch-source "Model, run ID, and provenance"
```

The sketch must be a decodable, single PNG of at most 4096px per side. It is copied
and hash-bound before generation, retained with source attribution, and attached
as an unapproved composition hypothesis. It does not become an admitted part or
a style reference. The author reconstructs it through the same constrained compiler
and must report any missing representation. The critic sees the resulting icons
and admitted style references, never the sketch. This experimental hybrid route
preserves visual information that the older raster-to-coarse-words route discards;
it has not yet demonstrated superior general generation quality.


Compiler15 treats `finish` as a global declaration, resolved before construction
regardless of its position in the program. Unknown or conflicting finishes still
fail. The style revision compiler identity has changed: create a new revision
using the current compiler and rerun checks. Historical compiler14 revisions and
artifacts remain evidence of their original runs; they are not silently migrated.

The September6 strategy screen and its limitations are recorded in
[strategy-review-2026-09-06.md](strategy-review-2026-09-06.md).

Filled cutouts in compiler16 use true subtraction of unioned cutters. Overlap and repeated cuts stay transparent, including diagonal line caps and nested Boolean recipes. Boundary-crossing cutters are clipped to their solid, and filled bounds measure the resolved ink. Create a new revision for compiler16; historical outputs remain unchanged.


Compiler17 adds explicit intersection fillets: `subtract r1` and `union r0.5`
round sharp operand intersections using a filled-family radius tier. Existing
corners and smooth segments remain intact. Infeasible radii fail atomically;
choose a smaller tier or change the operands. The author chooses a radius, while
the compiler owns the tangent points and curve handles.

The canonical author/reviewer loop shares a ten-minute wall-clock budget and
retains the best checked candidate. Its receipt records elapsed time, deadline
status and the stopping reason. A review-clear result still has
`craftApproved: false` until the instrument qualifies against human labels.

Create a frozen development manifest and a local audit packet:

```sh
node --import tsx packages/iconsmith/scripts/quality-audit.ts freeze .staging/new-benchmark
node --import tsx packages/iconsmith/scripts/quality-audit.ts export .staging/new-audit --manifest .staging/new-benchmark/manifest.json --inputs path/to/inputs.json
```

Inputs follow `AuditInput` in `scripts/quality-benchmark.ts`: one original program,
concept/family, paint, source, model/manual authorship, model identity and nullable
elapsed time/API cost per row. This exporter uses the default family spec; pinned
custom-size runs must retain their canonical `style-check.ts` artifacts instead.
Its 16px image is explicitly a downsample, not a calibrated optical master.
Review Q-numbered PNGs before opening the separate provenance key. Missing rows,
failed constructions and unlabeled verdicts remain visible and cannot qualify.


Whole-library coverage starts with every SVG, not a hand-picked success:

```sh
node --import tsx packages/iconsmith/scripts/library-audit-cli.ts /path/to/icons-svg .staging/library-audit-new
node --import tsx packages/iconsmith/scripts/library-replay-cli.ts .staging/library-audit-new/inventory.json .staging/library-replay-new
```

The audit records source hashes, descriptive morphology, missing paint references,
native16/24 contact sheets, and a separate generation matrix for all concepts.
The replay pass measures admitted-source reconstruction and native pixel error.
Neither source rendering nor reconstruction counts as model generation or craft
approval. Use the full population to choose broad development cases and track
failures by morphology; preserve unseen family exclusions for later qualification.


### Admitting reusable family components

Use `scripts/family-parts.ts` and `admitFamilyParts(revision, master, sources)` when preparing an immutable local style revision. Each source explicitly supplies its name, finish, SVG and provenance. Admit outlined centerlines and independently drawn filled boundaries separately; do not substitute a scaled outline for a filled boundary. The helper keeps path compounds intact, preserves source curves, checks paint compatibility, and compares actual16/24px renders before returning a revision. A source failing those checks is refused. This is component admission, not human craft approval or new-generation coverage.

Compiler18 preserves admitted contours by default while snapping placement anchors. Old compiler17 revisions retain their original receipts and must not be silently reinterpreted. The2026-09-07 library admission receipt is `docs/log/library-parts-admission-2026-09-07.json`; full per-file outcomes and component data remain in the referenced staging artifact. It records3,431admitted source files and926refusals, not a whole-library generation pass.

### Automatic library retrieval

Add `--library /absolute/path/to/icons-svg --library-set blode-icons` to
`local-generate.ts`. The flat library uses `name.svg` and `name-filled.svg`.
The pinned revision provides the style/master anchor. Retrieval searches every
available family name with the native subscription model for body, modifier and
construction analogues, inspects the shortlisted drawings, and replaces the
selected master's reference/part packet with its selected sources. Generation
and independent output review consume that same immutable revision.

`--exclude <concept>` is repeatable. The requested concept, known target aliases
and byte-identical target SVGs are excluded from discovery; explicit exclusions
extend this set. These checks do not establish sealed semantic holdout isolation.
Existing target references are also filtered from discovery's style anchors.

The `retrieval/` directory retains the source inventory hash, native discovery
and visual-selection traces, image hashes, candidate decisions, component
admission refusals, selected reference PNG and resulting revision. A useful
visual reference may fail native component fidelity and remain reference-only.
An empty or failed selection stops the run; it never silently uses the old
manual packet. Source policy is checked before names or images reach a model.
No public UI, network icon browsing or API fallback is involved.
