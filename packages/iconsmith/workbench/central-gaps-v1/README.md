# Central gaps campaign

> Surface update, 9 September 2026: the website, Studio, Eve service, shared Studio contract, and browser viewer were removed at the user’s request. References to them below are historical; use the root README and `docs/local-setup.md` for current local commands.

This campaign turns missing Central concepts into a durable icon-production workflow. It borrows the useful separation from Cursor's icon project without copying its Figma files or visual rules:

- Explorations keeps immutable attempts, candidate renders, programs, audits, cost records, and the Eve session that produced them.
- Overviews holds derived consistency checks across selected attempts.
- Icons receives only explicitly approved outlined and filled pairs.
- campaign.json is the machine-readable source of truth.
- PROGRESS.md is regenerated from the campaign and must not be edited by hand.

## State model

todo -> exploring -> review -> approved -> published

An unsuccessful quality gate moves an item to revision. An operational failure moves it to blocked. wont-do is an explicit product decision. A clean render is not approval, and approval is not publication.

## Commands

Run from the repository root:

    npm run backlog -w iconsmith-web -- status
    npm run backlog -w iconsmith-web -- generate --limit 1 --max-spend 0.25
    npm run backlog -w iconsmith-web -- generate --slug dna
    npm run backlog -w iconsmith-web -- generate --limit 10 --max-icon-spend 0.25 --max-calls 20
    npm run backlog -w iconsmith-web -- sync

The generator creates one durable Eve session per concept and runs the same paired tournament used by Studio. It records every candidate SVG, available programs, deterministic findings, visual-agent scores, exact API-cost records, and a compact event ledger. It never imports third-party SVG geometry; external libraries are names-only evidence.

Automatic runs default to a 20-call, $0.25 first-pass reservation per icon. `--max-spend` is the batch ceiling and is checked between durable attempts; it never cancels paid work in flight. Per-call spend observation is also a soft cutoff: the pipeline stops before the next model call, but one already-running provider call can cross the threshold. The final Studio gate therefore rejects any run whose complete ledger is over budget or unpriced. Expensive direct and coding-harness arms stay available to Studio and explicit larger-budget runs, but are not silently started when the remaining reservation cannot cover the complete pair.

`model-policy.json` records the live Gateway prices and role assignment used by this campaign. Cheap multimodal models handle orchestration, proposal reading, critique, and ranking. Gemini 3.7 Flash draws and performs the independent visual acceptance audit. Claude Sonnet 5 is reserved for the code-harness escalation tier. Model choice is intentionally role-based: the lowest raw token price does not win if it has not proved reliable with the required structured-output, vision, and tool-calling contract.

Every paint stores its rendered SVG and replayable `.icon.json` document. The human-readable `.icon` DSL is stored only when it represents the whole drawing; filled diagonals and other internal raw marks use `.icon.partial` so a lossy program is never presented as the source of truth.

Tracked workbench files are written only after an Eve turn reaches a terminal boundary. While a turn is active, its session checkpoint lives under `apps/web/.eve/backlog-checkpoints/`. This keeps a progress update from triggering Eve's development source watcher during its own workflow.

Local Eve development allows each icon tournament up to 30 minutes before its durable delivery is retried. The generation tool coalesces duplicate delivery within a process by Eve session and turn, preventing a slow tournament from starting the same paid work twice.

## Approval

Generation deliberately stops at review. Promotion into Icons is a separate human action so a machine-clean attempt cannot silently become part of Central.
