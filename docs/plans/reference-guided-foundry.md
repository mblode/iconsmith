# Reference-guided icon foundry

Decisions, past attempts and reconciled spend: [foundry log](../foundry-log.md).

Authoritative execution plan, 5 September 2026. Execution is underway; see the [implementation and paid-run evidence](reference-guided-foundry.notes.md). The current authorized ceiling is $50. Read with the [first-principles audit and experiment protocol](reference-guided-foundry.audit.md) and [research and Glyphs decision](reference-guided-foundry.research.md). Supersedes the sequencing in [the earlier pipeline map](../foundry-pipeline-map.md).

## Goal and scope decisions

Build Iconsmith into a foundry that ingests versioned reference collections, derives reviewable design rules, generates new concepts consistently within a selected family, and releases maintained libraries. Cursor, OpenAI and X are target reference collections, each scoped to a product version/surface; they are not interchangeable labels or a mixed training set.

The user has also authorized model training if necessary, within the current $50 ceiling. The [training decision](foundry-training-decision.md) keeps that option behind usable construction examples and a held-out quality comparison.

The user clarified that icon artwork must be **100% AI-generated**. No manual drawing, master correction or per-icon human aesthetic approval is required. Iconsmith owns style inference, master generation, optical corrections, evaluation and bounded repair. Figma and Glyphs are optional downstream inspection/export tools, not authoring dependencies. Reference icons may be human-made, as explicitly requested; their use is tracked separately from generation. Retrieval or copying an existing icon must never be counted as a newly generated icon.

**First milestone:** produce a replayable specimen report through the actual engine/tournament for the house baseline and one authorized contrasting reference collection. It includes newly generated concepts, distinct master behavior, family comparisons, calibrated defect controls and real failure/spend accounting. A synthetic fixture proves integration only. Studio selection follows this evidence; it is not the initial quality experiment.

**Foundry release finish line:** acquire and independently evaluate Cursor, OpenAI and X collections scoped to real product surfaces. A source blocker remains incomplete. First delivery is one contrasting profile with explicitly tested capabilities and a complete pinned library manifest whose required entries pass automatic acceptance. Repeat onboarding and evaluation for the remaining targets. The 24-concept pilot does not establish arbitrary-style support. Artwork generation, correction and acceptance require zero human intervention. Claims of professional perceptual equivalence require separate empirical evidence; automatic acceptance alone is insufficient.

## Architecture: Deepen, then enforce

This is a plan for Deepen plus narrowly targeted Harden work. Preserve the four workspaces and existing deployment. No new service, package, vector editor or generalized plugin host.

### Domain terms

- **Reference collection:** captured assets from one source/surface/version with provenance and use permissions. Avoid calling every imported asset the corpus; the existing Central corpus has a specific physical location.
- **Style revision:** immutable approved rules and dependencies for an aesthetic family. Existing `Rendering.style` means finish; leave that stored field compatible and map it explicitly.
- **Optical master:** a design for a native size/use range; distinct from scaling a 24-unit drawing.
- **Finish:** outlined/filled or another explicitly supported rendering treatment. Avoid using style to mean both finish and aesthetic.
- **Concept family:** related semantic constructions such as folder/folder-add/folder-open; distinct from aesthetic family.
- **Library release:** a versioned manifest of approved concept variants and exact artifacts, not a directory of whichever generations finished.

### Ranked opportunities, based on current code and churn

1. **Style selection is scattered.** `GenerateOptions` already accepts `spec` and `policy`, but `PairTournamentOptions` lacks both, the arsenal always loads house assets, and caches omit revision identity. Resolve one immutable style revision and carry it through generation, repair, replay, twins and judging. Highest leverage: every requested new family becomes local to one definition instead of a set of unrelated switches.
2. **Reference ingestion loses meaning.** `normaliseIconSvg` normalizes to 24 and handles only a limited SVG shape. Extend existing records with originals/native metrics and explicit rejection. Do not build a parallel corpus platform.
3. **Part acceptance does not prove style membership.** `houseDerivedBy` accepts a part operation or construction trace. Replace the proxy with complete dependency provenance and approved compiler-operation validation. A valid generated-only construction must be eligible without a copied part. Preserve the old behavior only for the pinned legacy house policy, not as a universal gate. Test irrelevant-part stuffing as well as missing provenance.
4. **Batch state is not durable.** `turn-record.ts` explicitly uses per-instance temporary files. Add persistent claims and spend accounting when library execution lands; do not pretend the existing guard is cross-instance idempotency.
5. **The judge also imposes the house.** `pipeline/audit.ts` hard-codes house geometry and a 24px small preview. Build its rubric and render contexts from the selected revision/master; the existing unrelated-icon judge gate does not establish optical sensitivity. Qualify the instrument with same-concept defect and valid controls before trusting it.
6. **Construction vocabulary is house-bound.** Generalize only operations demanded by the contrasting specimen set. Imported human-authored geometry and model-generated programs remain separate trust paths.

Recent 30-commit scan at HEAD `a4e36e0` found frequent edits in Studio and tournament code, validating this focus. Recheck status/history at execution; preserve unrelated changes and the untracked planning documents.

### Repo shape and interfaces

| Owner | Proposed responsibility | Existing seams to deepen | Enforcement |
| --- | --- | --- | --- |
| `packages/iconsmith` | Pure style definition, resolution from supplied assets, construction, provenance checks, evaluation | `types.ts`, `tools/canvas.ts`, `pipeline/generate.ts`, `policy.ts`, `tournament.ts`, `pair.ts`, `harness.ts` | Typecheck; style isolation/replay tests; existing boundary checker extended to new folders. |
| Engine corpus/commands | Capture-file adapters, normalization, measurements, manifests, local library execution | `corpus/sources.ts`, `record.ts`, `normalise.ts`, `commands/corpus.ts`, `commands/view.ts`, `cli.ts` | SVG conformance fixtures; no filesystem imports into pure geometry/parts/tools. |
| `apps/agent` | Resolve trusted selected revision, source authorization, reference retrieval, existing paid tournament | `lib/arsenal.ts`, `lib/generate.ts`, `tools/generate_icon_pair.ts`; bundled data in `data/` | Cache isolation and authorization tests; real Eve discovery startup. |
| `packages/contract` | Wire IDs, master/finish selector, output provenance and status | `src/types.ts` | Zod validation and contract tests; engine-free dependency check. |
| `apps/web` | Style selection, evidence/specimen views, release status | Existing Studio components and `lib/studio/` | Browser verification and web tests; private source geometry never added to a public catalogue response. |

Proposed engine entry is a small `pipeline/style.ts` module, not a registry service. It resolves one style revision into existing `Spec`, `Policy`, allowed references/parts and evaluator configuration. Pure serialized identity/metadata belongs in engine types; corpus file loading remains at the command/agent edge. Reuse existing modules rather than creating one file per field. Do not move the engine into the wire contract.

Explicit style context is domain input, so thread it through engine calls. Ambient request metadata may remain in the existing transport mechanism; do not introduce AsyncLocalStorage just to hide a style choice from tests. The same program must be replayable outside a request.

Target run identity: style ID + revision digest + optical-master ID + finish + concept ID + program/compiler version. Corpus selection also includes holdout identity. Cache reuse, output replay and library jobs must resolve all of these identically. A digest alone does not preserve an old interpreter: archive the compiler build/lockfile or prove backward-compatible replay with frozen old-program fixtures. If that compiler is unavailable, serve the preserved exact SVG and report program replay unavailable; never reinterpret silently using the latest compiler. A release archive includes the executable replay bundle or its retrievable immutable build artifact.

A style revision contains source asset hashes, approved Spec/Policy values, named family parts/constructions, supported masters/finishes and evaluator calibration. Include a construction capability matrix: terminal/join behavior, angular and curved forms, overlaps/counters, local thinning/relief and independent optical masters. Unsupported capabilities are explicit; the same stroke/radius knobs do not imply a different construction language. Model-suggested rules remain drafts. The model cannot mint an approved source grant, choose private assets from another user, or turn malformed data into default Central rules.

## Approach and local ticket slices

Each ticket below has its own local file, explicit blockers and independently observable outcome. These are planning artifacts, not issues published to a tracker or dispatched implementation. Read the common contracts and verification here before pickup.

| Ticket | Outcome | Blocked by |
| --- | --- | --- |
| [01](slices/01-select-and-replay-a-style.md) | Run a contrasting-style generation and evaluator experiment | Minimal authorized source fixture; full 02 inventory can proceed alongside |
| [02](slices/02-inspect-reference-collections.md) | Import and inspect honest reference collections | None |
| [03](slices/03-qualify-optical-families.md) | Integrate the tested profile in Studio and qualify declared capabilities | 01 outcome `pilot-proven`, plus 02 evidence |
| [04](slices/04-resume-library-builds.md) | Generate and resume a bounded library locally | 03 |
| [05](slices/05-release-reviewed-libraries.md) | Curate and release reproducible libraries | 04 |
| [06](slices/06-glyphs-authoring-bridge.md) | Deferred editor bridge; superseded by 100% AI-generated requirement | Not on the execution path |

### First tracer bullet, not a horizontal rewrite

Ticket 01 packages the current house constants and a small contrasting authorized fixture in the same change as an executable generation-to-specimen experiment. It exercises the actual generator and tournament with newly synthesized programs, native rendering, evaluation and exact replay. A file/CLI input selects the revision first; the Studio selector lands in ticket 03 after the experiment resolves the main quality risks. Use deterministic injected generation for CI and a bounded real generation for aesthetic evidence only when an explicit run ceiling is available. Do not migrate every historical script before this works.

Current contract excerpt to extend, not replace:

```ts
// packages/iconsmith/src/pipeline/generate.ts, GenerateOptions
policy?: Policy;
spec?: Spec;

// packages/iconsmith/src/pipeline/tournament.ts, PairTournamentOptions
parts?: readonly Part[];
references?: readonly Buffer[];
```

Propagate selected revision to replay, twins and audit prompts; include validated reference metadata before rasterization so an array of PNG buffers is not mistaken for provenance. Default requests resolve explicitly to the committed house revision. An explicit unknown/missing revision errors; it never falls back.

Keep legacy stored Studio versions renderable. Mark versions lacking provenance as legacy/unknown; do not invent a revision digest for historical output. New versions must contain enough pinned identity to reproduce them. Make the selector's trusted choice survive the Eve tool boundary: bind it to server-validated operation/session metadata and reject an inconsistent model-copied ID. Schema validation alone does not prove it is the user's selection.

### Reference acquisition and profile qualification

Acquisition update: the [product reference inventory](../references/product-icon-collections.md) records extracted Raycast catalog SVGs, a bounded Linear client sample, mixed Granola website assets and Minor Adventures optical correction pairs. These are analysis captures, not qualified style revisions. Consult their manifests before using counts, labels or geometry; do not mark the original three-source goal complete from these additional references.

Use file imports before adding a crawler framework. Collection manifests record product, surface, app version/capture date, source URL/path, original hash, variant/name mapping, native viewBox, count and missing coverage. Acquire accessible product assets through inspected pages or supplied exports. Never label a sampled page as a whole library. Keep Cursor's prior Codicons separate; separate ChatGPT/Codex/marketing; separate old Twitter/current X and emoji/logos.

Represent allowed use at the source boundary: analysis, conditioning, copying into outputs and redistribution are independent. Retain the existing Central attestation without broadening it to other sources. New grants are explicit trusted records; absent/ambiguous permission is a collection-level blocked conditioning state, while inspection can still progress where allowed. Do not put private or restricted references into public fixtures or packages.

Enforce those capabilities on actual paths: conditioning admits reference images/prompt examples only; extracted parts, exact analogs and reconstruction additionally require permission to copy source geometry into outputs. Redistribution and required notices are checked against final dependency closure at release. A conditioning-only source cannot become an exported `part` through style membership. Test a source allowed as a visual reference but denied for part extraction, analog output and release. This is a runtime policy design, not a conclusion about any vendor's license terms.

Validate the effective parts after merging candidate `result.extras`, before program completion and replay, as well as the initial arsenal. Otherwise a candidate can inject an unapproved part after the first membership check. Retain source membership and evaluator revision identity alongside raster reference buffers.

Preserve original source coordinates. A normalized comparison image is not the authoring master. Initially accept the exact simple SVG subset the parser can faithfully represent and reject unsupported features by name. Add transform/group/CSS/font adapters only when a real captured asset needs them; check rendered equivalence for each addition. No arbitrary remote fetch/render dependency inside the pure engine.

Measure distributions for extents, strokes, caps, joins, corners, angles, negative space and repeated parts. Report sample counts and ambiguity. The AI proposes a profile and named exceptions; frozen qualification checks and an independent evaluator admit its immutable revision. Preserve the existing `measured`/`published`/`inferred` policy distinction. An aesthetic evaluator cannot authorize source use or change its own pass thresholds.

Use the 24-concept diagnostic pilot and instrument protocol in the [audit](reference-guided-foundry.audit.md). Freeze advancement before generation: all declared pilot concepts/variants and instrument classes must pass within budget for `pilot-proven`; otherwise record `blocked`. A closed failed experiment does not unlock ticket 03. Narrowing scope requires a fresh declared trial rather than removing failures. Freeze 12 development and 12 sealed concepts across six morphology groups. Within sealed examples distinguish six known-family completions from six novel-family concepts. For completion, exclude target aliases/variants while allowing the base; for novel families, exclude the whole related source family across finishes and masters. Local exclusions cannot rule out pretrained memorization. Once feedback changes the system, retire that holdout into regression data and draw a fresh one.

Separate reconstruction fidelity tests from new generation. First check whether declared host operations can represent the target's diagnostic constructions, recording residual errors. This isolates a representation ceiling from weak model search. Then compare direct constrained generation with the existing visual-proposal route under equal total call/cost ceilings and the same references. The raster route is a hypothesis, not an automatic default or a license to trace arbitrary paths into production.

Generate separate supported optical masters using named deterministic treatments for local thinning, junction relief and curve construction. Preserve source-native units and exact transforms to an internal canvas; a canonical 24-unit representation is acceptable only if it retains the native master's feature precision and rendering. The model continues to choose structures and named bounded operations, never free path coordinates. Source geometry can support reference analysis and labeled reconstruction, but does not count as newly generated artwork.

Generate and freeze family anchors automatically before synthesizing their siblings. A concept graph records base/modifier relationships, intended meaning, aliases and confusion sets. Shared bases, modifier placement, slash direction and optical treatment become dependencies of programs. Judge individual artifacts and native-size family sheets. A repair to a shared part creates a new revision and revalidates its dependency closure. Do not force every concept into every finish; the manifest declares actual required variants.

Ticket 03 integrates the first tested contrasting profile in Studio, including trusted selection and pinned replay, and establishes a scoped capability declaration. Prefer Cursor when source availability supports it. Repeat qualification independently for OpenAI and X; neither is implicitly supported by a Cursor pass. Draft, pilot-tested, restricted, qualified-for-manifest and blocked are distinct statuses. Additional sources do not block the first local library delivery, but the three-source goal remains incomplete until all are supported within declared scope.

### Library execution and release

First library builder is a local command in the existing engine, using persistent on-disk state under a caller-selected output directory, never tmpdir. Reuse engine generation/tournament APIs with explicit style inputs. It may differ from Studio orchestration and must record its route/model configuration rather than claim production parity automatically.

Use Node's built-in SQLite for transactional local claims/reservations, behind the actual library-job module, not a generic storage abstraction. Local Node 24.17 exposes `DatabaseSync`; restrict usage to APIs available at the repo's Node floor and test that floor in CI. No new server database or deployment is required. SQLite files must not be placed on ephemeral Vercel storage or presented as cross-instance persistence. Hosted batch execution is a later separately scoped integration.

Job identity includes explicit operation ID plus pinned manifest/style/compiler/model configuration. Item states: pending, reserved, running, completed, rejected, failed, uncertain, cancelled. Reserve calls/cost transactionally before any external invocation; record receipts/results immediately. Unknown actual cost retains the reservation and stops further spend. Never count unknown as zero. Treat cost units consistently using integer sub-dollar units with conservative rounding at provider boundaries; preserve the original reported cost.

An external call may succeed just before the process dies. Local transactions cannot make that call exactly-once. Mark unresolved running attempts uncertain on recovery; reconcile stored provider/run evidence where possible, otherwise require explicit retry with a new budgeted attempt. Do not automatically redraw after losing the response. Use one worker initially; concurrent launch attempts contend on a database claim and cannot both spend for the same item. Cancellation stops new calls and records in-flight outcome uncertainty.

Approve exact artifact hashes. Regeneration creates a new draft. A change to a recurring part marks dependent icons stale and produces a specimen diff; it does not rewrite released files. Releases contain SVG, programs or authored-source references, metadata, provenance/notices and a specimen view. React output is generated from the same approved SVG set when needed by the current web consumer. Keep font/Figma publishing and public npm distribution outside the first release; packages are currently private.

### Optional editor boundary

The former Glyphs-authoring ticket is deferred. Generated programs, style revisions and generated master assets are authoritative; SVGs are release outputs. Figma can inspect icons in interface context and Glyphs can inspect masters if useful later. Neither application is required to create, correct, qualify or release an icon. Export integrations are added only for a requested consumer. No manual-edit fallback is allowed to count as fully AI-generated output.

## Quality bar and acceptance evidence

Hard gates apply per artifact: no invalid SVG, unsupported silent normalization, missing declared variant, wrong-style reference/part, unpinned replay, unauthorized source use, or unresolved release dependency. Deliberate style exceptions remain named and visible.

Use separate structural, semantic, style, optical and family verdicts, as specified in the [audit's instrument protocol](reference-guided-foundry.audit.md). No scalar average can compensate for a failed dimension. Semantic identification uses unlabeled icons and frozen confusion sets. Style controls separate same-concept/wrong-style from different-concept/right-style comparisons. Native-size render contexts include intended CSS sizes, 1×/2× device scales, light/dark surfaces and typography; zoomed previews are diagnostic aids.

The repair critic and sealed final evaluator have separate roles. The latter sees no generator rationale, prior scores or origin labels. Freeze evaluator versions, rules and thresholds. Different model identities do not prove independent errors. Qualify defect sensitivity and valid-control false rejection before using a metric as an acceptance gate. Initial instrument targets are 90% correct ordering across at least 20 distinct rule-grounded pairs per defect class and at most 10% false rejection on valid controls; report uncertainty and do not claim this proves taste. Ambiguous aesthetic edits are not automatically labeled defects. Missing sensitivity blocks the corresponding capability.

Every pilot concept and declared variant receives a verdict, including rejected/unknown cases. A pilot pass permits a larger frozen coverage trial for those tested capabilities; it is not full-style certification. Every release entry must individually pass hard gates and the frozen acceptance policy, with whole-family consistency checked before release. Repeatedly tuning against the sealed set invalidates its status. Report automated acceptance separately from evidence of professional perceptual equivalence; an optional blinded human study evaluates the system without becoming a manual production requirement.

Repairs name the defect and affected part, preserve the best valid candidate and stop after the manifest's fixed attempt/round ceilings or a repeated artifact/program hash. Unresolved disagreement rejects the icon. Representation failure returns to host-operation design; semantic failure returns to metaphor choice; neither is hidden by an unlimited tournament.

Measure elapsed time, attempted/accepted counts, real/unknown spend, automated repair count and any human artwork intervention in the first experiment. The qualifying production path requires zero human artwork intervention. Report cost per accepted concept including failures. Record retrieved, reconstructed and newly generated outputs separately; only the last category satisfies new-icon generation. No latency, cost or indistinguishability claim is made before measurement. Decide the larger release's manifest from these results.

## Verification

Existing commands, run serially and only broaden after touched-scope checks pass:

```sh
npm run build -w iconsmith
npm run test -w iconsmith -- --maxWorkers=2 src/tools/spec.test.ts src/pipeline/prompt.test.ts src/pipeline/tournament.test.ts src/pipeline/licence.test.ts
npm run test -w @iconsmith/agent
npm run test -w @iconsmith/contract
npm run test -w iconsmith-web
npm run check
npm run typecheck
npm run test -w iconsmith -- --maxWorkers=2
npm run build
```

The listed per-workspace commands cover each test-owning workspace and cap the full engine suite at two workers. Run engine build before consumer checks whenever declarations changed. Do not run concurrent full suites. Tests listed below are required additions, not existing commands falsely claimed to pass:

- `pipeline/style.test.ts`: explicit revision resolution, malformed/unknown failure, default house parity, no foreign parts, and a frozen prior-compiler replay fixture. Missing old compiler preserves the original SVG and fails replay explicitly.
- `pipeline/tournament.test.ts`: chosen spec/policy survives candidate replay, twin derivation, repair and final visual judge; deterministic mismatch is rejected. Valid generated-only geometry is eligible; irrelevant part stuffing cannot establish style conformance.
- Audit tests: selected master controls rubric/render sizes; unknown contexts fail; clean controls, same-concept defects and order reversal exercise the instrument. Sealed feedback cannot enter a later attempt in the same evaluation.
- Family tests: pinned generated anchors survive sibling placement; a changed anchor invalidates its dependency closure; semantically distinct siblings cannot collapse into identical output unnoticed.
- Optical/representation fixtures: native-unit round trips, declared cap/join treatments, counter survival and master-specific topology. Unsupported constructions fail explicitly.
- Agent arsenal tests: identical concept under two revisions yields isolated references/cache, including holdout identity; tampered style selection fails before paid work.
- Corpus tests: native-size retention, transforms/inherited paint fixtures, unsupported-feature errors, counters, stroke extents and repeatable import hashes.
- `library/job.test.ts`: two claimants, crash before/after provider call, uncertain recovery, budget reservation, null cost, cancellation and replay of completed items without another provider call.
- `library/release.test.ts`: missing required concept/finish, stale part dependency, unapproved hashes and notices block release; repeated export is identical.

Add these to the narrow invocation as each lands. Missing target test files fail pickup verification rather than being silently ignored by `--passWithNoTests`.

Inspect full-test skipped counts: the author's real corpus stays at `/packages/iconsmith/corpus/`; twelve known corpus-gated tests honestly skip when it is absent. Observe current totals instead of copying old AGENTS totals. Never fabricate a corpus to turn skips green.

After adding/moving authored agent files, run `npm run dev -w iconsmith-web`, inspect `[eve:dev]` discovery and exercise `/iconsmith/studio` on port 3210. Do not place JSON in Eve `lib/` or tests in `tools/`. Build engine declarations before consuming them. Browser acceptance: select two revisions, generate/replay the same concept, refresh, inspect selected style/master/finish and exact downloaded SVG; error and cancellation remain visible. Verify the mounted zone path before release.

Every new architectural invariant uses the existing typecheck, tests or boundary checker. For a newly wired boundary rule, deliberately introduce a prohibited import, observe a failing named diagnostic, revert and observe pass. Existing CI invokes check/boundaries/typecheck/test/build; keep hooks and CI using those commands. Check root configuration separately if edited.

## Rollout, rollback and failure scope

- Default house selection remains unchanged; expose additional revisions only after qualification. New source behavior is opt-in by revision.
- Store immutable old revisions and compiler identity. Rolling back the active selector/release pointer must not rewrite historical assets. For private large assets, archive outside git with a manifest; only redistributable fixtures enter git.
- Parser or profile failure quarantines the offending collection, not all collections. Renderer rejection shows the unsupported feature. No empty tile may count as a valid icon.
- Quality regressions restore the previous approved revision and invalidate only affected draft caches/jobs. Completed releases remain addressable.
- Job ledger corruption stops spending and release; restore a backup or reconcile receipts. No best-effort reset that loses spend history.
- Any generated master change while a job runs creates a new revision; the running job stays pinned.
- Public multi-user uploads or cloud batch work require shared durable storage and per-owner authorization at each handler/tool; they are explicitly not implemented by the local SQLite job.

## Scope challenge and dependency budget

Cut from the initial outcome: a new vector editor, auto two-way Glyphs sync, automatic font interpolation, font/Figma publishing, a public style marketplace, cloud batch infrastructure, arbitrary illustration styles, new provider abstractions and training/fine-tuning. These do not prove reference-guided generation. Preserve source permissions, budget handling, failed states, isolation, provenance and replay.

Reuse existing Spec/Policy, parts, tournament, corpus records, SVG sanitizer, sharp renderer, Zod and boundary script. Use stdlib SQLite only at the local durable-job step. Do not add a DOM/vector/parser library until a captured unsupported feature requires it and an existing dependency cannot represent it faithfully. Any such dependency requires a focused fixture demonstrating why it is necessary.

Net simplicity target: zero new workspaces/deployables; one resolved style input replaces scattered defaults and independent style choices. New acquisition/job/release behavior has real users (three target sources, resumable library work), so their modules are earned. Delete redundant default-resolution branches after all supported callers migrate; do not leave a permanent parallel generator. Keep unrelated cleanup out.

## Assumptions and STOP conditions

Verified by code/docs: injectable Spec/Policy, missing tournament context, house arsenal, constrained DSL, limited SVG normalizer, temporary turn cache, four workspaces, Linux CI, Glyphs 4 icon mode, locally installed 4.0.1/4004.

Unverified: usable conditioning grants and complete assets for each target product; automatic Glyphs icon export fidelity; novel-concept aesthetic quality; cost/time for a qualified library. These are experiments/gates, not implementation facts.

Stop the dependent slice and record evidence if:

1. A named seam has materially changed: re-read the real exports and revise the plan before broad migration. Routine path moves can be logged and followed without pausing unrelated work.
2. A source grant is absent: keep that collection out of conditioning/release. Continue other collections and fixtures.
3. SVG features cannot be normalized faithfully: preserve original and reject; do not substitute a raster trace as exact source.
4. A real generation has no explicit total budget available: run deterministic tests only. This planning turn authorizes no new spend.
5. Any item needs manual drawing or editor correction to pass: reject or repair automatically within budget; do not count the manual result toward the AI-generated acceptance set.
6. The only way to fit a family is model-authored free paths: report the unsupported construction and design a host operation/approved part before continuing.
7. A proposed hosted batch uses tmpdir/local SQLite as durable shared state: stop that deployment; the local builder is not a cloud design.

Keep `reference-guided-foundry.notes.md` beside this plan during implementation, with `## Deviations` (plan/code-required/taken) and `## How the run ended` (capability proven, blocker isolated, or scope boundary reached), including commands and artifact paths. No notes file is prefilled with nonexistent implementation results.

## Review notes

The 5 September first-principles audit supersedes prior self-assessments. Before this audit: completeness 3, feasibility 3, scope 4, testability 3, risk 3, assumptions 3. After corrections: completeness 5, feasibility 4, scope 5, testability 4, risk 5, assumptions 5. These are planning scores, not implementation results.

Resolutions: move the first outcome from selector plumbing to a real quality experiment; replace house-derived eligibility for new revisions; make judging/master rendering style-aware; add representational coverage, generated family anchors, separate instrument qualification and honest pilot/holdout semantics. Remove manual-authoring dependencies and historical hybrid recommendations.

<!-- UNRESOLVED: Novel-family generation and an evaluator sensitive to professional optical quality have not been demonstrated. Source access is unconfirmed for all three targets. These require evidence, not a prose upgrade to 5/5. -->

Ready to implement the bounded experiment. Scaling and claims of world-class equivalence remain gated on its evidence. No implementation tests or paid generation were run during this audit.

## Plan validation

- Answers the request: Goal and scope decisions; first-principles audit; generation-to-family-to-release sequence.
- Answers landed: zero human artwork steps, AI-created anchors/masters/repairs, optional editors only.
- Scope gate: existing four workspaces and generator seams; quality experiment before selector and batch infrastructure; no mandatory new models, training or editor runtime.
- Assumptions explicit: source coverage, expressivity, evaluator validity and performance remain unverified.
- Verification: commands and named required tests above, plus the audit's frozen experimental protocol. Replay differs from stochastic regeneration.
- Document checks: relative links and contradictory acceptance language checked. Source and fixtures are unchanged.
