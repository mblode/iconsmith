/**
 * Sparse mixture of experts for one concept.
 *
 * The 2025–26 literature on self-improving systems agrees on the shape, and
 * disagrees on what the loop is allowed to touch. Darwin Gödel Machine
 * (Sakana / Clune, 2025) and AlphaEvolve (DeepMind, 2025) keep/discard code
 * against a frozen evaluator. Mixture of Agents (Together, 2024) stacks cheap
 * proposers under a picker. Sparse MoE (Switch, Mixtral) fires one specialist
 * per token, not every specialist. Expert iteration records who won and
 * updates the gate. PLAN.md already picked the generation half: sample-and-
 * select beats in-place iteration, and the picker is the panel plus `part`
 * count, never the model's own judgement.
 *
 * This file is that stack, aimed at icons:
 *
 * 1. **Experts are the DRAW arms that already exist.** compile, mark, analog,
 *    glyph, agent. No new coordinate channel. A mixture that traced Lucide
 *    would be a vectoriser with extra steps.
 * 2. **The gate is sparse and evidence-only.** A house file, a MARKS key, a
 *    named analog family, a splice pair, a part hit, or pack *consensus*
 *    (how many analysis-only sets *name* this concept). Third-party packs —
 *    Lucide, Heroicons, Tabler, Remix, Phosphor, Iconoir, Radix — enter as
 *    a `PackIndex` of slugs. No SVG, no `d`, no neighbour raster. That is
 *    the licence gate in `licence.ts`, restated as a type the drawer can
 *    take. Huge Icons is the same kind of source if someone vendors the
 *    names; it is not a path this module opens.
 * 3. **Cheap experts run first.** Host arms cost nothing and cannot emit a
 *    coordinate. The agent (Vercel AI Gateway or OpenRouter) is the
 *    expensive layer, hired only when the gate lists it and a cheap expert
 *    did not already draw clean. `stopOnCleanCheap` is the default because
 *    a clean analog *is* the house language.
 * 4. **Unknown analog is not a win.** `analog unknown xyzzy` is a hold-out
 *    staying unknown, not a drawing. The gate falls through.
 *
 * The codebase-rewriting loop stays `scripts/autoresearch.ts`. This module
 * improves *routing*, not the frozen evaluator. A loop that can edit
 * `render.ts` or `blindspot.ts` is the DGM deleting its own cheat markers.
 *
 * `PackIndex` is a plain `ReadonlyMap`, for the same reason `search.ts`
 * restates aliases that way: `pipeline/` does not import `corpus/`.
 * `commands/` walks baseline *directory names* and passes slugs in.
 */
import { z } from "zod";

import type { Finish } from "../types.js";
import { analogArm, familyFromTokens } from "./analog.js";
import { generate } from "./generate.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import { glyphArm } from "./glyph.js";
import type { GenerateLike } from "./harness.js";
import { markFromSlug } from "./kind.js";
import { markArm } from "./mark.js";
import raw from "./mixture.default.json" with { type: "json" };
import { pick } from "./pick.js";
import type { Concept } from "./prompt.js";
import type { HouseSource } from "./reach.js";
import { compileArm } from "./reconstruct.js";
import { rankParts } from "./search.js";
import { splicePair, splicePaths } from "./splice.js";

export const EXPERT_IDS = [
  "agent",
  "analog",
  "compile",
  "glyph",
  "mark",
] as const;

export type ExpertId = (typeof EXPERT_IDS)[number];

export const CONCEPT_CLASSES = [
  "analog-family",
  "keyed-house",
  "keyed-mark",
  "keyed-splice",
  "net-new",
  "pack-inventory",
  "part-covered",
] as const;

export type ConceptClass = (typeof CONCEPT_CLASSES)[number];

/** Concept slug → analysis-only pack ids that *name* it. Never geometry. */
export type PackIndex = ReadonlyMap<string, readonly string[]>;

export interface MixturePolicy {
  /** Packs that must name a gap before it is inventory, not a curiosity.
   *  PLAN.md's "4+ of the seven third-party packs". */
  packInventoryFloor: number;
  /** Stop after a cheap expert draws clean and not-unknown. */
  stopOnCleanCheap: boolean;
  /** Try order per class. First is preferred; later are fallbacks. */
  weights: Readonly<Record<ConceptClass, readonly ExpertId[]>>;
}

export interface Evidence {
  analogFamily: string | null;
  hasHouse: boolean;
  isMark: boolean;
  packConsensus: number;
  packs: readonly string[];
  partHits: number;
  splice: { badge: string; base: string } | null;
}

export interface GateDecision {
  candidates: readonly ExpertId[];
  class: ConceptClass;
  reason: string;
}

export interface MixtureDeps {
  /** Override an expert so tests never hit the network. */
  experts?: Partial<Record<ExpertId, GenerateLike>>;
  house?: HouseSource;
  /** Slugs only. Built in `commands/` from baseline directory listings. */
  inventory?: PackIndex;
  onExpert?: (id: ExpertId, result: GenerateResult) => void;
  policy?: MixturePolicy;
}

const expertSchema = z.enum(EXPERT_IDS);
const classSchema = z.enum(CONCEPT_CLASSES);

const policySchema = z
  .object({
    packInventoryFloor: z.number().int().min(1).max(8),
    stopOnCleanCheap: z.boolean(),
    weights: z.record(classSchema, z.array(expertSchema).min(1)),
  })
  .strict();

export class MixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MixtureError";
  }
}

export const CHEAP_EXPERTS: ReadonlySet<ExpertId> = new Set([
  "analog",
  "compile",
  "glyph",
  "mark",
]);

const GEOMETRY_KEYS = new Set(["d", "path", "paths", "source", "svg"]);

/** Pack inventory may carry names. A `d` or `svg` is the leak `licence.ts`
 *  exists to stop, arriving as data rather than as an import. */
export const assertNamesOnly = (
  value: unknown,
  label = "pack inventory"
): void => {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const [i, item] of node.entries()) {
        walk(item, `${path}[${i}]`);
      }
      return;
    }
    if (node === null || typeof node !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (GEOMETRY_KEYS.has(key)) {
        throw new MixtureError(
          `${label} carries "${key}" at ${path}.${key}. Analysis-only packs ` +
            "may contribute names; geometry cannot condition a generation."
        );
      }
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, "$");
};

export const parseMixturePolicy = (value: unknown): MixturePolicy => {
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) {
    throw new MixtureError(
      `invalid mixture policy:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`
    );
  }
  const missing = CONCEPT_CLASSES.filter(
    (id) => parsed.data.weights[id] === undefined
  );
  if (missing.length > 0) {
    throw new MixtureError(
      `mixture policy is missing weights for ${missing.join(", ")}`
    );
  }
  return {
    packInventoryFloor: parsed.data.packInventoryFloor,
    stopOnCleanCheap: parsed.data.stopOnCleanCheap,
    weights: parsed.data.weights as MixturePolicy["weights"],
  };
};

export const DEFAULT_MIXTURE: MixturePolicy = parseMixturePolicy(raw);

export const consensusOf = (
  name: string,
  index: PackIndex
): { packs: number; sets: string[] } => {
  const sets = [...(index.get(name) ?? [])].toSorted((a, b) =>
    a.localeCompare(b)
  );
  return { packs: sets.length, sets };
};

/** Slug × pack rows, as `commands/` reads them off baseline listings. */
export const packIndexFromSlugs = (
  rows: readonly { pack: string; slug: string }[]
): PackIndex => {
  assertNamesOnly(rows, "pack slug index");
  const map = new Map<string, string[]>();
  for (const { pack, slug } of rows) {
    const list = map.get(slug) ?? [];
    if (!list.includes(pack)) {
      list.push(pack);
    }
    map.set(slug, list);
  }
  return map;
};

export const isUnknownAnalog = (result: GenerateResult): boolean =>
  /\banalog unknown\b/u.test(result.brief ?? "");

export const partOpsOf = (program: string | undefined): number =>
  (program ?? "").split("\n").filter((line) => /^\s*part\s/u.test(line)).length;

const hasHouseOf =
  (
    concept: Concept,
    options: GenerateOptions,
    house?: HouseSource
  ): ((slug: string) => boolean) =>
  (slug) =>
    Boolean(
      house?.has(slug) ||
      (slug === concept.name && (options.targetPaths?.length ?? 0) > 0)
    );

export const evidenceOf = (
  concept: Concept,
  options: GenerateOptions = {},
  deps: Pick<MixtureDeps, "house" | "inventory"> = {}
): Evidence => {
  const has = hasHouseOf(concept, options, deps.house);
  const { packs, sets } = consensusOf(
    concept.name,
    deps.inventory ?? new Map()
  );
  return {
    analogFamily: familyFromTokens(concept.name, ...(concept.tags ?? [])),
    hasHouse: has(concept.name),
    isMark: markFromSlug(concept.name) !== null,
    packConsensus: packs,
    packs: sets,
    partHits: rankParts(options.parts ?? [], concept.name, 8, options.aliases)
      .length,
    splice: splicePair(concept.name, has),
  };
};

/**
 * One class, one candidate list. Order is the try order.
 *
 * Keyed names are decided by the name alone — the house has already drawn
 * them. Unkeyed names take the first class that fits: a named analog family,
 * then a part hit, then pack consensus at the floor, else net-new.
 */
export const gate = (
  evidence: Evidence,
  policy: MixturePolicy = DEFAULT_MIXTURE
): GateDecision => {
  const choose = (id: ConceptClass, reason: string): GateDecision => ({
    candidates: policy.weights[id],
    class: id,
    reason,
  });
  if (evidence.isMark) {
    return choose("keyed-mark", "MARKS key — host twin, no model");
  }
  if (evidence.hasHouse) {
    return choose("keyed-house", "house file — compile onto parts");
  }
  if (evidence.splice !== null) {
    return choose(
      "keyed-splice",
      `splice ${evidence.splice.base} × ${evidence.splice.badge}`
    );
  }
  if (evidence.analogFamily !== null) {
    return choose(
      "analog-family",
      `named analog family ${evidence.analogFamily}`
    );
  }
  if (evidence.partHits > 0) {
    return choose(
      "part-covered",
      `${evidence.partHits} vocabulary hit(s) for this name`
    );
  }
  if (evidence.packConsensus >= policy.packInventoryFloor) {
    return choose(
      "pack-inventory",
      `${evidence.packConsensus} analysis-only packs name this (${evidence.packs.join(", ")})`
    );
  }
  return choose(
    "net-new",
    "no house file, family, part, or pack consensus — hire the agent"
  );
};

const miss = (slug: string): Error =>
  new Error(`expert compile has no house path data for "${slug}"`);

const compileExpert = (
  concept: Concept,
  options: GenerateOptions,
  house?: HouseSource
): Promise<GenerateResult> => {
  const finish: Finish = options.finish ?? "outlined";
  const has = hasHouseOf(concept, options, house);
  if ((options.targetPaths?.length ?? 0) > 0) {
    return compileArm()(concept, options);
  }
  const pair = splicePair(concept.name, has);
  if (pair) {
    const body = house?.paths(pair.base, finish);
    const badge = house?.paths(pair.badge, finish);
    if (body === undefined || body === null || body.length === 0) {
      throw miss(pair.base);
    }
    if (badge === undefined || badge === null || badge.length === 0) {
      throw miss(pair.badge);
    }
    return compileArm()(concept, {
      ...options,
      finish,
      targetPaths: splicePaths(body, badge),
    });
  }
  const paths = house?.paths(concept.name, finish) ?? null;
  if (paths === null || paths.length === 0) {
    throw miss(concept.name);
  }
  return compileArm()(concept, { ...options, finish, targetPaths: paths });
};

const analogExpert = (
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
  return analogArm()(concept, withKin);
};

export const defaultExperts = (
  house?: HouseSource
): Record<ExpertId, GenerateLike> => ({
  agent: generate,
  analog: (concept, options) => analogExpert(concept, options, house),
  compile: (concept, options) => compileExpert(concept, options, house),
  glyph: glyphArm(),
  mark: markArm(),
});

const isWin = (id: ExpertId, result: GenerateResult): boolean => {
  if (!result.clean) {
    return false;
  }
  if (id === "analog" && isUnknownAnalog(result)) {
    return false;
  }
  return true;
};

const annotate = (
  result: GenerateResult,
  decision: GateDecision,
  expert: ExpertId
): GenerateResult => ({
  ...result,
  brief:
    result.brief === undefined
      ? `mixture ${decision.class} ${expert}`
      : `mixture ${decision.class} ${expert} — ${result.brief}`,
  trace: [`mixture/${decision.class}/${expert}`, ...result.trace],
});

/** Ranked sample the experiment and `pick()` share. */
export const mixtureSample = (
  expert: ExpertId,
  concept: string,
  result: GenerateResult,
  cosine: number | null = null
): {
  clean: boolean;
  concept: string;
  cosine: number | null;
  errors: number;
  expert: ExpertId;
  partsFound: number;
  structural: readonly string[];
  unknown: boolean;
} => {
  const unknown = expert === "analog" && isUnknownAnalog(result);
  const errors = result.issues.filter((i) => i.severity === "error").length;
  return {
    clean: result.clean && !unknown,
    concept,
    cosine,
    errors: errors + (unknown ? 1 : 0),
    expert,
    partsFound: partOpsOf(result.program),
    structural: unknown ? ["unknown"] : [],
    unknown,
  };
};

/**
 * DRAW: try the gated experts in order. Cheap and clean wins; unknown analog
 * and dirty drawings fall through. The last attempted result is what a
 * caller gets when nothing won — so a hold-out that stays unknown stays
 * unknown, and an agent failure is not replaced by a silent hub.
 */
export const mixtureArm =
  (deps: MixtureDeps = {}): GenerateLike =>
  async (concept, options = {}) => {
    const policy = deps.policy ?? DEFAULT_MIXTURE;
    const evidence = evidenceOf(concept, options, deps);
    const decision = gate(evidence, policy);
    const experts = { ...defaultExperts(deps.house), ...deps.experts };
    const ran: { id: ExpertId; result: GenerateResult }[] = [];
    for (const id of decision.candidates) {
      // oxlint-disable-next-line no-await-in-loop -- stop on first cheap win
      const result = await experts[id](concept, options);
      deps.onExpert?.(id, result);
      ran.push({ id, result });
      if (policy.stopOnCleanCheap && isWin(id, result)) {
        return annotate(result, decision, id);
      }
    }
    if (ran.length === 0) {
      throw new MixtureError(
        `mixture gate for "${concept.name}" listed no experts`
      );
    }
    if (!policy.stopOnCleanCheap && ran.length > 1) {
      const samples = ran.map(({ id, result }) => ({
        id,
        result,
        ...mixtureSample(id, concept.name, result),
      }));
      const best = pick(samples);
      return annotate(best.result, decision, best.id);
    }
    const last = ran.at(-1);
    if (last === undefined) {
      throw new MixtureError(
        `mixture gate for "${concept.name}" listed no experts`
      );
    }
    return annotate(last.result, decision, last.id);
  };
