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
import type { Element, Spec } from "../tools/canvas.js";
import type { CohortTarget } from "../tools/cohort.js";
import { TURNS, alignCohort, fitKeyline, recentre } from "../tools/dsl.js";
import { format, lint } from "../tools/lint.js";
import { png, sheet } from "../tools/render.js";
import type { Finish, Issue, Keyline, Part } from "../types.js";
import { adoptHost, hostConstruction } from "./analog.js";
import type { Proposal } from "./compose.js";
import { describeProposal } from "./compose.js";
import type { Reference } from "./licence.js";
import { steerBrief } from "./recipe.js";
import { overlap, rankParts, tokens } from "./search.js";
import type { Aliases } from "./search.js";

export type { Reference } from "./licence.js";

export interface ToolsOptions {
  /** A non-house revision must not retrieve implicit house constructions. */
  allowHouseConstruction?: boolean;
  /**
   * The words each source icon also answers to, from `corpus/aliases.ts`.
   *
   * `listParts` is the only place in the run where a model asks the vocabulary
   * a question in its own words, so it is the place the widening has to reach:
   * the model types "open link" because that is what it is drawing, and without
   * the table the query dies on the fact that nobody put those words in a
   * filename. Empty by default — `commands/` loads it, and a caller that has
   * not been wired gets exactly the old ranking.
   */
  aliases?: Aliases;
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
  /**
   * Stroked skeleton or solid shape. Decided by the caller, not by the model:
   * the finish is which variant of a set is being drawn, so it is a property
   * of the run in the same way the keyline and the cohort are. It also decides
   * which tools exist — `hole` appears only when it is `filled`, and `line`
   * disappears, because an open polyline paints nothing under a fill.
   */
  finish?: Finish;
  /** Stroke, family radius, optical size. Defaults to the house 24/2/3 cut. */
  spec?: Spec;
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
  /**
   * The host analog is already on the canvas. Draw, remove, construct,
   * fit, center, and the separate render/lint pair are withheld — the
   * remaining tool is `confirm`. A tool the model can only be refused
   * by costs a step, and those steps are how a seeded heart becomes
   * three circles or a pause gets stretched off the house bars.
   */
  hostLocked?: boolean;
  /** Maximum vocabulary searches in one agent run. Direct tool consumers are
   * unbounded; generation sets two so browsing cannot consume every step. */
  maxPartSearches?: number;
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
  /** Set by the first `construct` call. The host analog is adopted once;
   *  calling again would let the model shop constructions. */
  constructed: boolean;
  /**
   * The best drawing this run has actually looked at: fewest lint errors,
   * latest on a tie.
   *
   * A run ends wherever the step cap lands, and the campaign's traces end
   * `render, remove, remove, remove, remove` — the model wiped the canvas to
   * start again and ran out of steps mid-wipe. The blank was then delivered,
   * audited at SC 0 / PQ 0, and billed. Keeping what it drew costs nothing:
   * the drawing was already rendered, so it was already paid for.
   */
  best: { elements: Element[]; errors: number } | null;
  calls: string[];
}

const KEYLINE_NAMES = Object.keys(SPEC.keylines) as [Keyline, ...Keyline[]];
/** The turns, from the DSL's own table rather than a second copy: the language
 *  and the tools must name the same three or a program and a generation mean
 *  different things by `cw`. */
const TURN_NAMES = Object.keys(TURNS) as [string, ...string[]];

const coord = z.number().describe("canvas units, 0–24");

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

// oxlint-disable-next-line eslint/complexity -- one factory keeps every model tool on the same canvas and shared call budget
export const createTools = (options: ToolsOptions = {}) => {
  const {
    allowHouseConstruction = true,
    aliases = new Map(),
    cohort = null,
    corpus = [],
    finish = "outlined",
    spec = SPEC,
    keyline = null,
    maxPartSearches = Number.POSITIVE_INFINITY,
    parts = [],
    proposal = null,
    renderSize = 96,
    hostLocked = false,
  } = options;
  const canvas = new Canvas(parts, { finish, spec });
  const roleNames = Object.keys(spec.dots) as [string, ...string[]];
  const state: ToolState = {
    best: null,
    calls: [],
    constructed: false,
    issues: null,
    lintedAt: -1,
    proposed: false,
    renderedAt: -1,
  };

  /**
   * Remember the drawing the model is about to look at.
   *
   * Ranked by standing lint errors rather than by recency, so a run that
   * degrades a clean composition into a dirty one keeps the clean one. Ties go
   * to the later snapshot, because the model kept working on it for a reason.
   */
  const keep = (): void => {
    if (canvas.elements.length === 0) {
      return;
    }
    const errors = lint(canvas, { keyline }).filter(
      (issue) => issue.severity === "error"
    ).length;
    if (state.best === null || errors <= state.best.errors) {
      state.best = {
        elements: canvas.elements.map((element) => structuredClone(element)),
        errors,
      };
    }
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

  /**
   * Once the host analog is on the canvas, the model confirms it — it
   * does not invent a second silhouette. Generate seeds that analog;
   * `construct` places it when the canvas started empty. Either way the
   * coordinates already came from analog, and a `circle`, `remove`, or
   * `fit` after that is how a heart becomes three discs or a pause
   * gets stretched off the house bars.
   */
  const refuseHostEdit = (action: string): void => {
    if (!state.constructed) {
      return;
    }
    throw new Error(
      `the host analog is already on the canvas. Call confirm; do not ${action} it.`
    );
  };

  const tools = {
    arc: tool({
      description:
        "Draw an open circular arc. Same cubics as circle. Name a pole (top/right/bottom/left), a sweep (quarter/half/three-quarter), and optionally ccw. Use this for canopies, wifi fans, C-shapes and the lobes of an S. Do not approximate a curve with a polyline of grid points.",
      execute: (input) =>
        track("arc", () => {
          refuseHostEdit("arc");
          return placed(canvas, canvas.arc(input));
        }),
      inputSchema: z.object({
        ccw: z
          .boolean()
          .optional()
          .describe(
            "run counter-clockwise; default follows circle (top → right → bottom → left)"
          ),
        cx: coord,
        cy: coord,
        from: z.enum(["bottom", "left", "right", "top"]),
        r: z.number().positive(),
        sweep: z.enum(["half", "quarter", "three-quarter"]),
        weight: z
          .literal("detail")
          .optional()
          .describe(
            "Use the selected family detailStroke; never an arbitrary numeric width"
          ),
      }),
    }),

    center: tool({
      description:
        "Recentre the whole drawing on the canvas centre. Does not change its size.",
      execute: () =>
        track("center", () => {
          refuseHostEdit("recentre");
          recentre(canvas);
          return { bbox: canvas.bbox(), elements: canvas.describe() };
        }),
      inputSchema: z.object({}),
    }),

    circle: tool({
      description: "Draw a circle from its centre.",
      execute: (input) =>
        track("circle", () => {
          refuseHostEdit("circle");
          return placed(canvas, canvas.circle(input));
        }),
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

    combine: tool({
      description:
        "For filled paint, union solids or subtract a closed cutter. For outlined paint, trim removes the left path sections inside the right closed cutter, preserving the remaining curves with round stroke caps. Allow for cap radius when choosing clearance. Uses whole solid groups including counters. Both operands are replaced by the result. Place and size operands first; fit/center after composition is unsupported. No raw paths. The result remains an editable Boolean recipe.",
      execute: ({ operation, leftId, rightId, radius }) =>
        track("combine", () => {
          refuseHostEdit("combine");
          return placed(
            canvas,
            canvas.combine(operation, leftId, rightId, radius)
          );
        }),
      inputSchema: z.object({
        leftId: z.string(),
        operation:
          finish === "filled"
            ? z.enum(["subtract", "union"])
            : z.enum(["trim"]),
        radius: z
          .number()
          .positive()
          .optional()
          .describe(
            "Filled family-tier radius for sharp operand intersections only; rejects infeasible rounding. Omit to preserve exact Boolean edges."
          ),
        rightId: z.string(),
      }),
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
          keep();
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

    confirm: tool({
      description: "Look at the drawing and check it against the house spec.",
      execute: async () =>
        await track("confirm", async () => {
          state.renderedAt = canvas.version;
          keep();
          const issues = lint(canvas, { keyline });
          state.issues = issues;
          state.lintedAt = canvas.version;
          const image = await png(canvas.toSVG(), renderSize);
          return {
            clean: issues.every((i) => i.severity !== "error"),
            image: image.toString("base64"),
            report: format(issues),
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
          { text: output.report, type: "text" },
        ],
      }),
    }),

    construct: tool({
      description:
        "Place the host analog for this name. The model never emits those coordinates — the canvas writes the program. Generate already adopts it when one exists; call this only if the canvas is still empty. Available once. After it lands, confirm with render and lint — do not redraw it.",
      execute: ({ query }) =>
        track("construct", () => {
          if (state.constructed) {
            throw new Error(
              "construct has already placed a host analog. Confirm with render and lint."
            );
          }
          const adopted = adoptHost(canvas, query, finish, parts, spec);
          state.constructed = true;
          return {
            elements: canvas.describe(),
            family: adopted.family,
            placed: adopted.placed,
          };
        }),
      inputSchema: z.object({
        query: z
          .string()
          .describe("the icon name this run is drawing, e.g. heart, lantern"),
      }),
    }),

    diamond: tool({
      description:
        "Draw a square rotated 45°, vertices on the axes. Reach is centre to vertex — equal run and rise, so every edge sits on 45°/135°. Use this for a compass needle, a card suit, a lozenge. Not a star. A kite that is only grid-legal (unequal diagonals) is off-axis and is not this op.",
      execute: ({ cx, cy, r }) =>
        track("diamond", () => {
          refuseHostEdit("diamond");
          return placed(canvas, canvas.diamond({ cx, cy, reach: r }));
        }),
      inputSchema: z.object({
        cx: coord,
        cy: coord,
        r: z
          .number()
          .positive()
          .describe("centre to vertex, so the diagonals are equal"),
      }),
    }),

    dot: tool({
      description: `Place a dot. The role picks the size, so the set's dots stay one of ${roleNames.length} sizes rather than a continuum.`,
      execute: (input) =>
        track("dot", () => {
          refuseHostEdit("dot");
          return placed(canvas, canvas.dot(input));
        }),
      inputSchema: z.object({
        cx: coord,
        cy: coord,
        role: z.enum(roleNames).optional(),
      }),
    }),

    fit: tool({
      description:
        "Scale and centre the whole drawing so its visual extent — the strokes' outer edges, not the path bounds — matches a keyline. Do this once, near the end.",
      execute: ({ keyline: k }) =>
        track("fit", () => {
          refuseHostEdit("fit");
          const used = k ?? keyline ?? "square";
          fitKeyline(canvas, used);
          return { bbox: canvas.bbox(), keyline: used };
        }),
      inputSchema: z.object({ keyline: z.enum(KEYLINE_NAMES).optional() }),
    }),

    hole: tool({
      description:
        "Cut a shape out of a solid you have already drawn — the hole in a ring, the slot in a card, the counter in a glyph. It cuts the solid you drew most recently unless you name another with cutFrom. Draw the hole immediately after that solid: a mark between `circle` and `hole` takes the knockout and the circle ships as a solid disc. The shape is built exactly as a solid. Overlapping cutters are unioned before subtraction, so overlap never restores ink. Cutters may cross the boundary without painting outside the solid.",
      execute: ({ cutFrom, cx, cy, h, r, shape, w, x, y }) =>
        track("hole", () => {
          refuseHostEdit("hole");
          // The two shapes take different fields, so the schema is flat and
          // the pairing is checked here. A discriminated union in the schema
          // would say it once instead — but it lands in the wire format as a
          // top-level `anyOf`, which not every provider will accept for a tool.
          const want = (v: number | undefined, name: string): number => {
            if (v === undefined) {
              throw new Error(`hole ${shape} needs ${name}`);
            }
            return v;
          };
          return placed(
            canvas,
            canvas.hole(
              shape === "circle"
                ? {
                    cutFrom,
                    cx: want(cx, "cx"),
                    cy: want(cy, "cy"),
                    r: want(r, "r"),
                    shape: "circle",
                  }
                : {
                    cutFrom,
                    h: want(h, "h"),
                    r,
                    shape: "rect",
                    w: want(w, "w"),
                    x: want(x, "x"),
                    y: want(y, "y"),
                  }
            )
          );
        }),
      inputSchema: z.object({
        cutFrom: z
          .string()
          .optional()
          .describe("id of the solid to cut; defaults to the most recent one"),
        cx: coord.optional().describe("circle only"),
        cy: coord.optional().describe("circle only"),
        h: z.number().positive().optional().describe("rect only"),
        r: z
          .number()
          .min(0)
          .optional()
          .describe(
            `radius: the circle's, or a rect's corners. Filled tiers: ${spec.fillRadiusTiers.join(", ")}`
          ),
        shape: z.enum(["rect", "circle"]),
        w: z.number().positive().optional().describe("rect only"),
        x: coord.optional().describe("rect only"),
        y: coord.optional().describe("rect only"),
      }),
    }),

    line: tool({
      description:
        "Draw a polyline through two or more points. Segments within a few degrees of 0/45/90 are snapped onto the axis, so a nearly-horizontal line becomes horizontal. A segment further off than that is refused unless offAxis is set, so a diagonal is something you choose rather than something arithmetic drift hands you.",
      execute: ({ offAxis, points, r, solid, weight }) =>
        track("line", () => {
          refuseHostEdit("line");
          return placed(
            canvas,
            canvas.line({
              offAxis,
              points: points as [number, number][],
              r,
              solid,
              weight,
            })
          );
        }),
      inputSchema: z.object({
        offAxis: z
          .boolean()
          .optional()
          .describe(
            "allow a segment to sit off 0/45/90 — the set does this on about one edge in seven, always between two grid points"
          ),
        // Google tool declarations use protobuf Schema, whose `items` field
        // accepts one schema rather than JSON Schema's tuple array. A fixed
        // length array preserves the exact [x, y] contract while remaining
        // portable across Gateway providers.
        points: z.array(z.array(coord).length(2)).min(2),
        r: z
          .number()
          .nonnegative()
          .optional()
          .describe(
            "Family-tier centerline radius, or zero for sharp corners; repeat first vertex to close."
          ),
        solid: z
          .boolean()
          .optional()
          .describe(
            "Fill the stroke and interior of an explicitly closed contour. In outlined paint this is a solid modifier."
          ),
        weight: z
          .literal("detail")
          .optional()
          .describe(
            "Use the pinned family detailStroke for this line; requires a style that declares it."
          ),
      }),
    }),

    lint: tool({
      description:
        "Check the drawing against the house spec. Errors must be fixed; warnings are judgment calls. `gap` is the true edge-to-edge distance between strokes (not vertex-to-vertex): crossing marks are coincident, staggered parallels report the perpendicular gap.",
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
        "Search the extracted parts vocabulary by name. These are the shapes the existing set is built from; placing one is how a new icon inherits the set's drawing rather than approximating it. When the query asked for a house paint construction, the result names it as `construction`. When a host analog exists, `constructable` is true — call `construct` instead of inventing the silhouette. Analog does not volunteer a star glyph.",
      // Ranked by `rankParts`, which SELECT's shortlist and the coverage report
      // also call, so all three agree about what "relevant" means. The shaping
      // is this tool's own: a model deciding whether to place a mark wants its
      // proportions, and a shortlist carried between stages does not.
      execute: ({ limit = 12, query }) =>
        track("listParts", () => {
          const searches = state.calls.filter(
            (call) => call === "listParts"
          ).length;
          if (searches > maxPartSearches) {
            throw new Error(
              `listParts is limited to ${maxPartSearches} searches in this run; draw from the searches already returned`
            );
          }
          const construction = allowHouseConstruction
            ? steerBrief(query, finish)
            : null;
          const host = allowHouseConstruction
            ? hostConstruction(query, finish)
            : null;
          return {
            ...(host ? { constructable: true as const } : {}),
            ...(construction ? { construction } : {}),
            ...(host ? { family: host.id } : {}),
            matches: rankParts(parts, query, limit, aliases).map(
              ({ hits, part }) => ({
                h: part.h,
                id: part.id,
                name: part.name ?? null,
                // Why it matched. An unnamed part is only useful if the model can
                // tell what it is, and the icons it came from say that better
                // than `p0044` does.
                seenIn: hits.slice(0, 5),
                usedByIcons: part.icons.length,
                w: part.w,
              })
            ),
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
          refuseHostEdit("part");
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
        track("rect", () => {
          refuseHostEdit("rect");
          return placed(canvas, canvas.rect(input));
        }),
      inputSchema: z.object({
        h: z.number().positive(),
        r: z
          .number()
          .min(0)
          .optional()
          .describe(
            `tiers: ${(finish === "filled" ? spec.fillRadiusTiers : spec.radiusTiers).join(", ")}`
          ),
        w: z.number().positive(),
        x: coord,
        y: coord,
      }),
    }),

    remove: tool({
      description: "Delete an element by the id a draw tool returned.",
      execute: ({ id }) =>
        track("remove", () => {
          refuseHostEdit("remove");
          return canvas.remove(id);
        }),
      inputSchema: z.object({ id: z.string() }),
    }),

    render: tool({
      description:
        "Render the current drawing and look at it. Use this often: it is the only way to find out whether the icon reads as the thing it names.",
      execute: async ({ size }) =>
        await track("render", async () => {
          state.renderedAt = canvas.version;
          keep();
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
  if (!allowHouseConstruction) {
    Reflect.deleteProperty(tools, "construct");
    if (parts.length === 0) {
      Reflect.deleteProperty(tools, "listParts");
      Reflect.deleteProperty(tools, "part");
    }
  }
  if (!cohort) {
    Reflect.deleteProperty(tools, "cohort");
  }
  if (!proposal) {
    Reflect.deleteProperty(tools, "proposal");
  }
  // Open filled lines have host stroke expansion; outlined paint has no
  // ordinary solid parent for legacy holes.
  if (finish !== "filled") {
    Reflect.deleteProperty(tools, "hole");
  }
  if (hostLocked) {
    for (const name of [
      "arc",
      "center",
      "circle",
      "compare",
      "construct",
      "diamond",
      "dot",
      "fit",
      "hole",
      "combine",
      "line",
      "lint",
      "listParts",
      "part",
      "rect",
      "remove",
      "render",
    ] as const) {
      Reflect.deleteProperty(tools, name);
    }
  } else {
    Reflect.deleteProperty(tools, "confirm");
  }

  return { canvas, state, tools };
};
