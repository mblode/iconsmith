/**
 * The compile-time half of the licence gate.
 *
 * This file runs under `tsc --noEmit`, not under vitest, and the extension is
 * the reason: `tsconfig.json` excludes `*.test.ts`, so an assertion written in
 * a `.test.ts` would never be type-checked and would pass by not being looked
 * at. `.test-d.ts` is not excluded, and vitest's default include does not match
 * it either. `npm run typecheck` is the runner.
 *
 * Every assertion here is a `@ts-expect-error`, which fails the build when the
 * line beneath it *stops* being an error. That is the direction that matters: a
 * refactor that renames `BaselineIcon.icon` to `name`, or that exports the
 * brand symbol, breaks the typecheck here rather than quietly letting a
 * third-party pack into a prompt.
 *
 * It sits at `src/` rather than beside either module because it is the one file
 * that must name both, and `pipeline/` may not import `corpus/baselines` —
 * `scripts/check-boundaries.ts` rule 3, which this file would otherwise be the
 * first violation of.
 *
 * Nothing here executes; `check` is declared and never called.
 */
import type { BaselineIcon } from "./corpus/baselines.js";
import type { IconRecord } from "./corpus/record.js";
import type { BenchmarkEntry } from "./pipeline/bench.js";
import { evaluate } from "./pipeline/eval.js";
import type { ConditioningProvenance, EvalIcon } from "./pipeline/eval.js";
import { generate } from "./pipeline/generate.js";
import { asReference } from "./pipeline/licence.js";
import type { Reference, ReferenceIcon } from "./pipeline/licence.js";
import type { Concept } from "./pipeline/prompt.js";
import type { Provenance } from "./types.js";

declare const baseline: BaselineIcon;
declare const house: ReferenceIcon;
declare const provenance: Provenance;
declare const record: IconRecord;
declare const icons: EvalIcon[];
declare const benchmark: BenchmarkEntry[];
declare const conditioning: ConditioningProvenance;

const check = (): Reference[] => {
  // A baseline is not a reference icon: it carries `icon`/`source`, not
  // `name`/`svg`, so it cannot even be offered to the constructor.
  // @ts-expect-error — third-party icons may not condition a generation.
  asReference(baseline, provenance);

  // Nor as a member of a reference set.
  // @ts-expect-error — a baseline is not a Reference.
  const smuggled: Reference[] = [baseline];

  // The brand is a module-local `unique symbol`. Nothing outside licence.ts can
  // name the key, so no literal can produce the type: `asReference` is the sole
  // constructor by construction rather than by convention.
  // @ts-expect-error — the brand is missing, and unnameable from here.
  const forged: Reference = { name: "arrow", svg: "<svg/>" };

  // House-shaped icons are still not references until they have been through
  // the gate. The assignment that *is* allowed is the other direction.
  // @ts-expect-error — unchecked icons are not references.
  const unchecked: Reference[] = [house];

  const ref: Reference = asReference(house, provenance);
  const widened: ReferenceIcon = ref;

  return [
    ...smuggled,
    forged,
    ...unchecked,
    ref,
    asReference(widened, provenance),
  ];
};

export type Check = typeof check;

/**
 * The gate, at the surfaces that put an icon in front of a model.
 *
 * The first assertion is the one that matters: `IconRecord.provenance.usage` is
 * `Usage`, and eight of the ten sets in the corpus carry `"analysis-only"`. An
 * eval shows the model every icon it does not hold out, so its provenance is
 * narrowed to `"conditioning"` and a record from one of those eight cannot
 * build the neighbour list — not because a runtime check rejects it, but
 * because it does not typecheck.
 *
 * The rest close the other two doors into a prompt: the neighbours `compare`
 * renders onto a contact sheet, and the reference drawing pasted verbatim into
 * the per-icon brief.
 */
const gate = async (): Promise<void> => {
  // A record's own usage, carried through unchanged. Only "conditioning" is
  // assignable, so this fails for the eight third-party sets and passes for
  // blode-icons and Central — which is the whole distinction, checked once.
  const fromRecord: ConditioningProvenance = {
    ...provenance,
    // @ts-expect-error — an analysis-only set may not condition a generation.
    usage: record.provenance.usage,
  };

  await evaluate({
    benchmark,
    icons,
    // @ts-expect-error — analysis-only records may not build a neighbour list.
    provenance: { ...provenance, usage: "analysis-only" },
  });
  await evaluate({ benchmark, icons, provenance: fromRecord });
  await evaluate({ benchmark, icons, provenance: conditioning });

  // The contact sheet `compare` renders. An unbranded icon is structurally a
  // neighbour and is still refused: the brand, not the shape, is the check.
  // @ts-expect-error — unchecked icons may not be shown to a model.
  await generate({ name: "arrow-up" }, { corpus: [house] });
  await generate(
    { name: "arrow-up" },
    { corpus: [asReference(house, provenance)] }
  );

  // The reference drawing, which lands in the brief verbatim.
  // @ts-expect-error — an unchecked icon may not be the reference.
  const brief: Concept = { name: "arrow-up", reference: house };
  const checked: Concept = {
    name: "arrow-up",
    reference: asReference(house, provenance),
  };
  await generate(brief, {});
  await generate(checked, {});
};

export type Gate = typeof gate;
