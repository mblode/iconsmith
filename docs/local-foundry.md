# Local foundry

The primary workflow is local: reference files → coding-agent CLI → constrained
icon program → host compiler → native-size visual review → saved SVG library.
No public web app, deployed Eve agent, database or API judge is required.
The existing web and agent workspaces remain available; they are outside this
local workflow and have not been deleted.

Run from the repository root after building the engine:

```sh
npm run build --workspace iconsmith
npx tsx packages/iconsmith/scripts/local-generate.ts codex camera .staging/my-camera
npx tsx packages/iconsmith/scripts/local-generate.ts claude camera .staging/my-camera-claude
```

Use a new output directory for every attempt. Runs retain their scratch brief,
program, logs and failure evidence. Without style options, this command produces an outlined house-style draft.
The selected-style route below supports paired or single-paint authoring and
render/check/revise work through native Codex. A successful compile is not a craft
approval.

Codex uses its ChatGPT sign-in with user provider config ignored. Claude uses its
native sign-in with settings sources and external MCP configuration disabled.
Inherited provider keys and endpoint overrides are removed from child processes.
The generic harness now defaults to subscription routing; historical Gateway
experiments must opt into `billing: "gateway"`. Custom harness callers must also
isolate CLI provider configuration. No API fallback is permitted for current work.

The local Codex command explicitly requests high reasoning and records that request
in its run receipt. Ignoring user configuration previously left the CLI at its
default of no reasoning; A039's live metadata verifies the explicit high setting.
Inspect emitted model metadata when comparing runs, rather than assuming account
tier or a successful sign-in determines model effort.

Cursor CLI is installed at `~/.local/bin/cursor-agent`. Its native login has
now been restored, and `about` confirms Ultra. Use `cursor` as the first argument
to the local command; a native-sign-in preflight runs before generation. The
unrelated `agent` executable on PATH is Grok and must not be used as Cursor.
Claude's expired session has also been refreshed through native sign-in.
Authentication is distinct from successful artifact delivery; each run retains
its result or failure. No API key or paid fallback is supplied.

Subscription usage is not recorded as a zero-dollar model call. The historical
API ledger is frozen at $10.65904960 with no outstanding reservations.

Check a selected-style pair locally:

```sh
node --import tsx packages/iconsmith/scripts/style-check.ts path/to/revision.json large path/to/pair-directory
```

The directory must contain `outlined.icon` and `filled.icon`. The command compiles
both against the pinned revision, verifies exact replay and paint identity, checks
individual declared keylines and geometry plus pair consistency, and writes SVGs,
192px previews, a pair at the selected master’s native size and `checks.json`. Structural errors produce a
nonzero exit. Empty findings do not approve craft. `tsx` is an exact workspace dev
dependency, so normal repository installation supplies the runner.

Each check now retains the submitted programs, rendered artifacts and report in a
new `check-*` directory. Compile failures retain their programs and failure report,
and set the latest `checks.json` to `exactReplay: false`; any older latest previews
must not be treated as a successful rendering of those failed programs. The checker
also emits `preview-16.png`. The report identifies this as native when the selected
master is 16px, otherwise a downsample. Rendering at 16px alone does not establish
that the geometry was designed as a separate optical master. Node's tsx import hook avoids the CLI's unnecessary IPC listener
inside restricted agent sandboxes.

For spatial review of one exported SVG:

```sh
node --import tsx packages/iconsmith/scripts/review-proof.ts path/to/icon.svg path/to/new-proof-directory
```

The proof separates an enlarged vector render from magnified native 24px and 16px
raster pixels. The pixel views use nearest-neighbor enlargement so gray coverage
and closed counters remain visible. Native-size samples and orientation labels are
included. Ask reviewers to locate defects in the normalized 24×24 viewport, then
verify their claims. The proof does not establish optical masters or approve craft.

For a style that requires only one paint, append `outlined` or `filled` to the
checker command. Only that program is required, and the report records `paints`
and `pairChecked: false`. Omitting the argument continues to require and validate
both paints. A single-paint result is never evidence of pair consistency.


Generate in a pinned, admitted style through the same local entry point:

```sh
node --import tsx packages/iconsmith/scripts/local-generate.ts codex bookmark-check .staging/new-bookmark --revision path/to/revision.json --master large --finish outlined --brief path/to/design-brief.md
```

Omit `--finish` to request both paints. `--brief` is optional additional design
guidance. Selected-style generation currently supports Codex; the existing default
house smoke command still supports Claude and Cursor. Every invocation needs a new
directory. Do not copy historical `.scratch` experiment runners to start new runs.

The runner prepares the selected spec, admitted reference sheet and part names,
then asks the native CLI to author and visually revise its programs. It rechecks
saved programs itself after the author exits. `delivery.json` reports `delivered`
only when the author succeeds, pinned inputs are unchanged, required programs and
nonempty `review.md` exist, and the final structural check succeeds. Any missing
requirement produces `incomplete` and a nonzero command exit. `author.json` retains
the process output and failure details. A review file's presence does not verify
its claims: `reviewContentValidated` and `craftApproved` remain false.

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
