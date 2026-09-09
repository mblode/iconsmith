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

## Agent-assisted drafting

After installing dependencies and building, open Codex or Claude Code in this
checkout and ask it to read [the starter authoring brief](../examples/starter/AGENT.md):

> Read examples/starter/AGENT.md and create a square-check icon in a new
> starter-run directory. Use the bundled references, run the pinned checker,
> and inspect the SVG and native-size proof before reporting the result.

Use your own agent login and model. Either agent can carry out this workflow;
it does not require both subscriptions. The brief uses original MIT references,
the bundled pinned revision and the real compiler/checker. Its outputs are drafts
with structural diagnostics, not independently approved artwork. Agent invocation
and permissions belong to your normal coding-agent session.

## Advanced unattended foundry

`npm run generate:local -- --help` describes the separate contained foundry
entry point. It requires `--native-route` and `--native-route-hash`, Docker,
frozen runtime/credential assets, and supported author/reviewer identities.
The legacy host-author route is disabled; signing in and passing `--model`
alone cannot run it. It is not the public quickstart. See
[the local foundry guide](local-foundry.md) for this research route and its limits.
Parent-bound runs retain their original deadline and need a fresh output directory.

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

### Advanced native sandbox probe

Use the standard Node 24 distribution (for example `nvm install 24` and `nvm use 24`) for this low-level sandbox probe. Passing it does not configure or validate an entire contained foundry route. The native read/network boundary probe passed on macOS with Node 24.15.0 and Codex CLI 0.150.1. Homebrew Node 26.7.0 failed because its separately installed shared libraries were blocked; that combination is not supported by the tested restricted runtime. The checker fails before author dispatch rather than widening file access. Offline drawing is unaffected.

Run `npm run check:agent` before signing in to check the real generation sandbox with no account or model call. It uses an empty temporary auth directory and verifies both allowed workspace operations and denied outside-file/network access. Pass `-- --codex /path/to/codex` for an explicit executable. `npm run check:public` separately checks included references and exports without agents or a corpus.

The agent sandbox is tested on macOS. Linux offline build and reference smoke tests run in CI, but Linux agent compatibility is not yet verified: the Ubuntu hosted runner rejected Codex 0.153.4 bubblewrap loopback setup (`RTM_NEWADDR: Operation not permitted`) before the probe ran. Run `check:agent` on your host; a failed check blocks generation. Windows native agent support is unverified.
