# Public clone readiness

## Outcome

Merge the composition fixes and make the public clone usable for offline drawing and reference-guided agent generation. A clone must include reference artwork, a pinned starter revision, concept alternatives and exact commands. Native agent logins remain user-owned. No private corpus, credentials or private machine paths may be required by the starter.

## Checklist

- [x] Root: verify public main state and existing setup gaps.
- [x] Alignment: bundle original MIT starter reference family and current revision.
- [x] Delivery: portable agent selection and executable setup instructions.
- [x] Arrowhead: isolated public smoke test and CI coverage.
- [x] Root: integrate, verify source, commit and push to main.
- [ ] Root: verify remote commit and clean CI checkout results.

## Verification and limits

Scoped tests plus relocated public smoke exercise actual draw/replay/reference proof generation without the private corpus or author environment. Fresh GitHub CI installs the committed lockfile on Node24 and runs integrated checks. Local native-call full tests currently fail the existing 2 GiB free-disk floor; retain this failure, do not weaken the guard. Authenticated provider generation requires compatible user-installed Codex/Claude and account model access; offline smoke is not a live model or visual qualification result.

## Delivery

Current checkout is main and matches origin/main, with only this task work uncommitted. User explicitly authorizes merge. Commit scoped changes and push normally, never force. Resolve concurrent remote changes before push if necessary. Rollback is a normal revert of task commits.

## Local evidence

The relocated public smoke passes without private corpus or credentials. New focused onboarding/reference tests pass; typecheck/build/check pass. Native permission probe passes with standard Node24.15.0 and PATH Codex0.150.1, including positive inside access and denied outside/source/symlink/network access. Homebrew Node26 library probes failed; attempted library admission did not fix them and was removed. Setup now identifies the tested Node24 distribution. No model dispatch occurred. Clean remote CI remains the integrated fresh-install gate.

Public sandbox preflight is now a reusable `check:agent` command and CI uses pinned public Codex 0.153.4. Local credential-free Node24/Codex0.150.1 probe passes under an empty auth home. Initial implementation needed creation of that empty directory; fixed before delivery. Commit da7e62c is public and anonymous reference downloads match local bytes.
