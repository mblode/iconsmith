# Blode reference family

The default style is [blode-icons](https://github.com/mblode/blode-icons), the
house set. Its git-tracked SVG library and metadata are bundled at
`packages/iconsmith/library/blode-icons` under MIT, with the upstream commit
recorded in `SOURCE.json`. No sibling checkout, private corpus or download is needed.

The reference set is that whole library. `library-siblings.ts` ranks its
drawings for any concept by shared tags, cohort and name and reads each stroke
back as the DSL `line` or `circle` that redraws it, so authors place the set's
own tick or arrowhead and reviewers measure against the set's own version.
`revision.json` embeds twelve outlined anchors copied byte-for-byte from the
library, the 24px house master, a short policy and the current compiler
identity; they are the style sheet, not the reference set. The regression test
rejects a stale compiler identity, an anchor that drifts from the bundled
library, or a Lucide-derived source.

After `npm ci` and `npm run build:local`, open Codex or Claude Code in the
repository and ask it to read [AGENT.md](AGENT.md) and execute the drawing task.
The brief includes the exact pinned checker command and requires proof inspection.
Use your own agent account and model; the result remains a draft for user review.
See [local setup](../../docs/local-setup.md) for commands and the separate advanced
contained foundry requirements.

The four alternatives in `meanings.json` are an illustrative square-check label
set. Freeze suitable alternatives for a different requested concept before a run.
This family remains `unvalidated`: a runnable example and successful structural
checks are not professional craft approval or critic qualification.
