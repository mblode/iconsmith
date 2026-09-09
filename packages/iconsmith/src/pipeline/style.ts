/** A local, immutable drawing context. Only this constructor admits source
 * material; generation, replay and review consume the same pinned context. */
import { createHash } from "node:crypto";

import { z } from "zod";

import { bbox, parsePath, translate } from "../geometry/path.js";
import type { Spec } from "../tools/canvas.js";
import { run } from "../tools/dsl.js";
import type { SourceExactResolver } from "../tools/source-exact.js";
import type { Finish, Part } from "../types.js";
import { asReference } from "./licence.js";
import type { Reference } from "./licence.js";
import { parsePolicy } from "./policy.js";
import type { Policy } from "./policy.js";

/** Bump when the compiler's interpretation changes. Stored SVGs remain the
 * authoritative artifact; replay additionally checks their exact bytes. */
export const STYLE_COMPILER = "iconsmith-constrained-25-source-exact";

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
    sourceAssembly: z
      .object({
        children: z
          .array(
            z
              .object({
                partHash: z.string().regex(/^[a-f0-9]{64}$/u),
                partId: z.string().min(1),
                semantics: z.discriminatedUnion("kind", [
                  z
                    .object({
                      fillRule: z.enum(["nonzero", "evenodd"]),
                      kind: z.literal("fill"),
                    })
                    .strict(),
                  z
                    .object({
                      cap: z.enum(["butt", "round", "square"]),
                      join: z.enum(["bevel", "miter", "round"]),
                      kind: z.literal("stroke"),
                      strokeWidth: positive,
                    })
                    .strict(),
                ]),
                x: z.number().finite(),
                y: z.number().finite(),
              })
              .strict()
          )
          .min(2)
          .max(64),
        finish: z.enum(["filled", "outlined"]),
        sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
        viewBox: z.literal("0 0 24 24"),
      })
      .strict()
      .optional(),
    sourceAssemblyOnly: z.string().min(1).optional(),
    sourceFillRule: z.enum(["nonzero", "evenodd"]).optional(),
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

type RevisionDefinition = z.infer<typeof revisionSchema>;
const sameExtent = (left: number, right: number) =>
  Math.abs(left - right) <= 1e-9;

// Assembly validation deliberately evaluates all identity, paint, graph and
// bounds invariants together so no parsed revision can bypass a later phase.
// eslint-disable-next-line complexity
const validateSourceAssemblies = (definition: RevisionDefinition): void => {
  for (const master of Object.keys(definition.masters)) {
    const spec = definition.masters[master];
    const masterParts = definition.parts
      .filter((entry) => entry.master === master)
      .map(({ part }) => part);
    const byId = new Map(masterParts.map((part) => [part.id, part]));
    const assemblies = masterParts.flatMap((part) =>
      part.sourceAssembly ? [[part, part.sourceAssembly] as const] : []
    );
    for (const [part, assembly] of assemblies) {
      if (part.sourceAssemblyOnly) {
        throw new Error(
          `Source assembly ${part.id} cannot itself be a private dependency`
        );
      }
      if (part.sourceFillRule) {
        throw new Error(
          `Source assembly ${part.id} cannot also carry source fill paint`
        );
      }
      if (
        assembly.finish === "filled" &&
        new Set(assembly.children.map(({ semantics }) => semantics.kind)).size >
          1
      ) {
        throw new Error(
          `Filled source assembly ${part.id} mixes fill and stroke paint`
        );
      }
      let nodes = 0;
      const childGeometry = [];
      for (const child of assembly.children) {
        if (child.partId === part.id) {
          throw new Error(`Source assembly cycle: ${part.id}`);
        }
        const target = byId.get(child.partId);
        if (!target) {
          throw new Error(
            `Source assembly ${part.id} has missing child ${child.partId}`
          );
        }
        if (target.sourceAssembly) {
          throw new Error(
            `Source assembly ${part.id} exceeds maximum depth 1 at ${child.partId}`
          );
        }
        if (
          target.sourceAssemblyOnly &&
          target.sourceAssemblyOnly !== part.id
        ) {
          throw new Error(
            `Source assembly ${part.id} cannot use private child ${child.partId} from ${target.sourceAssemblyOnly}`
          );
        }
        if (styleHash(target) !== child.partHash) {
          throw new Error(
            `Source assembly ${part.id} child identity drift: ${child.partId}`
          );
        }
        const expected = target.sourceFillRule
          ? { fillRule: target.sourceFillRule, kind: "fill" as const }
          : {
              cap: spec.strokeCap ?? "round",
              join: spec.strokeJoin ?? "round",
              kind: "stroke" as const,
              strokeWidth: spec.stroke,
            };
        if (canonical(expected) !== canonical(child.semantics)) {
          throw new Error(
            `Source assembly ${part.id} child paint drift: ${child.partId}`
          );
        }
        nodes += target.nodes;
        childGeometry.push(
          ...parsePath(target.d).map((shape) =>
            translate(shape, child.x, child.y)
          )
        );
      }
      if (nodes > 4096) {
        throw new Error(`Source assembly ${part.id} exceeds 4096 child nodes`);
      }
      const childBounds = bbox(childGeometry);
      if (
        part.w > 24 ||
        part.h > 24 ||
        !sameExtent(childBounds.x0, 0) ||
        !sameExtent(childBounds.y0, 0) ||
        !sameExtent(childBounds.w, part.w) ||
        !sameExtent(childBounds.h, part.h)
      ) {
        throw new Error(
          `Source assembly ${part.id} children drift outside its source-bound extent`
        );
      }
    }
    for (const part of masterParts) {
      if (!part.sourceAssemblyOnly) {
        continue;
      }
      const owner = byId.get(part.sourceAssemblyOnly);
      if (
        !owner?.sourceAssembly?.children.some(
          ({ partId }) => partId === part.id
        )
      ) {
        throw new Error(
          `Private source child ${part.id} has missing assembly ${part.sourceAssemblyOnly}`
        );
      }
    }
  }
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
    if (part.sourceFillRule && !part.closed) {
      throw new Error("Source-filled parts must have closed contours");
    }
    try {
      const paths = parsePath(part.d);
      if (!paths.length || !Object.values(bbox(paths)).every(Number.isFinite)) {
        throw new Error("Expected nonempty finite path geometry");
      }
    } catch (error) {
      throw new Error(
        `Invalid geometry for style part ${part.id}: ${String(error)}`,
        {
          cause: error,
        }
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
  validateSourceAssemblies(definition);
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
  sourceExactRegistryHash?: string;
}

export const compileStyle = (
  selection: StyleSelection,
  program: string,
  options: { sourceExact?: SourceExactResolver } = {}
): StyleArtifact => {
  assertStyle(selection);
  const result = run(program, [...selection.parts], {
    sourceExact: options.sourceExact,
    spec: selection.spec,
  });
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
    ...(options.sourceExact
      ? { sourceExactRegistryHash: options.sourceExact.registryHash }
      : {}),
  };
};

/** An unavailable compiler never reinterprets old source. Callers can still
 * display the stored SVG after verifying svgHash. */
export const replayStyle = (
  selection: StyleSelection,
  artifact: StyleArtifact,
  options: { sourceExact?: SourceExactResolver } = {}
): string => {
  assertStyle(selection);
  if (
    artifact.compiler !== STYLE_COMPILER ||
    artifact.style !== selection.revision.hash ||
    artifact.master !== selection.master
  ) {
    throw new Error("Replay unavailable for this compiler/style/master");
  }
  if (artifact.sourceExactRegistryHash !== options.sourceExact?.registryHash) {
    throw new Error("Replay unavailable for this source-exact registry");
  }
  const replay = compileStyle(selection, artifact.program, options);
  if (
    replay.svg !== artifact.svg ||
    replay.svgHash !== artifact.svgHash ||
    replay.finish !== artifact.finish
  ) {
    throw new Error("Stored style artifact differs from exact replay");
  }
  return replay.svg;
};
