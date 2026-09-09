<div align="center">

# Iconsmith

**Draw SVG icons with constrained primitives, pinned styles, and repeatable geometry**

Run an icon program locally, inspect its output, or generate candidates with a coding agent.

</div>

## Install

Use Node.js 24.11 or newer and npm. Iconsmith runs from this repository and is not published to npm.

```bash
git clone https://github.com/mblode/iconsmith.git
cd iconsmith
npm ci
npm run build:local
```

## Quickstart

Draw the included square-check program. No API key, subscription, or private corpus is required.

```bash
npm run iconsmith -- draw examples/square-check.icon -o square-check.svg
```

Open `square-check.svg` in a browser. The command refuses to replace an existing file; add `--force` when you want to replace it.

Edit [the example](examples/square-check.icon) and run it again. `rect`, `line`, `circle`, `arc`, and named parts use the engine's grid and radius rules. The host computes curve geometry and retains an editable program.

## Inspect and export

```bash
npm run iconsmith -- lint square-check.svg
```

For scripts, suppress npm's banner so stdout contains only the result:

```bash
npm run --silent iconsmith -- --output json draw examples/square-check.icon
```

`draw -` reads a program from stdin. Without `-o`, text mode writes SVG to stdout. `--doc` emits the editable document instead. Errors and lint findings can produce a nonzero exit; inspect them before using the output.

## AI generation

The clone includes an [original MIT starter reference family](examples/starter/README.md),
its pinned revision, and example meanings. No private corpus or sibling repository
is needed for this example.

After `npm ci` and `npm run build:local`, open Codex or Claude Code in this
checkout with your own account, then send this prompt:

> Read examples/starter/AGENT.md and create a square-check icon in a new
> starter-run directory. Use the bundled references, run the pinned checker,
> and inspect the SVG and native-size proof before reporting the result.

The [authoring brief](examples/starter/AGENT.md) contains the exact commands and
reference paths. This workflow needs no private corpus or sibling repository.
Your agent uses its normal account, model, and permissions; generation consumes
your account usage. Drafts retain structural findings and require visual review.

`generate:local` is the advanced unattended foundry entry point. It requires a
configured contained route, Docker, frozen runtime assets, and supported model
identities; account login alone is insufficient. The legacy host route is disabled.

See [local setup](docs/local-setup.md) for prerequisites and
[the foundry guide](docs/local-foundry.md) for custom references and review.
`npm run generate:local -- --help` works without authentication.
Structural checks and positive AI reviews do not establish professional drawing quality. Inspect the exported icons at their intended size.

## More commands

```bash
npm run iconsmith -- --help
npm run iconsmith -- new --help
```

- **Host constructions:** `new` can draw supported concepts without a model; other routes need their documented credentials or coding-agent CLI.
- **Parts:** extract a vocabulary from a directory of SVGs with `parts`.
- **Evaluation:** `eval`, `conform`, and corpus analysis require additional datasets. The private reference corpus is not included or downloadable with this repository.

The [local setup guide](docs/local-setup.md) covers prerequisites and troubleshooting. See [the evaluation notes](docs/evaluation-notes.md) for interpreting scores.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
