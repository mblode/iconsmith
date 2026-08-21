/**
 * Host object constructions as a GenerateFn.
 *
 * Analog replays a neighbor. Marks write the ten twins. This writes the
 * programs in `glyphs.ts` — no model, so a compass needle sits on 45°
 * instead of whatever kite an agent happened to place.
 */
import type { Spec } from "../tools/canvas.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import type { Issue } from "../types.js";
import { audit } from "./audit.js";
import { glyphFromSlug, GLYPH_WHY, GLYPHS } from "./glyphs.js";
import type { GenerateLike } from "./harness.js";
import { pairPrograms } from "./pair.js";

export class GlyphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlyphError";
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

export const glyphArm =
  (): GenerateLike =>
  async (concept, options = {}) => {
    const resolved = glyphFromSlug(concept.name);
    if (resolved === null) {
      throw new GlyphError(
        `\`${concept.name}\` is not a host glyph. Host DRAW for a new ` +
          "object runs GLYPHS keys (and their `-filled` twins)."
      );
    }
    const { finish, glyph } = resolved;
    const source = GLYPHS[glyph](concept.name, finish);
    const drawn = fromSource(source, concept.name, options.spec);
    const other = finish === "filled" ? "outlined" : "filled";
    const issues = pairPrograms(
      drawn.issues,
      finish,
      source,
      GLYPHS[glyph](concept.name, other),
      [],
      options.spec
    );
    const brief = `${finish} ${glyph} — ${GLYPH_WHY[glyph]}`;
    const reviewed = options.ask
      ? await audit({
          ask: options.ask,
          concept,
          finish,
          kind: "analog",
          references: options.lookReferences ?? [],
          svg: drawn.svg,
        })
      : undefined;
    return {
      audit: reviewed,
      brief,
      ...drawn,
      clean: issues.every((issue) => issue.severity !== "error"),
      issues,
      text: brief,
    };
  };
