---
"iconsmith": patch
---

Run the generation-pipeline meta-loop inline.

`npx tsx scripts/autoresearch.ts --rounds N` applies one in-process change
per round (playbook and/or OpenRouter from `OPENROUTER_API_KEY` /
`/tmp/openrouter.env`), measures, and keeps or `git reset`s.
`autoresearch.md` stays the standing file the loop cannot write. The
editable surface is pipeline / tools / commands / tests / SKILL. Frozen
gates and bench calibrations stay put. Cursor Cloud Agents are not this
loop — no `NEXT.md`, no spawn brief, nothing to paste into
cursor.com/agents. Overnight is `--rounds 50`.
