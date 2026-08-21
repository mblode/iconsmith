/**
 * Host marks as a GenerateFn.
 *
 * Compile places vocabulary parts. Analog replays a neighbor. This writes the
 * twin programs in `marks.ts` — no model, so 0 `part` ops is not a leak.
 * When `options.ask` is set, DRAW screenshots, then applies at most one catalog
 * repair and looks again. The model never runs.
 */
import type { Spec } from "../tools/canvas.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import type { Issue } from "../types.js";
import { audit } from "./audit.js";
import type { GenerateLike } from "./harness.js";
import { MARK_TWINS, markFromSlug } from "./kind.js";
import { applyRepair, pickRepair } from "./look.js";
import { MARKS } from "./marks.js";
import { pairPrograms } from "./pair.js";

/** Thrown when the slug is not a MARKS key (or a `-filled` twin of one). */
export class MarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkError";
  }
}

const traceOf = (source: string): string[] =>
  source
    .split("\n")
    .map((l) => l.replace(/(?<lead>^|\s)#.*$/u, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/u)[0].toLowerCase());

const fromSource = (source: string, slug: string, spec?: Spec) => {
  const program = runDsl(source, [], spec ? { spec } : {});
  const issues: Issue[] = [
    ...program.errors.map((message) => ({
      message,
      rule: "dsl",
      severity: "error" as const,
    })),
    ...lint(program.canvas, { keyline: program.keyline }),
  ];
  const trace = traceOf(source);
  return {
    clean: issues.every((i) => i.severity !== "error"),
    doc: program.canvas.toJSON({
      icon: program.icon ?? slug,
      keyline: program.keyline,
    }),
    issues,
    program: source,
    steps: trace.length,
    svg: program.canvas.toSVG(),
    trace,
  };
};

/**
 * Host twins as a `GenerateFn`.
 *
 * `cost` is absent: there is no model. The slug encodes finish
 * (`plus-filled` → filled plus); `markFromSlug` is the decoder.
 */
export const markArm =
  (): GenerateLike =>
  async (concept, options = {}) => {
    const resolved = markFromSlug(concept.name);
    if (resolved === null) {
      throw new MarkError(
        `\`${concept.name}\` is not a mark. Host DRAW only runs MARKS keys ` +
          "(and their `-filled` twins)."
      );
    }
    const { finish, mark } = resolved;
    const { ask, lookReferences = [], lookTwin, spec } = options;
    let source = MARKS[mark](concept.name, finish);
    const twin = lookTwin ?? MARK_TWINS[mark];
    let repaired: string | undefined;
    let reviewed = ask
      ? await audit({
          ask,
          concept,
          finish,
          kind: "mark",
          references: lookReferences,
          svg: fromSource(source, concept.name, spec).svg,
          twin,
        })
      : undefined;
    const verb =
      reviewed?.scorable === true
        ? pickRepair(mark, finish, reviewed.findings)
        : null;
    if (verb) {
      const next = applyRepair(mark, concept.name, finish, verb);
      if (next !== null && next !== source && ask) {
        source = next;
        repaired = verb;
        reviewed = await audit({
          ask,
          concept,
          finish,
          kind: "mark",
          references: lookReferences,
          svg: fromSource(source, concept.name, spec).svg,
          twin,
        });
      }
    }
    const drawn = fromSource(source, concept.name, spec);
    const other = finish === "filled" ? "outlined" : "filled";
    const issues = pairPrograms(
      drawn.issues,
      finish,
      source,
      MARKS[mark](concept.name, other),
      [],
      spec
    );
    const brief = repaired
      ? `${finish} ${mark} repaired ${repaired}`
      : `${finish} ${mark}`;
    return {
      audit: reviewed,
      brief,
      ...drawn,
      clean: issues.every((issue) => issue.severity !== "error"),
      issues,
      text: brief,
    };
  };
