# Local setup

Install the skill in the project where you want the icons:

```bash
npx --yes iconsmith@0.1.0 skill --out .agents/skills/iconsmith
```

Requires Node.js 24.11 or newer. Open or refresh Codex or another compatible
coding agent, then ask it to create your requested icon with iconsmith.
The [skill](../packages/iconsmith/SKILL.md) owns the complete workflow and review rubric.
Your agent account supplies authoring and reviews; the CLI makes no model calls.

## Result files

The agent creates a fresh request directory containing `request.json`, a pinned
`revision.json`, sibling reference drawings, and separate candidate directories.
Each candidate contains `outlined.icon`, `outlined.svg`, `checks.json`,
`outlined.proof.png`, `outlined.native.png`, and immutable `check-*` snapshots.
Reviews bind to the exact artifact hashes. `selected/` contains an accepted
candidate only when both independent reviews pass. `review.md` explains the
selection or the unresolved defects.

The initial workflow targets 24px outlined icons. A smaller raster preview is
not an independently authored optical master. Structural checks do not establish
visual approval or a pipeline-wide quality score.

## Source development

```bash
git clone https://github.com/mblode/iconsmith.git
cd iconsmith
npm ci
npm run build:local
node packages/iconsmith/dist-agent/cli.js --help
```

Use `node packages/iconsmith/dist-agent/cli.js` in place of `iconsmith` when
following the skill from source. `npm run check:package` verifies a real tarball
with fresh dependencies outside the checkout. `npm run check:public` checks the
source packet. The research CLI remains available through `npm run iconsmith`;
it is not installed by the public package.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node version error | Install Node.js 24.11 or newer. |
| Skill not discovered | Refresh the agent session and verify it reads the project's `.agents/skills` directory. |
| Output or skill directory already exists | Choose another directory; installation does not overwrite it. |
| CLI not on PATH | Use `npx --yes iconsmith@0.1.0` for each CLI invocation. |
| Agent cannot view images or obtain independent reviews | Use a session with those capabilities; existing results remain drafts. |
| Compiler or checker failure | Read `checks.json`, repair the source and check again. Earlier snapshots survive. |
| Public CLI has no API generation command | Ask your host agent to follow the skill. The CLI only performs local operations. |
