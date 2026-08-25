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

/**
 * The visual judge.
 *
 * **The previous line here claimed "Acceptance remains independent of the
 * generation model." On the Studio path that was false.**
 * `apps/web/lib/studio/generate.ts` sets both `IMAGE_AGENT_MODEL` and
 * `GATEWAY_AGENT_MODEL` to this same string, so two of the four arms are
 * judged by their own model. `tournament.ts` is careful that an arm must not
 * review its own drawing — "a witness, not a judge" — and says nothing about
 * the weights behind it, and `paintAccepted` has no model-identity check. A
 * stylistic preference shared by generator and judge is then scored as quality
 * and selected for, arm over arm.
 *
 * Overridable so a deployment can hold the judge apart from the draughtsman
 * without a code change. Whatever is set here must first clear the forced-choice
 * gate in `eval/judge.ts` — `scripts/judge-gate.ts --model <id>` — because that
 * gate has already failed one model at 83%, and a judge that cannot tell a
 * shipped icon from an unrelated one is noise wearing a number.
 */
export const AUDIT_MODEL =
  process.env.ICONSMITH_AUDIT_MODEL ?? "google/gemini-3.7-flash";
export const PREVIEW_FILE = "PREVIEW.png";
export const AUDIT_FILE = "AUDIT.json";
/** Same size `eval/judge-model.ts` uses: eyes, not the 48px cosine raster. */
export const AUDIT_PX = 192;
/** Design size. A stroke that survives here is an icon; 192px can merge it. */
export const ICON_PX = 24;
/** SC/PQ at or above this is a screen pass. */
export const LOOK_SCREEN = 6;

/**
 * The rubric, with anchors, used as the system prompt for every look.
 *
 * It lived in `eval/judge.ts` with no caller on this path while the shipping
 * judge ran on a bare "Score SC and PQ 0-10" — and `eval/judge.ts` says why
 * that matters in its own words: an unanchored scale "drifts toward 7 for
 * everything, and a column where every entry is 7 has no variance to read".
 * Measured on 42 audited paints, this one did something worse than drift: SC
 * never took the value 9 and PQ had no observation between 5 and 8.5, so the
 * instrument answered 0-1 or 10 and the acceptance threshold sat in a dead
 * zone where no value from 6 to 9 changed a single decision.
 *
 * Canonical here rather than in `eval/`, because `pipeline/` may not import
 * `eval/` — `scripts/check-boundaries.ts` calls that "the one thing standing
 * between `pipeline/` and a cycle". `eval/judge.ts` re-exports it, so the
 * sanity gate and the shipping judge are held to one rubric. The text is
 * unchanged from the version the recorded gate runs in
 * `bench/calibration.v1.json` were measured against.
 */
export const LOOK_RUBRIC = `You grade icons for an icon set with a strict house spec: 24×24 canvas, 2px round-capped strokes, geometry on a 0.5 grid, edges at 0/45/90 degrees, a small number of elements.

You give two independent scores from 0 to 10.

SC — semantic consistency. Does the drawing read as the named concept, unlabelled, at 16px?
  10  unmistakable; the first thing anyone would name it is the concept
   7  reads as the concept once you know it; a stranger might say something adjacent
   4  the parts of the concept are present but do not assemble into it
   0  reads as something else, or as nothing

PQ — perceptual quality. Is it a competent icon, ignoring what it depicts?
  10  even stroke weight, clean joins, balanced mass, nothing accidental
   7  sound but with a visible awkwardness: a crowded corner, a lopsided element
   4  legible but crude: uneven weight, collisions, drifting alignment
   0  broken geometry, stray marks, or an empty canvas

Score the two independently. A beautiful drawing of the wrong thing scores high PQ and low SC; a clear concept drawn badly scores the reverse. Do not average them yourself.`;

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
  abortSignal?: AbortSignal;
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
/**
 * Markup that is unambiguously a path, whatever surrounds it.
 */
const PATH_MARKUP = /\bd\s*=|<\s*path\b/u;

/**
 * Path DATA, recognised by its shape rather than by one letter beside a digit.
 *
 * The previous rule was `[CcLlHhVvSsQqTtAa]\s*-?\d`, which fires on any English
 * word ending in one of those letters before a number — and the rubric this
 * judge is given asks it to reason about "24px" and "192px" and to answer in
 * the words rect, circle, hole, part, line, finish. So it ate its own output:
 * "the stroke does not survive at 24px", "the ring is 2 units thick", "the icon
 * has 3 parts" and "PQ 6 is generous here" were all replaced by the scold. That
 * matters beyond tidiness — `harness.ts` hands finding text to the external
 * coding agent AS the repair instruction, so a scrubbed paint bought a paid
 * turn on the sentence "finding named geometry", and `look.ts`'s repair picker
 * matches on words like "corner" and "notch" that it could no longer see.
 *
 * Real path data is a command letter, a number, and then MORE of the same:
 * `M4 4H12`, not "at 24". Requiring the repeat is what separates them, and the
 * lookbehind keeps a command letter from being the tail of a word.
 *
 * Known gap, stated rather than papered over: coordinates spelled out in prose
 * ("from four, eleven to twenty") still pass, as do non-ASCII digits. The
 * finding text is written by a vision model looking at a host-rendered PNG,
 * with no untrusted party in the loop, so the injection premise is weak and the
 * false-positive damage was the real cost. `reason` is scrubbed by the same
 * rule below, which it previously was not.
 */
const PATH_DATA =
  /(?<![A-Za-z])[MmZz]\s*-?\d[\d.,\s+-]*(?:[A-Za-z]\s*-?\d[\d.,\s+-]*)+/u;

const namesGeometry = (text: string): boolean =>
  PATH_MARKUP.test(text) || PATH_DATA.test(text);

/**
 * The judge's free-text `reason`, held to the same rule as its findings.
 *
 * It was held to none. `sanitizeFinding` was applied to `findings` only, while
 * `reason` travelled unchecked into `AUDIT.json` — the file `harness.ts` tells
 * the external coding agent to open, two lines above telling it not to emit
 * path data. That is the leak the scrubber exists to stop, through the door
 * left open beside it.
 */
export const sanitizeReason = (reason: string | null): string | null => {
  if (reason === null) {
    return null;
  }
  return namesGeometry(reason)
    ? "reason named geometry; it was withheld so it cannot be copied"
    : reason;
};

export const sanitizeFinding = (finding: AuditFinding): AuditFinding => {
  const kind = KINDS.has(finding.kind) ? finding.kind : "belong";
  const message = namesGeometry(finding.message)
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
  abortSignal,
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
    abortSignal,
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
    // Anchored, so "8" means the same thing twice. Without a system prompt the
    // scale was whatever the model brought to that call, and `eval/judge.ts`
    // says why that matters: an unanchored scale has no variance to read.
    system: LOOK_RUBRIC,
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
    reason: sanitizeReason(result.object.reason),
    sc: result.object.sc,
  };
};

export const audit = async ({
  abortSignal,
  ask = gatewayAsk,
  concept,
  finish = "outlined",
  kind,
  references = [],
  svg,
  twin,
}: {
  abortSignal?: AbortSignal;
  ask?: AuditAsk;
  concept: { name: string };
  finish?: Finish;
  kind?: DrawKind;
  references?: readonly Buffer[];
  svg: string;
  twin?: MarkTwin;
}): Promise<AuditResult> => {
  try {
    abortSignal?.throwIfAborted();
    const [preview, previewSmall] = await Promise.all([
      shot(svg, AUDIT_PX),
      shot(svg, ICON_PX),
    ]);
    const raw = await ask({
      abortSignal,
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
      {
        cost: raw.cost,
        findings,
        pq: raw.pq,
        reason: sanitizeReason(raw.reason),
        sc: raw.sc,
      },
      kind ?? "analog"
    );
  } catch (error) {
    // Cancellation is control flow, not an unscorable audit. Swallowing it
    // here made the tournament continue spending after the user pressed Stop.
    abortSignal?.throwIfAborted();
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
