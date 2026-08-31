<div align="center">

# [Iconsmith](https://blode.co/iconsmith)

**Icon generation that cannot drift, because the model never emits a coordinate**

Describe an icon in chat or at a terminal, and a constrained drawing API puts every node on the grid.

</div>

## Demo

[Iconsmith Studio](https://blode.co/iconsmith/studio) draws an icon from a description, asks when it is unsure, and shows the program behind every version. Nothing to install.

## Install

Not on npm yet. The CLI runs from a clone:

```bash
git clone https://github.com/mblode/iconsmith.git
cd iconsmith
npm install && npm run build
```

Node 24.11 or newer. The package ships no `bin`, so every `iconsmith` below is `node packages/iconsmith/dist/cli.js` from the repo root — alias it if you use it often.

## Quickstart

Draw an icon. No model, no API key, no corpus: a concept the routing table already knows goes to a host construction instead of a generation.

```bash
iconsmith new database -o database.svg
```

```
analog trays database

  8 step(s): mixture/pack-inventory/analog → construct → icon → keyline → finish → rect → rect → rect → fit
  clean — no lint errors
  wrote database.svg
```

The SVG goes to stdout without `-o`. Every step above is a primitive call, so the three trays land at y=3, y=10.5 and y=18 every time.

## The language

A program names shapes and where they go. It never names a number the library did not choose. Save one as `square-check.icon` and run `iconsmith draw square-check.icon`.

```
icon square-check
keyline square
rect 4,4 16x16 r3
line 8,12 11,15 16,10
fit
```

- **Primitives:** `rect`, `circle`, `arc`, `diamond`, `line`, `dot`, `hole`, and `part` for a named shape lifted out of a real set.
- **Quantised:** every node lands on a 0.25 grid, corner radii snap to the measured tiers (0.5, 1, 2, 3), and a part turns only in named quarter-turns, never by an angle.
- **No arithmetic:** `fit`, `center`, `fill` and `cohort` do the scaling and centring, because those are the sums a model gets wrong.
- **Two escapes, both asked for by name:** `raw` for verbatim path data, and `off-axis` for a segment more than 6° from an axis.

An undeclared diagonal is refused rather than drawn:

```bash
printf 'icon send\nkeyline circle\nline 4,20 20,12 4,4 7,12 4,20\nfit\n' | iconsmith draw -
```

```
line 3 (line 4,20 20,12 4,4 7,12 4,20): line segment 1 (4,20 → 20,12) runs at
153.43°, 18.43° off the nearest axis (135°). Off-axis edges are legitimate —
29.3% of stroked icons in the set have one, on rational slopes between two grid
points — but they are asked for, not arrived at: pass `offAxis: true`
(`off-axis` in the DSL) if that is the shape, or move an endpoint onto the axis.
```

Add `off-axis` to the end of that `line` and the paper plane draws, with a warning that says there is nothing to fix.

## Commands

| Command | What it does |
| --- | --- |
| `new <name>` | describe an icon; draw it to the house spec |
| `draw <file>` | run a DSL program and emit SVG (`-` reads stdin) |
| `lint [files...]` | check SVG icons against the house spec |
| `parts <dir>` | cluster the subpaths of an icon set into a named vocabulary |
| `view [dir]` | serve a directory of icons as a page, on the grid |
| `eval` | score generated icons against the real ones they reconstruct |
| `conform` | transform icons between corpus variants and score the result |
| `improve` | A/B two experts on a concept class; keep updates the routing table |

`corpus`, `concepts`, `bench`, `modifiers`, `elements` and `repair` are in `iconsmith --help`. `--output json` makes any command's stdout machine-readable.

## Reading an eval

`iconsmith eval` reports four numbers, never one.

|  |  |
| --- | --- |
| **floor** | 0.482, a random icon from the set scored against the target: what no information looks like |
| **baseline** | 0.737, the measured median rendered cosine between two mature icon sets drawing the same concept |
| **treatment** | what the pipeline scored |
| **ceiling** | 1.0, the target against itself |

Baseline is the target, not ceiling. Anything above 0.95 is flagged as suspect: two professional sets drawing the same concept only reach 0.737, so a near-perfect score means the answer leaked into the prompt.

The house spec is measured the same way. Against its strict reading, the house set passes 33.8% of the time and the best third-party stroke pack 22.3%. A spec every set already satisfies is not a spec.

## Notes

- **Generation needs a Vercel AI Gateway credential:** `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, or `OPENROUTER_API_KEY` with an OpenRouter model id. A provider key such as `ANTHROPIC_API_KEY` is not a substitute. The analog and glyph arms need neither.
- **The corpus is not shipped.** 2,085 symbols drawn 30 ways, plus third-party packs the licence gate exists to keep out of a generation. Point `--corpus <dir>` at your own set.
- **The library is exported too:** `import { generate, parseIconSvg, png, runPairTournament } from "iconsmith";`

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
