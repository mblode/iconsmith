# Public repository readiness

On 9 September 2026, the owner instructed: "Git commit and push and make public"
after receiving the audit findings. Publication of the reviewed history is
authorized; no additional license documents were supplied. Audit base: `bcd321b99d06ea521dd12388c50dbd6924b416ce` plus the
working files captured during the audit. Concurrent generation work was preserved.

## Disposition of the audit findings

1. **Artwork publication authorized by the owner.** The current tree contains generated
   geometry, reference comparison images, and Central-derived work. History also
   contains `apps/web/lib/studio/house-icons.json`,
   `apps/agent/data/house-icons.json`, and four Glide font binaries under
   `apps/web/app/fonts/` and `apps/web/lib/og-assets/`. The engine records a Central
   license held out of band; no redistribution grant was available in this audit.
   The owner directed publication after reviewing this finding. This records
   that decision, not an independent verification of redistribution terms. The
   source's MIT license and runtime admission policy do not establish those rights.
2. **Six Cursor action-link blocks removed.** Six bot review comments
   on PRs [#1](https://github.com/mblode/iconsmith/pull/1) and
   [#11](https://github.com/mblode/iconsmith/pull/11) contain encoded links with
   embedded encryption material. These are not confirmed account credentials;
   their access scope was not tested. Following the owner's instruction to
   proceed, all six comments were edited to remove only the action-link block.
   Readback verified the prepared body for every comment; review prose is intact.

GitHub exposes Actions history and logs when a repository becomes public, so this
audit included those surfaces. [GitHub visibility documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)

## Publication changes

- Added pinned, checksum-verified Gitleaks CI, read-only workflow permissions,
  and checkout credential persistence protection.
- Expanded credential ignore rules and added [security guidance](../SECURITY.md).
  The private corpus remains ignored at its exact existing path.
- Updated Sharp from 0.35.3 to 0.35.4 in the manifest and lockfile, addressing
  [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- Made two exact-source measurements explicitly skip when their private or
  sibling datasets are absent. Their portable validation tests still run.
- Corrected the licensing comment that inferred redistribution permission from
  existing MIT distribution.

## Evidence and limits

Gitleaks scanned 259 commits across fetched history, including 19 pull-request
heads. The working-tree snapshot contained 2,138 files. Default-detector findings
were reviewed hashes, lock UUIDs, budget prose, and one historical public
[PostHog project token](https://posthog.com/docs/api). Narrow configured scans
returned zero findings; all three synthetic credential controls were detected.
No confirmed account or provider credential was found in the scanned source or
history. This is a scoped scan result, not proof that every kind of private data
is absent.

Of 216 Actions runs, 197 log archives were available and scanned without findings;
19 returned HTTP 404 and could not be audited. No Actions artifacts or release
assets were present. PR text scans found the six action-link blocks above. The
ignored private corpus did not appear in the inspected Git history.

In an isolated snapshot without private datasets, build, typecheck, lint, dead-code
and boundary checks passed; the CLI drew and linted an icon with zero errors and
warnings using Sharp 0.35.4. The production dependency audit reported zero
vulnerabilities. The active checkout's installed Sharp remains 0.35.3 to preserve
the ongoing campaign; refresh its dependencies after that work has stopped.

The full default-worker verification initially failed: 2,520 tests passed,
9 failed, and 29 skipped. Two missing-data failures were fixed. All five failing
files plus renderer tests then passed with one worker: 209 passed, 2 explicitly
skipped. With the real local datasets, the two modified test files passed all
16 tests with no skips. This is not a completed green full-suite verification;
the earlier process-timing failures and timeouts remain recorded.

The initial [audit receipt](log/public-readiness-2026-09-09.json) is retained as
recorded, including its then-pending decisions. The
[publication follow-up](log/public-publication-2026-09-09.json) records the owner's
subsequent instruction, verified comment edits, and publication execution.
The publication commit excludes separate uncommitted campaign work; GitHub CI
will validate that committed source independently of the local audit snapshot.
