# Iconsmith execution handover — 9 September 2026

> Surface update, 9 September 2026: the website, Studio, Eve service, shared Studio contract, and browser viewer were removed at the user’s request. References to them below are historical; use the root README and `docs/local-setup.md` for current local commands.

Use this handover to resume the AI-only quality program without repeating failed experiments or promoting development scores into qualification. The [authoritative plan](generation-quality-10.md) remains the sole active checklist. This document is an audit and ordered handoff, not a replacement checklist or a claim that the plan is complete.

**Answer:** Studio already uses image generation for composition proposals, followed by constrained editable construction. The canonical local foundry route is separate and does not generate these raster proposals by default. Keep the existing Google proposal defaults for now; evaluate GPT Image 2.5 Sunburst behind the same proposal seam before changing them. This audit verified source wiring, not a fresh live Studio request.

For that experiment, use the exact API ID `gpt-image-2.5-sunburst`, whose generation endpoint worked in this session. Treat `gpt-image-2.5-flare` as an untested comparison candidate. “ChatGPT Images 2.5” names the product family; it is not the API model parameter. OpenAI positions Flare as its default and Sunburst for greater precision, but these product claims do not establish Iconsmith quality. [Official announcement](https://openai.com/index/introducing-chatgpt-images-2-5/).

## Current architecture and the image-model decision

Use the raster path to propose composition only if it improves the final constrained drawing.

| Path | Current behavior | Disposition |
| --- | --- | --- |
| Canonical local generation | Family retrieval, structured author, constrained program compilation, native proofs, inspection, independent review, bounded repair and local receipts | Continue closing authority and live-evidence gaps in `scripts/local-generate.ts`, `local-campaign.ts` and `local-structured-author.ts` |
| Studio raster proposal stage | Without an attachment, Studio generates Google sketches, selects one and reduces it to a bounded semantic proposal for the drawer | Already wired in Studio source; not qualified under the current foundry route |
| Sunburst API diagnostics | Two direct generation requests, one corrected transparent four-slot sheet; fixed quadrant crops downsampled to 16/24 | Access and output-format evidence only; not canonical integration, editable delivery or route selection |
| Source-exact reconstruction | Compiler25 consumes a host-issued admitted source/spec binding and exactly reconstructs supported source ink | Separate reconstruction capability; it does not convert Sunburst pixels to constrained editable geometry |

The [Studio orchestrator](../../apps/agent/lib/generate.ts) calls [propose.ts](../../packages/iconsmith/src/pipeline/propose.ts) with two ideation sketches from `google/gemini-3.1-flash-lite-image` and a quality sketch from `google/gemini-3-pro-image`. An attached image/SVG instead supplies the proposal through `visualProposal()` and pixel-only composition, without generating those sketches. `image-agent` and `claude-harness` consume the proposal; `gateway-agent` is the explicit no-proposal control. The generic route registry does not expose this as a named raster route.

The [local CLI](../../packages/iconsmith/scripts/local-generate.ts) separately accepts paired `--sketch` and `--sketch-source` inputs for its constrained author. Reuse these existing seams rather than creating a parallel vectorization pipeline.

The intended optional flow is: licensed house references → image proposal → constrained semantic composition → existing DSL author → deterministic compiler → native proofs → qualified independent review. The final authority remains the program, host geometry and verified artifact tree.

[compose.ts](../../packages/iconsmith/src/pipeline/compose.ts) already describes blocks using a 3×3 cell, size bands, adjacency, part suggestions and a blurred thumbnail. It deliberately does not trace paths. Therefore the earlier statement “no converter found” was too broad: a semantic raster-to-proposal adapter exists. The Sunburst experiment never invoked that adapter or the constrained drawer. What has not been demonstrated is a Sunburst-to-current-campaign route that preserves useful craft through editable DSL and passes the frozen review gates.

Do not update the old raster model constants alone and call this integration. Its provider transport, reference licensing/exposure, cost accounting, prompt, candidate count, reader/selector calls and original deadline all need the same canonical controls as the author route. Existing dated per-image prices are unsuitable for new GPT Image token accounting. The older outline-only sketch brief also needs an explicit experimental scope before it can represent both paints.

## What the image experiments proved

Keep all three experiments separate; their protocols and provider identities differ.

| Receipt | Route | Result | Interpretation |
| --- | --- | --- | --- |
| [D486](../log/wave-ew-images25-results-2026-09-09.json) | Built-in image tool; actual model identity unverified | 1254px transparent sheet; Sol development craft 4/5/7/7, ship 2/4 | Not a verified Images 2.5 comparison |
| [D490](../log/wave-fa-images25-api-result-2026-09-09.json) | Direct OpenAI Images API, requested Sunburst | HTTP200, 32.308 seconds; 1024px opaque PNG with baked checkerboard | Failed transparency setup: root omitted explicit `background`; retain failure |
| [D492](../log/wave-fb-images25-transparent-result-2026-09-09.json) | Same model/request with explicit transparent background | HTTP200, 27.018 seconds; genuine alpha; Sol craft 4/4.5/6.5/7, ship 0/4 | Both 16px badges ambiguous; both 24px meanings readable but crowded; below craft gate |

**Correction:** model metadata GETs returned404 for Flare and Sunburst, but the direct Sunburst generation POST succeeded twice. D486's conclusion that generation access was unavailable is superseded. Flare generation remains untested. A metadata lookup is not a sufficient access oracle.

The successful requests used `POST https://api.openai.com/v1/images/generations`, `model: "gpt-image-2.5-sunburst"`, `n: 1`, `size: "1024x1024"`, `quality: "high"`, `output_format: "png"`; the corrected request also used `background: "transparent"`. The endpoint accepted the exact requested ID; the response did not echo a model or immutable underlying snapshot. Keep that identity boundary explicit. [API output settings](https://developers.openai.com/api/docs/guides/image-generation).

Each response reported 331 text input tokens and 1,756 image output tokens. At $5/M text input and $30/M image output, each costs $0.054335; both cost $0.10867. These are usage-rated costs, not invoice reconciliation. [Official pricing](https://developers.openai.com/api/docs/pricing#image-generation).

The native tests were fixed-quadrant Lanczos downsampling, not independently constructed optical masters. The image occupies only part of each quadrant, so crop padding and resampling confound native craft. Do not infer that the model cannot produce better icons, that its API variant beats the built-in tool, or that the raster result would survive DSL reconstruction. No house references were supplied; no house-parity result exists. Alpha-threshold topology counts are sensitivity diagnostics, not definitive hole/bridge judgments. Sol's ratings are uncalibrated development judgments with a shared multi-row board, not a sealed qualification instrument.

Inspect the [API native board](../../output/imagegen/api-review-2026-09-09/panel.png), [transparent source sheet](../../output/imagegen/api-review-2026-09-09/sunburst-transparent.png), and [built-in native board](../../output/imagegen/review-2026-09-09/panel.png). Preserve `.staging/wave-fa-images25-api-2026-09-09` and `.staging/wave-fb-images25-api-transparent-2026-09-09`, including raw responses, usage, dispatch intents, failed original and review evidence.

## Verified checkout and evidence status

These are current observations or explicitly identified receipts, not visual qualification.

| Item | Audit observation |
| --- | --- |
| Current HEAD | `bedec8a175c5fb8d4586549988d2e69e14d6cb5c` — sitemap-only commit after baseline `1e81fd0`; not made by this audit |
| Worktree at audit start | 90 tracked modified files and 456 untracked files; preserve this shared work, including untracked source and receipts |
| Private corpus | 62,550 SVGs remain at `packages/iconsmith/corpus`; never move or synthesize a replacement |
| Last full engineering verification | [D488](../log/wave-ez-compiler25-uncertainty-integrated-verification-2026-09-09.json): 2,522 tests / 178 files / zero skips; typecheck, build, lint and diff checks pass |
| Fresh drift check | All 401 D488 source-manifest file hashes still match; no full suite rerun needed for this documentation-only audit |
| Compiler | `iconsmith-constrained-25-source-exact`; [D482 integration](../log/wave-es-source-exact-canonical-integration-2026-09-09.json) |
| Full source regression | [D483](../log/wave-et-compiler25-source-regression-2026-09-09.json): 4,357 exact replays, 3,960 admitted, 397 refused, 1,007 raster differences; every per-source admission/replay row matches D450 |
| Source overlap | Refusal/raster-difference intersection 352, union 1,052; never add those populations as if disjoint |
| Acceptance | Draft16 integrated in the dirty working tree, with contract files still untracked; including independent population metrics and descriptive family-clustered uncertainty; not frozen production qualification |
| Plan status | 15 of 84 numbered primary tasks checked at audit; implementation evidence subtasks are separate. No phase is visually qualified |
| Census | Latest D447 overlay: 444 mapped concepts, 9 inspected but unresolved, 1,768 uninspected, totaling 2,221 concepts / 8,884 requested slots |

The plan also retains an obsolete P3.6 implementation claim: current `ai-qualification.ts` already rejects producer/evaluator lineage overlap. P3.6 remains open for the actual frozen roster and qualifying evidence. Its old baseline canary and resource figures must be read alongside D488 and D492, not as current totals. No checklist was promoted during this audit.

Some nested plan notes still say “open” beneath later D405/D420 closure annotations. Read those chronologically; old nested prose alone is not grounds to reopen a mechanism. D473 explicitly reopens the affected current-route tasks.

D488's manifest is an engineering source closure, not an assertion that every repository file was frozen. It does not invalidate or certify the unrelated sitemap commit. The root canary now reads 2,522/178; absent corpus would skip 13 tests and leave 2,509 passing, not prove the private measurements.

## Material session progression and retained failures

Read [execution notes](generation-quality-10.notes.md) and the [foundry log](../foundry-log.md) for every attempt. This synthesis covers the plan execution through D492 and the current source state; historical research was checked with `ccs` against both project paths and the [research history](../project-research-history.md). It does not claim sentence-by-sentence recovery of every hidden, deleted or compacted transcript.

| Evidence period | Progress | Boundary or correction |
| --- | --- | --- |
| Baseline / Wave A | Revalidated 1,830 tests, private corpus and source identities; corrected active paint/curve/repair guidance | First local topology gate caused 501 admission regressions and was removed; keep the failed evidence |
| Early runtime / compiler22–24 | Container ownership, launch identity, original deadlines, receipts and compiler repairs developed | Compiler22 source regression failed; later compiler revisions corrected it. Green process exits and exact replay did not establish visual approval |
| D290–D333 | Credential incident quarantined Claude; prospective collector work; folder-lock16/24 slice eventually delivered | Earlier failed slices and source/inspection uncertainties remain. Credential rotation confirmation is still required before reusing quarantined Claude route |
| D343–D420 | Parent-clock admission, resume/STOP accounting, six-request reliability replay and authenticated containment probes | D420 closed P1 engineering for its frozen identity, not every later revision |
| D427–D450 | Local source-feature profiles, native packet binding, broader census and full source regression | Bell/counter and family identity uncertainty persisted; classification coverage is not visual family qualification |
| D448–D480 | Acceptance authority, explicit critic bytes, independent audit metrics and honest terminal states improved | D473 found 24 changed files against D420's 635-file closure; current P1.5/P1.7/P1.10/P1 exit reopened. D479 remains a design-only acceptance bridge |
| D481–D488 | Source-exact compiler25 and draft16 uncertainty integrated; source regression stable; full verification passed | Three bundled-skill integration failures were corrected and preserved in D487; source-exact author wiring and collector authority remain open |
| D485–D492 | Built-in diagnostic, failed model GET inference, successful direct Sunburst generation and transparent correction | Metadata access conclusion corrected; first API configuration failure counted; no raster route promoted |

Important retained instrument failures include unsupported native reviewer tools, wrong model/roster intent, ambiguous provider charge/metadata states, and unsupported factual counter allegations. Do not retry exposed control packets as fresh samples, suppress strict reviewers, or turn an exact reconstruction's score into novel-generation evidence.

## Next execution wave: three Sol 5.6 medium owners

Root owns all shared plan/log/ledger edits, freezes, integration and provider dispatch. Keep worker file sets disjoint. The following are handoff assignments; record completion in the authoritative plan, not in a competing checklist.

| Owner | First bounded assignment | Files / exit evidence |
| --- | --- | --- |
| Runtime | Review and integrate the sealed EN inspection collector proposal, then close recursive campaign/root evidence consumption | `local-native-call-factory`, `local-codex-review`, `local-astra-author`, `local-structured-author` and tests. Revalidate exact bases, capability single-use, raw-answer mapping, attachment multiplicity, settlement, prior-best restore and finalization binding |
| Evaluation | Implement D479 terminal-to-acceptance bridge after draft16, preserving every requested slot | `src/eval/acceptance-contract`, `scripts/acceptance-critic-evidence`, population/qualification tests. Coordinate any `local-campaign` boundary edit with Root. Preserve `unstarted`, `production-unknown`, null unavailable evidence and critic-coverage denominators |
| Geometry / image experiment | Audit/reuse `propose.ts` and `compose.ts`; specify one Sunburst-to-DSL feasibility fixture before new paid calls | Keep compiler/kernel unchanged unless an existing-DSL reproduction demonstrates a gap. Test coarse semantic proposal preservation, source licensing, no arbitrary path output and actual editable replay |

**EN is prepared, not integrated.** Proposal directory: `.staging/wave-en-inspection-collector-proposal-2026-09-09`. Patch SHA256: `4360542298cc6cebdc84732231fd75af0a66e4ccaf23c3c0ee62d6dabc47ec1f`. All eight recorded canonical bases still matched during this audit. The isolated proposal reports 103 focused tests, typechecks and scoped lint; this is not canonical verification. It deliberately leaves `authorEvidenceVerified` false, requires downstream recursive replay, and does not support sealed Claude inspection. Do not flip that flag after applying a patch.

[D479's design receipt](../log/wave-ep-terminal-acceptance-bridge-design-2026-09-09.json) and `.staging/wave-ep-terminal-acceptance-bridge-design-2026-09-09/design.md` describe the acceptance mismatch. “No selected artifact” is not evidence that nothing was produced. Invalid child output must remain retained and counted; a serialized receipt alone cannot confer authority.

After integration, run the scoped tests for changed modules, then the plan's sequential integrated checks. Freeze the resulting route before repeating the required folder-lock slice, controlled interrupted salvage and six-request replay. Historical D420 success cannot supply those current-route results.

## Remaining phase dependencies

Complete these dependencies in the authoritative plan before catalog or unseen-family dispatch.

| Phase | Remaining work and exit evidence |
| --- | --- |
| P0 | Complete the acceptance contract and current collector authority; reconcile newly required staging behavior and current source/route identities. Refresh stale dashboards and prompt payloads where affected; reserve each next paid wave explicitly |
| P1 | EN plus recursive evidence replay, terminal bridge, current frozen end-to-end slice/salvage/reliability replay, and proof of every required review inside the original clock |
| P2 | Finish semantic family/derivative dispositions and independent construction annotation; close native counters/modifier identity and eight-class board; resolve generation-blocking source gaps; re-run full source audit after compiler/importer changes. Keep source-exact reconstruction separately labeled |
| P3 | Qualify a critic against a sealed two-model panel with all lineages excluding the author/repairer and one another. Obtain an eligible four-lineage roster, at least100 independent stimuli including80 natural candidates,20 confirmed critical generated defects and20 predicted generated approvals, plus controls. Pass95% precision/90% recall/80% coverage; no self-declared authority |
| P4 | Matched retrieval comparison, author screen/full80-output cohort, bounded refinement and10/20-minute comparison. Resolve P4.6 by an eligible constrained raster-composition experiment or an evidenced exclusion. No default model selection from the tiny Sunburst trial |
| P5 | Separate sealed20 repairable failures; at least16 resolved without critical regression; qualified before/after review and cross-master/paired-paint cohort |
| P6 | Measured forecast, quota/concurrency pilot, separately frozen catalog scheduler, all4,442 pair requests/8,884 slots terminal,400-output probability audit and all flagged cases. Catalog mode cannot be enabled merely by removing development guards |
| P7 | Complete append-only exposure census; seal two disjoint20-family out-of-catalog batches,80 slots each; no tuning between batches,19/20 successes per stratum for95% thresholds |
| P8 | Current release replay, machine-readable qualification, complete local PNG/SVG/DSL index, cost reconciliation and fresh independent audit. Publish the exact AI-assessed claim only if every gate passes |

Training remains conditional on the plan's T1–T5 evidence and separate budget authority. Nothing in this session establishes a need to train a model from scratch or fine-tune a closed native model.

## How to evaluate the optional Images 2.5 arm fairly

First build the canonical adapter offline: explicit API model/parameters, no automatic retry after ambiguous dispatch, one parent deadline, STOP and budget checks, raw usage/request IDs, true alpha/dimensions and ordered input hashes. A simple HTTP timeout and `.staging` request file from D489/D491 do not meet all of P1's production containment, resume and evidence requirements.

Then reserve one small concept-size request, with separately identified paint outputs, house references allowed by the exposure policy and a predeclared optical target. Use the same retrieved packet and final constrained drawer as the DSL-only control; vary only the raster proposal. Preserve all raster candidates, semantic readings, programs and failed reconstructions. The next experiment must measure the final DSL render, not only the attractive large raster.

Do not spend on a broad Flare/Sunburst tournament until this conversion path yields a useful editable result. If it does, first compare Sunburst with the existing Google proposal stage on a predeclared multi-family cohort. A single four-crop sheet is not cost-equivalent to Studio's three sketches plus selection and reading. Only then compare exact Flare and Sunburst IDs under equal total generation/selection/reader/author/reviewer budgets. Prefer the cheaper/faster route only when native craft, meaning, topology and accepted-pair yield hold. Current data supports neither a winner nor a price forecast for the catalog.

## Resources, ownership and stop conditions

The current [ledger](../log/api-budget-after-d492-2026-09-09.json) records $13.17402110 actual/usage-rated plus $11.37126575 reserved or unknown, leaving at most $25.45471315 under $50. Keep historical campaigns separate. There is no new paid generation reservation for this handover. Native author/reviewer/subagent usage has unknown dollar allocation; the three audit subagents are subscription orchestration, not free API calls.

The last recorded native quota observation was95% weekly used; it is stale until rechecked. A reset credit was not authorized or redeemed. Recheck quota and disk before dispatch; the prior disk floor was2GiB. Do not delete private evidence or original attempts to recover space. Keep Claude quarantined until the previously required credential rotation is confirmed; do not copy credentials into logs or handover prompts.

Stop new calls on identity drift, ambiguous dispatch/charges, insufficient reservation, failed containment, a critical regression, broken critic controls or exposure leakage. Continue independent offline work. Do not use elapsed time as permission to spend or retry. Do not publish packages, add a public UI, silently fallback to another model, or overwrite historical compiler evidence.

## Resume references and verification

Start with [the plan](generation-quality-10.md), [notes](generation-quality-10.notes.md), [foundry log](../foundry-log.md), D488, D483, D492, EN and D479. The last generated dashboard v16 and evidence index v27 predate the final image/API updates; they are historical views, not the current source of truth. Rebuild a new immutable view if needed.

Run commands from `/Users/mblode/Code/mblode/iconsmith`. The plan's section6 names the scoped tests and sequential integrated commands. Use a fresh output directory and preserve results before re-running. A docs-only audit does not justify another full suite; changed runtime/compiler/evaluator behavior does. Do not commit unrelated work or discard untracked files during integration.

[D493, this handover's audit receipt](../log/wave-fc-session-handover-audit-2026-09-09.json), records source hashes, checked-task counts, history-search scope, links and independent worker findings. Completion means delivering qualifying evidence, not reaching a particular test count or finishing this document.
