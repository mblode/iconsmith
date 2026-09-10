# Create and independently review an icon

Create one outlined `square-check` icon in the Blode house style, using the bundled blode-icons reference family.
Use parallel AI authors and independent AI reviewers. Spend effort on competing
candidates and repairs; do not stop at the first structurally valid drawing.
This is the default agent workflow. It does not yet have a qualified 10/10 score.

## 1. Pin the request

Read `packages/iconsmith/SKILL.md`, `examples/starter/revision.json` and the
reference drawings in `examples/starter/references/`. The revision's `24` master
and Blode references are the house defaults. The full library is bundled at
`packages/iconsmith/library/blode-icons`; no private corpus, sibling repository
or download is needed.

Before drawing, find the set's own drawings of any element the concept reuses.
A tick, arrow, tray or handle keeps the same geometry across Blode; for
`square-check` that element is the tick already drawn in `circle-check`. List the
matching files in `packages/iconsmith/library/blode-icons/icons-svg/` (skip any
file carrying a `lucide` class), read their path data, and pin those siblings
next to the references for authors and reviewers. Do not pin or copy the set's
drawing of the requested concept itself.

Record the intended object, action and native size before drawing. Create a fresh
`starter-draft` directory; choose another name if it exists. Preserve every
candidate, review and revision beneath it. Never overwrite an earlier attempt.

## 2. Draw competing candidates

Dispatch at least two authors in parallel with the same request and pinned
references. Give each a separate candidate directory. Neither author sees the
other's draft. Each writes `outlined.icon`, beginning with `icon square-check`
and `finish outlined`. Use only the constrained DSL. Do not write raw SVG paths,
modify the compiler or change the revision to make checks pass. Do not copy
`examples/square-check.icon` as a submission.

Compile each candidate with the real checker, substituting its directory:

```bash
node --import tsx packages/iconsmith/scripts/style-check.ts examples/starter/revision.json 24 starter-draft/candidate-a outlined
```

The checker writes the SVG, artifact, findings, enlarged proof, native pixels and
immutable snapshots. Resolve compilation errors and inspect every warning. Open
both `outlined.proof.png` and `outlined.native.png`; command success and image
metadata are not visual inspection. Authors can revise their own drafts before
review, retaining previous versions.

## 3. Review without author influence

Use two fresh reviewer contexts that did not author the candidates. Present
anonymously labelled images in shuffled order. Exclude author reasoning, route,
model, cost, prior scores and preferred candidate. Reviewers first describe the
object and action without seeing the requested concept. Preserve that response,
then compare it with the frozen request. A clean checkmark fails a request for a
magnifying glass containing a checkmark.

Have both reviewers inspect enlarged contours and actual native pixels on light
and dark backgrounds. Give them the pinned sibling drawings from step 1 and have
them measure the reused element against the set's own version: an oversized or
undersized tick fails family fit even when it looks balanced on its own. Check
interior mark placement within its own host, clearance, arrow direction and arrowhead shape, coherent silhouettes, counter
openings, stroke consistency and fit with the pinned references. A resized 24px
master is not an independently designed native 16px master.

Record each review in `reviews/`: candidate identity, inspected artifact hashes,
free recognition, meaning match, craft score, ship-unchanged decision, specific
visible defects and uncertainty. Use 9–10 for ready without edits, 7–8 for
recognizable drawings needing refinement, and 6 or below for substantial repair.
Do not count author self-review as independent approval. Treat any critical
finding or recognition conflict as a rejection, even if the average score is high.

## 4. Repair and select

Send localized defects to the author and retain each repaired candidate as a new
version. Rerun the checker and have both reviewers inspect the new images. Allow
up to three repair rounds per candidate; if a candidate still fails, report it
as unresolved instead of looping indefinitely or lowering the standard.

Select only among candidates with exact replay, no structural errors, both
reviewers recognizing the requested meaning, both scoring at least 9, both
willing to ship unchanged, and no unresolved critical finding or uncertainty.
Resolve warnings with visible evidence. Rank eligible candidates by their lower
reviewer score, then family fit; cost and speed do not break quality ties.
If none qualify, deliver the retained drafts and specific blocker, not an
approved icon. Missing independent reviewers or image inspection also leaves
review incomplete. Do not silently replace them with the author's self-review.

## 5. Deliver the evidence

Copy the selected SVG, program and exact proofs to `selected/` only after the
checks above pass. Write `review.md` with a task checklist, requested and
completed candidates, reviews, repairs, remaining warnings, selection and links.
Call this an independently reviewed development result. Keep the compiler's
`craftApproved: false` field intact: this workflow has not passed the sealed
critic and population gates in `docs/plans/generation-quality-10.md`, so neither
local scores nor a successful export authorize a pipeline-wide 10/10 claim.

For another icon, replace `square-check` with the user's concept. Keep the pinned
family unless the user supplies another revision. Use the user's agent account;
do not silently switch to an API provider if that account or its tools fail.
