# program.md

The standing instructions for the improvement loop. **A human writes this file; `scripts/loop.ts` reads it and cannot write it.** It is not the artefact under optimisation — the loop optimises `src/pipeline/policy.default.json` and nothing else. Steering happens here.

The loop refuses to start if this file is missing. Every ledger row and every kept commit records its hash, so an iteration can be attributed to the instructions that were in force when it ran.

## What the loop may change

One file: `src/pipeline/policy.default.json`, the design language as data. A kept iteration commits that file to the `iconsmith/loop` branch and nothing else — the branch tip is the champion, and `git log iconsmith/loop` is the record of what survived.

## What it may never change

The paths below are frozen. The ratchet commits exactly one path and verifies that before advancing the ref, so a commit touching any of these cannot land; if the experiment branch diverges from `HEAD` in one of them, the loop refuses to run at all.

```frozen
packages/iconsmith/program.md
packages/iconsmith/scripts/loop.ts
packages/iconsmith/scripts/gate.ts
packages/iconsmith/scripts/check-boundaries.ts
packages/iconsmith/src/eval/blindspot.ts
packages/iconsmith/src/tools/render.ts
packages/iconsmith/bench/reconstruction.json
packages/iconsmith/bench/calibration.v1.json
packages/iconsmith/bench/noise-floor.json
```

## How an iteration is decided

Two stages, and they are asymmetric on purpose.

1. **Screen, on `feedback` (60 icons).** Cheap and lenient: "is this not worse?" These are the icons a proposal was written against, so a score here is optimistically biased and is _never_ reported as evidence. A candidate that cannot beat the incumbent on them will not beat it on 130 it has never seen.
2. **Decide, on `selection` (130 icons).** The full rule — paired significance, a median over the measured noise floor, no fall in the lint-clean rate, and no regression on the blind-spot panel — computed on icons no proposer has read a trace from. Only a candidate that survived the screen pays for it.

`sealed` (60 icons) is not a stage. It is opened once, by a person, after the campaign is over; the loop names it nowhere, because anything that could route to it automatically would spend it.

The blind-spot panel is required for a keep, not optional. Rendered cosine cannot resolve element sizing — a dot two tiers too large scores 0.988, inside the band a legal 0.25 jitter produces — so a cosine win with no panel behind it is the first thing an optimiser finds. A missing panel is a refusal, never a pass.

## Standing constraints

These are not preferences. Each one is either a measurement that stops meaning anything if the constraint moves, or a guarantee the project exists to provide.

**`render.ts` is frozen: `SIZE`, `BLUR`, the density and the `currentColor` substitution.** 0.737 — the median rendered cosine between two mature sets drawing the same concept — was measured under exactly those settings. Change any of them and every score in `bench/`, every calibration and every accepted iteration in the ledger becomes a number about a different measurement. A loop that can turn the rasteriser knobs is a loop that can raise its own score without drawing anything better; that is the cheapest exploit on the board.

**`canvas.raw` stays unreachable from the model's tool set.** It exists so a person can bring any icon into a document. If it reaches the model, the model emits coordinates, and the one invariant — the model never emits a coordinate — is gone along with the drift guarantee the whole project is for. No policy principle may mention it, describe it, or hint that free path data is available.

**No vectoriser, anywhere under `pipeline/`.** A raster tracer turns a picture into path data with no primitive in between, which is the raw escape with extra steps. Whatever a proposal wants tracing for, it does not want it there. Trace outside the pipeline and bring the result back through the canvas.

**The four categorical gates are outside the loop's reach and not negotiable.** They are pass/fail, they are not scored, and no median delta buys an exemption:

1. the compile-time licence gate — only the author's own sets may condition a generation;
2. the import layering check — `geometry ← parts ← tools ← pipeline ← commands`, plus the baselines and vectoriser containment rules;
3. tests and typecheck green;
4. the no-coordinates invariant.

They live in `scripts/check-boundaries.ts`, `scripts/gate.ts` and the test suite, all frozen above. The loop does not run them and cannot weaken them; a human runs `npm run check` and `npm run test`, and a kept commit that fails either is a commit to revert, not a threshold to lower.

## Known defects — do not optimise against these

**The scorer has an inverted gradient in the registration direction**, and another agent is fixing it. Until that lands, a variant that wins by moving marks around the canvas is more likely to be exploiting the metric than drawing better. Do not enable principles about placement, centring or bounding-box fit while this is open, and treat any registration-flavoured win as suspect even after it passes the gates.

## What to try

- One principle per iteration. A variant with three changes that wins tells you nothing about which one won.
- Prefer `measured` principles. `inferred` ones are the first to cut, and a win from one is a hypothesis, not a finding.
- The capacity cap in `policy.ts` (`LIMITS.totalText`) is binding on purpose: to add prose, trade prose away. Do not raise it.

## What not to try

- Do not touch the noise floor to make a result pass. The floor is measured, not chosen; if it looks wrong, re-measure it and say so here.
- Do not widen the benchmark slice mid-experiment. A champion and a variant scored on different sets are not comparable, whatever the ledger says.
- Do not chase the lint-clean rate. It is a floor, not a score: a run may not buy similarity by drawing worse, but a run that only raises it has not necessarily drawn anything better.
