# Public clone readiness

## Outcome

Merge the composition fixes and make the public clone usable for offline drawing and reference-guided agent drafting in an ordinary Codex or Claude session. A clone must include reference artwork, a pinned starter revision, concept alternatives and exact commands. Native agent logins remain user-owned. The advanced unattended foundry requires separately configured contained assets and is not the public quickstart. No private corpus, credentials or private machine paths may be required by the starter.

## Checklist

- [x] Root: verify public main state and existing setup gaps.
- [x] Alignment: bundle original MIT starter reference family and current revision.
- [x] Delivery: portable agent selection and executable setup instructions.
- [x] Arrowhead: isolated public smoke test and CI coverage.
- [x] Root: integrate, verify source, commit and push to main.
- [x] Root: verify remote commit and clean CI checkout results.

## Verification and limits

Scoped tests plus relocated public smoke exercise actual draw/replay/reference proof generation without the private corpus or author environment. Fresh GitHub CI installs the committed lockfile on Node24 and runs integrated checks. Local native-call full tests currently fail the existing 2 GiB free-disk floor; retain this failure, do not weaken the guard. Authenticated provider generation requires compatible user-installed Codex/Claude and account model access; offline smoke is not a live model or visual qualification result.

## Delivery

Task implementation commits are on public main. User explicitly authorizes merge. Push scoped follow-ups normally, never force. Resolve concurrent remote changes before push if necessary. Rollback is a normal revert of task commits.

## Local evidence

The relocated public smoke passes without private corpus or credentials. New focused onboarding/reference tests pass; typecheck/build/check pass. Native permission probe passes with standard Node24.15.0 and PATH Codex0.150.1, including positive inside access and denied outside/source/symlink/network access. Homebrew Node26 library probes failed; attempted library admission did not fix them and was removed. Setup now identifies the tested Node24 distribution. No model dispatch occurred. Clean remote CI remains the integrated fresh-install gate.

Public sandbox preflight is now a reusable `check:agent` command and CI uses pinned public Codex 0.153.4. Local credential-free Node24/Codex0.150.1 probe passes under an empty auth home. Initial implementation needed creation of that empty directory; fixed before delivery. Commit da7e62c is public and anonymous reference downloads match local bytes.

## Final route correction

An end-to-end command audit found that the old no-manifest generate:local example could never pass the contained author/reviewer guards. Replaced public onboarding with examples/starter/AGENT.md for normal user-directed Codex or Claude drafting. The exact pinned checker command runs in the isolated public smoke. The advanced CLI now fails before authentication/output creation when no contained route is configured, with an actionable pointer to the public brief. No guards removed. No authenticated model dispatch or independent craft qualification claimed.

## Completion evidence

Source107554330adb6960eb9c3239fc588bcaf72eeada passed clean GitHub CI34338775915: 2,335 tests passed,33 expected missing-dataset skips; full verification, relocated public agent-packet smoke, macOS public Codex0.153.4 sandbox and secret scan passed. A coding agent also executed the bundled brief, authored a new square-check, ran the pinned checker and inspected the actual proof: exact replay, no findings, draft with craftApproved false. The final receipt is docs/log/public-clone-readiness-2026-09-09.json. All task commits pushed normally to public main. This completion covers the public user-directed draft workflow; advanced unattended runtime bootstrap remains unbundled and no authenticated provider CLI run is claimed.
