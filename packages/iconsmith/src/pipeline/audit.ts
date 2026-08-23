/**
 * Host-side look at a *drawing*, not a sketch.
 *
 * `critique` picks among raster proposals. This module looks at SVG that
 * already went through `Canvas`. The host screenshots; the agent only
 * rewrites DSL. Fail open: a downed model must not turn a treatment into a
 * missing sample — but it must not count as a pass either.
 *
 * `shot` calls the frozen `png()` — it does not retune `render.ts`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { generateObject } from "ai";
import { z } from "zod";

import { png } from "../tools/render.js";
import type { Finish } from "../types.js";
import type { ApiCost } from "./cost.js";
import { EMPTY_USAGE, tokenUsageOf } from "./cost.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { CounterpartClass, DrawKind, MarkTwin } from "./kind.js";

/** High-value visual judge from the live Gateway catalog (2026-08-24).
 * Gemini 3.7 Flash is the current discounted workhorse for agents, vision,
 * and tool use. Acceptance remains independent of the generation model. */
export const AUDIT_MODEL = "google/gemini-3.7-flash";
export const PREVIEW_FILE = "PREVIEW.png";
export const AUDIT_FILE = "AUDIT.json";
/** Same size `eval/judge-model.ts` uses: eyes, not the 48px cosine raster. */
export const AUDIT_PX = 192;
/** Design size. A stroke that survives here is an icon; 192px can merge it. */
export const ICON_PX = 24;
/** SC/PQ at or above this is a screen pass. */
export const LOOK_SCREEN = 6;

export type AuditKind =
  | "belong"
  | "empty"
  | "finish"
  | "gap"
  | "keyline"
  | "object"
  | "weight";

export interface AuditFinding {
  kind: AuditKind;
  message: string;
}

export interface AuditResult {
  /** The visual judge call, when this result came from a live provider. */
  cost?: ApiCost;
  findings: AuditFinding[];
  /**
   * Decide pass for agent arms (no findings + screen). Screen pass for host
   * marks (SC/PQ ≥ 6; findings are notes). Always false when unscorable.
   */
  ok: boolean;
  pq: number;
  reason: string | null;
  sc: number;
  /** False when the gateway threw. Not a pass, not a finding. */
  scorable: boolean;
  /** Screen = competence; decide = zero findings. */
  stage: "decide" | "screen";
}

export type AuditAsk = (input: {
  concept: { name: string };
  finish: Finish;
  kind?: DrawKind;
  preview: Buffer;
  previewSmall?: Buffer;
  references: readonly Buffer[];
  twin?: MarkTwin;
}) => Promise<
  Omit<AuditResult, "ok" | "scorable" | "stage"> & Partial<AuditResult>
>;

const KINDS = new Set<AuditKind>([
  "belong",
  "empty",
  "finish",
  "gap",
  "keyline",
  "object",
  "weight",
]);

const schema = z.object({
  findings: z.array(
    z.object({
      kind: z.enum([
        "belong",
        "empty",
        "finish",
        "gap",
        "keyline",
        "object",
        "weight",
      ]),
      message: z.string(),
    })
  ),
  pq: z.number().min(0).max(10),
  reason: z.string(),
  sc: z.number().min(0).max(10),
});

/** Path data, SVG path commands, or `d=` — the model never smuggles geometry. */
const GEOMETRY = /\b[Mm]\s*-?\d|[CcLlHhVvSsQqTtAa]\s*-?\d|\bd\s*=|<\s*path\b/u;

export const sanitizeFinding = (finding: AuditFinding): AuditFinding => {
  const kind = KINDS.has(finding.kind) ? finding.kind : "belong";
  const message = GEOMETRY.test(finding.message)
    ? "finding named geometry; rewrite the program, do not copy path data"
    : finding.message;
  return { kind, message };
};

const classOf = (twin?: MarkTwin): CounterpartClass | undefined => twin?.class;

/** Outlined is not "must show a hole". Bars and dots *are* the stroke. */
export const HOLE_RULE =
  "Outlined finish: a bar, line, or dot may be solid — the stroke is the " +
  "subject. Only closed masses (rings, frames, tiles, bodies) must show " +
  "canvas inside. Do not fail a minus or a node for lacking a hole. Do not " +
  "treat 24px antialiasing as a finish fail.";

export const lookBrief = ({
  concept,
  finish,
  kind,
  twin,
}: {
  concept: { name: string };
  finish: Finish;
  kind?: DrawKind;
  twin?: MarkTwin;
}): string => {
  const cls = classOf(twin);
  const who = `"${concept.name}" (${finish})`;
  const head = (() => {
    if (cls === "same-construction") {
      return (
        `The references are the same construction as ${who}. Reconstruction is ` +
        "allowed. Findings only for real problems in our language, not 1-unit " +
        "margin nits or a cross-set take."
      );
    }
    if (cls === "same-concept") {
      return (
        `The references are another set's take of ${who}. Target is a competent ` +
        "icon of that object, not a copy of their motif. Do not demand their " +
        "exact corners, slash direction, or hollow details."
      );
    }
    if (
      cls === "house-motif" ||
      cls === "none" ||
      twin === undefined ||
      twin.slug === null
    ) {
      return (
        `No house counterpart to copy for ${who}. Judge whether it reads as ` +
        "that concept in that finish. Do not invent a motif from another set."
      );
    }
    if (kind === "compile") {
      return `Keyed reconstruction of ${who}. Parts placed is the point.`;
    }
    return `Candidate drawing for ${who}.`;
  })();
  return `${head} ${HOLE_RULE}`;
};

export const judged = (
  raw: Omit<AuditResult, "ok" | "scorable" | "stage"> &
    Partial<Pick<AuditResult, "scorable">>,
  kind: DrawKind = "analog"
): AuditResult => {
  const scorable = raw.scorable !== false;
  const screen = scorable && raw.sc >= LOOK_SCREEN && raw.pq >= LOOK_SCREEN;
  const decide = screen && raw.findings.length === 0;
  const host = kind === "mark";
  return {
    cost: raw.cost,
    findings: raw.findings,
    ok: host ? screen : decide,
    pq: raw.pq,
    reason: raw.reason,
    sc: raw.sc,
    scorable,
    stage: decide ? "decide" : "screen",
  };
};

export const shot = (svg: string, size = AUDIT_PX): Promise<Buffer> =>
  png(svg, size);

export const writePreview = async (
  dir: string,
  svg: string
): Promise<Buffer> => {
  const preview = await shot(svg);
  writeFileSync(path.join(dir, PREVIEW_FILE), preview);
  return preview;
};

export const writeAudit = (dir: string, result: AuditResult): void => {
  writeFileSync(
    path.join(dir, AUDIT_FILE),
    `${JSON.stringify(result, null, 2)}\n`
  );
};

export const previewName = (stem: string): string => `${stem}.preview.png`;
export const auditName = (stem: string): string => `${stem}.audit.json`;

export const persistLook = async (
  dir: string,
  stem: string,
  svg: string,
  result?: AuditResult | null
): Promise<void> => {
  writeFileSync(path.join(dir, previewName(stem)), await shot(svg));
  if (result) {
    writeFileSync(
      path.join(dir, auditName(stem)),
      `${JSON.stringify(result, null, 2)}\n`
    );
  }
};

/** The live vision ask. Harness leaves this off until the caller passes it. */
export const gatewayAsk: AuditAsk = async ({
  concept,
  finish,
  kind,
  preview,
  previewSmall,
  references,
  twin,
}) => {
  const costTracker = gatewayCostTracker();
  const result = await generateObject({
    messages: [
      {
        content: [
          {
            text: lookBrief({ concept, finish, kind, twin }),
            type: "text",
          },
          ...references.map(
            (data) => ({ data, mediaType: "image/png", type: "file" }) as const
          ),
          {
            text:
              `Candidate at 24px (does the stroke survive icon size), then ` +
              `at 192px (does it read). Score SC (is it the named object) and ` +
              `PQ (is it a competent icon) 0-10. List findings only for real ` +
              `problems. Never quote path data, coordinates, or SVG. Say what ` +
              `to change in the icon language (rect, circle, hole, part, ` +
              `line, finish), not how to draw it. ${HOLE_RULE}`,
            type: "text",
          },
          ...(previewSmall
            ? [
                {
                  data: previewSmall,
                  mediaType: "image/png",
                  type: "file" as const,
                },
              ]
            : []),
          { data: preview, mediaType: "image/png", type: "file" as const },
        ],
        role: "user",
      },
    ],
    model: resolveModel(AUDIT_MODEL),
    schema,
  });
  costTracker.record(result.providerMetadata);
  return {
    cost: await costTracker.measure({
      model: AUDIT_MODEL,
      operation: "visual-audit",
      usage: tokenUsageOf(result.usage),
    }),
    findings: result.object.findings.map(sanitizeFinding),
    pq: result.object.pq,
    reason: result.object.reason,
    sc: result.object.sc,
  };
};

export const audit = async ({
  ask = gatewayAsk,
  concept,
  finish = "outlined",
  kind,
  references = [],
  svg,
  twin,
}: {
  ask?: AuditAsk;
  concept: { name: string };
  finish?: Finish;
  kind?: DrawKind;
  references?: readonly Buffer[];
  svg: string;
  twin?: MarkTwin;
}): Promise<AuditResult> => {
  try {
    const [preview, previewSmall] = await Promise.all([
      shot(svg, AUDIT_PX),
      shot(svg, ICON_PX),
    ]);
    const raw = await ask({
      concept,
      finish,
      kind,
      preview,
      previewSmall,
      references,
      twin,
    });
    const findings = raw.findings.map(sanitizeFinding);
    return judged(
      { cost: raw.cost, findings, pq: raw.pq, reason: raw.reason, sc: raw.sc },
      kind ?? "analog"
    );
  } catch (error) {
    return judged(
      {
        cost: {
          calls: 1,
          generationIds: [],
          model: AUDIT_MODEL,
          operation: "visual-audit",
          source: "unpriced",
          usage: { ...EMPTY_USAGE },
          usd: null,
        },
        findings: [],
        pq: 0,
        reason: `audit failed (${(error as Error).message}); kept the drawing`,
        sc: 0,
        scorable: false,
      },
      kind ?? "analog"
    );
  }
};
