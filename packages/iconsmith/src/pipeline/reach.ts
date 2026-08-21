/**
 * Host DRAW first for a house file or a MARKS key. A new glyph is written by
 * a coding agent (`unkeyed: "agent"` / `"harness"`). Analog replay is the lab
 * path, not the product path for `iconsmith new`.
 *
 * Keyed compile scored 0.999 on `pull-request`; N=5 agent redraws of the same
 * file scored 0.58–0.79. `forceAgent` skips host DRAW entirely.
 */
import { analogArm, sameLetters } from "./analog.js";
import { LOOK_SCREEN } from "./audit.js";
import { generate } from "./generate.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import { harnessArm } from "./harness.js";
import { markFromSlug } from "./kind.js";
import { markArm } from "./mark.js";
import type { Concept } from "./prompt.js";
import { compileArm } from "./reconstruct.js";
import { splicePair, splicePaths } from "./splice.js";

export type ReachKind = "agent" | "analog" | "compile" | "mark";

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
  paths: (slug: string) => readonly string[] | null;
}

export const classifyReach = (
  name: string,
  hasHouse: (slug: string) => boolean,
  forceAgent = false,
  twin?: string
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
  return { kind: "analog" };
};

const miss = (slug: string): Error =>
  new Error(`no house path data for "${slug}"`);

const pathsOf = (
  plan: ReachPlan,
  concept: Concept,
  options: GenerateOptions,
  house?: HouseSource
): readonly string[] => {
  if (plan.base !== undefined && plan.badge !== undefined) {
    const body = house?.paths(plan.base);
    const badge = house?.paths(plan.badge);
    if (body === undefined || body === null) {
      throw miss(plan.base);
    }
    if (badge === undefined || badge === null) {
      throw miss(plan.badge);
    }
    return splicePaths(body, badge);
  }
  const paths =
    options.targetPaths ?? house?.paths(plan.of ?? concept.name) ?? undefined;
  if (paths === undefined) {
    throw miss(concept.name);
  }
  return paths;
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
  house?: HouseSource
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
    twin
  );
  if (plan.kind === "agent") {
    return generate(concept, options);
  }
  if (plan.kind === "mark") {
    return markArm()(concept, options);
  }
  if (plan.kind === "compile") {
    return compileArm()(concept, {
      ...options,
      targetPaths: pathsOf(plan, concept, options, house),
    });
  }
  if (options.unkeyed === "harness") {
    return harnessArm({
      command: options.harnessCommand ?? "claude",
    })(concept, options);
  }
  if (options.unkeyed === "agent") {
    return generate(concept, options);
  }
  return analogOrAgent(concept, options, house);
};
