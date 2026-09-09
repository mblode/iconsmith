<div align="center">

# Iconsmith

**Draw SVG icons with coding agents and repeatable geometry**

Use the included references, write an icon program, and export an SVG.

</div>

## Install

Requires Node.js 24.11 or newer and npm. Run from the repository:

```bash
git clone https://github.com/mblode/iconsmith.git
cd iconsmith
npm ci
npm run build:local
```

## Quickstart

Draw the included icon. No account or API key needed.

```bash
npm run iconsmith -- draw examples/square-check.icon -o square-check.svg
```

Open `square-check.svg`. Edit [the program](examples/square-check.icon) and run it
again with `--force` to replace the file.

## Use an agent

Open this folder in Codex or Claude Code and send:

> Read examples/starter/AGENT.md and execute its drawing task.

The [brief](examples/starter/AGENT.md) includes the references and commands to draw,
check, and preview an icon. Use your own agent account. Inspect the result at its
intended size before using it.

The [four starter references](examples/starter/README.md) are included under MIT.
No private dataset or sibling repository is needed.

## More

See [local setup](docs/local-setup.md) for exports and troubleshooting, or run
`npm run iconsmith -- --help`.

The [unattended foundry](docs/local-foundry.md#advanced-contained-foundry) needs
separate Docker and agent configuration. The public workflow above produces
drafts for review. Structural checks and AI reviews do not establish drawing quality.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
