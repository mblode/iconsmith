# icon-forge

Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec.

## Installation

```bash
npm install -g icon-forge
```

Or use directly with npx:

```bash
npx icon-forge --help
```

## Usage

```bash
forge parts ./icons-svg -o parts.json   # cluster subpaths into a vocabulary
forge draw icon.forge -p parts.json     # run a DSL program, emit SVG
forge lint ./icons-svg/*.svg            # check against the house spec
forge eval --dir ./icon-set -n 12       # reconstruction score (needs ANTHROPIC_API_KEY)
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

`fill`, `center` and `fit` exist so a model never does spatial arithmetic: keyline
scaling and centring are pure functions of the content, so the library does them exactly.

### Reading an eval

`forge eval` reports four numbers, never one:

| | |
| --- | --- |
| **floor** | a random icon scored against the target |
| **baseline** | 0.737 — the measured median between two mature icon sets drawing the same concept |
| **treatment** | what the pipeline scored |
| **ceiling** | 1.0 |

A treatment above 0.95 is flagged as suspect: it means the harness is comparing
something to itself, not that generation succeeded.

## Programmatic API

```typescript
import { Canvas, extractParts, lint, runDsl, similarity } from "icon-forge";
```

## Usage with AI Agents

Add the skill to your AI coding assistant:

```bash
npx skills add mblode/icon-forge
```

## License

MIT
