# iconsmith-agent

The eve agent that fronts Iconsmith Studio. It is the only production path into
icon generation: `generate_icon_pair.ts` is the sole caller of
`generateStudioResponse`, so everything a user ever receives goes through here.

## What is here, and what is not

`lib/` runs the drawing pipeline: `generate.ts` seats the arms and holds the
budget, `arsenal.ts` picks the references, `concept.ts` reads what the user
asked for, `turn-record.ts` stops a retry paying twice. These moved out of a
package the client could also read; the client can no longer reach them, which
is the point.

**None of it draws.** It calls `runPairTournament` in `packages/iconsmith`, and
every invariant that makes an icon match the set lives there. If a drawing came
out wrong, the cause is almost always in the engine, not here.

## Commands

```bash
npm run dev:eve      # eve dev, with the delivery timeouts raised
npm run build:eve
npm run smoke:eve    # one full tournament; SPENDS REAL MONEY
npm run typecheck
npm run check
```

## Gotchas

- **`tools/` is a name table, not a folder.** eve derives each tool's name from
  its filename, so `generate_icon_pair.ts` *is* the tool `generate_icon_pair`.
  A file here whose stem is not a legal tool name makes the app refuse to boot
  with `Tool filename "replay.test" is not a legal tool name` — which is why the
  test that exercises this tool lives in `lib/replay.test.ts` and reaches
  back for it. Never put a test in this directory.
- **`lib/` takes authored TypeScript modules and nothing else.** A data file
  there is a hard discovery error, not a warning, and the agent refuses to
  boot: `Expected ".../lib/house-icons.json" to be a supported authored module
  within "lib/"`. That is why the house snapshot lives in `data/`. eve ignores
  an unrecognised directory with a warning, so `data/`, `scripts/` and `.turbo/`
  are fine; it is only the directories eve owns that are strict.
- **Nothing but starting the server catches that.** `npm run typecheck`,
  `npm run test`, `npm run check` and `npm run build` were all green with the
  JSON file in `lib/`, because eve's discovery runs at dev/build time for the
  agent service, not during the Next build. After moving a file into or out of
  this workspace, run `npm run dev -w iconsmith-web` and read the `[eve:dev]`
  lines before believing the gates.
- **`oxlint.config.ts` turns off `unicorn/filename-case` for `tools/*_*.ts`**
  for the same reason: renaming the file renames the tool the model calls.
- **This app is mounted by the web build, not deployed on its own.**
  `apps/web/next.config.ts` calls `withEve(..., { eveRoot: "../agent" })`, and
  `withEve` writes the Vercel service routes. Nothing here has a Vercel project.
- **Every tool but `generate_icon_pair` is `disableTool()`.** The agent has one
  tool. If you add a second, the orchestrator's instructions become the only
  thing deciding which is called, and `instructions.md` is prose — it enforces
  nothing.
- **`instructions.md` is input, not documentation.** `oxfmt.config.ts` ignores
  markdown here on purpose: reflowing that file edits the model's prompt.
- **The refusal seam is `defineDynamic`, not middleware.** `agent.ts` returns the
  same model from every branch; the point is the `turn.started` callback, which
  eve runs *before* any provider call, so a refused continuation costs no tokens.
