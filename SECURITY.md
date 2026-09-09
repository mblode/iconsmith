# Security

Do not put credentials or private reference artwork in public issues, pull
requests, or uploaded logs. For a vulnerability containing sensitive information,
use GitHub's private vulnerability reporting when available, or arrange a private
disclosure with the maintainer before sharing the details.

The CI secret check scans Git history with Gitleaks 8.30.1. To run the same check
locally after installing Gitleaks:

```bash
gitleaks git . --log-opts="--all --full-history" --redact=100 --no-banner
```

The configuration retains the default detectors and narrowly excludes reviewed
evidence hashes, verification lock identifiers, historical budget prose, and an
old client-side analytics token. Do not add a directory-wide exception for logs
or generated output. A clean scan is not a guarantee that arbitrary private data
or licensed artwork can be published.

Keep credentials in ignored environment files and private assets in the existing
ignored corpus or staging directories. Ignore rules do not remove files from Git
history. Revoke exposed credentials before considering history cleanup; review
branches, pull requests, and Actions logs as well as the current tree.

The package remains private on npm. Public access to the source repository does
not change reference-artwork permissions or grant access to the private corpus.
