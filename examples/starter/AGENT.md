# Draw a starter icon

Create one outlined `square-check` icon as a reviewable draft, using only this
repository and the bundled original starter family. This is a user-directed
agent task, not an independently reviewed foundry run.

1. Read `packages/iconsmith/SKILL.md` for the DSL syntax and
   `examples/starter/revision.json` for the selected style. The revision's `24`
   master and original reference drawings override generic house defaults in
   the skill. The included reference SVGs and `.icon` programs are in
   `examples/starter/references/`; inspect them to understand the family.
   No private corpus, sibling repository or external icon pack is needed.
2. Use a fresh output directory named `starter-draft` at the repository root.
   If it exists, choose a new name and substitute it consistently below. Write
   `outlined.icon` in that directory. Start it with `icon square-check` and
   `finish outlined`. Use only the constrained DSL; never write raw SVG path
   coordinates, modify the compiler, or rewrite the pinned revision to make
   checks pass. Do not copy `examples/square-check.icon` as your submission.
3. Compile, replay, lint and render the actual program with the pinned checker:

   ```bash
   node --import tsx packages/iconsmith/scripts/style-check.ts examples/starter/revision.json 24 starter-draft outlined
   ```

   The checker writes `outlined.svg`, `outlined.artifact.json`, `checks.json`,
   `outlined.proof.png`, `outlined.native.png`, and immutable `check-*`
   snapshots. Fix compilation errors and inspect every finding. Explain any
   remaining warnings with visible evidence rather than dismissing them because
   they have warning severity. Rerun the same command after every program edit.
4. Open the final `outlined.proof.png` and `outlined.native.png` using your image
   viewing tool. Inspect native pixels and enlarged contours, including the
   check's optical placement inside its own square, surrounding clearance,
   corner consistency and readable check arms. Whole-icon centering is not
   enough. If you cannot inspect images, state that visual review is incomplete;
   do not infer visual quality from a successful command or image metadata.
5. Write a concise `review.md` inside the output directory describing what you
   inspected, remaining defects or uncertainty, and any warnings. Link the SVG,
   proof and report in your response. Call the result a draft pending user review.
   Preserve `craftApproved: false`: exact replay and structural checks do not
   grant independent visual approval or production qualification.

For a different concept, replace `square-check` in the request and program with
the user's chosen concept. Keep the same pinned family unless the user provides
another revision. Do not dispatch another agent or paid reviewer as part of this
brief unless the user explicitly requests it.
