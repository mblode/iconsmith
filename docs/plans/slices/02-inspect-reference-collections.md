# 02 Import and inspect versioned reference collections

Read the common contracts, STOP conditions and verification in [the authoritative plan](../reference-guided-foundry.md). This is a local planning ticket, not dispatched work.

**What to build:** Import source files into an evidence collection, inspect native/normalized specimens and measurements, and expose incomplete/unsupported assets honestly. Reuse existing corpus adapters. Start acquisition manifests for Cursor, a named OpenAI product surface and current X; record missing source coverage rather than declaring all icons captured.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] Original bytes and hashes, product/surface/version, names/variants and native dimensions survive import.
- [ ] Repeated import is stable and duplicate geometry is reported without deleting source-name relationships.
- [ ] Each collection reports captured count, exclusions and missing coverage; historical product families, logos and emoji are not silently merged.
- [ ] Simple supported SVGs render equivalently; unsupported transforms, inherited paint, clipping or other features are explicitly rejected until supported with fixtures.
- [ ] Font extraction, when required by an actual asset, retains glyph/codepoint mapping and compares the result with the original font render.
- [ ] Analysis and conditioning permissions are distinct; an imported collection cannot bypass the existing reference gate or acquire an original/house origin.
- [ ] Measurements report units, sample count, uncertainty and examples; normalized 24-unit data never overwrites a native master.
- [ ] Private assets stay outside public fixtures/releases, and the existing Central corpus path and skip behavior remain intact.

## Verification and finish

Run touched-scope tests and the common plan gates. Record the command, expected behavior, actual result and artifact locations in the implementation notes. Paid experiments require an explicit total ceiling. Stop only the dependent work when a named STOP condition is met; continue independent work. The ticket closes when its observable outcome and all criteria are evidenced, not when files merely exist.
