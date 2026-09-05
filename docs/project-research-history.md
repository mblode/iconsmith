# Project research history

Recovered on 2026-09-05 with **claude-code-search (`ccs` 1.3.0)**, local experiment receipts, and Git history. This extends the [foundry decision log](foundry-log.md); it does not replace the original reports or revise failed experiments into successes.

## Coverage and reproducibility

The [research index](log/project-research-index.json) records source paths, session IDs, document hashes, experiment hashes, and recovered citation URLs. It includes:

- 4,456 records from 16 sessions under the current Iconsmith project.
- 3,418 records from seven sessions under its earlier `icon-forge` location: **7,874 records across 23 sessions** in total. These include prompts, assistant text and tool-result messages; they are not 7,874 research findings.
- 262 additional search hits for `iconsmith` across projects, with session/project attribution. Some overlap the project captures or are generated harness prompts.
- Current tracked and ignored local Markdown, including the old Eve audit, demo briefs and workbench notes; removed Markdown recovered from all local Git refs; benchmark and campaign receipts. Exact counts live in the index, because this recovery adds documents itself.
- A recovered URL catalog. URLs and paper claims found in old assistant prose are **unverified historical citations**, not validated external research. Check the original source before using one to justify a new experiment.

Read-only discovery commands:

```sh
ccs --no-input --output json --list --limit 100000 --source claude --project /Users/mblode/Code/mblode/iconsmith
ccs --no-input --output json --list --limit 100000 --source codex --project /Users/mblode/Code/mblode/iconsmith
ccs --no-input --output json --search iconsmith --limit 100000 --source claude --source codex
```

The combined CLI and Cursor-only listing failed with `Invalid time value`. The package's read-only `loadMessages` API recovered the records, preserving **94 invalid timestamps as null**. It was also called with the real legacy path `/Users/mblode/Code/mblode/icon-forge`; the displayed project label `icon/forge` initially returned no records and was corrected. Neither ccs nor its source stores were modified. Private captures stay under `.staging/project-history/`.

This is a project-wide inventory and synthesis of material decisions, not a claim that every transcript sentence has been manually reviewed. The ccs Codex/Cursor loaders expose prompts; assistant conclusions from those sessions need original transcripts or repository evidence. Compressed Codex sessions, deleted sessions, remote-only history and missing temporary artifacts are outside coverage. Removed documents are indexed at their last adding/modifying revision, not every intermediate revision.

## Recovered decisions and corrections

| ID / period | Finding and evidence | Consequence for the foundry |
| --- | --- | --- |
| H001 / Aug 19 | Earlier `icon-forge` work separated reference loading, constrained drawing, rendering and evaluation. Legacy Claude session `c8e0818a-b81b-411e-b358-50eea3b9db6e`, plus [program.md](../packages/iconsmith/program.md). | Preserve host-owned geometry and provenance. A new harness alone does not improve contour craft. Historical orchestration comparisons are not current product capability audits. |
| H002 / Aug 19 | The policy loop's recorded screen improved cosine by 0.0265725, above its 0.019 noise floor, p=0.007216, but was **discarded** because the structural panel did not run. [Ledger](../packages/iconsmith/bench/ledger.jsonl), one row. | A scalar gain with missing independent checks is not accepted evidence. Old prose called this a “real win”; the defensible result is a rejected screen, with no selection-set confirmation. |
| H003 / Aug 19–25 | [Calibration](../packages/iconsmith/bench/calibration.v1.json): DINO style AUC approximately 0.476 was discarded; SigLIP semantic AUC approximately 0.672 passed its old sanity threshold, but its own-icon rank baseline ordering was problematic. Legacy record `c1310917-36f8-407b-b447-49ba5c47f15e` flags that mismatch. | Do not adopt embedding scores as a craft reward or turn an inverted baseline into a quality percentage. Conformance is a gate, not an aesthetic score. |
| H004 / Aug 19–25 | The same calibration records shipped-versus-unrelated judge controls: Haiku 25/30, Sonnet 28/30, Gemini 3.5 and 3.7 each 30/30. | Passing an easy semantic control does not qualify subtle curve, spacing or weight judgments. September A003's failed qualification is a different protocol, not a contradiction. |
| H005 / Aug 19 onward | Named vocabulary and metaphor selection were recurring bottlenecks. [Coverage receipt](../packages/iconsmith/bench/part-coverage.v1.json): 1,106 parts, 91 names, 76 named concepts, 548/2,201 covered. Earlier prompts cite different extraction snapshots. | Keep source population and measurement date attached to coverage. Object meaning and contour construction need separate diagnosis. More names are not automatically more drawing capacity. |
| H006 / Aug 21–23 | Compile, analog, host twins, mixture and offline loops evolved through the removed changesets and [lab.md](../packages/iconsmith/lab.md), [REACH](../packages/iconsmith/REACH.md), [autoresearch](../packages/iconsmith/autoresearch.md). Keyed reconstruction was explicitly separated from unkeyed generation. | High reconstruction similarity does not demonstrate novel icon generation. Old “professional parity” and “free CLI” claims do not establish today's quality or provider costs. |
| H007 / routing comparison | [Pipeline comparison](../packages/iconsmith/bench/pipeline-compare.v1.json): two cheap routing variants covered 9/9 names, but `wouldApply: false`; agent and compile arms were skipped in that run. | Do not route glyph fallback merely to make unknown cases disappear. The experiment did not compare paid generation quality. |
| H008 / Aug 25 | [Eve audit](../.staging/eve-audit/REPORT.md) identified missing named parts, provenance vetoes, analog trace errors and failed repairs discarding completed work. The report says delivery rose from 0/6 to 1/6; `rotate-360-right` scored 0.849/0.853 on its old similarity measure. | Retaining a good draft and fixing delivery matters. One delivered pair is not a reliable success rate, and the report's “house quality” label is not a current 10/10 finding. Early exits confound arm comparisons. |
| H009 / Aug 25 | [Eve notes](../.staging/eve-audit/NOTES.md) discarded two mis-briefed pilot results; `write-2` had normalized to a different answer key. | Preserve brief identity and holdout closure. Do not count contaminated pilot results. |
| H010 / Aug 25 | Closed-part offset audit, Claude session `337abb49-1745-4ecf-96bb-6173652fcff4`, record `129db883-d6df-4bda-914e-b916a86b4ab3`: 389 closed parts; independent-axis scaling distorted 123 by over 10%, 43 by over 25%; uniform scaling left 156 outside the short-axis extent tolerance. | **Scaling is not a contour offset.** These are recovered historical measurements, not rerun today. Boolean subtraction solves shape overlap; offsetting and stroke expansion remain separate problems. |
| H011 / Aug 25 | The same offset audit reported zero elliptical-arc segments among those 389 closed parts. It also contained a now-stale limitation about targeting parts with holes. | Population-specific kernel observations need remeasurement when the library changes. Current `hole` supports solid groups; do not carry the old limitation forward as fact. |
| H012 / Aug 24 onward | [Workbench campaign](../packages/iconsmith/workbench/central-gaps-v1/campaign.json) stores 200 items, 197 todo and three revision at its saved stage. Progress notes and individual exploration decisions are separate projections. | A campaign scaffold is not 200 generated or approved icons. Preserve attempt decisions; do not infer a completed library from backlog size. |
| H013 / Aug 26–Sep 3 | Git documentation history records the four-workspace restructure, house snapshot removal from the library, the program arm (`46f83cd`), stale-path cleanup (`195b3ab`), and packaged skill fallback (`885b81d`). | Resolve current ownership from current code. Removed release changesets describe history; they do not mean the private package is published now. |
| H014 / Sep 5 | [Source study](references/blode-central-craft.md), [product references](references/product-icon-collections.md), [research](plans/reference-guided-foundry.research.md), [audit](plans/reference-guided-foundry.audit.md), and A001–A014 in the foundry log. | Reference-guided style revisions and replay work; no generated pair has established the requested consistent 10/10 craft. Training remains deferred until demonstrations and critics are trustworthy. |

## Historical costs: preserve the disagreement

The old Eve report says $4.25 before and $4.94 after. The currently recovered `before-fixes/run.json` reports zero while containing failed entries with missing charges; **that does not establish a free run**. The current `shipped/run.json` totals **$5.34184693**. These receipts and the report disagree. Their hashes are in the research index; no attempt was made to invent missing provider charges or reconcile them by overwriting the originals.

Historical campaign budgets stay separate from the current $50 foundry round. The current round's 14 settled entries total **$5.72662485**, with no outstanding reservation. This history recovery and Boolean capability fixture made no new paid generation calls. Tool/subscription usage outside the provider ledger is not assigned an invented zero cost.

## Research to revisit before spending

The legacy transcripts discuss render-in-the-loop training, agent noise, optimizer safeguards and alternative harnesses. Those paper names, numerical claims and URLs remain historical leads until independently verified; some appear only in assistant prose. The strongest immediately usable evidence is the local failed-attempt record: missing structural checks, metric blind spots, incorrect output handling, contaminated components, replay drift and inadequate cutout construction.

The next quality experiment should isolate the new filled Boolean construction and preserved source curves on an unseen concept, with native-size comparison and a reviewer qualified for the defect being tested. It must not relabel the host-constructed Boolean fixture as AI-generated success.
