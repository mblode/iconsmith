<div align="center">

# Iconsmith

**Draw SVG icons with coding agents and repeatable geometry**

Ask your agent for an icon. It draws alternatives, reviews them and exports an SVG.

<img src="docs/showcase.png" alt="Six concepts drawn by the pipeline, each in outlined and filled" width="1016">

<sub>Six concepts, both paints, selected from <a href="output/ten-icons-repaired-2026-09-09/">one run of ten</a> — the other four have contour defects. Regenerate the sheet with <code>npx tsx packages/iconsmith/scripts/showcase-sheet.ts</code>.</sub>

</div>

## Install the skill

Requires Node.js 24.11 or newer and a coding agent with image viewing and independent subagents.
Run in the project where you want to create icons:

```bash
npx --yes iconsmith@0.1.0 skill --out .agents/skills/iconsmith
```

Open or refresh your agent session, then ask:

> Create a bookmark-check icon with iconsmith.

Your agent uses the bundled Blode references, draws competing candidates, checks
native previews and requests independent reviews. It uses your agent account;
there is no separate API key. Unresolved defects leave the result as a draft.
The pipeline is not yet qualified as 10/10.

The default style is blode-icons, bundled under MIT. No private dataset,
repository clone or source build is needed for the installed workflow.
See [local setup](docs/local-setup.md) for outputs, source development and troubleshooting.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
