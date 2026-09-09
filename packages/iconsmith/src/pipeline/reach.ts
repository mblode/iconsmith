/**
 * Host DRAW first for a house file or a MARKS key. A new glyph is written by
 * a coding agent (`unkeyed: "agent"` / `"harness"`), or taken from `glyphs.ts`
 * where the house has a construction and the caller asks for it
 * (`unkeyed: "glyph"`). Analog replay is the lab path. `iconsmith new`
 * defaults to forced AI authoring; cheaper routes require explicit flags.
 *
 * Keyed compile scored 0.999 on `pull-request`; N=5 agent redraws of the same
 * file scored 0.58–0.79. `forceAgent` skips host DRAW entirely.
 */
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { adaptProgram } from "../tools/twin.js";
import type { Finish, Issue, Part } from "../types.js";
import { analogArm, sameLetters } from "./analog.js";
import { LOOK_SCREEN } from "./audit.js";
import { generate } from "./generate.js";
import type { GenerateOptions, GenerateResult, Unkeyed } from "./generate.js";
import { glyphArm } from "./glyph.js";
import { glyphFromSlug } from "./glyphs.js";
import { harnessArm } from "./harness.js";
import { markFromSlug } from "./kind.js";
import { markArm } from "./mark.js";
import { mixtureArm } from "./mixture.js";
import type { PackIndex } from "./mixture.js";
import { pairCanvases } from "./pair.js";
import { programArm } from "./program.js";
import type { Concept } from "./prompt.js";
import { compileArm } from "./reconstruct.js";
import { splicePair, splicePaths } from "./splice.js";

type ReachKind = "agent" | "analog" | "compile" | "glyph" | "mark";

export interface ReachPlan {
  readonly badge?: string;
  readonly base?: string;
  readonly kind: ReachKind;
  /** House slug to compile when the query is the same drawing under another name. */
  readonly of?: string;
}

/** Slugs the caller can resolve to house path `d` strings. Injected so this
 *  module does not read the corpus; `commands/` does. */
export interface HouseSource {
  has: (slug: string) => boolean;
  /**
   * Stroked Central slugs that are this concept under another name.
   * Names only — the caller ranked them; this module does not read the corpus.
   */
  kin?: (query: string) => readonly string[];
  /**
   * House path `d` strings. `finish` selects the paint: outlined is the
   * default (the house file `has` names); filled is the solid variant when
   * that file exists. A missing paint returns null — the caller then adapts
   * or skips, rather than compiling the other paint under the wrong finish.
   */
  paths: (slug: string, finish?: Finish) => readonly string[] | null;
}

/**
 * Which arm draws this name.
 *
 * A keyed name — a mark, a house file, a splice of two — is decided by the name
 * alone, because the house has already drawn it. An *unkeyed* name is not: the
 * caller says who draws it, and `unkeyed` is that choice.
 *
 * `glyph` is in the second group, which an earlier revision got wrong by
 * putting it in the first. Ten host constructions had been written for the
 * concepts the reach dashboard staged, and classifying by slug meant any of
 * those names silently returned the house drawing — including for a caller who
 * had asked for `unkeyed: "agent"` in as many words. Two things went with it.
 * The badge stopped meaning anything, because every icon in the set read
 * `glyph` whichever arm had been requested. And the set stopped being able to
 * fail: a staged run of host programs reports what the house can draw, which is
 * not the question anybody was asking of a generator. A host form is worth
 * having and worth asking for; it is not worth having instead of an answer.
 */
export const classifyReach = (
  name: string,
  hasHouse: (slug: string) => boolean,
  forceAgent = false,
  twin?: string,
  unkeyed?: Unkeyed
): ReachPlan => {
  if (forceAgent) {
    return { kind: "agent" };
  }
  if (markFromSlug(name) !== null) {
    return { kind: "mark" };
  }
  if (hasHouse(name)) {
    return { kind: "compile" };
  }
  if (twin !== undefined && hasHouse(twin) && sameLetters(name, twin)) {
    return { kind: "compile", of: twin };
  }
  const pair = splicePair(name, hasHouse);
  if (pair) {
    return { badge: pair.badge, base: pair.base, kind: "compile" };
  }
  if (unkeyed === "glyph" && glyphFromSlug(name) !== null) {
    return { kind: "glyph" };
  }
  return { kind: "analog" };
};

const miss = (slug: string): Error =>
  new Error(`no house path data for "${slug}"`);

const pathsOf = (
  plan: ReachPlan,
  concept: Concept,
  options: GenerateOptions,
  house?: HouseSource,
  finish: Finish = "outlined"
): readonly string[] | null => {
  if (plan.base !== undefined && plan.badge !== undefined) {
    const body = house?.paths(plan.base, finish) ?? undefined;
    const badge = house?.paths(plan.badge, finish) ?? undefined;
    if (body === undefined || badge === undefined) {
      // A missing *filled* paint is the documented adapt-from-outline case:
      // return null so `reach`'s `finish === "filled"` fallback re-paints the
      // compiled outline, exactly as it does for a plain compile. Throwing here
      // made that fallback unreachable for every spliced concept whose house
      // files are outlined-only. A missing *outlined* paint is a real gap —
      // `splicePair` only fires when both slugs exist — so it stays a hard error
      // naming the side that is missing.
      if (finish === "outlined") {
        throw miss(body === undefined ? plan.base : plan.badge);
      }
      return null;
    }
    return splicePaths(body, badge);
  }
  const paths =
    options.targetPaths ??
    house?.paths(plan.of ?? concept.name, finish) ??
    undefined;
  if (paths === undefined) {
    return null;
  }
  return paths;
};

/**
 * Net-new / missing-filled-house fallback: re-paint a compiled outline.
 * The keyed path never lands here when a filled house file exists.
 */
const adaptFilledFrom = (
  drawn: GenerateResult,
  options: GenerateOptions
): GenerateResult => {
  const source = drawn.program;
  if (source === undefined || source.trim() === "") {
    return drawn;
  }
  const adapted = adaptProgram(source, "filled");
  // The compiled program places vocabulary parts by id (`part p0001`), so
  // replaying it needs the vocabulary the compile was given *and* the
  // house-local subpaths it parked in `drawn.extras`. `drawn.extras` is always
  // an array — `compilePaint` initialises it to `[]` — so a bare
  // `drawn.extras ?? options.parts` never fell through, silently dropping the
  // vocabulary and turning every keyed `part` id into an "unknown part" error.
  const vocabulary: Part[] = [
    ...(options.parts ?? []),
    ...(drawn.extras ?? []),
  ];
  const opts = options.spec ? { spec: options.spec } : {};
  const outlined = runDsl(source, vocabulary, opts);
  const program = runDsl(adapted, vocabulary, opts);
  const issues: Issue[] = pairCanvases(
    [
      ...program.errors.map((message) => ({
        message,
        rule: "dsl" as const,
        severity: "error" as const,
      })),
      ...lint(program.canvas, { keyline: program.keyline }),
    ],
    "filled",
    program.canvas,
    outlined.canvas
  );
  return {
    ...drawn,
    brief:
      drawn.brief === undefined ? undefined : `adapt filled ${drawn.brief}`,
    clean: issues.every((i) => i.severity !== "error"),
    doc: program.canvas.toJSON({
      icon: program.icon ?? drawn.doc.icon,
      keyline: program.keyline,
    }),
    // The parked house-local subpaths only. Downstream (`tournament.ts`,
    // the former browser viewer) re-adds the vocabulary itself as `[...parts,
    // ...result.extras]`, so folding it in here would double-count it.
    extras: drawn.extras ?? [],
    issues,
    program: adapted,
    svg: program.canvas.toSVG(),
    text: drawn.text,
  };
};

const analogOrAgent = async (
  concept: Concept,
  options: GenerateOptions,
  house?: HouseSource
): Promise<GenerateResult> => {
  const [of] = house?.kin?.(concept.name) ?? [];
  const paths = of === undefined ? undefined : (house?.paths(of) ?? undefined);
  const withKin =
    of !== undefined && paths !== undefined && paths.length > 0
      ? { ...options, analogOf: of, analogPaths: paths }
      : options;
  const drawn = await analogArm()(concept, withKin);
  if (
    options.ask &&
    drawn.audit?.scorable === true &&
    drawn.audit.sc < LOOK_SCREEN
  ) {
    return generate(concept, options);
  }
  return drawn;
};

/**
 * Draw one concept on the host path that matches the kind of gap.
 *
 * Analog with a look that cannot name the object (scorable, SC below screen)
 * falls through to the tool-calling loop. Unscorable looks keep the host
 * drawing: a gateway blip is not a reason to spend the agent budget.
 */
export const reach = (
  concept: Concept,
  options: GenerateOptions = {},
  house?: HouseSource,
  inventory?: PackIndex
): Promise<GenerateResult> => {
  const hasHouse = (slug: string): boolean =>
    Boolean(
      house?.has(slug) ||
      (slug === concept.name && (options.targetPaths?.length ?? 0) > 0)
    );
  const twin = house
    ?.kin?.(concept.name)
    .find((slug) => sameLetters(concept.name, slug));
  const plan = classifyReach(
    concept.name,
    hasHouse,
    options.forceAgent === true,
    twin,
    options.unkeyed
  );
  if (plan.kind === "agent") {
    return generate(concept, options);
  }
  if (plan.kind === "mark") {
    return markArm()(concept, options);
  }
  if (plan.kind === "glyph") {
    return glyphArm()(concept, options);
  }
  if (plan.kind === "compile") {
    const finish = options.finish ?? "outlined";
    const paintPaths = pathsOf(plan, concept, options, house, finish);
    if (paintPaths !== null && paintPaths.length > 0) {
      return compileArm()(concept, {
        ...options,
        finish,
        targetPaths: paintPaths,
      });
    }
    if (finish === "filled") {
      const outlined = pathsOf(plan, concept, options, house, "outlined");
      if (outlined === null || outlined.length === 0) {
        throw miss(concept.name);
      }
      return compileArm()(concept, {
        ...options,
        finish: "outlined",
        targetPaths: outlined,
      }).then((drawn) => adaptFilledFrom(drawn, options));
    }
    throw miss(concept.name);
  }
  if (options.unkeyed === "harness") {
    return harnessArm({
      command: options.harnessCommand ?? "claude",
    })(concept, options);
  }
  if (options.unkeyed === "agent") {
    return generate(concept, options);
  }
  if (options.unkeyed === "program") {
    return programArm()(concept, options);
  }
  if (options.unkeyed === "mixture") {
    return mixtureArm({ house, inventory })(concept, options);
  }
  return analogOrAgent(concept, options, house);
};
