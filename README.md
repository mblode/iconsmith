<div align="center">

# Iconsmith

**Create SVG icons that match the Blode family with your coding agent**

Describe an icon, compare independently reviewed candidates, and keep the SVG and previews.

<p align="center">
  <a href="https://www.npmjs.com/package/iconsmith">
    <img src="https://img.shields.io/npm/v/iconsmith?style=flat&colorA=000000&colorB=000000" alt="npm version" />
  </a>
  <a href="https://github.com/mblode/iconsmith/blob/main/LICENSE.md">
    <img src="https://img.shields.io/github/license/mblode/iconsmith?style=flat&colorA=000000&colorB=000000" alt="MIT license" />
  </a>
</p>

</div>

## Install

Run in the project where you want to create icons:

```bash
npx --yes iconsmith@0.1.0 skill --out .agents/skills/iconsmith
```

Requires Node.js 24.11 or newer and a coding agent with shell access, image viewing
and independent subagents. Generation uses your agent account, with no separate API key.

## Quickstart

Prepare a bookmark-check request and its reference drawings:

```bash
npx --yes iconsmith@0.1.0 prepare bookmark-check --out icon-work/bookmark-check
```

Open `icon-work/bookmark-check/references/siblings.png` to see related Blode icons.
Refresh your agent session to load the installed skill, then ask:

> Use iconsmith to create a bookmark-check icon from the prepared request in
> icon-work/bookmark-check. Show the selected SVG and native previews.

The agent draws two candidates, checks their geometry, and asks two fresh reviewers
to assess the images. Accepted output includes an SVG, editable `.icon` drawing,
PNG previews and a review record. Candidates that still need work remain drafts.

## What you get

- **Matching references:** bundled MIT Blode drawings and a pinned 24px outlined style.
- **Repeatable drawings:** an editable drawing format that recompiles to the same SVG.
- **Visual review:** native-size and enlarged light/dark previews, checked for meaning and family fit.
- **Local tools:** prepare, compile, render and lint without model calls from the CLI.

## Commands

Prefix commands with `npx --yes iconsmith@0.1.0`. Use `--help` for command options.

| Command | Purpose |
| --- | --- |
| `skill` | Install the agent workflow in a new directory. |
| `prepare` | Save a request, pinned revision and related drawings. |
| `check` | Compile a candidate, verify exact replay and create preview images. |
| `render` | Preview an existing SVG at native size and on light/dark backgrounds. |
| `draw` | Compile an `.icon` drawing to SVG. |
| `lint` | Check SVG geometry against the house spec. |

Commands never prompt. Use `--output json` for structured CLI output.
Skill, request and proof directories must be new so existing work is preserved.

## Notes

The default workflow creates outlined Blode icons. A clean geometry check does not
prove that an icon communicates the right meaning; inspect the previews and review
record before using it. Image viewing and independent review are required to accept
a result. This workflow does not create logos or define a new icon family.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
