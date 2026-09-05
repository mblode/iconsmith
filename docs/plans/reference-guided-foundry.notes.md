# Foundry implementation notes

The maintained decision and attempt history is [the foundry log](../foundry-log.md). These notes retain stage-specific details; use the log for the reconciled latest state.

5 September 2026. Execution of the first bounded experiment has started. **The plan is not complete and no style has reached `pilot-proven`.** The user authorized a $50 ceiling. Paid development runs are recorded below; none is a sealed pilot.

## Implemented

- `packages/iconsmith/src/pipeline/style.ts` admits immutable, content-addressed revisions containing compiler identity, master-specific specs, parts, references, policy and rubric. Unknown compiler/master and unadmitted selections fail explicitly. Existing source admission still applies; the extracted product collections have not been enabled for conditioning.
- Generation owns the selected vocabulary, reference lookup and spec. It disables implicit house construction, rejects competing spec/reference overrides and stamps the resulting revision/master key. Existing callers without a style retain the legacy house path.
- Tournament generation, replay, twin adaptation and review receive the same selection. Selected-style acceptance checks the requested finish, complete document, exact compiled SVG, fresh structural lint and the entire dependency list, including extras. Primitive-only programs are eligible. Part count no longer decides ties for selected styles.
- Reviews use the selected rubric and native master size; the legacy house rubric remains unchanged. Selected-style judge calls have bounded output and no automatic retries. This is wiring, not evaluator qualification.
- Complete attempt costs survive replacement by a rescued twin, including the original failed review and generation. Studio reads this complete ledger. Failed selected-style generation without a complete bill records unknown spend and stops budgeted escalation.
- `packages/iconsmith/src/eval/foundry-gate.ts` implements the audited advancement rule: 24 distinct concepts, the 12/6/6 split across six morphology groups, every declared variant, fresh generation, exact replay, family checks, zero manual edits, an unchanged frozen manifest and known in-budget spend. Instrument classes require 20 distinct pairs, both orders, at least 90% correct ordering and at most 10% false rejection. Repetitions do not increase the sample size; Wilson intervals are reported. The caller must retain the evidence behind these observations.
- `scripts/style-lab.ts` exercises compilation, native rendering, exact replay and the actual tournament with an explicitly injected judge. `scripts/style-generate.ts` provides a live direct-constrained exploration entry, requires an explicit dollar ceiling and saves revision, plan, result, spend and artifacts. Its dry run makes no model calls or output directory. Exploration acceptance never qualifies a style.

## Evidence

The local report is [.staging/style-lab-2026-09-05-verified/report.json](../../.staging/style-lab-2026-09-05-verified/report.json), with [contact sheet](../../.staging/style-lab-2026-09-05-verified/contact-sheet.png), per-artifact SVG/program/metadata, native PNGs and 2× PNGs.

There are **24 compiler specimens, not 24 generated concepts**: three simple shapes, two fixture profiles, two sizes, two finishes. All 24 compile, pass structural replay checks and reproduce their exact SVG. The contact sheet was visually inspected. This offline report contains no model-generated artwork; the later paid experiments below do. The profiles only vary supported stroke/radius controls; they do not establish a contrasting product aesthetic or independently designed optical masters.

Capability probes record the parser's rejection of model-selected butt caps and per-segment stroke width. A free cubic command is also rejected, as required by the no-model-coordinates invariant. Future curved treatments need host-owned named constructions or admitted parts. These probes demonstrate missing direct controls, not a proof that every target drawing is impossible using combinations of existing primitives.

The executable advancement result is `blocked`: there is no frozen real pilot roster, no generated pilot output and no qualified instrument dataset. The injected perfect scores in the plumbing test cannot advance it.

## Run recipes

From `packages/iconsmith`, use a new output directory each time:

```sh
npx tsx scripts/style-lab.ts --dry-run --out ../../.staging/style-lab-next
npx tsx scripts/style-generate.ts \
  --revision ../../.staging/style-lab-next/thin-tight-fixture.json \
  --master small --concept container --model test/not-called \
  --out ../../.staging/style-exploration-next --dry-run
```

For a real exploration, choose an actual model, remove `--dry-run` and supply the explicitly authorized `--max-usd` ceiling. The fixture profile is a wiring example, not the professional reference collection for the pilot. Reservations and bounded responses limit work; provider-reported overruns and unknown charges remain explicit failures, not promises that a provider can never bill above an estimate. Interrupted runs write an unknown-spend record and do not retry automatically.

## Deviations

- The plan requires a real contrasting-style experiment before Studio or library-job implementation. This execution completes the initial plumbing and capability evidence only. The user subsequently authorized $50 for this round. Product-reference conditioning still needs an admitted source fixture; the prior analysis-only captures are not such a grant.
- The code still supports a canonical 24-unit canvas and the existing optical sizes. Unsupported native canvases are rejected instead of being silently scaled. Named optical relief, cap/join controls and novel curve constructions have not been implemented.
- Visual-proposal parity, automatic family anchors, source/alias/family holdout closure, actual semantic confusion tests and instrument datasets remain to implement and run. The advancement function enforces submitted evidence; it does not manufacture or collect that evidence itself.
- Compiler identity is explicit and replay verifies stored SVG bytes. An archived executable compiler bundle and backward-compatible release archive remain outstanding. A compiler token alone is not an archive.
- Slice 02 retains its extracted originals, manifests and analysis gallery from the research work; this execution does not claim a production ingestion pipeline. Slices 03–05 remain gated by a successful pilot and larger coverage trial. The Glyphs bridge stays deferred.

## How the run ended

- Engine: `npm run test -w iconsmith -- --maxWorkers=2` passed **1,392 tests in 99 files, zero skipped**. The real corpus was present. Root AGENTS canary totals were updated together.
- Agent, contract and web test commands passed. The agent check includes propagation of the complete replacement-attempt ledger.
- `npm run check`, `npm run typecheck` and `npm run build` passed across the monorepo. The production Next build completed. No files were added to Eve discovery directories.
- Offline lab: 24 exact replays and 24 structurally valid specimens, zero paid calls, `blocked` advancement. The live entry's dry run validated its selected revision with zero paid calls.
- No deployment, commit, source redistribution or library release was performed. Work remains in the checkout for review and continuation.


## Paid development round: $50 ceiling

The root ledger is [.staging/foundry-round-1/budget.json](../../.staging/foundry-round-1/budget.json). Every experiment reserves its ceiling before starting; completed provider-reported charges replace the reservation. Unknown charges retain the hold. This is a local experiment ledger, not a new billing or batch service.

Live model calls revealed and fixed three problems in the existing path:

- A fresh selected-style `home` could still receive the instruction that its house construction was already drawn. The prompt now disables that shortcut along with the tools.
- Empty vocabularies still exposed part search, causing repeated fruitless calls. Those tools are absent when a selected revision has no parts. The first prompt now includes actual reference images, before the first drawing operation.
- Default reasoning consumed the entire 4,096-token output allowance without drawing a filled icon. The CLI can record and pass Anthropic effort; medium effort produced both paints within the same output and dollar limits. See the [provider effort contract](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic).

The CLI also saves each paint immediately, before later generation or review can fail. An optional `--brief <text-file>` supplies per-concept art direction through `Concept.guidance`; its exact text is recorded in the plan. It changes neither the immutable family nor the judge. All geometry in these experiments was emitted through model tools; no generated SVG was manually corrected.

The first three folder-lock attempts cost $0.30503875, $0.2293775 and $0.14643875. The first two produced empty filled paints; the third produced both paints, but the judge found a cramped outlined shackle and an incorrect filled cutout. The fourth uses AI-written feedback about those failures. These are unsealed development attempts, not independent holdouts.

### Evaluator measurement

[instrument-weight/result.json](../../.staging/foundry-round-1/instrument-weight/result.json) retains all 80 actual reviews and charges: **$0.5360916**. Twenty distinct shipped Central originals were compared with path-identical copies whose uniform stroke was changed from 1.5 to 4.5. Each was reviewed twice, with the scheduling order reversed. These are independent single-candidate reviews, not a joint two-image position-bias test. The frozen protocol preserves source/defect hashes and the unchanged rubric.

The judge ordered all 20 pairs correctly in both repetitions. It nevertheless rejected 3 of the 20 shipped controls in at least one repetition: a 15% control rejection rate against the frozen maximum of 10%. Therefore this instrument **does not qualify**. The 95% Wilson intervals are 83.9–100% for correct ordering and 5.2–36.0% for control rejection. This measures gross weight discrimination only; it does not establish subtle optical, semantic, curve or family evaluation. Shipped controls may themselves contain aesthetic defects, so these rejections also require better ground-truth controls; they are not proof of judge hallucination.

### Current boundary

Keep the generator and the selected-style entry small. Do not add a library queue or Studio selector to hide an unqualified drawing/evaluation loop. The next evidence needed is repeatable native-size quality, qualified controls across the required defect classes, and an authorized genuinely contrasting construction language. Supported Central stroke/radius variants remain useful integration probes, not evidence of arbitrary-style support.


### Settled results and pair-gate repair

The round settled at **$1.9288466**, leaving **$48.0711534** of the authorized ceiling, with no open reservations or unknown charges. [Report](../../.staging/foundry-round-1/report.json) · [native/4× contact sheet](../../.staging/foundry-round-1/contact-sheet.png).

Six generated pairs produced ten nonempty, exactly replayable drawings and two empty filled attempts. None passes the current full exploration gate. Fourth-attempt feedback did not repair folder-lock quality; it cost $0.4009665. Camera thin cost $0.12789125 and camera heavy cost $0.18304225. Both use authorized Central variant references, not an unrelated product collection. The heavy fixture explicitly changes stroke and radius tiers along with its matching references.

The thin camera initially passed both individual reviews at SC/PQ 10/10. Rechecking the two actual artifacts together found a 1-unit height mismatch. The tournament now applies the existing `pairPrograms` checks after any twin rescue, under the selected spec, records `pairIssues`, and refuses an error even when both individual reviews pass. A regression test demonstrates this exact false-acceptance class. Earlier result files are retained unchanged; the report records their original individual acceptance separately from the current paired result.

The contact sheet was visually inspected. It also shows construction differences the extent check cannot judge: the camera tab moves between paints, and the heavy filled treatment can resemble an outline. Pair geometry checks therefore complement, but do not replace, a qualified family evaluator. No release-quality claim follows from a model score.


## User-rejected craft and direct source study

The user rejected the generated drawings as insufficiently crafted. [The direct Blode/Central study](../references/blode-central-craft.md) now records source geometry, nine paired construction examples, current full-repository counts and the quarter-grid effect on an admitted folder part. It supersedes the assumption that more primitive-only prompt iterations or a stroke/radius fixture will reach the required quality. No further paid calls were made during the study.


## Completed component experiment and replay repair

The corrected generation cost $0.82881725. It produced a legible outlined folder-lock and a filled composition, but the filled program exposed a host serialization defect: a 0.45 part multiplier was emitted as absolute `size 0.45`. The DSL now has an explicit `scale` multiplier; legacy `size` remains an absolute dimension. Explicit part positions also bypass a redundant center conversion that introduced floating-point drift. Regression coverage checks both paints, fractional scales, rotation/reflection, legacy size and invalid combinations.

Both original AI SVGs replay byte-for-byte after host serialization repair. No artwork was manually edited or regenerated. Original failed programs and attempts remain intact; repaired derivatives record their lineage in `.staging/foundry-round-1/folder-lock-components-replay-02`. The first repair review cost $0.0305745 and exposed the position drift; the final review cost $0.029787.

The final pair is rejected. Outlined visual extent is 20×18 versus filled 20×17; a 0.88-unit inter-component gap also falls below the 1-unit warning threshold. The visual reviewer scored outlined SC 10/PQ 8 and filled SC 8.5/PQ 5.5, identifying the uneven cutout and overhanging folder corner. These scores remain exploratory because the critic is not qualified. Direct visual inspection agrees that the filled shield-derived opening does not fit the lock and the scaled keyhole is uneven.

Cumulative measured spend is $3.28230835 of the authorized $50, with no outstanding reservation. No training job or upload occurred. This experiment supports developing reusable contour construction and badge-specific clearance before training; it does not establish professional quality, unseen-family generalization, or a successful AI-generated library. These rejected compositions must not become positive training demonstrations.


## Eve and the drawing harness (2026-09-05)

Eve remains the production entry: `generate_icon_pair.ts` calls `generateStudioResponse`, which selects candidates and invokes the engine's `runPairTournament`. The direct SDK loop in `pipeline/generate.ts` and external CLI loop in `pipeline/harness.ts` share constrained geometry/replay infrastructure. The existing Studio arsenal is house-oriented; the selected-style CLI is a bounded development path, not yet Studio parity. No Eve replacement or new service was introduced.

Added optional `GenerateOptions.companion` and the development CLI's `--companion`. The artifact must replay under the exact style/master and use the opposite finish before any model call. The generator receives its image/program explicitly labelled as an unapproved draft. The outlined result is saved before verification and the filled pass; a replay failure stops dependent generation. Final style, structural and independent visual gates remain unchanged. This tests shared composition context; it does not certify the companion's craft or automatically promote it into the reference family.

Verification: engine 1,394 tests / 99 files, zero skips; root check and typecheck pass after formatting correction. Root corpus canaries updated together. No production deployment or library-quality claim.
