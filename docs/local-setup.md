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

This is a separate workflow from the offline example. It needs:

- A style revision JSON accepted by `createStyleRevision` in
  `packages/iconsmith/src/pipeline/style.ts`. It pins the compiler identity,
  masters, policy, references and admitted parts. Preserve the revision supplied
  with a run rather than editing its hash or updating an old compiler identifier.
- A master name that exists in that revision, such as `large` or `16`.
- A JSON array of 3–12 distinct plausible concept labels, including the exact
  requested concept. Freeze the alternatives before generating.
- Reference artwork you are permitted to use. The private corpus and existing
  foundry staging files are not distributed. Source admission and reference
  provenance rules still apply to your inputs.
- At least 2 GiB free on the evidence filesystem for contained native calls.
- Native ChatGPT and Claude subscription logins for the default route, with a
  Codex executable supporting the restricted runtime. The runner checks login
  and permissions before authoring. It has no API fallback. Advanced contained
  routes have their own pinned runtime manifests and prerequisites.

The full command, input semantics, output receipts and advanced routes are in
[the local foundry guide](local-foundry.md). Its `path/to/...` arguments identify
inputs you must supply; they are not files bundled with a fresh clone. The offline
example demonstrates the compiler only and is not a qualified reference family.

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
