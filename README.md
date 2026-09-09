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

Use macOS and the standard Node 24 distribution for the tested agent runtime (see [setup](docs/local-setup.md#tested-native-runtime)). Install [Codex CLI](https://help.openai.com/en/articles/11096431) and
[Claude Code](https://code.claude.com/docs/en/quickstart), then sign in to your
ChatGPT and Claude subscriptions. The generator uses `codex` and `claude` on PATH.
Generation consumes your subscription usage; credentials are not included.

```bash
npm install -g @openai/codex
npm run check:agent
codex login
claude auth login
npm run generate:local -- square-check ./starter-run \
  --revision examples/starter/revision.json --master 24 \
  --meanings examples/starter/meanings.json --finish outlined \
  --model YOUR_CODEX_MODEL
```

Replace `YOUR_CODEX_MODEL` with a model available to your account. Use a new output
directory for each run. The command checks subscription authentication and actual
sandbox permissions before authoring; unsupported runtimes fail without falling
back to broader access. The starter demonstrates the workflow and is not a
qualified production icon family.

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
