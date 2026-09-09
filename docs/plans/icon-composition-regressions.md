# Icon composition regressions

Authoritative checklist for this task, a bounded slice of the broader generation-quality-10 work.

## Outcome

The user rejected the original database-backup arrowhead and search-check tick placement. Structural validity and exact replay passed; this ten-icon export used the standalone checker and author inspection, not canonical independent review. Catch these composition defects in regression coverage and make the structural-versus-visual delivery boundary explicit.

Acceptance: original search-check is diagnosed for local ring/mark alignment and the corrected version is not; original backup arrowhead has an evidence-based diagnostic and the corrected version is not; controls prevent blanket rejection of intentional asymmetry and unrelated marks; real checker and generation/review seams consume the changes; structural-only output never asserts visual approval.

## Decisions and boundaries

Extend existing geometry, lint and review mechanisms. Use narrowly applicable diagnostics with stated limits, not universal aesthetic thresholds. No automatic geometry changes, new dependency, model substitution or qualification claim. The rejected examples are development regressions; the revised drawings do not yet have user approval. Deterministic regression work needs no provider dispatch. Any live review retains existing isolation, budget and eligibility requirements.

## Tasks and owners

- [x] T1 — Root: inspect checker/review seams, preserve feedback, write this plan.
- [x] T2 — Alignment agent: local enclosure/mark diagnostic and rejected/corrected/control tests.
- [x] T3 — Arrow agent: arrowhead diagnostic and rejected/corrected/control tests, with applicability limits.
- [x] T4 — Delivery agent: reviewer questions and explicit structural-only report status, with focused tests.
- [x] T5 — Root, after T2–T4: integrate real paths; replay actual rejected/revised programs and inspect proofs.
- [x] T6 — Root, after T5: integrated checks, diff review, evidence receipt and completed checklist export.

## Approach

T2 and T3 own separate diagnostic modules/tests under packages/iconsmith/src/tools. Root owns shared lint integration. T4 owns scripts/style-check.ts and reviewer question/prompt seams and their focused tests. Root owns shared docs and source manifests. Preserve unrelated checkout changes.

## Verification

Run scoped Vitest tests for each slice. After source is stable, run npm run verify with a fresh output directory. Retain failures and identify environmental or baseline blockers. Replay actual preserved original/corrected programs through the pinned checker: rejected geometry produces relevant diagnostics and corrected geometry clears them. Missing independent review remains explicit and cannot become craftApproved. Native/downsample inspection supplements tests but grants no independent qualification.

## Recovery

No release or migration is in scope. Revert only task-owned source edits if necessary; preserve artwork history and verification receipts.

## Progress evidence

T2–T4: three parallel agents completed their owned modules and review/report seams. T5: 134 focused tests passed across seven files. Actual checker CLI replayed all four fixtures exactly: both rejected programs emit the intended warning, both revised programs clear that warning. Revised backup retains its existing whole-icon centred warning. All reports retain craftApproved:false and visualReview:required. Root inspected both revised native/retina proof sheets. These are author checks, not independent visual qualification.

Integrated verification is running in .staging/composition-regressions-20260909. Initial root formatter invocation failed because configuration is package-local; rerun from packages/iconsmith passed.

## Final verification

Implementation and verification audit complete. Full integrated run did not pass: 2,315 tests passed and 47 failed across three native-call files because the evidence filesystem was below its required 2 GiB free-disk floor. Source hashes remained stable during that run. No disk guard was weakened. Typecheck, build, foundry guards, dead-code checks, formatting/lint, boundaries and diff checks passed separately. Fixture JSON formatting was corrected after the full test attempt; no geometry changed. A fully green integrated run remains pending sufficient disk space. Evidence: docs/log/icon-composition-regressions-2026-09-09.json. No provider calls, commits or publication.
