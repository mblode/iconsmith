/**
 * One shape for what an arm records about its own drawing.
 *
 * The reach set shipped four different shapes and one of them was a lie. The
 * agent arm wrote `{brief, clean, issues, policy, steps, trace}`; the compile
 * arm wrote `{brief, issues, policy}` with no `clean` and no `trace`; and
 * `compass` wrote `clean: true` beside a non-empty `issues`. A reader cannot
 * tell "this arm has nothing to report" from "this arm does not report that",
 * so a missing key reads as a pass — which is exactly how the set announced
 * itself as finished.
 *
 * Two rules fix it, and both are structural rather than conventions somebody
 * has to remember:
 *
 * 1. **Every field is required.** An arm with nothing to say says so with an
 *    empty array, and the type will not let it stay quiet.
 * 2. **`clean` is derived, never passed.** It was a second opinion that could
 *    disagree with the findings beside it, and a status that can contradict its
 *    own evidence is worse than no status. {@link thinking} computes it.
 *
 * `suppressed` is here for the same reason `lint.ts` has it: a waiver is a
 * decision on the record, and dropping it makes a deliberate off-axis needle
 * indistinguishable from one that happens to be on the axis.
 */
import type { Suppression } from "../tools/lint.js";
import type { Finish, Issue } from "../types.js";

export interface Thinking {
  /** What was drawn and why, in the arm's own words. */
  brief: string;
  /**
   * No errors among {@link issues}. Warnings do not block — they are the tier
   * the house rules use for judgements a human arbitrates.
   */
  clean: boolean;
  /** The paint this record is about. Two paints are two records. */
  finish: Finish;
  /** Every finding, from every rule. Empty is the only thing that means clean. */
  issues: Issue[];
  /** Which arm drew it: `glyph`, `mark`, `compile`, `analog`, `agent`. */
  policy: string;
  /** The program, so the record and the drawing cannot come apart. */
  program: string;
  /** How many ops ran. `trace.length`, kept because a reader scanning a column
   *  of records should not have to count an array. */
  steps: number;
  /** Waivers the program asked for by name. See `lint.ts`'s `Suppression`. */
  suppressed: Suppression[];
  /** The ops the program ran, in order. */
  trace: string[];
}

/** The ops a program ran, comments and blank lines stripped. The same reading
 *  `reconstruct.ts` takes, so two arms' traces are comparable. */
export const traceOf = (program: string): string[] =>
  program
    .split("\n")
    .map((line) => line.replace(/(?<lead>^|\s)#.*$/u, "").trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/u)[0].toLowerCase());

/** A record with `clean` derived and every field present. The only way to
 *  build one: `clean` is deliberately not an input. */
export const thinking = (fields: {
  brief: string;
  finish: Finish;
  issues: readonly Issue[];
  policy: string;
  program: string;
  suppressed?: readonly Suppression[];
}): Thinking => {
  const trace = traceOf(fields.program);
  return {
    brief: fields.brief,
    clean: fields.issues.every((issue) => issue.severity !== "error"),
    finish: fields.finish,
    issues: [...fields.issues],
    policy: fields.policy,
    program: fields.program,
    steps: trace.length,
    suppressed: [...(fields.suppressed ?? [])],
    trace,
  };
};
