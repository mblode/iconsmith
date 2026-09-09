# Foundry footguns and rat holes

Updated 9 September 2026 through D522 collector integration. Read this to avoid repeating work, not to claim a gate passed. [The plan](plans/generation-quality-10.md) remains the sole checklist; [the foundry log](foundry-log.md) retains every attempt.

## Start here — cheap checks before expensive work

1. Read the current plan status and this section; search the relevant row below. Do not reload the entire history or giant dirty diff on every resume.
2. Establish the exact source delta against the last engineering manifest. If hashes match and only docs changed, do not rerun the full suite.
3. Assign disjoint files and a concrete exit result. Root owns shared docs, campaign integration, freezes and provider dispatch. Workers stop editing after reporting source-stable.
4. Use declared workspace commands. Capture each failed check once; fix the specific cause. Do not run several overlapping full checks while workers are editing.
5. For historical questions, query `ccs` once per relevant project/source, then filter the results locally. Search both `/Users/mblode/Code/mblode/iconsmith` and `/Users/mblode/Code/mblode/icon-forge`.
6. Before repeating an experiment, name its prior failure, the changed variable, and the evidence that makes a retry informative. If nothing changed, stop that arm and continue independent work.
7. Before provider dispatch, verify current route identity, exposure, original deadline, STOP, quota, disk floor and reservation. An ambiguous charge is not permission to retry.
8. After source-stable scoped checks, freeze once and run the plan's integrated commands sequentially. Preserve failures in separate attempt directories.
9. Report one result: what changed, what passed, what remains open. Link evidence; do not paste transcripts or repeatedly narrate unchanged progress.

**Current boundary:** D522 is an engineering source closure: 2,614 Iconsmith tests / 183 files plus 10 runner tests / zero skips. Parent author provenance requires recursive inspection, exact compiler replay and regenerated proofs. It grants no independent approval or production qualification. Mini v3 dispatch is retired; Claude remains quarantined. No phase is visually qualified. These figures are dated observations, not evergreen defaults.

## Run a verification wave

1. From the repository root, run the narrow test first: `npm test -w iconsmith -- scripts/local-structured-author.test.ts`. A typo now fails. Use the workspace cwd for scoped Ultracite.
2. Wait until all owners report source-stable. Run `npm run check:foundry` for the cheap root configuration guards.
3. Run `npm run verify -- --out .staging/verification-next` once. It serializes test/typecheck/build/check/diff, preserves logs and source hashes, refuses an existing output directory or active lock, and fails on source drift. It does not skip tests based on an old green receipt.
4. Read `receipt.json` in the chosen output directory and only the failed stage's log. Fix the named failure; use a fresh output directory on retry. A surviving lock after a crash requires checking `.staging/.verify.lock/owner.json` and any child process before manual removal; the runner never steals it.
5. Local verification requires the six private-corpus/cache predicates behind the thirteen gated tests. CI uses `--allow-missing-corpus` and records missing measurements explicitly; that flag grants no foundry qualification. Sibling-source and retained-image skips remain separate.

## Execution and token waste

| ID | Trap / observed failure | Do instead; condition for revisiting |
| --- | --- | --- |
| F01 | Repeated giant worktree diffs mix this wave with hundreds of shared changes. | Preserve shared work. Compare the named source manifests and inspect only owned files. D499's actual delta is14 changed/3 added, not the entire dirty diff. [D499](log/wave-fg-integrated-verification-2026-09-09.json). |
| F02 | Worker typechecks race concurrent edits; failures get called “baseline” without a baseline. | Attribute errors to the current wave, route exact diagnostics to the owner, and require source-stable before integrated checks. Preserve correction of the mistaken baseline label. [D495](log/wave-fe-terminal-acceptance-bridge-integration-2026-09-09.json), [D497](log/wave-ff-raster-feasibility-result-2026-09-09.json). |
| F03 | Full suite reruns for documentation or unchanged sources waste time and output. | Hash-check first. Material runtime/evaluator/compiler changes need scoped checks then sequential integration; docs-only changes need links/diff checks. D493 correctly reused D488; D499 needed a new run. [Handover](plans/iconsmith-handover-2026-09-09.md). |
| F04 | Tiny edits followed by many overlapping validation runs obscure which revision passed. | Batch coherent edits; run one scoped check after stabilization. Repeat only for a changed source, a failure or a named unresolved concern. D494–D499 had avoidable concurrent check churn. |
| F05 | Frequent polling, rereading unchanged outputs and repetitive updates consume tokens without resolving uncertainty. | Keep process/session IDs; wait for completion events or bounded useful intervals. Inspect the failure excerpt or compact result, not the full log. Updates should report a new finding or decision. |
| F06 | Treating worker prose or a reconstructed transcript as raw verification evidence. | Attribute worker-reported checks; root captures actual command output, exit codes, source hashes and before/after freeze. D499 is the integrated evidence; earlier worker reports are scoped. |
| F07 | Creating another checklist/dashboard/handover that drifts from the plan. | This file stores lessons only. Update the sole plan and append receipts. Historical dashboard v16/index v27 are dated views, not active authority. [D493](log/wave-fc-session-handover-audit-2026-09-09.json). |
| F08 | Reopening a closed mechanism from old nested “open” prose, or carrying old closure across changed code. | Read corrections chronologically. D405/D420 supersede older notes for their identity; D473 explicitly reopens affected current-route tasks. [D473](log/wave-eh-current-route-revalidation-2026-09-09.json). |

## Checkout, tooling and evidence

| ID | Trap / observed failure | Do instead; condition for revisiting |
| --- | --- | --- |
| F09 | Moving, replacing or synthesizing the private corpus makes tests meaningless. | Keep `packages/iconsmith/corpus`. A cloud checkout must honestly skip. A manufactured substitute measures a different population. [Root rules](../AGENTS.md). |
| F10 | Using total tests as the missing-corpus canary. | Missing corpus still collects13 tests: check skips. At D499, missing corpus alone means2,529 pass/13skip out of2,542. Sibling-source and retained D492-image skips are separate. Update totals/files together. [Root rules](../AGENTS.md). |
| F11 | Bare `corpus/` ignore hides `src/corpus`; wrong root ignore can stage62,550 SVGs. | Preserve the exact anchored `/packages/iconsmith/corpus/` ignore. Do not “simplify” it. [Root rules](../AGENTS.md). |
| F12 | Turbo cached tests cannot account for ignored private corpus bytes. | Keep test uncached. A cached green result is not corpus validation. [Root rules](../AGENTS.md). |
| F13 | Root `npx vitest` fails because Vitest is workspace-local. | Use `npm test -w iconsmith -- <test paths>` or run `npx vitest` from `packages/iconsmith`. Preserve D495's failed invocation; do not install another test tool to fix cwd. [D495](log/wave-fe-terminal-acceptance-bridge-integration-2026-09-09.json). |
| F14 | Root `npx ultracite` has no config; moving lint dependencies into workspaces breaks imports. | Run scoped Ultracite from the owning workspace; use root `npm run check` for integration. Keep lint dependencies at root and oxlint pinned as documented. [Root rules](../AGENTS.md). |
| F15 | Assuming all workspaces exclude Markdown; broad autofix rewrites unrelated prose. | Package Markdown is formatted; app Markdown is ignored. Scope fix to owned files and review reflow. Fresh CCS also recovered this warning from session337abb49. [Research history](project-research-history.md), [root rules](../AGENTS.md). |
| F16 | Exact-byte test conflates Buffer identity with a Uint8Array contract. | Preserve byte equality using the declared representation. EN defensive copying exposed this in the offline Claude test; only the expectation changed. Do not remove defensive copies or weaken byte checks. [D498](log/wave-fg-integration-buffer-expectation-correction-2026-09-09.json). |
| F17 | Helper shadows an existing digest or uses canonical-JSON hashing for raw bytes. | Name hash domains explicitly. Raw files/programs use SHA256 of actual bytes; canonical objects use their specified serialization. D494 root lint failure and intent/selected hash corrections are retained. [Early checks](../.staging/wave-fg-root-integration-2026-09-09/early-checks.json). |
| F18 | `EADDRINUSE` leads to repeatedly starting another Studio server. | Inspect the listener and checkout/port ownership before restarting. Do not kill an unrelated process. Fresh CCS confirms port3210 failures in session2ad0e3d5; it does not establish today's listener state. [Search index](log/wave-fh-footguns-ccs-index-2026-09-09.json). |
| F19 | Searches use display label `icon/forge`, or repeat the known Cursor timestamp crash. | Use actual legacy path `icon-forge`. Historical `Invalid time value` was handled by read-only `loadMessages`, retaining94 null timestamps. Do not modify source history or repeat that failing loader without a reason. [Recovery protocol](project-research-history.md#coverage-and-reproducibility). |
| F20 | Search counts or old assistant prose become “verified research.” | CCS prompt records are discovery leads; cross-check receipts/source. Fresh912 prompt records are not the historical7,874-message recovery population. Deleted/compacted/missing history remains outside guaranteed coverage. [Research history](project-research-history.md). |
| F21 | Reusing output directories overwrites failed evidence; disk pressure invites cleanup of originals. | Fresh immutable attempt directories; retain raw responses, dispatch intents and failure logs. Check2GiB floor before dispatch; never delete private evidence to make a call fit. [D498](log/wave-fg-integration-buffer-expectation-correction-2026-09-09.json), [handover](plans/iconsmith-handover-2026-09-09.md). |
| F22 | Reintroducing npm release metadata to make the CLI feel complete. | Package remains private/unpublished; harness symlink provides CLI access. No version/bin/files/changesets/publishing work without a new explicit task. [Root rules](../AGENTS.md). |

## Runtime, accounting and authority

| ID | Trap / observed failure | Do instead; condition for revisiting |
| --- | --- | --- |
| F23 | Green child exit, serialized receipt or exact reconstruction is treated as authority. | Verify parent intent, settlement, original deadline, selected tree and recursive evidence. Keep `authorEvidenceVerified:false` until production authority is actually established. D496 only adds structural replay. [D496](log/wave-fd-inspection-recursive-replay-integration-2026-09-09.json). |
| F24 | Hashing a trace is confused with semantically verifying what the model saw/did. | D496 reparses settled final stdout and checks mappings, but raw trace events are only retained/hash-verified. Do not promote that result to production authority. [Runtime boundary](../.staging/wave-fd-runtime-2026-09-09/receipt.json). |
| F25 | Missing selected artifact is relabeled “nothing produced,” hiding invalid child output. | Retain rejected child bytes; use production-unknown. Preserve both requested slots and null unavailable evidence. Unstarted alone has no issued intent/deadline. [D479](log/wave-ep-terminal-acceptance-bridge-design-2026-09-09.json), [D495](log/wave-fe-terminal-acceptance-bridge-integration-2026-09-09.json). |
| F26 | A JSON copy of a capability or self-declared qualification becomes trusted. | Consume live process-local capabilities synchronously; reject copied, expired, rebound, duplicated and mutated evidence. Caller-frozen expected hashes are comparisons, not authority. [D495](log/wave-fe-terminal-acceptance-bridge-integration-2026-09-09.json). |
| F27 | Resume, cold start, repair or nominal1ms retries reset the clock. | Pass one parent absolute deadline; charge preparation, all calls, settlement and export. Check reserve before dispatch, not after the work. [D405](log/wave-ca-runtime-state-budget-resume-closure-2026-09-09.json). |
| F28 | Process-group observation is called detached-descendant containment; killed candidates become salvage success. | Use the verified owned/container boundary and prove quiescence before hashing. Salvage also needs complete ancestry, finalization and independent review inside the original clock. [Plan P1](plans/generation-quality-10.md#p1--make-one-complete-real-request-trustworthy). |
| F29 | Repair destroys prior-best evidence; uncertainty triggers redraw; missing paperwork triggers geometry work. | Restore exact prior program and its inspection on failed repair. Route uncertainty to bounded evidence clarification and paperwork to finalization. [D329](log/wave-be-runtime-collector-integration-2026-09-08.json), [D309](log/wave-ar-uncertainty-shared-packet-integration-2026-09-08.json). |
| F30 | Native usage is called free, stale quota reused, or unknown charges silently dropped. | Subscription dollars remain unknown. Recheck quota/disk; preserve actual, usage-rated, reserved and unknown amounts separately. No reset without authorization; no ambiguous-dispatch retry. [Current ledger](log/api-budget-after-d514-live-2026-09-09.json). |
| F31 | Reusing the quarantined Claude route or copying credential details into evidence. | Rotation confirmation is required before reuse; sealed Claude inspection is unsupported. Record incident identifiers and status only, never secret values. [Quarantine](log/wave-ai-claude-credential-quarantine-2026-09-08.json). |

## Geometry, evaluation and false wins

| ID | Trap / observed failure | Do instead; condition for revisiting |
| --- | --- | --- |
| F32 | A stricter topology gate sounds safer but rejects valid source families. | Keep the failed501-admission-regression experiment. Require source-population regression evidence before adopting a new rule. Compiler22 failure is also historical, not erased by later success. [Wave A](log/wave-a-integration-2026-09-08.json), [compiler22](log/wave-z-compiler22-source-regression-2026-09-08.json). |
| F33 | Axis scaling is used as contour offset; computed curve intersections are grid-snapped. | Scaling changes shape; offset/stroke expansion and Boolean subtraction solve different problems. Keep host-derived curves/intersections and reproduce gaps with existing DSL before kernel changes. [History H010/H011](project-research-history.md#recovered-decisions-and-corrections). |
| F34 | Filled paint is always mechanical outline expansion; off-axis source craft is “fixed” away. | Preserve measured solid/detail roles and active house curve policy. Consult current source/spec, not obsolete outline-only prompts. [Wave A](log/wave-a-integration-2026-09-08.json). |
| F35 | Add overlapping source refusal and raster-difference counts as disjoint failures. | D483 overlap352, union1,052. Report distinct replay, admission, raster fidelity and visual findings with source population attached. [Handover](plans/iconsmith-handover-2026-09-09.md). |
| F36 | High similarity, source-exact reconstruction or a host fixture establishes novel-generation craft. | Keep keyed reconstruction separate. Compiler25 does not turn Sunburst pixels into editable geometry. Exact replay proves a program property, not meaning or quality. [History H006](project-research-history.md#recovered-decisions-and-corrections), [D497](log/wave-ff-raster-feasibility-result-2026-09-09.json). |
| F37 | Embedding gain or an easy semantic control substitutes for a craft instrument. | H002's scalar gain was discarded without structural checks; DINO style AUC≈0.476 was rejected. Easy judge controls do not qualify subtle spacing/weight defects. Require the frozen critic protocol. [History H002–H004](project-research-history.md#recovered-decisions-and-corrections). |
| F38 | Better scores come from suppressing strict reviewers, offsets, exposed controls or lineage overlap. | No score patching or recycled sealed samples. All author/repairer/evaluator lineages must meet exclusion rules. P3.6 code exclusion exists; the eligible four-lineage roster and qualifying evidence remain open. [Plan P3](plans/generation-quality-10.md). |
| F39 | Missing ratings, absent output or uninspected cases disappear from denominators. | Keep every requested slot, critic coverage and null missing values. Separate natural/generated/control populations and probability samples from flagged supplements. [D495](log/wave-fe-terminal-acceptance-bridge-integration-2026-09-09.json). |
| F40 | Family classification, a scaffold or one delivered pair is catalog completion. | Census rows are not qualified families; historical200-item backlog had197todo. Full catalog/unseen gates require terminal populations and sealed audits, not dashboard counts. [History H008/H012](project-research-history.md#recovered-decisions-and-corrections). |
| F41 | Tune the model/train from scratch before diagnosing geometry, delivery and critic failures. | Training remains conditional on T1–T5 and separate budget. Require a recurring qualified failure that survives current geometry/retrieval/repair first. [Plan training gate](plans/generation-quality-10.md). |

## Image-model experiments

| ID | Trap / observed failure | Do instead; condition for revisiting |
| --- | --- | --- |
| F42 | Metadata GET404 means generation access is unavailable. | D490/D492 Sunburst generation POSTs succeeded. Exact requested API ID was `gpt-image-2.5-sunburst`; response did not echo immutable model identity. Flare generation is untested. [D492](log/wave-fb-images25-transparent-result-2026-09-09.json). |
| F43 | Prompting for transparency is enough; checkerboard pixels are alpha. | Explicit background parameter plus actual alpha/dimension inspection. Preserve D490's opaque failure. Product family names are not model parameters. [D493 handover](plans/iconsmith-handover-2026-09-09.md). |
| F44 | Built-in tool output, direct Sunburst and Studio Google sketches form a matched comparison. | Keep provider identity/protocol separate. Built-in model unverified; tiny development boards are uncalibrated. Equalize total candidate/selector/reader/author/reviewer cost and clock before comparison. [D492](log/wave-fb-images25-transparent-result-2026-09-09.json). |
| F45 | Fixed-quadrant downsampling establishes native optical masters, topology or house parity. | Crop padding/resampling confound craft; threshold topology is diagnostic. No house references were supplied. Judge actual constrained16/24 masters, both paints/surfaces, under a frozen protocol. [D492](log/wave-fb-images25-transparent-result-2026-09-09.json). |
| F46 | “No converter exists” leads to a parallel vectorization pipeline; swapping model constants is called integration. | Reuse `propose.ts`, `compose.ts` and local paired sketch inputs. Canonical transport, licensing, usage, STOP/budget/deadline controls still need work. Existing Studio defaults stay until evidence supports change. [D493](log/wave-fc-session-handover-audit-2026-09-09.json). |
| F47 | Offline connected-component refusal excludes the model-backed reader or Sunburst altogether. | D497 only ran `compose(model:null)`. One connected block failed the declared two-block hypothesis. Studio's model-backed semantic reader/selector/drawer was not exercised. [D497](log/wave-ff-raster-feasibility-result-2026-09-09.json). |
| F48 | Synthetic editable replay is described as preserved raster meaning or “outlined” visual quality. | Inspect the render: D497's narrow rectangles look solid despite outlined declaration. Block-to-op indexes prove coverage only. Keep diagnosticOnly true and qualificationEligible false. [Visual correction](../.staging/wave-ff-raster-feasibility-2026-09-09/receipt-correction-2.json). |
| F49 | Broad Flare/Sunburst tournament before useful constrained conversion; stale per-image pricing used for token billing. | First demonstrate one useful final DSL result under canonical controls. Then a predeclared cohort, equal full budgets and exact models. Use reported usage under the applicable price schedule; never infer catalog cost from a four-crop sheet. [Handover](plans/iconsmith-handover-2026-09-09.md). |

## Enforcement status

[D504 maps every original F01–F49 entry](log/wave-fk-footgun-enforcement-audit-2026-09-09.json) to existing enforcement, a concrete guard gap or an evidence/operator requirement. The log records failures; the plan alone tracks qualification. [D505](log/wave-fk-architecture-hardening-result-2026-09-09.json) closes the F10/F21 code gaps identified by that audit. Runtime trace consolidation, required corpus preflight, disk admission and configuration checks are integrated; the runner also enforces exclusive execution, fresh output and source stability for F01/F03/F04/F06/F21. No source edit can certify a licensed exposure, credential rotation, optical craft or a frozen critic population without its evidence.

## Corrections and enforcement — D502–D505

F24: D502 now reparses retained native trace semantics with the same validator used by both adapters. Model/session, attachment multiplicity/order, forbidden tools and final settled answer are bound. Production authority remains false; D505 integrated verification passes.

| ID | Trap / observed failure | Do instead; condition for revisiting |
| --- | --- | --- |
| F50 | Assuming the first user message in a native trace carries the images rejects real startup preambles. | Bind the sole image-bearing user message, with exact hashes/order and one terminal assistant answer. Reject malformed or duplicate output instead of filtering it away. D502 retains the trace paths and hashes. |
| F51 | `--passWithNoTests` makes a typo in a focused test path report success. | Removed from the iconsmith test command; an intentional nonexistent-path control must exit nonzero. Use `npm test -w iconsmith -- scripts/<name>.test.ts`. |
| F52 | Mixing root-relative file preparation with a workspace-cwd lint command fails before verification starts. | Run root preparation and workspace lint as separate invocations with explicit cwd. D503 retains the initial failure; the canonical runner removes repeated command assembly. |
| F53 | Assuming the installed TypeScript package exposes the historical compiler JSON API fails at runtime. | Use the explicitly declared existing `jsonc-parser` for JSONC configuration. D503 retains the failed API attempt and passing replacement; no homegrown comment stripper. |

## Search provenance and maintenance

D500 used fresh `ccs --no-input --output json --list --limit 100000 --source claude --source codex --project <path>` on both project paths, plus a targeted `failed` search. It returned713 current-project prompt records/209 sessions and199 legacy records/7 sessions. Twenty local terms were scanned; counts and session IDs are in the [CCS index](log/wave-fh-footguns-ccs-index-2026-09-09.json). Raw prompt bodies and credentials were not copied into this log. Fresh Cursor history was not loaded; its older read-only recovery remains in the [research history](project-research-history.md).

This consolidates material recovered traps, not every sentence of inaccessible or compacted history. Historical claims retain their source boundaries. Append a new row or dated correction when a new failure occurs; do not rewrite original receipts. Before a repeated experiment, cite the applicable row and state what changed. Before opening more history, search this file by symptom or ID.


### D507 runtime prerequisite correction

- F54: Frozen Docker executable bytes do not prove a running daemon. An absent OrbStack socket caused empty failed inspect output to be parsed as JSON and hid the root error. Check runtime availability before dispatch; preserve phase/exit diagnostics and unknown containment. Starting OrbStack later does not retroactively settle the failed call. [D507](log/wave-fl-e2e-score-qualification-assessment-2026-09-09.json).
- F26/F27: Context setup can throw after native intent reservation but before a started receipt or normal terminal. STOP; retain unknown accounting and use the existing settlement validator with its exact intentHash/deadlineAt/container envelope. A free-form diagnostic object is refused. Do not infer free or completed calls from missing receipts.
- F53 addendum: The installed TypeScript package also lacks the historical ScriptTarget/transpileModule surface. For a staging runner syntax check, use `node --check <runner.mts>`; do not recreate a compiler API shim.

- F38 chronology correction: Mini v3 was actually called in D376 and refused `read_mcp_resource`. D362’s earlier “uncalled” note is superseded. Search the exact model/profile through its later result/refusal before reserving any repeat; v3 goals disabling is not a new changed variable now. Root missed this during D506 preflight; Docker setup prevented an actual reviewer result. [D376](log/wave-br-mini-v3-capability-result-2026-09-08.json).

F54 engineering correction: D508 now checks failed/killed inspect status before JSON parsing and preserves phase/exit/hash diagnostics; the actual failure regression and full sequential verification pass. This does not add daemon auto-start, runtime availability admission, production authority or a retry. [D508](log/wave-fl-e2e-prerequisite-integrated-result-2026-09-09.json).


### D510 — authority binding and retired reviewer enforcement

- F23/F26: A selected tree hash and verified inspection trace did not prove that the selected SVG came from the inspected program or that its proof showed that SVG. The parent now requires exact current-compiler artifact replay and regenerates both optical proofs before issuing its live author-provenance capability. It checks the entire report again after asynchronous rendering and at consumption; serialized flags cannot substitute. Author provenance still grants no independent approval or critic qualification.
- F26/F54: Context-preparation exceptions after allocation now use the existing settlement callback automatically, retaining failed/unknown/unproven evidence and STOP observation. They do not assert container absence, provider non-dispatch or zero charge. D506 remains unresolved historically.
- F38: The exact pinned CLI has no verified supported global tool-catalog disable; `tools.state=disabled` is an unknown silently ignored setting. Mini v3 is retired at route configuration before reservation or author cost, and at direct reviewer dispatch before allocation. Historical manifest/trace parsing remains. A replacement needs an explicitly frozen, offline-verified capability change; no fallback or dropped reviewer. See the [isolation receipt](../.staging/wave-fm-reviewer-isolation-2026-09-09/receipt.md).
- F52 recurrence: One root-relative Python edit was mistakenly run from the workspace cwd and failed with FileNotFoundError; no file was changed by it. The corrected workspace-relative edit is reflected in D510. Keep filesystem edits separate from workspace lint commands.
- F55: Strict realpath evidence checks correctly reject macOS temporary-directory aliases. The first real-render campaign fixture passed `/var` instead of canonical `/private/var`; it failed before provenance issuance. Normalize fixture paths rather than weakening production link rejection. The failed focused log is retained.
- Formatting repairs can sort keys after their first formatting pass. Retain the first diagnostic, finish the reported source correction, then run the canonical integrated check once stable. Do not repeat full suites to discover a scoped formatter error.

### D511 preflight corrections (offline; result pending)

- **Frozen base versus applied retrieval revision:** `local-generate` authors against the revision produced by retrieval. Replaying only the base revision safely refuses genuine retrieved drawings. Reapply the exact plan-frozen family packet with `applyFamilyReferencePacket` before restricting the master; bind packet file SHA, internal hash and concept. Automatic retrieval needs its own verified selection chain and remains outside this authority bridge.
- **Optional identity pairs:** supplying a concept without its family packet correctly fails the helper contract. Root now supplies both together; retain the failed 79/80 scoped result in `.staging/wave-fn-scoped-failure.json`.
- **Actual API request versus SDK arguments:** a tools-free input object does not establish what the SDK sent. Seal the serialized transport body against the frozen prompt, schema, model/provider and ordered PNG bytes; reject added tools, remote URLs or external context. Terminal acceptance must revalidate the owned image file after inference and metadata. D511 evaluation correction is pending verification.
- **Working-directory relapse:** one root-relative edit was attempted from the workspace and failed before writes. Use absolute repository paths inside edit scripts; keep workspace cwd only for workspace commands. Do not couple path assumptions to a later formatter's cwd.

The next folder-lock dry run uses a fresh ordinary-DSL compiler25 base and the explicit Astra/GPT-5.5/Sol development roster. Two requests were scheduled without dispatch. Historical compiler24 inputs, D510 engineering success and the dry run do not establish a current live result or a qualified score.

D512 verifies the D511 corrections above: 2,575 total tests, zero skips, stable source manifest. The API seal uses the pinned SDK contract for `result.request.body`; it does not establish an immutable upstream model revision. [Result](log/wave-fn-offline-integration-result-2026-09-09.json).

### D513–D514 live lessons

- Reuse `snapshotSources` from `scripts/verify.mjs` for drift checks. Its symlink hash binds target text, a NUL and referent bytes. Two ad-hoc interpretations falsely reported drift before dispatch; canonical reuse passed.
- A four-slot scheduled slice can sit inside an 80-slot frozen manifest. Keep all 40 pair terminals: D514 has one delivered, one incomplete and 38 unstarted. Never silently narrow the qualification denominator to the dispatched successes.
- An uncertainty in an unchanged paint can become an observed defect after another paint is repaired. Preserve both inspections; do not suppress the stricter review or call successful repair of one paint a paired approval. D514's filled tip improved while outlined key clearance remained rejected.
- The old interrupted-salvage staging runner cannot gain current authority by updating hashes: it needs the current canonical terminal capability and deterministic replay. Current preparation is offline only.
- Status output should select bounded fields. Never dump parent settlement stdout, full native traces or giant review objects merely to check progress. D513 uses `.staging/wave-fn-p1-preparation-2026-09-09/status.py`.

### D517 — diagnostic plans without circular authority

- A prelaunch plan cannot freeze its own derived request ID or a parent deadline that does not exist yet. Freeze static campaign/target/revision/packet/route identities; bind actual request/deadline/reservation inside the child before native allocation.
- Expiry belongs to dispatch admission, not structural receipt reading. Otherwise a completed diagnostic becomes impossible to replay after time passes. Reject expired new dispatch and expiry beyond the original clock; retain immutable evidence access.
- macOS temporary paths can resolve through `/var` to `/private/var`. The owned-file guard correctly refused the first campaign diagnostic fixture; use `realpathSync` for new fixture paths, never weaken the guard. Retained first failure: `.staging/wave-fq-campaign-tests-1.log`.
- New control branches exceeded campaign lint complexity. Extract the diagnostic configuration/validation boundary, scope autofix to owned files, and preserve lint failures; do not suppress complexity or rerun the full suite to discover scoped lint errors.
- Broad tool-name/description searches can accidentally return every connector mentioning code/search. Match the exact desired tool/plugin name and cap output; the post-compaction discovery dump was unnecessary because CCS had already been used.

- A private WeakSet is not authority if an exported mint accepts arbitrary descriptors. Issue through the validated canonical plan only. The interruption trigger must be immutable evidence joined to settlement, not just a side-effect log. D517 independent review caught these older-helper gaps before freezing or live dispatch.

- A passing focused suite does not prove a new branch ran. D517's68 factory/structured tests covered child trigger guards but initially had no interrupted parent-replay positive fixture. Require one real collector-chain replay and targeted mutation refusals before calling the recursive join verified. Check the test path, not just its count.


### D519: create the fresh output parent before execute

Campaign dry-run does not create output directories. Execute creates the campaign leaf exclusively, so a missing parent fails before the dispatch loop. Create the new parent during preparation, retaining the campaign leaf for the runner. D519 retained the ENOENT attempt and proved zero dispatch/capability issuance before a separate launch attempt; do not treat every process failure as permission to retry a provider.


### D520: recovery and review certainty are separate results

A contained interrupted author can pass exact recursive replay while independent AI reviewers remain uncertain about native optics. D520 recovered after the diagnostic trigger and settled seven calls within the original clock, but the pair remains incomplete. Do not count recovery as craft approval, repeat unchanged clarifications, or replace unavailable scores with a delivery percentage. The single-PNG Google noun probe also cannot supply a five-answer critic/panel collector record; its adapter proposal remains offline and unqualified.


D520 settlement naming: `killed:false` describes the host attach-wrapper supervisor, while a separate capability-owned trigger proves the successful diagnostic Docker kill. Numeric container exit137 with signalnull is consistent. Use the bound trigger plus container-absent/quiescent settlement; do not overwrite the raw flag or infer a failure from its name alone. See `log/wave-fs-canonical-salvage-audit-2026-09-09.json`.


### D521 integration lessons (verification in progress)

- A single-use API capability must be consumed by the qualifier, inside the runtime callback. Journal assembly only rehashes the sealed summary's file bindings; consuming the verifier to write a journal exhausts authority before qualification. Root orchestration tests explicitly reject that extra verifier call. A journal or mocked positive test cannot grant authority.
- F52 recurred: a root-relative Python edit ran from the workspace cwd and failed before writing. The following formatter exited successfully, so its exit code did not describe the edit. Run edits and checks separately with explicit cwd; the corrected edit and 61 passing focused tests are retained in `.staging/wave-fu-google-collector-root-2026-09-09/`.
- Root scoped lint initially caught complexity, formatting, then parameter reassignment. Extracted descriptor preflight and snapshot input into a local constant; no suppression or relaxed check. Logs `scoped-fix-1.log` through `scoped-fix-4.log` preserve the sequence.

- A one-stage validator test does not cover full hybrid qualification. Require sequential API callbacks, expiration of their original proofs, final collector assembly and post-append mutation controls before calling that handoff integrated. The assembly retains authority in process, revalidates bytes at finalization and cannot be reconstructed from JSON.
- A worst-case per-call reservation multiplied by100 is not a measured cohort price. Simultaneous reservations may exceed the cap while reconciled sequential waves fit. Forecast actual total usage and peak outstanding reservation separately; never assume released funds or cheaper tokenization before settlement.

- Runtime evidence bindings use absolute canonical paths; collector journals use paths relative to their own root. Compare resolved canonical identity plus hashes, not the raw JSON objects or hashes alone. A mocked bridge fixture using the same relative paths on both sides concealed this integration failure; retain a Root-shaped absolute/relative fixture.
- After incremental collection, revalidate original ordered attachment files as well as the six evidence files. An unchanged descriptor hash does not prove the files named inside it stayed unchanged.

- Collector fixtures must fit the runtime protocol: five answers for one candidate per API stage. Grouping four candidates into a mocked stage can falsely pass a bridge while the real runtime refuses its20 answers. Use one stage per candidate, including the sequential100-stage orchestration control.
- Final evidence revalidation must retain runtime ownership checks, including `nlink === 1`; matching bytes and canonical paths alone do not exclude a hardlink introduced after append.


D523 house comparison: matching concept names do not imply identical house shapes (bell/cloud differ between blode-icons and Central). Keep targets separate; label24px-to16px renders as scaled references. Reference boards with no generated candidates cannot establish provider quality. Quiver sign-in blocks the live comparison; no blind retry, provider spend or invented score. Initial guessed licence path was corrected to `src/pipeline/licence.ts`.


D525 Quiver: valid credentials and a200 model listing do not establish a funded generation route. First generation returned402 insufficient_credits; app credits and API credits are separate. Stop without retry, release unused reservation and retain reference exposure even on rejection. Never call a reference-only board a completed comparison.

## Public repository audit — 2026-09-09

- A visibility change exposes more than the current checkout. Include fetched PR heads, review text, and available Actions logs. Record unavailable logs explicitly. Cursor action links can contain encoded encryption material; inspect without redeeming links, and distinguish that finding from account credentials.
- Evidence hashes and lock UUIDs triggered generic secret detectors. Use field-shape plus path exceptions, retain the default detectors, and prove real credential controls still fire inside excepted paths. Never allowlist the entire evidence directory.
- Runtime admission of paid reference artwork and existing MIT distribution do not establish redistribution permission. Review historical asset bundles and font binaries separately from ignored corpus files.
- A public clone lacks private cached inventory and sibling source artwork. Skip only exact-data measurements when inputs are absent; run portable controls and verify the measurements still execute with real data. Never manufacture a substitute corpus.
- Audit snapshots need an explicit cwd before verifier startup. Stop only verified audit-owned workers before removing their stale lock. A narrowed single-worker pass does not erase an earlier default-worker full-suite failure. See the public-readiness receipt for retained attempts.

### CI verification evidence — 2026-09-09

A verifier that retains immutable stage logs only on an ephemeral Actions runner can fail without exposing the cause. Public-readiness run 34323499722 reported only failed-stage and a runner-local path. CI now uses a known output directory and always prints its stage logs and receipt, including on failure; the verifier's pass/fail behavior is unchanged. Do not infer the failed test from an earlier local run.


### Public clone fixture portability — 2026-09-09

Author-absolute library paths can survive a local green suite and fail every public runner. Resolve the real sibling library, explicitly gate exact-source measurements, and prove both present and absent cases; never invent replacement artwork. A cleanup fault-injection fixture must keep its owner alive long enough to observe descendants and attempt the injected signal. Repeated full-population validation inside one assertion group can exhaust the test timeout; reuse only within the same candidate mutation state, preserving all checks. Use Node24 for CI parity, and check disk headroom before installing another dependency tree on a host with a two-GiB guard. Keep incomplete and failed attempts separate from successful evidence.
