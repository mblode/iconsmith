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
import { fitKeyline, recentre } from "../tools/dsl.js";
import { format, lint } from "../tools/lint.js";
import { png, sheet } from "../tools/render.js";
import type { DotRole, Issue, Keyline, Part } from "../types.js";

/** An icon the draft can be shown beside: the set it is trying to join. */
export interface Neighbour {
  name: string;
  svg: string;
  tags?: string[];
}

export interface ToolsOptions {
  /** Existing icons `compare` can draw from. */
  corpus?: Neighbour[];
  /** Fixed keyline; `fit` uses it when the model does not name one. */
  keyline?: Keyline | null;
  /** Pixel size for `render`. 96 is four times the design size: big enough to
   *  see a join, small enough that the model is judging an icon and not a
   *  poster. */
  renderSize?: number;
  /** The extracted vocabulary `listParts` searches and `part` places. */
  parts?: Part[];
}

/** What the loop needs to know afterwards; the model cannot see any of it. */
export interface ToolState {
  /** Issues from the model's last `lint` call, or null if it never called it. */
  issues: Issue[] | null;
  /** Set once the model has looked at a render. An icon it never saw is a
   *  guess, however clean it lints. */
  rendered: boolean;
  calls: string[];
}

const KEYLINE_NAMES = Object.keys(SPEC.keylines) as [Keyline, ...Keyline[]];
const ROLE_NAMES = Object.keys(SPEC.dots) as [DotRole, ...DotRole[]];

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
 * The model asked for `rect x=3.1`; the canvas drew it at 3. Report the second.
 * Anything else teaches it that its numbers survived, and it will keep sending
 * finer ones.
 */
const placed = (canvas: Canvas, id: string) => {
  const el = canvas.describe().find((e) => e.id === id);
  return { elements: canvas.elements.length, id, placed: el ?? null };
};

export const createTools = (options: ToolsOptions = {}) => {
  const { corpus = [], keyline = null, parts = [], renderSize = 96 } = options;
  const canvas = new Canvas(parts);
  const state: ToolState = { calls: [], issues: null, rendered: false };

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

    compare: tool({
      description:
        "Render the draft beside the existing icons nearest to this concept. The draft is the first cell. If it does not look like it belongs, it does not, whatever lint says.",
      execute: async ({ concept, limit = 5 }) =>
        await track("compare", async () => {
          const want = tokens(concept);
          const near = corpus
            .map((n) => ({
              n,
              score: overlap(
                tokens(`${n.name} ${n.tags?.join(" ") ?? ""}`),
                want
              ),
            }))
            .filter((s) => s.score > 0)
            .toSorted((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((s) => s.n);
          if (near.length === 0) {
            return {
              image: null,
              names: [],
              note: "No comparable icons in the corpus; judge the draft on its own.",
            };
          }
          state.rendered = true;
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
        "Draw a polyline through two or more points. Segments within a few degrees of 0/45/90 are snapped onto the axis, so a nearly-horizontal line becomes horizontal.",
      execute: ({ points }) =>
        track("line", () =>
          placed(canvas, canvas.line({ points: points as [number, number][] }))
        ),
      inputSchema: z.object({
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
        "Place a part from the vocabulary by id or name, scaled about its top-left corner.",
      execute: ({ id, scale, x, y }) =>
        track("part", () => {
          const p = byName.get(id);
          if (!p) {
            throw new Error(
              `unknown part "${id}" — call listParts to see the vocabulary`
            );
          }
          return placed(canvas, canvas.part({ id: p.id, scale, x, y }));
        }),
      inputSchema: z.object({
        id: z.string().describe("part id or name, from listParts"),
        scale: z.number().positive().optional(),
        x: coord,
        y: coord,
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
          state.rendered = true;
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

  return { canvas, state, tools };
};

export type CanvasTools = ReturnType<typeof createTools>["tools"];
