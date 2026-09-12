# Iconsmith: simpler onboarding and evidence-led generation

Date: 2026-09-12. Status: implementation and live onboarding verified; npm release awaits account two-factor authentication. This file is authoritative for this simplification proposal; it does not promote or replace the qualification gates in `generation-quality-10.md`.

## Outcome

An agent user installs the skill, asks for an icon in the Blode family, and receives an SVG with native previews and an honest review status. No repository clone, source build, internal file-path prompt or private corpus is required. The agent uses a small packaged CLI for references, checking and rendering. Existing user preferences favor skill + npx distribution, testing direct SVG, and letting quality determine pruning within the previously recorded $50 experiment ceiling.

Product value is reliable extension of an existing icon family. Raw SVG generation alone is increasingly available from the model. Keep code that measurably improves family fit, semantic correctness, iteration or delivery.

## Evidence and decisions

- `README.md` requires Node >=24.11, git clone, npm ci, a build, and a prompt naming `examples/starter/AGENT.md`. That brief requires two authors and two reviewers. The engine package is private and has no version, bin or files metadata. npx installation is a proposal, not an existing capability.
- The retained September 10 comparison reports 5/10 usable for DSL self-inspection and critic repair, versus 0/10 single-pass. These are exposed development concepts with uncalibrated AI judges, not a reliable population estimate.
- `.staging/astra-direct-svg-2026-09-12/arm-b/usage.json` now records two repair rounds for all ten concepts. Arm B is no longer merely running. No `blind-review-b.json` was found. A fresh CLI lint of all ten SVGs produced zero errors and two centering warnings, on database-backup and list-filter-plus.
- Arm A's retained panel has four null responses across three icons. Its scorer reports 0/10 usable and 5/10 semantic matches; missing reviews remain in the denominator but are not negative aesthetic judgments. Equal observed counts do not establish statistical equivalence.
- The experimental `run-b.mjs` catches checker/JSON failures and returns an empty issue list. Its logged issue count precedes each repair, not the final output. Fix this before treating its receipts as acceptance evidence. `score.mjs` uses keyword matching for semantics and omits the public brief's >=9 score requirement: align and freeze the rubric before further comparison.
- Retained costs are $0.996560 for A, $2.228871 for B repairs, and $3.092851 for A reviews: $6.318282 of identifiable receipts. This is not complete provider accounting; the intent still says unreconciled and probes/failed calls must be checked before determining remaining budget. No paid calls were made during this assessment.
- Direct arms received twelve anchors but no sibling packet. The previous DSL baseline differs in author configuration and feedback. It cannot isolate representation effects. Zero errors on ten SVGs does not establish linter completeness or make compiler guarantees redundant.
- There are 143,033 tracked TypeScript/TSX lines across 191 non-test and 175 test files. This is not 143k production lines. Delete by reachability and demonstrated utility, not a percentage target.
- The X post demonstrates a visually coherent icon grid from a short constraint prompt. The visible discussion also raises consistency concerns. It is motivation to test direct SVG, not a controlled family-matching benchmark. OpenAI's Astra announcement supports testing the model, not a claim of icon-specific superiority.

Sources: https://x.com/kazdenc/status/2098211946516373634 and https://openai.com/index/gpt-6-astra/. Repository evidence: `docs/log/path-comparison-2026-09-10/comparison.md`, root/package manifests, `examples/starter/AGENT.md`, `scripts/public-smoke.mjs`, `packages/iconsmith/src/commands/lint.ts`, and the staging artifacts above. Historical search via ccs could not run because its installed commander dependency is missing; `docs/project-research-history.md` was consulted instead. No historical transcript conclusions were independently authenticated.

## Delivery slices

### 1. Close the existing comparison before changing the default

Preserve original receipts and SVGs. Move the small reusable parts of the staging runner into a durable development script, reusing current lint/render/reference code rather than building another orchestration framework. Checker failure or malformed output must stop the run. Persist raw usage per call and immutable candidate versions; unknown usage stays unknown.

Reconcile known/unknown spend against `docs/log/astra-direct-svg-intent-2026-09-12.json` before paid dispatch. Complete the missing A reviews and review B under one explicit rubric. Record missing results separately from rejection. Include genuine house references and visibly defective controls to check whether the judges distinguish acceptable drawings from defects. Obtain the user's blind preference on candidate boards before a production choice.

For the architecture decision, compare Astra direct SVG with Astra DSL using the same concepts, anchors, sibling references, effort, candidate count and repair allowance. Freeze those inputs before generation. Do not reuse a historical score as a matched control. Use the existing ten as development evidence and a small fresh concept set for confirmation only if the reconciled budget supports it. If it does not, retain uncertainty rather than overrun or silently reset the budget.

Measure usable yield, semantic recognition, family fit, warnings, latency, review completeness and cost per usable result. Prefer direct SVG if matched results and human preference show no material quality regression; otherwise retain the DSL. An inconclusive outcome does not authorize removing it. This is a practical product choice, not a statistical equivalence claim.

Verification: malformed checker JSON, checker crash, missing review and missing usage each produce explicit incomplete/failed status; none can select an icon. Every reviewed artifact is hash-bound. Replay the same frozen rubric over all compared arms. Retain all requested slots in the denominator.

### 2. Ship one portable agent workflow

First prove one requested icon from an installed tarball in an unrelated empty directory. Extend the existing CLI, `scripts/library-siblings.ts`, `scripts/style-check.ts`, and render/lint utilities as needed so the skill never references source-checkout paths. Bundle the default revision, MIT library/license, skill and required runtime assets. Reuse the user's host agent account for Astra; do not require an extra API key for the default skill route or silently switch providers.

Consolidate `packages/iconsmith/SKILL.md` and `examples/starter/AGENT.md` into one canonical workflow. README and local setup should point to it. Preserve current review requirements until an experiment justifies reducing author/reviewer count. Report the selected SVG and native previews first; keep detailed receipts adjacent. Unresolved review delivers a draft with the concrete defect, not an approved result.

Add version/bin/files metadata and adapt `tsdown.config.ts` only as needed for real distribution. Validate registry name availability before specifying a public npx command. Update the old no-publishing instruction explicitly when adopting this slice; it currently describes the research-only product. Publishing itself is outside this planning turn.

Verification: build and npm pack, install the tarball with fresh dependencies and no source symlinks, then run help, reference lookup, checking and rendering from an unrelated directory. The current public smoke reuses node_modules and source files, so it does not prove tarball portability. Exercise one real agent request separately. Verify missing model/image/reviewer capabilities produce an actionable draft/incomplete status and no paid fallback; existing output files survive repeated requests.

### 3. Remove code outside the chosen product path

After the chosen route and tarball pass, trace dependencies from its CLI commands and skill. Remove unused generation routes and route-specific orchestration/tests in reversible commits. Candidates include analog, glyph, mixture and advanced contained runtime paths, but names and poor scores on one cohort alone do not establish safe deletion. Retain shared geometry, family lookup, validation, rendering and useful evaluation fixtures wherever the chosen path needs them. Keep historical evidence out of the shipped package without erasing it.

Update `AGENTS.md`, package instructions and qualification plans where they conflict with the adopted architecture. Run `npm run check:dead`, `npm run check:boundaries`, targeted behavioral tests and one `npm run verify -- --out .staging/verification-astra-simplification-<unique>` after source stabilization, plus the tarball smoke. Report private-corpus skips honestly. Restore the previous commit/package version if portable generation or accepted quality regresses.

## Boundaries and open decisions

No implementation, publishing, paid generation or new qualification claim is part of this planning turn. No new UI, provider framework, training pipeline or generic workflow engine is needed. Default representation remains contingent on a sound comparison. Registry availability, supported host installation behavior, complete spend accounting and independent B quality remain unverified. A 16px downsample is not a separately authored optical master; scope the initial promise to the tested 24px outlined family.


## Execution update

- Implemented a portable `dist-agent/cli.js` with skill installation, reference preparation, exact checking, rendering, drawing and linting. It reuses the existing sibling resolver, style compiler and optical proof functions.
- Consolidated the workflow in `packages/iconsmith/SKILL.md`; grammar lives in `references/drawing.md`. The research harness fallback is generated from that reference at build time. Updated both research loaders after a four-test regression exposed one stale path.
- Removed API SDKs and the JS program runner from production dependencies. The npm allowlist excludes source, research runtime, corpus, tests and staging artifacts. This prunes the installed product; broad deletion of research source remains deferred because the representation comparison is inconclusive.
- Completed a fresh matched ten-concept comparison with identical author reference packets and two-round limits. Authors ran as host Astra subagents before the user's CLI-only correction. Two independent `gpt-6-astra` reviewers subsequently ran through Codex CLI 0.154.0 with ChatGPT login and API-key environment removed. Direct SVG: 3/10 usable; DSL: 2/10. Both have 5/10 strict semantic matches. Two house controls pass and two thickened-stroke controls fail. All reviews are complete and hash-bound. This small development result does not justify a representation change; retain the DSL. Human preference remains unanswered.
- The old paid A/B run is superseded as a development comparison, not rewritten as completed: raw usage and some reviews remain missing. Identifiable historical receipts remain $6.318282, not a fully reconciled bill. No new API spend. Further paid dispatch stays stopped. The old repair runner was preserved before replacing fail-open checking and protecting future snapshots; it was not executed.
- Added strict checker/result parsing and a hash-bound review rubric with a >=9 score requirement. Missing, malformed, duplicate or stale evidence is incomplete; low scores or semantic conflicts are rejection.
- Verified a real tarball with fresh dependencies outside the checkout: skill installation, reference lookup, checker, proofs, lint, repeated destinations and failure snapshot preservation. Installed dependency tree contains no AI SDK or program runner.
- Full integrated verification passed at `.staging/verification-astra-simplification-2026-09-12-v2`: 2,384 engine tests and 10 runner tests, zero skips; typecheck/build/check/diff passed. The failed first run is retained. The installed skill validator reports 29 passes and zero failures. Independent `skills-ref` validation is unavailable because that executable is not installed.
- Updated the user's global Codex CLI from 0.150.1 to 0.154.0. ChatGPT login remains active; all subsequent generation and review uses `gpt-6-astra` via CLI rather than the API.

Evidence: `docs/log/astra-matched-host-2026-09-12/results.json` and its exact candidate SVGs and independent review records. Subscription dollar cost is unavailable; CLI token usage is recorded separately and is not an API invoice. Baseline-vs-skill behavioral uplift is not established by installation checks or this representation experiment.


### Final release status

The real installed-skill request completed through Codex CLI 0.154.0 using gpt-6-astra and ChatGPT login: two candidates, two independent reviewers, one visual repair, final 9/10 from both, exact replay and zero warnings. Review caught and repaired an initial tick-family mismatch. The verified tarball also passed the complete package smoke on Node 24.11.0. The sample is retained under `docs/log/astra-matched-host-2026-09-12/onboarding/`.

Publication of iconsmith@0.1.0 was attempted only after verification; npm refused with EOTP because the account requires two-factor authentication. No release was published. The artifact is ready for the user to authenticate and publish; registry-installed smoke remains dependent on that action. The prepared npm README describes the intended released command. Human representation preference and broad research-source deletion remain deferred; public runtime isolation and dependency pruning are complete.
