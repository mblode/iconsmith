---
name: forge
description: Extract a parts vocabulary from an existing icon set, compose new icons in a constrained DSL that cannot express off-spec geometry, lint them against a house spec, and score them against the set they must match. Use when generating icons in an existing design language, auditing an icon set for drift, or building an AI-in-the-loop icon pipeline.
---

# forge

Icon generation that cannot drift, because the model never emits a coordinate.

## Commands

```bash
forge parts <icons-dir>          # cluster every subpath into a parts vocabulary
forge draw <program.icon>        # run a DSL program, emit SVG
forge lint <icon.svg>            # house-spec violations
forge eval <icons-dir>           # reconstruction score over held-out icons
```

Pass `--output json` for machine-readable results.

## The DSL

```
icon cloud-check
keyline wide
part cloud fill
line 9,13.75 11,15.5 14.5,10.5
fit
```

Ops: `icon`, `keyline`, `part`, `rect`, `circle`, `line`, `dot`, `center`, `fit`.

`fill`, `center` and `fit` exist so the model never does spatial arithmetic — keyline scaling and centring are pure functions of the content, so code does them exactly.

## Invariant

The model chooses what and where. The library chooses how: every primitive quantises to the sub-grid, snaps angles to 0/45/90, and takes corner radii from the tier system. Off-spec geometry is not merely discouraged — it has to be asked for by name: `raw` for verbatim path data, `off-axis` for a segment further than 6° from an axis. Anything else is refused.
