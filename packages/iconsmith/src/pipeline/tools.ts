/**
 * The canvas, as tools a model can call.
 *
 * Each tool is a thin wrapper: it validates shape, calls one `Canvas` method,
 * and reports what the canvas actually did. The reporting matters as much as
 * the call. A primitive quantises, snaps and re-tiers its input, so the model's
 * request and the resulting geometry differ; handing back the element's real
 * bounds is what stops it arguing with the grid for six turns.
 *
 * The `Canvas` lives in the closure rather than in the tool inputs, so there is
 * no path by which a model hands us a document to draw into — it can only issue
 * operations against the one canvas this generation owns.
 */
import { tool } from "ai";
import { z } from "zod";

import { Canvas, SPEC } from "../tools/canvas.js";
import type { CohortTarget } from "../tools/cohort.js";
import { TURNS, alignCohort, fitKeyline, recentre } from "../tools/dsl.js";
import { format, lint } from "../tools/lint.js";
import { png, sheet } from "../tools/render.js";
import type { DotRole, Issue, Keyline, Part } from "../types.js";
import type { Proposal } from "./compose.js";
import { describeProposal } from "./compose.js";
import type { Reference } from "./licence.js";

export type { Reference } from "./licence.js";

export interface ToolsOptions {
  /**
   * Existing icons `compare` can draw from — the set the draft is trying to
   * join, rendered into a contact sheet beside it.
   *
   * `Reference`, not a bare `{ name, svg }`: this is the surface that puts an
   * icon in front of a model, so the only icons that may arrive here are the
   * ones `asReference` has passed. The brand is a `unique symbol` local to
   * `licence.ts`, so an unchecked object literal is a compile error here rather
   * than something review has to notice.
   */
  corpus?: Reference[];
  /** Fixed keyline; `fit` uses it when the model does not name one. */
  keyline?: Keyline | null;
  /** Pixel size for `render`. 96 is four times the design size: big enough to
   *  see a join, small enough that the model is judging an icon and not a
   *  poster. */
  renderSize?: number;
  /** The extracted vocabulary `listParts` searches and `part` places. */
  parts?: Part[];
  /**
   * The family this icon joins, when the caller has measured one. Its presence
   * is what makes the `cohort` op reachable: without a measured extent there is
   * nothing to scale onto, and the prompt's `COHORT` block is only written when
   * the same brief is supplied.
   */
  cohort?: CohortTarget | null;
  /**
   * A composition read out of a raster proposal, if this run has one.
   *
   * Offered through a tool the model may call **once**, never in a `compare`
   * sheet. Once is the whole design: a model that can look again after each
   * edit is iterating against the picture, and iterating against a picture is
   * how "informed by a proposal" becomes "traced from one" without anybody
   * choosing it. Once means the raster can inform the plan and cannot become
   * the target.
   */
  proposal?: Proposal | null;
}

/** What the loop needs to know afterwards; the model cannot see any of it. */
export interface ToolState {
  /** Issues from the model's last `lint` call, or null if it never called it. */
  issues: Issue[] | null;
  /**
   * The canvas version the model's last `lint` call read, or -1 if it never
   * called it. A version rather than a flag: `issues` describes the drawing as
   * it was when lint ran, and one draw call later it describes nothing.
   */
  lintedAt: number;
  /**
   * The canvas version the model last looked at a render of, or -1. An icon it
   * never saw is a guess however clean it lints — and an icon it saw four
   * mutations ago is a different icon.
   */
  renderedAt: number;
  /** Set by the first `proposal` call. The second one is refused, which is the
   *  mechanism that keeps the raster a brief rather than a target. */
  proposed: boolean;
  calls: string[];
}

const KEYLINE_NAMES = Object.keys(SPEC.keylines) as [Keyline, ...Keyline[]];
const ROLE_NAMES = Object.keys(SPEC.dots) as [DotRole, ...DotRole[]];
/** The turns, from the DSL's own table rather than a second copy: the language
 *  and the tools must name the same three or a program and a generation mean
 *  different things by `cw`. */
const TURN_NAMES = Object.keys(TURNS) as [string, ...string[]];

const coord = z.number().describe("canvas units, 0–24");

/** Words a part or icon name is searched by. `arrow-up-2` → arrow, up, 2. */
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

const overlap = (a: string[], b: string[]): number => {
  const set = new Set(b);
  return a.filter((t) => set.has(t)).length;
};

/**
 * The icons nearest a concept, by shared words over name and tags.
 *
 * Exported because `references.ts` conditions the raster proposal on the same
 * neighbourhood the model later compares its draft against. Two scorers would
 * mean the proposal was drawn from one set of neighbours and judged against
 * another, and a disagreement between them would read as the arm being worse
 * when it is only being measured differently.
 */
export const nearest = (
  corpus: readonly Reference[],
  concept: string,
  limit: number
): Reference[] => {
  const want = tokens(concept);
  return corpus
    .map((n) => ({
      n,
      score: overlap(tokens(`${n.name} ${n.tags?.join(" ") ?? ""}`), want),
    }))
    .filter((s) => s.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.n);
};

/**
 * The model asked for `rect x=3.1`; the canvas drew it at 3. Report the second.
 * Anything else teaches it that its numbers survived, and it will keep sending
 * finer ones.
 */
const placed = (canvas: Canvas, id: string) => {
  const el = canvas.describe().find((e) => e.id === id);
  return { elements: canvas.elements.length, id, placed: el ?? null };
};

export const createTools = (options: ToolsOptions = {}) => {
  const {
    cohort = null,
    corpus = [],
    keyline = null,
    parts = [],
    proposal = null,
    renderSize = 96,
  } = options;
  const canvas = new Canvas(parts);
  const state: ToolState = {
    calls: [],
    issues: null,
    lintedAt: -1,
    proposed: false,
    renderedAt: -1,
  };

  const byName = new Map<string, Part>();
  for (const p of parts) {
    byName.set(p.id, p);
    if (p.name) {
      byName.set(p.name, p);
    }
  }

  const track = <T>(name: string, fn: () => T): T => {
    state.calls.push(name);
    return fn();
  };

  const tools = {
    center: tool({
      description:
        "Recentre the whole drawing on the canvas centre. Does not change its size.",
      execute: () =>
        track("center", () => {
          recentre(canvas);
          return { bbox: canvas.bbox(), elements: canvas.describe() };
        }),
      inputSchema: z.object({}),
    }),

    circle: tool({
      description: "Draw a circle from its centre.",
      execute: (input) =>
        track("circle", () => placed(canvas, canvas.circle(input))),
      inputSchema: z.object({ cx: coord, cy: coord, r: z.number().positive() }),
    }),

    cohort: tool({
      description:
        "Scale and place the drawing onto the measured extent of the family this icon joins. Use it instead of `fit`, once, at the end: it is the same operation against a box the family's members actually occupy rather than a nominal keyline, and running `fit` afterwards throws it away. If it reports that the drawing is the wrong shape for the family, redraw it to those proportions rather than scaling harder.",
      execute: () =>
        track("cohort", () => {
          if (!cohort) {
            throw new Error(
              "no cohort was measured for this icon — use fit and a keyline"
            );
          }
          const note = alignCohort(canvas, cohort);
          return { bbox: canvas.bbox(), fitted: note === null, note };
        }),
      inputSchema: z.object({}),
    }),

    compare: tool({
      description:
        "Render the draft beside the existing icons nearest to this concept. The draft is the first cell. If it does not look like it belongs, it does not, whatever lint says.",
      execute: async ({ concept, limit = 5 }) =>
        await track("compare", async () => {
          // The corpus only. The proposal raster is deliberately not a cell
          // here: a sheet containing both the draft and the picture it came
          // from is a tracing view, and the model would use it as one.
          const near = nearest(corpus, concept, limit);
          if (near.length === 0) {
            return {
              image: null,
              names: [],
              note: "No comparable icons in the corpus; judge the draft on its own.",
            };
          }
          state.renderedAt = canvas.version;
          const image = await sheet([
            canvas.toSVG(),
            ...near.map((n) => n.svg),
          ]);
          return {
            image: image.toString("base64"),
            names: ["(your draft)", ...near.map((n) => n.name)],
            note: null,
          };
        }),
      inputSchema: z.object({
        concept: z
          .string()
          .describe("what you are drawing, for picking the neighbours"),
        limit: z.number().int().min(1).max(11).optional(),
      }),
      toModelOutput: ({ output }) =>
        output.image === null
          ? { type: "text", value: output.note ?? "" }
          : {
              type: "content",
              value: [
                {
                  data: { data: output.image, type: "data" },
                  mediaType: "image/png",
                  type: "file",
                },
                {
                  text: `Left to right: ${output.names.join(", ")}`,
                  type: "text",
                },
              ],
            },
    }),

    dot: tool({
      description: `Place a dot. The role picks the size, so the set's dots stay one of ${ROLE_NAMES.length} sizes rather than a continuum.`,
      execute: (input) => track("dot", () => placed(canvas, canvas.dot(input))),
      inputSchema: z.object({
        cx: coord,
        cy: coord,
        role: z.enum(ROLE_NAMES).optional(),
      }),
    }),

    fit: tool({
      description:
        "Scale and centre the whole drawing so its visual extent — the strokes' outer edges, not the path bounds — matches a keyline. Do this once, near the end.",
      execute: ({ keyline: k }) =>
        track("fit", () => {
          const used = k ?? keyline ?? "square";
          fitKeyline(canvas, used);
          return { bbox: canvas.bbox(), keyline: used };
        }),
      inputSchema: z.object({ keyline: z.enum(KEYLINE_NAMES).optional() }),
    }),

    line: tool({
      description:
        "Draw a polyline through two or more points. Segments within a few degrees of 0/45/90 are snapped onto the axis, so a nearly-horizontal line becomes horizontal. A segment further off than that is refused unless offAxis is set, so a diagonal is something you choose rather than something arithmetic drift hands you.",
      execute: ({ offAxis, points }) =>
        track("line", () =>
          placed(
            canvas,
            canvas.line({ offAxis, points: points as [number, number][] })
          )
        ),
      inputSchema: z.object({
        offAxis: z
          .boolean()
          .optional()
          .describe(
            "allow a segment to sit off 0/45/90 — the set does this on about one edge in seven, always between two grid points"
          ),
        points: z.array(z.tuple([coord, coord])).min(2),
      }),
    }),

    lint: tool({
      description:
        "Check the drawing against the house spec. Errors must be fixed; warnings are judgment calls.",
      execute: ({ keyline: k }) =>
        track("lint", () => {
          const issues = lint(canvas, { keyline: k ?? keyline });
          state.issues = issues;
          state.lintedAt = canvas.version;
          return {
            clean: issues.every((i) => i.severity !== "error"),
            issues,
            report: format(issues),
          };
        }),
      inputSchema: z.object({
        keyline: z.enum(KEYLINE_NAMES).optional(),
      }),
    }),

    listParts: tool({
      description:
        "Search the extracted parts vocabulary by name. These are the shapes the existing set is built from; placing one is how a new icon inherits the set's drawing rather than approximating it.",
      execute: ({ limit = 12, query }) =>
        track("listParts", () => {
          const want = tokens(query);
          const scored = parts
            .map((p) => ({
              p,
              score: overlap(tokens(p.name ?? p.id), want),
            }))
            .filter((s) => s.score > 0)
            .toSorted(
              (a, b) => b.score - a.score || b.p.icons.length - a.p.icons.length
            )
            .slice(0, limit);
          return {
            matches: scored.map(({ p }) => ({
              h: p.h,
              id: p.id,
              name: p.name ?? null,
              usedByIcons: p.icons.length,
              w: p.w,
            })),
            searched: parts.length,
          };
        }),
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
        query: z
          .string()
          .describe("a word or two: 'folder', 'chevron', 'magnifier'"),
      }),
    }),

    part: tool({
      description:
        "Place a part from the vocabulary by id or name, scaled about its top-left corner. `turn` names a quarter-turn clockwise and `flip` mirrors the part in x before turning it — the clusterer folds a mark together with its quarter-turns and its mirror, so a part is stored at one orientation and these are how you reach the others.",
      execute: ({ flip, id, scale, turn, x, y }) =>
        track("part", () => {
          const p = byName.get(id);
          if (!p) {
            throw new Error(
              `unknown part "${id}" — call listParts to see the vocabulary`
            );
          }
          return placed(
            canvas,
            canvas.part({
              flip,
              id: p.id,
              scale,
              turn: turn ? TURNS[turn] : 0,
              x,
              y,
            })
          );
        }),
      inputSchema: z.object({
        flip: z
          .boolean()
          .optional()
          .describe(
            "mirror the part in x before turning it — say so on purpose: chirality is the one symmetry that can be simply wrong (a tick, a comma, an S)"
          ),
        id: z.string().describe("part id or name, from listParts"),
        scale: z.number().positive().optional(),
        turn: z
          .enum(TURN_NAMES)
          .optional()
          .describe(
            "cw = 90° clockwise, half = 180°, ccw = 270°. Quarter-turns only: an angle here would be a coordinate by another name, and only the quarters keep every node on the grid."
          ),
        x: coord,
        y: coord,
      }),
    }),

    proposal: tool({
      description:
        "Read the composition proposal for this icon: how many elements it has, roughly where they sit, how they relate, and a blurred thumbnail of the arrangement. Available exactly once, at the start — it is a brief, not a target, and there are no coordinates in it to copy. Draw from it with the primitives; the spec still decides everything else.",
      execute: () =>
        track("proposal", () => {
          if (!proposal) {
            throw new Error(
              "there is no proposal for this icon — draw it from the concept"
            );
          }
          if (state.proposed) {
            throw new Error(
              "the proposal has already been read. It is available once on " +
                "purpose: a composition you keep checking back against becomes " +
                "a drawing you are copying. Use render and compare from here."
            );
          }
          state.proposed = true;
          return {
            image: proposal.thumbnail,
            summary: describeProposal(proposal),
          };
        }),
      inputSchema: z.object({}),
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [
          {
            data: { data: output.image, type: "data" },
            mediaType: "image/png",
            type: "file",
          },
          { text: output.summary, type: "text" },
        ],
      }),
    }),

    rect: tool({
      description:
        "Draw a rectangle from its top-left corner. The radius is snapped to the nearest tier for the shape's size; pass 0 for a hard corner.",
      execute: (input) =>
        track("rect", () => placed(canvas, canvas.rect(input))),
      inputSchema: z.object({
        h: z.number().positive(),
        r: z
          .number()
          .min(0)
          .optional()
          .describe(`tiers: ${SPEC.radiusTiers.join(", ")}`),
        w: z.number().positive(),
        x: coord,
        y: coord,
      }),
    }),

    remove: tool({
      description: "Delete an element by the id a draw tool returned.",
      execute: ({ id }) => track("remove", () => canvas.remove(id)),
      inputSchema: z.object({ id: z.string() }),
    }),

    render: tool({
      description:
        "Render the current drawing and look at it. Use this often: it is the only way to find out whether the icon reads as the thing it names.",
      execute: async ({ size }) =>
        await track("render", async () => {
          state.renderedAt = canvas.version;
          const image = await png(canvas.toSVG(), size ?? renderSize);
          return {
            elements: canvas.describe(),
            image: image.toString("base64"),
          };
        }),
      inputSchema: z.object({
        size: z.number().int().min(16).max(256).optional(),
      }),
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [
          {
            data: { data: output.image, type: "data" },
            mediaType: "image/png",
            type: "file",
          },
          {
            text: `Elements: ${JSON.stringify(output.elements)}`,
            type: "text",
          },
        ],
      }),
    }),
  };

  // A tool the model can only be refused by is worse than a missing one: it
  // spends a step to learn what the tool set could have said for free. The
  // `COHORT` block in `prompt.ts` had the same bug from the other side — it
  // described an op that was never in the tool set — so the two are now
  // supplied or withheld together, from the same two options.
  if (!cohort) {
    Reflect.deleteProperty(tools, "cohort");
  }
  if (!proposal) {
    Reflect.deleteProperty(tools, "proposal");
  }

  return { canvas, state, tools };
};

export type CanvasTools = ReturnType<typeof createTools>["tools"];
