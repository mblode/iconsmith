---
name: iconsmith
description: Creates SVG icons matching the Blode family, with native previews and independent visual review. Use when asked to "create an icon", "add an icon to Blode", or "match this icon set". For logos or illustrations, use a dedicated design workflow.
compatibility: Requires Node.js >=24.11, npm, shell and filesystem access, image viewing, and independent subagents. The host agent supplies the model; no API key is required.
---

# Iconsmith

Create a 24px outlined icon in the bundled Blode family. Deliver the SVG and native previews first, with an honest reviewed or draft status. This workflow extends a family; it does not create logos or a new style system.

Use the user's requested model in the host agent session. Do not launch a separate API or provider CLI when host capabilities are unavailable. Missing image viewing or independent reviewers leaves the result a draft; name the missing capability.

## Prepare

Run the installed `iconsmith` CLI. If it is not on PATH, use `npx --yes iconsmith@0.1.0` in its place. Resolve reference links below relative to this installed SKILL.md, not the working directory.

```bash
iconsmith prepare bookmark-check --out icon-work/bookmark-check
```

Replace the concept with the requested name and use a new output directory. The command writes a pinned `revision.json`, `request.json`, and related drawings in `references/`. Read these and open `references/siblings.png` when present. The twelve revision anchors describe the style; sibling drawings show the actual ticks, handles and other elements this concept reuses. The lookup excludes the target, its byte twins and Lucide-derived drawings.

Record the intended object and modifier in the request before drawing. For example, search-check needs a magnifying glass and a check, not just a check. Use the pinned family; a request for another family needs a supplied revision and an explicitly scoped workflow.

## Author and check

Read [the drawing reference](references/drawing.md) for the house spec, DSL grammar, supported construction and optical placement. Execute the CLI rather than recreating its checker.

Use two independent authors with the same request and references, each working in its own candidate directory. Each writes `outlined.icon` using the DSL, beginning with the requested `icon` name and `finish outlined`. No raw path data, compiler edits or revision changes to make a candidate pass. Give authors the drawing reference; this coordinating workflow does not need to run recursively inside them.

```bash
iconsmith check icon-work/bookmark-check/candidate-a --revision icon-work/bookmark-check/revision.json
```

The checker compiles, replays and writes an SVG, `checks.json`, native pixels and enlarged light/dark proofs. Each check retains an immutable snapshot. Fix compilation errors and inspect `outlined.native.png` and `outlined.proof.png`; image metadata does not count as inspection. Resolve warnings with a specific visual reason or a repair.

## Review and repair

Use two fresh reviewers who did not author either candidate. Present anonymously labelled images in shuffled order with the same reference packet. Exclude author reasoning, model, route and earlier scores. First record each reviewer's free recognition without the requested concept, then reveal the frozen request and assess the object and modifier.

Inspect native and enlarged light/dark proofs for family fit, contour continuity, clearance, modifier placement, stroke weight and surviving distinctions. Measure reused elements against sibling drawings. Normal antialiasing alone is not a defect, and a downsample is not a separately designed optical master.

Save reviews tied to the exact artifact hashes, with reviewer identity, free recognition, semantic match, craft score, ship-unchanged decision, visible defects and uncertainty. Scores 9–10 mean ready without edits; 7–8 need refinement; 6 or below need substantial repair. Missing reviews are incomplete, not aesthetic rejection.

Send specific defects back to the author. Retain each version, rerun the checker, and have both reviewers inspect the changed artifact. Allow at most three visual repair rounds per candidate. Preserve the prior candidate before each revision; do not overwrite the only record of a drawing.

## Deliver

Select only a candidate with exact replay, no structural errors, resolved warnings, and both reviewers confirming the intended meaning, scoring at least 9, accepting it unchanged, and reporting no critical defect or uncertainty. Among eligible candidates, prefer the stronger lower reviewer score, then family fit.

Copy the selected SVG, DSL and inspected proofs into `selected/`. Write `review.md` with the requested concept, candidates, reviews, repairs, selection and remaining issues. Keep detailed evidence beside the output. If none qualifies, deliver retained drafts with the visible blocker instead of claiming success.

A selected result is an independently reviewed development result. Keep the compiler's `craftApproved: false`: it reports structural checks, not visual approval or pipeline-wide qualification. No 10/10 pipeline claim follows from a single icon.

## Gotchas

- A check can pass while the drawing depicts the wrong object. Independent recognition is essential.
- Sibling DSL elements marked `quantised` change when the canvas draws them. Compare the rendered geometry, not just the numbers.
- A clean lint report is not proof of visual quality. Checker crashes and malformed reports are failures, never empty findings.
- Commands that create a request, skill or proof directory refuse an existing destination. Choose another name; do not delete a user's work to make the command succeed.
