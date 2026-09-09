# Local setup

Run commands from the repository root. Use Node.js 24.11 or newer, npm, and the
committed lockfile (`npm ci`). The offline CLI needs no account or environment file.

## Offline engine

```bash
npm run build:local
npm run iconsmith -- draw examples/square-check.icon -o square-check.svg
npm run iconsmith -- lint square-check.svg
```

Open the exported SVG in an image viewer. Output paths resolve from
the repository root. Use a new filename, or explicitly pass `--force` to replace an
existing SVG. When piping output, use `npm run --silent iconsmith -- ...` or invoke
`node packages/iconsmith/dist/cli.js` directly.

## Pinned-style generation

```bash
npm run generate:local -- --help
```

The clone includes `examples/starter/revision.json`, its `24` master, four
original MIT reference drawings, and `examples/starter/meanings.json`. These files
need no private corpus or sibling checkout. To try generation:

1. Install [Codex CLI](https://help.openai.com/en/articles/11096431) with
   `npm install -g @openai/codex` and run `codex login` with your ChatGPT account.
2. Install [Claude Code](https://code.claude.com/docs/en/quickstart) for your
   operating system and run `claude auth login` with your Claude subscription.
3. Check `codex login status` and `claude auth status`. This route requires native
   subscription authentication; API-key or cloud-provider authentication is not
   a fallback. Credentials and subscriptions cannot be distributed in a clone.
4. Run the example, choosing a model available to your Codex account:

```bash
npm run generate:local -- square-check ./starter-run \
  --revision examples/starter/revision.json --master 24 \
  --meanings examples/starter/meanings.json --finish outlined \
  --model YOUR_CODEX_MODEL
```

The author executable defaults to `codex` on PATH; `--codex /path/to/codex`
selects another installation. There is no macOS app-bundle dependency. The
restricted runtime needs Codex's `exec --ignore-user-config` and `sandbox -P`
permission-profile support. Before authoring, the runtime checks that the packet
is readable and writable while outside files, symlinks and network access are
actually denied. Unsupported runtimes fail this check; they never fall back to
broader permissions. Keep at least 2 GiB free on the evidence filesystem.

Standalone runs freeze their deadline once at startup, with a twenty-minute
maximum. Parent-bound campaigns must supply their original `--deadline-at`; child
startup does not renew it. Each run requires a new output directory whose parent
already exists.

For your own family, supply a revision accepted by `createStyleRevision`, a master
name declared in it, and 3–12 distinct plausible meanings including the concept.
Use reference artwork you are permitted to use; preserve its provenance. The
starter is an illustrative, unvalidated family, not a production quality claim.
The private evaluation corpus remains unavailable. See
[the local foundry guide](local-foundry.md) for custom references and advanced
contained routes.
A completed run retains programs, SVGs, proofs, attempts and review receipts.
`delivery.json` describes delivery, and `request.json` records the terminal status.
A structurally delivered, reviewer-clear result exits zero. Review uncertainty or
incomplete generation exits nonzero. Positive review does not qualify the critic
or approve the artwork. Keep failed attempts when inspecting or retrying a run.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `iconsmith: command not found` | Use the root npm script. This repository installs no global executable. |
| Missing `dist/cli.js` | Run `npm run build:local` from the repository root. |
| Existing output file or directory | Choose a new destination. `draw` supports explicit `--force`; foundry attempts require a fresh directory. |
| Unsupported Node or native dependency failure | Check `node --version`, select Node 24.11 or newer, and rerun `npm ci`. |
| Missing corpus | Offline drawing still works. Corpus-dependent tests and measurements remain unavailable. |
| Authentication or restricted-runtime failure | Follow the named login/runtime error; do not bypass the permission check or substitute an API key. |

To check repository changes, see [the agent commands](../AGENTS.md). Full verification
on a clone without private datasets uses `npm run verify -- --allow-missing-corpus`;
its skipped measurements are explicitly unverified, not foundry qualification.
The cached-inventory measurement in `campaign-manifest.test.ts` additionally
requires `.corpus/manifest.json` and `.corpus/icons.jsonl`. The exact-source check
in `source-feature-admission-profile.test.ts` requires the sibling `blode-icons`
checkout. Their skips are separate from the thirteen legacy corpus canaries;
the portable manifest and profile-validation controls still run.
The three canonical-library controls in `ai-control-packet.test.ts` also require
the sibling `blode-icons` artwork and metadata; their explicit skips are separate
from the private-corpus canary. The library is resolved relative to this checkout.

## Dead-code checks

`npm run check:dead` runs the pinned Knip version and is included in `npm run check`.
Knip discovers the CLI from tsdown and tests from Vitest. `knip.json` also lists
standalone research and maintenance commands that are invoked directly rather
than imported. Keep these explicit; new helper modules must have real consumers.
Entry exports are checked too. `mkfifo` is a system binary used by the container
runtime tests, so it is the sole binary exception.

### Tested native runtime

Use the standard Node 24 distribution (for example `nvm install 24` and `nvm use 24`) for agent generation. The native read/network boundary probe passed with Node 24.15.0 and Codex CLI 0.150.1. Homebrew Node 26.7.0 failed because its separately installed shared libraries were blocked; that combination is not supported by the tested restricted runtime. The checker fails before author dispatch rather than widening file access. Offline drawing is unaffected.
