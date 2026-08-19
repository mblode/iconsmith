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
import { asReference } from "./pipeline/licence.js";
import type { Reference, ReferenceIcon } from "./pipeline/licence.js";
import type { Provenance } from "./types.js";

declare const baseline: BaselineIcon;
declare const house: ReferenceIcon;
declare const provenance: Provenance;

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
