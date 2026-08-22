# iconsmith

Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec.

## Installation

```bash
npm install -g iconsmith
```

Or use directly with npx:

```bash
npx iconsmith --help
```

## Usage

```bash
iconsmith parts ./icons-svg -o parts.json      # cluster subpaths into a vocabulary
iconsmith draw cloud-check.icon -p parts.json  # run a DSL program, emit SVG
iconsmith lint ./icons-svg/*.svg               # check against the house spec
iconsmith eval --dir ./icon-set --slice 12     # reconstruction score (needs AI_GATEWAY_API_KEY or OPENROUTER_API_KEY)
iconsmith new database -o database.svg            # mixture: analog trays, no model
iconsmith improve --control analog --treatment agent --class pack-inventory --concepts database wifi --dry-run
```

Add `--output json` to any command for machine-readable output on stdout.

### The DSL

```
icon cloud-check
keyline wide
part cloud fill
line 9,13.75 11,15.5 14.5,10.5
fit
```

`fill`, `center` and `fit` exist so a model never does spatial arithmetic: keyline scaling and centring are pure functions of the content, so the library does them exactly.

### Reading an eval

`iconsmith eval` reports four numbers, never one:

|  |  |
| --- | --- |
| **floor** | a random icon scored against the target |
| **baseline** | 0.737 — the measured median between two mature icon sets drawing the same concept |
| **treatment** | what the pipeline scored |
| **ceiling** | 1.0 |

A treatment above 0.95 is flagged as suspect: it means the harness is comparing something to itself, not that generation succeeded.

## Programmatic API

```typescript
import { Canvas, extractParts, lint, runDsl, similarity } from "iconsmith";
```

## Usage with AI Agents

Add the skill to your AI coding assistant:

```bash
npx skills add mblode/iconsmith
```

## License

MIT
