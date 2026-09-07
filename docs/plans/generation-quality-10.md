# Icon generation: qualification plan

Authoritative implementation and handoff plan, revised 2026-09-07 against commit `27dba01`. This revision supersedes the earlier execution order; historical decisions, failures and receipts remain in `docs/foundry-log.md`. Execution is in progress; completed slices and evidence are recorded below.

## Execution checklist

- [x] 1. Reproducible audit and shared end-to-end deadline, with regression and root checks.
- [ ] 2. Twelve native bicycle, bell and folder outputs with exact replay and audit proofs.
  - [x] Show requested native light/dark proofs during reference selection.
  - [x] Complete six bounded requests and inspect all twelve outputs.
  - [ ] Obtain human optical acceptance before setting defaults.
- [ ] 3. Human label packets, qualified critic and independently measured repairs.
  - [x] Export blind packets of at most 20 images, with image-hash-bound pending label files.
  - [ ] Collect sealed human labels and qualify the critic.
  - [ ] Measure repairs on independent human-classified failures.
- [ ] 4. Classified source failures and 80-output development cohort.
  - [x] Join all 4,357 source receipts and identify the overlap and paint failure classes.
  - [x] Preserve source fill rules and mixed outlined ink; verify all 4,357 files (488 more admitted, zero admission regressions).
  - [x] Fix reproduced compound-trim crash with a compiler revision and regression test.
  - [x] Record per-file retained dispositions for all 438 admission refusals and the remaining 1,009 reconstruction differences under compiler20; unresolved conversion causes remain explicit.
  - [x] Expand open source curves without grid-bar flattening; preserve part recipes through transforms, replay and Boolean subtraction.
  - [x] Reserve author/review time within the original deadline and distinguish late delivery from construction failure in audits.
  - [x] Complete and inspect the four-request compiler20 repair cohort: three review-clear, one incomplete, all failures retained.
  - [x] Resume interrupted finalization only for checked, inspected, unchanged candidates interrupted during finalization; bounded by the original deadline and three-attempt limit.
  - [x] Inspect the additional shared-family-reference native16 repair: continuous body restored, overall needs-repair; independent pass does not override author concerns.
  - [ ] Complete native16 shoulder repair and human optical acceptance.
  - [ ] Complete the 80-output development cohort.
- [ ] 5. Matched model comparison and frozen route.
- [ ] 6. Complete catalog and two novel-family qualification batches.

Current implementation verified: 1,632 engine tests, 128 files, zero skipped; root build/typecheck/check pass. Evidence: `.staging/repair20-final-v4-{build,types,test}.log` and `.staging/repair20-final-v4-check-v2.log`.

Pilot: [12-image audit](../log/native-repair-pilot-2026-09-07/batch-001.png), individual native/light/dark proofs and hash-bound pending labels in that directory. All 12 original SVGs exactly replay; two of six requests are review-clear within budget, four exhaust the 600-second deadline. Native16 acceptance and human craft remain pending. The bicycle paint similarity and folder placement variation remain development concerns, not approved defaults.

Compiler19 source admission: 3,919/4,357 files admitted, 438 refused, 8,144 components; 488 additional files and 1,294 additional components, zero admission regressions. Full source reconstruction remains 4,357 exact replays and 1,010 source pixel differences; these are separate measurements. All 12 pilot SVGs are byte-identical in a separate compiler19 replay receipt. No new generated-output claim attaches to that replay.

Tasks are checked only after their acceptance evidence exists. Human-dependent gates remain pending until actual labels arrive.

## Outcome and definition of done

A requested concept produces a recognizable, well-drawn outlined/filled pair at the requested native size, using automatically retrieved references, constrained editable geometry, honest review and a bounded end-to-end runtime. The user can audit the actual images and reproduce their exact SVGs.

Scope is the whole Blode library and new concepts, not one cloud or a handful of attractive examples. The current inventory is 4,357 source SVGs and 2,221 filename concepts. Both paints at native16/native24 mean **8,884 output slots, or 4,442 concept-size pair requests**. Source inventory, source reconstruction and genuinely generated output are separate populations. Filename concepts are not yet verified semantic families.

“10/10” means every release gate below passes on its declared population, every accepted output meets the safety/craft contract, and remaining failures are explicitly rejected. It is not a promise to draw every imaginable concept perfectly. A small successful cohort cannot qualify the whole library. Do not average away a failed dimension or replace a missing human label with a model judgment.

No public web UI, backward-compatibility implementation, npm publishing, or training from scratch. Historical artifacts and their compiler identities remain immutable. The local CLI and standalone PNG/SVG/JSON audit files are the delivery surface.

## Verified baseline and open gaps

The latest assessment is **6.5/10**, a developmental judgment rather than a blind benchmark. The previous 5/10 judgment is historical. Last verified root build, typecheck and lint/layering pass; engine tests are 1,620 in128files, zero skipped. These results establish tested implementation behavior, not drawing quality.

| Evidence | What it establishes | What remains open |
| --- | --- | --- |
| [Automatic retrieval receipt](../log/automatic-retrieval-2026-09-07.json) | Native semantic discovery and visual selection across three development requests; shield pair review-clear, exact replay,262170ms author/review phase | Human craft labels; broader generation; end-to-end timing including retrieval |
| [Parts generation](../log/parts-generation-2026-09-07.json) | Folder and paired-source shield improved; bicycle still needs repair | Dense counters, bell tangencies, native16 craft and predictable repair |
| [Library progress](../log/library-progress-2026-09-07.json) | 4,357 exact source reconstruction replays;1,010 exceed native source pixel threshold | Source fidelity classification and conversion fixes; reconstruction is not generation |
| [Parts admission](../log/library-parts-admission-2026-09-07.json) | 6,850 components admitted from3,431files;926files explicitly refused | Mixed paint, unsupported semantics and native fidelity; refusal must remain safe |
| `scripts/local-retrieval.ts` | Full family-name discovery, image selection, target/alias/byte-hash exclusions | Candidate images are enlarged previews; no verified family/near-duplicate holdout closure; library input is optional |
| `scripts/local-generate.ts`, `scripts/local-style-run.ts` | Retrieval precedes generation; generation starts a fresh600000ms deadline | Current262170ms does not measure the entire request; supplied deadline is overwritten in `runLocalStyle` |
| `scripts/quality-benchmark.ts` | Immutable manifest, blinded IDs, missing paints retained | `AuditInput` has no pinned revision/master; exporter calls `run(input.program)` with default context and renders one SVG at two sizes; hard-coded20-family population |
| `src/eval/foundry-gate.ts` | Human-label and control qualification gate exists | No real qualified critic; all craft approvals remain false |

The mountain-bike donor selected for bicycle is useful development retrieval, not evidence of unseen bicycle-family generalization. Compact catalogue requests reduced observed initial discovery input from93,939to19,527tokens; retain that measured overhead improvement without calling it a quality uplift.

## Rubric and acceptance populations

Freeze these thresholds and the population before generating results. Report numerator, denominator, missing/failed/uncertain counts and uncertainty intervals. For novel-family statistics, report intervals clustered by family; two small batches do not establish population-wide certainty.

| Dimension | Current judgment | Release gate |
| --- | --- | --- |
| Recognition | 7/10 | ≥95% correct blind recognition in every paint/native-size stratum, with predefined synonyms and distractor/unknown controls. Zero accepted outputs convey a conflicting action. |
| Visual craft | 6/10 | ≥95% of requested outputs approved without manual geometry edits; human median craft≥9/10. Every accepted output approved, with zero unresolved critical slivers, broken tangencies, accidental seams or collapsed counters. |
| Reference/style matching | 7/10 | ≥95% blind family-fit pass in each stratum. No unexplained cap, radius, weight or modifier-polarity violations in accepted outputs. Review both paints together as well as individually. |
| Small-size legibility | 5/10 | ≥95% native16 and native24 pass on light/dark backgrounds. Accepted counters, thin connections and modifiers remain distinct. A24construction rasterized at16 cannot count as a calibrated16master. |
| Geometry/SVG reliability | 9/10 | Every accepted SVG parses, conforms and exactly replays with its pinned compiler/spec/parts. Every reusable component passes source admission. Invalid operations fail atomically; no fake background holes, recipe loss or unsupported semantics silently accepted. |
| Autonomous evaluation/repair | 5/10 | On separate sealed human-labeled controls: approval precision≥95%, critical-defect recall≥90%, decision coverage≥80%; identical/reversed controls fully consistent. Resolve≥80% of human-classified repairable failures within budget on a distinct repair set, with no critical regression. |
| Efficiency/predictability | 6/10 | ≥95% of requests complete within the frozen end-to-end budget; provisional p95≤10minutes per concept-size pair, including retrieval, authoring, review and repairs. All terminal states and usage receipts complete. Report cost per accepted pair, including failed requests. |

Apply the visual/recognition/efficiency thresholds to the completed catalog campaign and independently to each novel qualification batch. All8,884catalog slots must have explicit terminal evidence; missing rows prevent qualification and refusals count against yield. Low error among accepted rows alone cannot hide a pipeline that rejects most requests. Geometry regression covers all4,357source files, including explicitly unsupported conversions; it does not require falsely admitting every source format.

## Execution order and dependencies

Use the existing canonical harness. Do not add another generation implementation. Paths below are relative to `packages/iconsmith/` unless marked otherwise. Each slice delivers code, named regression evidence, actual images where relevant, and a foundry-log receipt.

### 1. Make the next measured run trustworthy

**Trigger:** Parts-based/native-size output can be misrepresented by the audit exporter, and retrieval time is outside the advertised generation budget.

Extend `scripts/quality-benchmark.ts`, `scripts/quality-audit.ts`, `scripts/local-generate.ts`, `scripts/local-retrieval.ts`, `scripts/local-style-run.ts` and their tests.

- Audit inputs identify concept, semantic family, finish, native master, exact revision/spec/parts, original SVG/program and terminal run receipt. Consume the existing `createStyleRevision`, `selectStyle` and `compileStyle` contracts. Preserve the stored original image; replay is a comparison, never a replacement artifact.
- Index expected rows by concept×paint×native master. Read manifest sizes and population rather than hard-coding20families. Reject duplicate/unexpected rows and mismatched hashes/master/paint; missing rows remain visible failures.
- Establish one absolute deadline at the request boundary; propagate it through retrieval, authoring, independent review and repairs. `runLocalStyle` honors an existing deadline instead of replacing it. Enforce remaining time before each external call and after local admission/render work; bounded local work cannot report a late pass.
- Record stage timings plus total wall time, tokens/usage where available, unknown charges and stop reason. Preserve the best candidate on deadline exhaustion and label it incomplete/needs-repair as appropriate.
- For the qualification route, require explicit library configuration and successful retrieval. Preserve pinned-only invocation for controlled comparisons; label its route so it cannot masquerade as automatic retrieval.

**Acceptance:** Offline fixtures reproduce a non-grid, parts-based program under a nondefault master exactly; tampering and absent dependencies fail. A24-only artifact leaves its16master slot missing. A simulated retrieval that consumes the budget prevents author launch; repair cannot reset the clock. Evidence with a late completion cannot pass the latency gate. Existing source/generated images remain unchanged.

### 2. Deliver a native-size repair cohort through that boundary

Depends on slice1. This is the first new generation milestone: **bicycle, bell-pause and folder-lock, each in both paints at native16 and native24: six pair requests, twelve outputs.** Retain the latest shield as a regression/control; do not spend another cohort on its already improved body.

Extend `scripts/local-retrieval.ts`, `scripts/family-parts.ts`, `scripts/reference-proofs.ts`, `src/tools/spec.ts`, `src/tools/proof.ts`, shared `SKILL.md`/packed skill and the existing DSL/geometry modules only when a reproduced failure requires them.

- Show retrieved candidates with native proofs and enlarged context before selecting parts; a96px preview cannot establish tiny counter utility.
- Separate source component fidelity from optical placement suitability. Keep exact admitted donor geometry; define the selected16master's weight, gaps, detail suppression and extents explicitly. Do not weaken admission thresholds just to make a16configuration accept a24donor.
- Measure retained failures first. Bicycle: rear-frame counters and paint distinction. Bell: shoulder/rim tangencies and clapper separation. Folder: body/badge clearance and continuous intended rim.
- Use independently drawn filled/outlined donor boundaries where appropriate. Choose body/counter/modifier/polarity relationships from references; do not enforce one universal filled-paint recipe.
- Try existing primitives, parts, source-preserving curves and explicit Boolean fillets before adding geometry. Add a capability only after a minimal failing DSL fixture proves it is missing. Preserve topology and reject infeasible rounding atomically.
- Keep the failed16contour-tier experiment unchanged. Test its identified0.5tier rejection as a controlled spec change, not as presumed root cause of all native16 failures.

**Acceptance:** Twelve genuine outputs and matching native/light/dark proofs in the corrected audit format, no manual artwork edits, exact replay and all terminal states. Human review must confirm target-counter continuity, recognition, family fit and smooth joins before these specimens establish optical defaults. An unresolved defect remains a failed row. The cohort demonstrates a repair mechanism; it does not by itself prove an80% repair rate.

### 3. Build the human label and qualified repair path

Evidence export can begin after slice1 while slice2 engineering proceeds. Qualification depends on actual human responses.

Extend `scripts/quality-benchmark.ts`, `scripts/local-review.ts`, `scripts/review-construction.ts`, `src/eval/foundry-gate.ts` and `scripts/local-style-run.ts`.

- Export local blind audit batches of at most20images with separate answer keys and editable label JSON. Collect recognition before revealing concepts, then craft rating, family fit, native legibility, critical defects and “ship unchanged”. Human identity and image hashes bind labels to evidence; null is pending.
- Gather at least100distinct canonical labeled stimuli for the sealed critic test, separate from critic tuning, development output and novel qualification families. Include≥20critical defects and enough human-approved examples to exercise the existing≥20predicted-approval gate. Do not count presentation duplicates as independent stimuli.
- Keep identical-image and reversed-order presentations as controls, outside that100-stimulus count. Freeze prompts/thresholds before revealing the critic test labels. A failed test becomes development data; reserve a fresh test for requalification.
- Benchmark repairs on a separate set of at least20human-classified repairable failures across multiple morphology families. Each repair identifies one observed defect, preserves the prior best candidate and rechecks unchanged requirements. No progress, repeated defect, representation gap or deadline ends the run explicitly.
- Only a passing, versioned critic qualification can enable automatic craft approval for that exact instrument configuration. Until then deliver review-clear as pending human audit, never approved. Any instrument/model/prompt change invalidates qualification until retested.

**Acceptance:** Existing `qualifyCraftJudge` gates pass on real labels, not fixtures. Wrong hashes, missing labels, duplicate stimuli, always-approve/always-reject critics and inconsistent controls fail. Repair success is≥16/20 for a20case set, without critical regressions; keep failures in the denominator. Human labels are an external dependency, not a reason to stop independent geometry work.

### 4. Expand from the repair cohort to all library failure classes

Depends on corrected audit/context handling; generation promotion depends on qualified review or explicit human approval.

Use `scripts/library-audit.ts`, `scripts/library-replay.ts`, `scripts/family-parts.ts`, `src/corpus/load.ts`, `src/pipeline/reconstruct.ts` and the existing20-family development manifest.

- Cluster the1,010source-fidelity differences and926admission refusals by actual failure mechanism and affected files. These populations overlap; never add them as independent defects.
- Prioritize the largest class that blocks useful generation. For mixed paint, support explicit component roles only if source paint and native pixels can be preserved. For CSS/transforms/masks/use, implement the specific needed semantics with independent examples, or keep the source reference-only/refused. Do not turn an unsupported source into an approximate admitted donor.
- After each source-conversion fix, rerun all4,357sources against the same source hash in a new directory; report improved, regressed and unchanged files. Every newly admitted component must pass native fidelity with counters intact. Exact replay alone is insufficient.
- Generate the full20-family development cohort at both native masters:40pair requests/80outputs, including the six slice2requests only when compiler/spec/route remain frozen and comparable. Preserve missing/error/rejected rows and stratify by dense details, organic curves, narrow connections, intersecting cutters and asymmetric modifiers.

**Acceptance:** Every source failure is classified with an explicit disposition; zero silently admitted fidelity failures. All80development slots have authentic terminal evidence; visual gates meet target per stratum before opening novel qualification. No source reconstruction counts toward those80outputs.

### 5. Select a route on matched evidence, then freeze it

Depends on trustworthy cohorts and calibrated review. Retain the currently working native author/reviewer as the baseline; no universal “best model” claim.

Use `scripts/local-generate.ts`, `scripts/local-style-run.ts`, `scripts/local-composition.ts` and the existing experiment receipt format. Verify exact currently callable model IDs, auth and costs before a comparison; historical marketing names are not configurations.

- Start with four difficult development concepts under matched pinned retrieval packets, specs, tooling, meanings and total budgets. Compare the baseline against one available challenger. Expand to the20family cohort only for a contender that clears all four cases without critical failures; a fourcase screen cannot establish a winner.
- Evaluate retrieval separately from author model quality. Do not change retrieval packets and author simultaneously then attribute any gain to the author. Assess a proposed improved retriever on the same query/source inventory with useful-component recall and final output evidence.
- Add an image-assisted composition arm only for a demonstrated layout failure. Same downstream DSL and review contract; reference/composition images cannot reach blind recognition or be mistaken for generated SVG output.
- Compare quality first, then total latency and cost per accepted pair including rejected/timed-out attempts. Unknown subscription dollar cost stays unknown; report tokens and time separately. A conditional fallback route needs demonstrated benefit for a named failure class and must share the original deadline.

**Acceptance:** A self-contained comparison supports the chosen route or explicitly says inconclusive. Freeze compiler, master specs, retrieval/index/exclusions, prompts, instrument, models, deadline and spend ceiling before qualification. Fine-tuning remains conditional on repeated residual construction-policy failures after adequate geometry/references/feedback; no training spend without verified access, rights, budget and a held-out uplift test.

### 6. Complete catalog coverage and novel-family qualification

Depends on slices1–5. This stage is substantial work, not a final screenshot check.

- Run the frozen route across all4,442catalog concept-size pair requests in resumable, cost-reserved batches. Preserve8,884terminal output rows. Checkpoint by manifest/request/revision hash; never silently reuse an artifact from a different route or charge a resumed request twice. Retries remain attached to the original request denominator.
- Catalog generation may use related donor families and must disclose reconstruction or near-copy results separately. It establishes supported-library behavior, not unseen generalization.
- Before opening new qualification tasks, seal two disjoint batches of20novel semantic families each. Audit source identity, aliases, close visual/geometry duplicates and prior experiment exposure; exclude the entire family from candidates, style anchors, admitted parts and cached retrieval. An exact-name/hash blacklist alone is insufficient. A mountain-bike donor invalidates a sealed bicycle-family claim.
- Generate both paints/native masters for each batch:80outputs per batch/160total. Score each batch independently; per paint-size stratum a20item batch needs at least19passes to reach95%. Report family-cluster uncertainty and avoid stronger population claims than the evidence supports.
- Export complete PNG/SVG/program/audit receipts, all failures and the per-dimension report. Automatic critic approval requires slice3qualification; human craft/family audit remains necessary for the human-rating gate.

**Acceptance:** No missing catalog rows; yield/quality/latency gates pass for the catalog and both novel batches independently; all accepted geometry passes, all human-label requirements satisfied. A failed opened batch becomes regression data, and a newly sealed batch is required after tuning. Only then update the rubric to qualified10/10.

## Verification commands and observations

Run from repository root. Use fresh output directories; placeholder paths below are chosen and recorded in the execution manifest before invoking a command.

- Slice1: `npm exec -w iconsmith -- vitest run scripts/quality-benchmark.test.ts scripts/local-style-run.test.ts scripts/local-retrieval.test.ts` covers pinned-context audit, native-master denominators and shared deadlines. Add the described scenarios to these existing suites.
- Slice2: `npm exec -w iconsmith -- vitest run scripts/family-parts.test.ts scripts/style-check.test.ts src/tools/boolean-round.test.ts src/tools/proof.test.ts` plus canonical `npx tsx packages/iconsmith/scripts/local-generate.ts <concept> <new-output> --revision <revision.json> --master <native-master> --meanings <meanings.json> --library <source-svg-directory> --library-set blode-icons`. Implementation must expose/record the shared budget before measured runs.
- Slice3: `npm exec -w iconsmith -- vitest run scripts/local-review.test.ts src/eval/foundry-gate.test.ts scripts/local-style-run.test.ts`; real labeled critic/repair receipts are separate required evidence. A test fixture cannot qualify the instrument.
- Slice4: `npx tsx packages/iconsmith/scripts/library-audit-cli.ts <source-svg-directory> <new-audit-directory>` then `npx tsx packages/iconsmith/scripts/library-replay-cli.ts <inventory.json> <new-replay-directory>`. Compare per-file source-hash-bound results and native images, including every refusal.
- Each material implementation slice: root `npm run test`, `npm run typecheck`, `npm run build`, `npm run check`, and `git diff --check`. Current canary1,632tests/128files/0skipped; update legitimate additions in rootAGENTS, investigate skips, and never synthesize the private corpus.
- Final qualification: machine-readable per-stratum numerators/denominators, immutable audit images, labeled craft evidence, critic version, end-to-end timings and reconciled spend. No CLI report can turn missing evidence green.

## Spending, unresolved dependencies and recovery

This plan makes no new provider reservation. Reconcile the live ledger before each batch; the latest recorded state is13.06220785USDconfirmed and11.37126575USDunknown reservations from the earlier round. Native subscriptions are separate, with dollar consumption unknown. Log calls and their actual/unknown cost; no automatic API fallback.

The catalog campaign is not assumed affordable:4,442pair requests at the10minute ceiling represent about740hours of serial wall time before the novel batches. This is an upper-bound workload calculation, not a latency forecast or dollar estimate. Complete the sixpair pilot, measure total stage time and usage, then prepare concrete batch manifests and cost/resource estimates before launching the catalog. Existing budget authorization is not permission to exceed its cap. Reuse frozen qualifying results by exact manifest identity, not by visual similarity.

Unresolved evidence dependencies: human taste labels and native-master acceptance, qualified critic performance, family/near-duplicate exclusion closure, currently callable challenger models, and measured full-campaign resources. None blocks slice1offline engineering. Human labels cannot be fabricated and elapsed time is not approval.

Preserve every original failed attempt and evidence directory. Each compiler/spec change creates a new revision; each experiment uses a new directory. On a regression, revert only the responsible implementation change and keep its failed receipt. Resume batch work only from validated terminal receipts; retain uncertain charges until reconciled. Do not rewrite shared history or require a compatibility layer to preserve evidence.

## Next deliverable

The first implementation slices and twelve-image pilot are delivered. Compiler20 repairs source curve expansion and review time allocation; its four-request repair cohort and additional shared-family repair are delivered with all failures retained. Latest [eight-image audit](../log/native-family-repair-2026-09-07/batch-001.png): three pairs review-clear, folder16 needs-repair after an interrupted second attempt. Shared family parts preserve body topology; automatic per-size retrieval did not. This is mixed-route development evidence, not a matched comparison or qualified route. Collect actual human responses to the hash-bound label packets. Do not open the 80-output development promotion or full catalog campaign on the pilot's two-of-six timely-review-clear result. Continue source classification and repair tooling while labels are pending; critic qualification and model selection still require their declared independent evidence.
