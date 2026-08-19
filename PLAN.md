# iconsmith

**Any concept, in blode-icons' language, without a human drawing it.**

Not "perfect icons" — that has no ceiling. Two mature professional icon sets
drawing the same concept only agree at **0.737**, so the operational target is
*indistinguishable from a house icon by the measures we trust*.

The product is not icons. It is **reach**: the number of concepts that can be
drawn to house quality on demand. Every number below serves that one.

---

## Where it stands, measured 2026-08-19

| | |
|---|---|
| treatment | **0.740** on 10 selection icons × 3 seeds |
| baseline | 0.737 — two mature sets, same concept |
| floor | 0.482 — a random house icon against the target |
| seed spread | **0.019** — the acceptance threshold |
| cost | $0.174–$0.30 per icon metered; **$0.00** through the local CLI |

The pipeline draws at professional parity. That is the headline and it was not
true this morning.

### The three numbers, in Goldratt's terms

- **Throughput** — concepts reachable at house quality. Unmeasured per-concept;
  see Slice 1.
- **Inventory** — concepts wanted but not reachable. 268 names drawn by 4+ of
  the seven third-party packs that blode does not draw.
- **Operating expense** — cost per reached concept. $0.00 marginal via
  `harnessArm({ command: "claude" })`.

---

## The constraint, and why it moved

`listParts` scored candidates on `name ?? id`. Of 1,116 extracted parts only 61
carried a name, so **94.5% of the vocabulary was unreachable** — a search for
`folder`, `clock`, `branch` or `gear` returned nothing while the shape sat there
under `p0492`.

That was the binding constraint and it explains every result: `bell-off` and
`cloud-check` were the two demo concepts whose part happened to be named, and
they were the two that used one. `bell-off` cleared 0.783 with a single part.
The three that matched nothing were drawn from scratch and did not.

Fixed by searching the icons each part was extracted from. `git-pull-request`
then scored **0.903** against the icon you actually drew, using 8 part calls.

**A constraint that has just been exploited is no longer the constraint.**
Slice 1 finds the new one rather than assuming it.

---

## Slices

### Slice 1 — find the new constraint

Re-run the identical baseline now that search is fixed and generation is free.

```bash
# the same 10 selection icons, the same 3 seeds, through the local CLI
npx tsx scripts/rebaseline.ts   # harnessArm({ command: "claude" })
```

Compare against `bench/noise-floor.json` — treatment 0.740, spread 0.019.
Then read which number *did not* move, because that is where the system is now
limited. Three outcomes, each pointing at a different Slice 2:

| observation | the constraint is | go to |
|---|---|---|
| treatment up, variance up | model consistency | 2a — best-of-N |
| treatment flat, some concepts still ~0.45 | vocabulary coverage | 2b — name the families |
| treatment up, spread ≥ 0.019 | the metric | 2c — widen and re-power |

Also record, per icon, whether a part was found. That single column converts
"reach" from an idea into a measurement and is the input to every later slice.

**Verification:** `bench/rebaseline.v1.json` exists, all three replicates
scored 10/10, and every icon carries a `partsFound` count.

### Slice 2a — best-of-N instead of iterate-in-place

Only if Slice 1 shows variance is the limit.

Cursor generates *"tens or hundreds of attempts, every concept has its own row"*
and picks. Our loop refines one drawing and calls `remove` when it dislikes it.
The 2026 literature agrees: sample-and-select beats in-place iteration.

Free generation makes N=5 affordable. Select on the structural panel plus
rendered cosine, never on the model's own judgement.

**Verification:** median of best-of-5 exceeds single-shot by more than 0.019 on
the selection split.

### Slice 2b — name the object families

Only if Slice 1 shows coverage is the limit.

Cursor tracks roughly **90 object families** across 645 icons — *"animals,
arrows, boxes, buildings, charts, chevrons, devices, faces, flags, hands,
people…"* — and every one has to look like itself everywhere it appears.

So the target is ~90 names, not 1,055. A day's work, not a project. Search
already reaches the unnamed remainder by provenance, so this is elevation on
top of a working exploit rather than a rescue.

Then measure per-concept reach across the whole 2,203-concept table and publish
the gap list. `database` returns nothing today because blode has no database
icon — that is inventory, and it should be visible as inventory.

**Verification:** `iconsmith parts --coverage` reports the fraction of concepts
with at least one matching part, and the gap list is committed.

### Slice 2c — widen the benchmark and re-power

Only if Slice 1 shows the metric is the limit.

250 entries split 60/130/60. If the spread grows, the selection slice cannot
resolve the effects we care about. Compute the minimum detectable effect
explicitly and widen until it is below the smallest change worth acting on.

**Verification:** the MDE is printed beside every loop verdict, so "not
significant" and "too small to see" stop looking alike.

### Slice 3 — filled as a facet, not a second icon

In flight (`fillmode`). Cursor's model is one component with two properties:
**Filled (true/false)** and **Size (16/24)**. Our measurement agrees — the
filled twin occupies the same visual extent as the outlined one in 94% of pairs
to within 0.01u, so keylines, clearance and centring carry over unchanged.

What does not carry over is interior white. **932 of 2,085 icons knock a hole
out of a solid and no primitive expresses it.** Filled needs a knockout op, its
own radius rule (the dominant filled corner is the outlined tier plus half a
stroke; only 43% land on the house tiers), and an inverted gap rule — a minimum
feature size, because solids are *meant* to touch.

**Verification:** a filled icon drawn through the DSL lints clean, and
`iconsmith lint` over the outlined corpus still reports substance 3, bleed 57,
cohort-align 210 — unchanged.

### Slice 4 — routes as arms

In flight (`router`). The stages already exist as separate files; they are not
yet swappable.

```
BRIEF → PROPOSE → SELECT → DRAW → CHECK → SCORE
```

A route is one implementation per stage, and drops into `evaluate`'s existing
`generate?: GenerateFn` seam — so `direct` vs `part-first` vs `claude` vs
`codex` become arms of one experiment scored by one metric.

**The property routing must not break:** no coordinate may cross from PROPOSE
into DRAW. `compose.ts:441` — *"there is no field here a coordinate fits in."*
That must be enforced by the types, not by convention.

**Verification:** two routes run end to end and produce comparable reports; a
test asserts a PROPOSE output cannot typecheck as DRAW geometry.

---

## Key decisions

- **Measure before elevating.** Slice 1 exists because the constraint was just
  exploited and TOC's fifth step is to not let inertia make the old constraint
  the policy.
- **Generation is free now, measurement is not.** `harnessArm` runs on the local
  Claude Code subscription. Build routes freely; test them one at a time.
- **The answer key is the 2,085 icons, not an image model.** Both embedding
  metrics failed their own gates today — DINO style discarded at AUC 0.476,
  worse than chance; SigLIP semantic with its ceiling below its baseline. The
  icons already encode decisions no pretrained model has access to.
- **A raster proposal must be abstracted, never traced.** A vectoriser emits
  coordinates that never passed through `Canvas`, and `conform` cannot rescue
  them — outlined→filled recovered 0.0% of the available gain because a redraw
  is not a transform.
- **Send image models the semantic rules, not the geometric ones.** They
  approximate the appearance of a constraint rather than satisfying it. The
  geometric rules belong to the drawer, where they are enforced.

## Out of scope

- **Other icon sets.** The goal is blode-icons exactly. Generality is a later
  question and would dilute the answer key.
- **An arc primitive.** The curve population is bimodal — 41.2% of cubics have
  chords ≤2u (corner rounding), 36.0% exceed 4u (genuine curvature). A
  `polyline(points, cornerRadius)` captures the larger bucket for less, and the
  six named stamps (the sparkle alone covers 39 icons) capture more still.
  Re-measure the residual before adding an arc.
- **Deleting the bespoke loop.** `harness.ts` proves the skill path works, but
  the built-in loop is the only arm with cost accounting and seed control. It
  goes when a route comparison says it can.
- **`_concepts.json` as a prompt input.** 2,203 entries point at 941 slugs and
  the tail is synonym absorption — `shield-check` alone answers 39 concepts
  including "bravery" and "tough". Use the verified ~60-entry core.

## Verification

```bash
npm run test        # 805 passing
npm run typecheck
npm run check       # lint + boundaries
npx tsx scripts/gate.ts cosine              # exit 0; AUC vs a SHA-pinned baseline
npx tsx scripts/gate.ts structure --dir <d> # element count, extent, corners, margins
npx tsx scripts/loop.ts --enable <ids> …    # refuses without bench/noise-floor.json
```

## STOP conditions

Stop and report rather than improvise if any of these is false.

- `render.ts`'s `SIZE`, `BLUR`, density and `currentColor` substitution are
  untouched. 0.737 is calibrated against them.
- `raw` stays unreachable from the model's tool set, in every route and in fill
  mode. Verified by word-boundary search, not by grep for the substring.
- The 164 untracked icons and 82 untracked metadata records in
  `packages/blode-icons-react/` are never rewritten, moved, or committed.
- No vectoriser dependency enters `package.json`.
- A gate lives in a path the loop cannot write. The Darwin Gödel Machine deleted
  the markers its researchers used to catch it cheating, despite being told not
  to.

Keep `PLAN.notes.md` beside this file. Log every deviation as: what the plan
said, what the code required, which option was taken.
