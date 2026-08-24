import { z } from "zod";

import type { StudioTournament, StudioVersion } from "./types";

/**
 * The set-wide consistency audit, computed from the documents the pipeline
 * already ships.
 *
 * Cursor's Overviews file exists because Figma cannot answer these questions:
 * whether the folder in one icon is the folder in the other nine is, in a file
 * of paths, a thing you check by eye. Here an icon is a program, so the same
 * questions are a group-by. `DrawOp` even keeps `knockout`, `offAxis` and
 * `flip` beside the geometry precisely so a diff shows a real change.
 *
 * Reported the way `corpus/census.ts` reports: the majority is the convention
 * and the minority is the finding. Nine agreeing and one not is a one-icon
 * problem, not a ten-icon one.
 */

/**
 * A local mirror of the package's `IconDoc`, only as deep as the audit reads.
 * It cannot import the real schema: this app is zod 4 and `packages/iconsmith`
 * is zod 3, and `AGENTS.md` says they must not be aligned. `document` arrives
 * as `unknown` on the wire, so it is validated rather than trusted.
 */
const drawOpSchema = z
  .object({
    flip: z.literal(true).optional(),
    id: z.string().optional(),
    knockout: z.literal(true).optional(),
    offAxis: z.boolean().optional(),
    op: z.string(),
    role: z.string().optional(),
    scale: z.number().optional(),
    turn: z.number().optional(),
  })
  .loose();

const iconDocSchema = z
  .object({
    draw: z.array(drawOpSchema).default([]),
    finish: z.enum(["filled", "outlined"]).optional(),
    keyline: z.string().nullable().default(null),
  })
  .loose();

export type OverviewDoc = z.infer<typeof iconDocSchema>;

/** One drawing the audit can see, whether it won its tournament or not. */
export interface OverviewSubject {
  readonly doc: OverviewDoc;
  readonly finish: string;
  readonly id: string;
  /** Names the drawing in a finding: the arm that drew it and which paint. */
  readonly label: string;
  /** The arm that drew it, or "kept" for a delivered version. */
  readonly origin: string;
  readonly name: string;
  readonly svg: string;
}

export interface OverviewGroup {
  readonly count: number;
  readonly subjects: readonly OverviewSubject[];
  readonly value: string;
}

export interface OverviewRow {
  /** What the house spec says, when it says anything. */
  readonly expected: string | null;
  readonly groups: readonly OverviewGroup[];
  readonly id: string;
  /** The subjects outside the majority. Empty when the row agrees. */
  readonly minority: readonly OverviewSubject[];
  readonly question: string;
  readonly title: string;
  /** Null when nothing recurs often enough to be a convention yet. */
  readonly convention: string | null;
  /**
   * True when no drawing uses this construct at all. Distinct from having no
   * convention: "none of these have dots" is a fact about the population,
   * "these dots disagree" is a finding about the drawing.
   */
  readonly absent: boolean;
}

const asDoc = (value: unknown): OverviewDoc | null => {
  const parsed = iconDocSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** Every drawing in the session, delivered or discarded. */
export const overviewSubjects = (
  versions: readonly StudioVersion[],
  tournaments: readonly StudioTournament[],
): OverviewSubject[] => {
  const subjects: OverviewSubject[] = [];

  for (const version of versions) {
    const doc = asDoc(version.document);
    if (doc) {
      subjects.push({
        doc,
        finish: version.finish,
        id: version.id,
        label: `${version.name}, ${version.finish}`,
        name: version.name,
        origin: "kept",
        svg: version.svg,
      });
    }
  }

  // The tournament ships every arm's complete pair and the studio shows two of
  // them. A table over two icons is not a population; over every arm it is.
  for (const tournament of tournaments) {
    for (const candidate of tournament.candidates) {
      // The delivered versions are the winning arm's own paints, so counting
      // that candidate again would enter each kept drawing twice and pull the
      // majority — which this table calls the convention — toward the winner.
      if (candidate.id === tournament.selected) {
        continue;
      }
      for (const paint of candidate.paints) {
        const doc = asDoc(paint.document);
        if (doc) {
          subjects.push({
            doc,
            finish: paint.finish,
            id: `${candidate.id}-${paint.finish}`,
            label: `${candidate.label}, ${paint.finish}`,
            name: candidate.label,
            origin: candidate.label,
            svg: paint.svg,
          });
        }
      }
    }
  }

  return subjects;
};

const group = (
  subjects: readonly OverviewSubject[],
  valueOf: (subject: OverviewSubject) => string | null,
): OverviewGroup[] => {
  const buckets = new Map<string, OverviewSubject[]>();
  for (const subject of subjects) {
    const value = valueOf(subject);
    if (value === null) {
      continue;
    }
    const bucket = buckets.get(value);
    if (bucket) {
      bucket.push(subject);
    } else {
      buckets.set(value, [subject]);
    }
  }
  return [...buckets.entries()]
    .map(([value, rows]) => ({ count: rows.length, subjects: rows, value }))
    .toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

/**
 * A convention needs something to be the exception to. One drawing is not a
 * majority, and an even split is a decision to make rather than a drift to
 * correct, so both report no convention rather than inventing one.
 */
const conventionOf = (groups: readonly OverviewGroup[]): OverviewGroup | null => {
  const [first, second] = groups;
  if (!first || first.count < 2) {
    return null;
  }
  return second && second.count === first.count ? null : first;
};

const buildRow = (
  id: string,
  title: string,
  question: string,
  expected: string | null,
  subjects: readonly OverviewSubject[],
  valueOf: (subject: OverviewSubject) => string | null,
): OverviewRow => {
  const groups = group(subjects, valueOf);
  const convention = conventionOf(groups);
  return {
    absent: groups.length === 0,
    convention: convention?.value ?? null,
    expected,
    groups,
    id,
    minority: convention ? groups.filter((g) => g !== convention).flatMap((g) => g.subjects) : [],
    question,
    title,
  };
};

const ops = (subject: OverviewSubject, op: string) =>
  subject.doc.draw.filter((entry) => entry.op === op);

/** House dot diameters, from the measured spec rather than asserted here. */
const dotSummary = (dots: Readonly<Record<string, number>>): string =>
  Object.entries(dots)
    .map(([role, size]) => `${role} ${size}`)
    .join(", ");

/**
 * The measured house constants the audit compares against. Passed in from the
 * server rather than imported here: `iconsmith` reaches `sharp`, which cannot
 * be placed in a browser bundle, and copying the numbers would create the
 * second source of truth this product exists to avoid.
 */
export interface OverviewSpec {
  readonly dots: Readonly<Record<string, number>>;
  readonly keylines: readonly string[];
}

export const buildOverview = (
  subjects: readonly OverviewSubject[],
  spec: OverviewSpec,
): OverviewRow[] => [
  buildRow(
    "keyline",
    "Optical shape",
    "Do these sit on one keyline?",
    spec.keylines.join(", "),
    subjects,
    (subject) => subject.doc.keyline ?? "none declared",
  ),
  buildRow(
    "parts",
    "Repeated objects",
    "Is the folder in one icon the folder in the others?",
    null,
    subjects,
    (subject) => {
      const ids = ops(subject, "part")
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === "string")
        .toSorted();
      return ids.length > 0 ? ids.join(" + ") : null;
    },
  ),
  buildRow(
    "dots",
    "Dots",
    "Are the dots the same kind of dot?",
    dotSummary(spec.dots),
    subjects,
    (subject) => {
      const roles = ops(subject, "dot")
        .map((entry) => entry.role)
        .filter((role): role is string => typeof role === "string")
        .toSorted();
      return roles.length > 0 ? roles.join(" + ") : null;
    },
  ),
  buildRow(
    "diagonals",
    "Diagonals",
    "Do the off-axis edges share one intent?",
    "29.3% of stroked icons carry one",
    subjects,
    (subject) => {
      const lines = ops(subject, "line");
      if (lines.length === 0) {
        return null;
      }
      return lines.some((entry) => entry.offAxis === true) ? "off-axis" : "on-axis only";
    },
  ),
  buildRow(
    "solids",
    "Solids and cuts",
    "Is the filled twin built the same way?",
    null,
    subjects,
    (subject) => {
      const knockouts = subject.doc.draw.filter((entry) => entry.knockout === true).length;
      const finish = subject.doc.finish ?? subject.finish;
      return knockouts > 0 ? `${finish}, ${knockouts} knockout` : `${finish}, no knockout`;
    },
  ),
];
