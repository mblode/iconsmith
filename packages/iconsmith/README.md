# Iconsmith

Create SVG icons matching the Blode family with your coding agent.

Requires Node.js 24.11 or newer, npm, image viewing and independent subagents. Install the skill in your project:

```bash
npx --yes iconsmith@0.1.0 skill --out .agents/skills/iconsmith
```

Open or refresh your agent session, then ask:

> Create a bookmark-check icon with iconsmith.

The agent uses your existing account. No separate API key, repository clone, private corpus or source build is required. It draws alternatives, checks native previews and obtains independent reviews. Unresolved results remain drafts.

The [skill](SKILL.md) is the canonical workflow. Run `npx iconsmith@0.1.0 --help` for the local CLI: prepare references, compile/check, render and lint. The package contains the MIT Blode reference library and the 24px outlined revision. No unattended API generation or JavaScript package API is exposed.

Source and research tools: [GitHub](https://github.com/mblode/iconsmith).
