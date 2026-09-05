# 06 Prove an optional Glyphs authoring bridge

**DEFERRED / SUPERSEDED:** The user requires 100% AI-generated artwork. Do not execute the authoring workflow below. Retained only as historical research. Neither Glyphs licensing nor manual editing blocks the foundry. Any future editor integration is downstream of generation and requires a concrete export/inspection need.

Read the common contracts, STOP conditions and verification in [the authoritative plan](../reference-guided-foundry.md). This is a local planning ticket, not dispatched work.

**What to build:** Evaluate six diagnostic master assets through Glyphs 4 import/edit/export. If fidelity is proven, document or implement only the minimal one-way approved-export import needed by the foundry. This does not block other work and is not automatic two-way sync.

**Blocked by:** none; an active Glyphs license is required for the experiment

## Acceptance criteria

- [ ] Record exact app build, source format and plugin/script versions. Resolve the expired-trial condition through the user's normal license flow.
- [ ] Verify native icon document export for dimensions, names, counters, curves and six diagnostic constructions.
- [ ] Verify the exact scripted SVG export mechanism rather than assuming the font-export CLI handles icons.
- [ ] Repeated pinned exports are compared geometrically and visually; unexplained change prevents approving the bridge.
- [ ] Human masters remain authoritative in their native project; imported exports become immutable revisions with source/export hashes.
- [ ] Lost component/interpolation metadata is identified and preserved in native sources/manifest; no claim of lossless SVG-to-Glyphs reconstruction.
- [ ] If scripting fails, retain a documented manual-export workflow with the same verification and provenance; Linux CI still builds approved runtime artifacts without Glyphs.

## Verification and finish

Run touched-scope tests and the common plan gates. Record the command, expected behavior, actual result and artifact locations in the implementation notes. Paid experiments require an explicit total ceiling. Stop only the dependent work when a named STOP condition is met; continue independent work. The ticket closes when its observable outcome and all criteria are evidenced, not when files merely exist.
