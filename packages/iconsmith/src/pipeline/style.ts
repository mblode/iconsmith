/** A local, immutable drawing context. Only this constructor admits source
 * material; generation, replay and review consume the same pinned context. */
import { createHash } from "node:crypto";

import { z } from "zod";

import { bbox, parsePath } from "../geometry/path.js";
import type { Spec } from "../tools/canvas.js";
import { run } from "../tools/dsl.js";
import type { Finish, Part } from "../types.js";
import { asReference } from "./licence.js";
import type { Reference } from "./licence.js";
import { parsePolicy } from "./policy.js";
import type { Policy } from "./policy.js";

/** Bump when the compiler's interpretation changes. Stored SVGs remain the
 * authoritative artifact; replay additionally checks their exact bytes. */
export const STYLE_COMPILER = "iconsmith-constrained-18";

const positive = z.number().finite().positive();
const pair = z.tuple([positive, positive]);
const specSchema = z
  .object({
    canvas: z.literal(24),
    clearance: z.number().finite().nonnegative(),
    detailStroke: positive.optional(),
    dots: z.record(positive).refine((dots) => Object.keys(dots).length > 0),
    fillRadiusTiers: z.array(positive),
    grid: positive,
    keylines: z
      .object({
        circle: pair,
        landscape: pair,
        portrait: pair,
        square: pair,
        tall: pair,
        wide: pair,
      })
      .strict(),
    maxElements: z.number().int().positive(),
    minFeature: positive,
    minGap: positive,
    partGeometry: z.enum(["grid", "source"]).optional(),
    radius: z.number().finite().nonnegative(),
    radiusTiers: z.array(positive),
    size: z.union([z.literal(16), z.literal(20), z.literal(24)]),
    stroke: positive,
    strokeCap: z.enum(["round", "square"]).optional(),
    strokeJoin: z.enum(["round", "miter"]).optional(),
  })
  .strict()
  .refine(
    (spec) =>
      spec.detailStroke === undefined || spec.detailStroke <= spec.stroke,
    "Detail stroke must not exceed family stroke"
  )
  .refine(
    (spec) =>
      spec.radius === 0 ||
      (spec.radiusTiers.length > 0 && spec.fillRadiusTiers.length > 0),
    "Positive-radius styles require radius tiers"
  );

const provenanceSchema = z
  .object({
    date: z.string().min(1),
    icon: z.string().optional(),
    licenses: z.array(z.string()).optional(),
    origin: z.enum(["central", "derived", "literal", "original"]),
    set: z.string().optional(),
    version: z.string().optional(),
  })
  .strict();

const partSchema = z
  .object({
    closed: z.boolean(),
    d: z.string().min(1),
    flips: z.tuple([z.number(), z.number()]).optional(),
    h: z.number().finite().nonnegative(),
    icons: z.array(z.string()),
    id: z.string().min(1),
    instances: z.number().int().nonnegative(),
    name: z.string().min(1).optional(),
    nodes: z.number().int().nonnegative(),
    sizeRange: z.tuple([z.number(), z.number()]),
    turns: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    w: z.number().finite().nonnegative(),
  })
  .strict();

const revisionSchema = z
  .object({
    /** Each style starts uncalibrated. A passing pilot is separate evidence. */
    calibration: z.literal("unvalidated"),
    compiler: z.literal(STYLE_COMPILER),
    id: z.string().min(1),
    masters: z
      .record(specSchema)
      .refine((masters) => Object.keys(masters).length > 0),
    parts: z.array(
      z
        .object({
          master: z.string().min(1),
          part: partSchema,
          provenance: provenanceSchema,
        })
        .strict()
    ),
    policy: z.unknown(),
    references: z.array(
      z
        .object({
          master: z.string().min(1),
          name: z.string().min(1),
          provenance: provenanceSchema,
          svg: z.string().min(1),
        })
        .strict()
    ),
    rubric: z.string().min(1).max(12_000),
  })
  .strict();

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
export const styleHash = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

export interface StyleRevision {
  readonly hash: string;
  readonly definition: z.infer<typeof revisionSchema> & { policy: Policy };
}
const revisions = new WeakSet<StyleRevision>();
const selections = new WeakSet<StyleSelection>();

/** Parsing is intentionally not a new grant mechanism: the existing source
 * admission rule still rejects analysis-only product collections. */
export const createStyleRevision = (input: unknown): StyleRevision => {
  const parsed = revisionSchema.parse(input);
  const definition = { ...parsed, policy: parsePolicy(parsed.policy) };
  const names = new Set<string>();
  for (const { master, part, provenance } of definition.parts) {
    if (!Object.hasOwn(definition.masters, master)) {
      throw new Error(`Unknown part master: ${master}`);
    }
    asReference({ name: part.id, svg: part.d }, provenance);
    try {
      const paths = parsePath(part.d);
      if (!paths.length || !Object.values(bbox(paths)).every(Number.isFinite)) {
        throw new Error("Expected nonempty finite path geometry");
      }
    } catch (error) {
      throw new Error(
        `Invalid geometry for style part ${part.id}: ${String(error)}`,
        { cause: error }
      );
    }
    for (const name of new Set([part.id, ...(part.name ? [part.name] : [])])) {
      const key = `${master}:${name}`;
      if (names.has(key)) {
        throw new Error(`Ambiguous style part: ${name}`);
      }
      names.add(key);
    }
  }
  for (const ref of definition.references) {
    if (!Object.hasOwn(definition.masters, ref.master)) {
      throw new Error(`Unknown reference master: ${ref.master}`);
    }
    asReference(ref, ref.provenance);
  }
  const revision = freeze({ definition, hash: styleHash(definition) });
  revisions.add(revision);
  return revision;
};

export interface StyleSelection {
  readonly revision: StyleRevision;
  readonly master: string;
  readonly spec: Spec;
  readonly policy: Policy;
  readonly parts: readonly Part[];
  readonly references: readonly Reference[];
  readonly key: string;
}

export const selectStyle = (
  revision: StyleRevision,
  master: string
): StyleSelection => {
  if (!revisions.has(revision)) {
    throw new Error("Style revision was not admitted");
  }
  const spec = revision.definition.masters[master];
  if (!Object.hasOwn(revision.definition.masters, master)) {
    throw new Error(`Unavailable style master: ${master}`);
  }
  const selection = freeze({
    key: styleHash({ master, revision: revision.hash }),
    master,
    parts: revision.definition.parts
      .filter((entry) => entry.master === master)
      .map(({ part }) => part),
    policy: revision.definition.policy,
    references: revision.definition.references
      .filter((ref) => ref.master === master)
      .map((ref) =>
        asReference({ name: ref.name, svg: ref.svg }, ref.provenance)
      ),
    revision,
    spec,
  });
  selections.add(selection);
  return selection;
};

export const assertStyle = (selection: StyleSelection): void => {
  if (!selections.has(selection)) {
    throw new Error("Style selection was not admitted");
  }
};

/** Extras may repeat a pinned dependency but cannot introduce or replace one.
 * New generated anchors must first become part of a new immutable revision. */
export const styleParts = (
  selection: StyleSelection,
  extras: readonly Part[] = []
): readonly Part[] => {
  assertStyle(selection);
  const approved = new Map(
    selection.parts.map((part) => [part.id, styleHash(part)])
  );
  for (const part of extras) {
    if (approved.get(part.id) !== styleHash(part)) {
      throw new Error(`Unapproved style dependency: ${part.id}`);
    }
  }
  return selection.parts;
};

export interface StyleArtifact {
  compiler: string;
  style: string;
  master: string;
  finish: Finish;
  program: string;
  svg: string;
  svgHash: string;
}

export const compileStyle = (
  selection: StyleSelection,
  program: string
): StyleArtifact => {
  assertStyle(selection);
  const result = run(program, [...selection.parts], { spec: selection.spec });
  if (result.errors.length || result.canvas.elements.length === 0) {
    throw new Error(
      `Style program did not compile: ${result.errors.join("; ") || "empty drawing"}`
    );
  }
  const svg = result.canvas.toSVG();
  return {
    compiler: STYLE_COMPILER,
    finish: result.finish,
    master: selection.master,
    program,
    style: selection.revision.hash,
    svg,
    svgHash: styleHash(svg),
  };
};

/** An unavailable compiler never reinterprets old source. Callers can still
 * display the stored SVG after verifying svgHash. */
export const replayStyle = (
  selection: StyleSelection,
  artifact: StyleArtifact
): string => {
  assertStyle(selection);
  if (
    artifact.compiler !== STYLE_COMPILER ||
    artifact.style !== selection.revision.hash ||
    artifact.master !== selection.master
  ) {
    throw new Error("Replay unavailable for this compiler/style/master");
  }
  const replay = compileStyle(selection, artifact.program);
  if (
    replay.svg !== artifact.svg ||
    replay.svgHash !== artifact.svgHash ||
    replay.finish !== artifact.finish
  ) {
    throw new Error("Stored style artifact differs from exact replay");
  }
  return replay.svg;
};
