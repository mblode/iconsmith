# Local setup

Follow [Install and Quickstart](../README.md#install) first. Run commands from the
repository root. The CLI runs from the checkout and is not published to npm.

## Draw and export

Edit [the example program](../examples/square-check.icon), then export and check it:

```bash
npm run iconsmith -- draw examples/square-check.icon -o square-check.svg
npm run iconsmith -- lint square-check.svg
```

Open the SVG in a browser or image viewer. Output paths are relative to the
repository root. Add `--force` to replace an existing file.

The program uses `rect`, `line`, `circle`, `arc`, and named parts. The engine
computes curves from its grid and radius rules and keeps the program editable.

For JSON output without npm's banner:

```bash
npm run --silent iconsmith -- --output json draw examples/square-check.icon
```

Use `draw -` to read stdin, omit `-o` to write SVG to stdout, or pass `--doc` for
the editable document. Errors and lint findings can return a nonzero exit code.

## Draw with an agent

Open Codex or Claude Code in the checkout with your own account and send:

> Read examples/starter/AGENT.md and execute its drawing task.

Either agent can follow the [brief](../examples/starter/AGENT.md). It uses the
bundled style and references, creates a fresh output directory, and runs the
compiler and image checks. Your session controls the model and permissions and
uses your account's allowance. Inspect the SVG and native-size proof before use.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `iconsmith: command not found` | Use `npm run iconsmith --`. There is no global executable. |
| Missing `dist/cli.js` | Run `npm run build:local`. |
| Output already exists | Use a new path, or `--force` with `draw`. Agent tasks need a fresh directory. |
| Node or dependency error | Use Node.js 24.11 or newer and run `npm ci`. |
| Missing corpus | Drawing works without it. Some evaluation checks need datasets that are not included or downloadable. |
| `generate:local` asks for a route | Follow the agent brief above, or configure the [advanced foundry](local-foundry.md#advanced-contained-foundry). Login alone is insufficient. |
| Advanced authentication or runtime failure | Follow the reported error. Do not bypass permission checks or substitute an API key. |

## Other commands

| Command | Use |
| --- | --- |
| `npm run iconsmith -- --help` | List commands and flags. |
| `npm run iconsmith -- new --help` | Draw supported concepts without a model. Other routes need their documented agent or credentials. |
| `parts` | Extract a vocabulary from an SVG directory. |
| `eval`, `conform` | Evaluate icons with the required datasets. See [evaluation notes](evaluation-notes.md). |
| `npm run generate:local -- --help` | Inspect the advanced unattended route without authentication. |

The [foundry guide](local-foundry.md) covers custom references, contained runtimes,
review limits, and contributor checks. The unattended route requires
`--native-route`, `--native-route-hash`, Docker, frozen runtime and credential
assets, and supported author/reviewer identities. Its legacy host route is
disabled. Parent-bound runs retain their original deadline and need a fresh output
directory. See [agent commands](../AGENTS.md) for repository development.
