# 05 Curate and release reproducible icon libraries

Read the common contracts, STOP conditions and verification in [the authoritative plan](../reference-guided-foundry.md). This is a local planning ticket, not dispatched work.

**What to build:** Automatically evaluate draft family specimens, accept exact artifacts and export a versioned library with SVGs, source references/programs, metadata and notices. Independent AI evaluations and deterministic checks replace mandatory human aesthetic approval. Consumers can obtain the previous release after a rollback.

**Blocked by:** 04

## Acceptance criteria

- [ ] A release manifest identifies every required concept/master/finish and blocks on missing, rejected or unapproved entries.
- [ ] Published capability and quality claims match measured coverage; automated acceptance is not labeled human-perceived equivalence.
- [ ] Approval is bound to artifact hashes; subsequent regeneration remains a new draft.
- [ ] Changed parts mark dependent drafts stale and expose specimen diffs without modifying old releases.
- [ ] Repeated export from the same pinned inputs produces identical canonical artifacts and metadata.
- [ ] SVG downloads and generated React output, where used, derive from the same approved artwork; counters and accessible usage conventions survive.
- [ ] Source provenance and required notices accompany the output; disallowed assets block release.
- [ ] Release pointer rollback restores prior approved output, which remains addressable.
- [ ] Specimen browsing shows actual-size variants and per-family comparisons; no empty or invalid tile counts as successful coverage.

## Verification and finish

Run touched-scope tests and the common plan gates. Record the command, expected behavior, actual result and artifact locations in the implementation notes. Paid experiments require an explicit total ceiling. Stop only the dependent work when a named STOP condition is met; continue independent work. The ticket closes when its observable outcome and all criteria are evidenced, not when files merely exist.
