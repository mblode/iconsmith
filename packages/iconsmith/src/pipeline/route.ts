/**
 * The pipeline as named, swappable stages.
 *
 * Everything here already existed as a function somewhere under `pipeline/`.
 * What did not exist was a way to say *which* of them ran: the raster arm is a
 * `proposalArm` wrapper, the external-agent arm is a `harnessArm` wrapper, and
 * the vocabulary search is something the model may or may not think to call.
 * Three different mechanisms for the same kind of choice, none of them
 * enumerable, so "which pipeline produced this number" is answered by reading
 * the call site rather than by reading the result.
 *
 * A `Route` is six named stages, one per decision the pipeline makes. Two
 * routes differing in one stage are an A/B with one variable in it, and
 * `runRoute` returns exactly what `generate` returns, so a route drops into
 * `EvalOptions.generate` — the seam `eval.ts` already reaches through — and
 * becomes an arm of the existing experiment for free. The scorer is part of the
 * route so that "compared on one scorer" is a checkable claim about two routes
 * rather than a promise about how they were invoked.
 *
 * THE INVARIANT, and how the types carry it.
 *
 * The model never emits a coordinate. Routing is the obvious place to lose
 * that: a PROPOSE stage that could hand geometry to a DRAW stage is a tracer
 * assembled out of parts that are each individually fine. It cannot happen
 * here, and not because a comment says so:
 *
 * - PROPOSE's output type is `Proposal | null`, and `Proposal` is `compose.ts`'s
 *   closed vocabulary — nine cell words, five size bands, three shape words, a
 *   block count, part ids, and a 48px blurred thumbnail. It has no `d`, no
 *   `Canvas`, no `IconDoc`, and its only `number` is an element count. There is
 *   no field a coordinate fits in, so a DRAW stage has nothing to read one out
 *   of. Widening `Proposal` to carry one is a change to `compose.ts`, where the
 *   file header, the schema and `assertNoGeometry` all argue against it.
 * - `runRoute` calls `assertNoGeometry` on every non-null composition before
 *   DRAW is entered. A stage that fabricates a `Proposal` rather than deriving
 *   one — the shape a hand-rolled bypass would take — is checked at runtime by
 *   the same function the raster arm is checked by.
 * - SELECT's `shortlist` is `PartHint[]`, which carries an id, a name and the
 *   icons a part was extracted from, and deliberately not the `w`/`h` that
 *   `listParts` reports. A shortlist is a set of things to look up, not a set
 *   of sizes to place at. `assertPlainIds` re-checks that at runtime.
 * - DRAW's input names its three sources — brief, composition, selection — and
 *   none of them is a drawing. The only route from any of them to a document is
 *   through the primitives, which is where it was already.
 *
 * `Selection.parts` does carry path data, because a `Part` is a measured
 * cluster of the existing set with a `d` on it. That is not the leak: parts are
 * house-authored geometry placed by id through `canvas.part`, which snaps and
 * quantises like every other primitive. Nothing in a route lets a model author
 * one.
 *
 * ROUTES ARE CODE, not JSON, and the deciding argument is composition. A route
 * is six functions whose output types must feed the next stage's input types;
 * held as data it would be six strings and a registry lookup, and the check
 * that BRIEF's output is what PROPOSE takes would move from the compiler to a
 * test nobody wrote. Data buys enumerability and diffability, which is real —
 * so those are bought back directly: `ROUTES` is a flat record, `routeNames`
 * lists it, and `describeRoute` projects any route to the plain object a report
 * or a diff wants. A route is also a plain object, so `{ ...ROUTES.direct, draw }`
 * is how an experiment swaps one stage, which is the thing a JSON file would
 * have made ceremonial.
 */
import { inspect, measureIcon } from "../eval/blindspot.js";
import { registeredSimilarity } from "../tools/registration.js";
import { similarity } from "../tools/render.js";
import type { Issue, Part } from "../types.js";
import { analogArm } from "./analog.js";
import type { Proposal } from "./compose.js";
import { assertNoGeometry } from "./compose.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import { generate } from "./generate.js";
import type { Reference } from "./licence.js";
import { markArm } from "./mark.js";
import { mixtureArm } from "./mixture.js";
import type { Concept } from "./prompt.js";
import type { ProposalOptions, ProposalRun } from "./propose.js";
import { propose } from "./propose.js";
import { compileArm } from "./reconstruct.js";
import type { PartHint } from "./search.js";
import { DEFAULT_SHORTLIST, searchParts } from "./search.js";

/**
 * One named step. `run` is async in every stage, including the ones that are
 * pure today: a stage that has to become a model call later should not change
 * the shape of the route it sits in.
 */
export interface Stage<In, Out> {
  readonly name: string;
  readonly run: (input: In, ctx: RouteContext) => Promise<Out>;
}

/** What every stage may read: the concept asked for, and the options the caller
 *  (usually `evaluate`) handed the whole run. */
export interface RouteContext {
  readonly concept: Concept;
  readonly options: GenerateOptions;
}

/**
 * What to draw, in words.
 *
 * Thin on purpose. BRIEF's job is to decide the *sense* of a concept — the
 * metaphor table and the concept closure both belong here — and its output is
 * the same `Concept` the prompt already renders, so a smarter BRIEF changes
 * what the drawer is told without changing anything downstream of it.
 */
export interface Brief {
  readonly concept: Concept;
  /** What BRIEF did, for the report. Prose about the concept, never about the
   *  drawing: nothing reads this back into the pipeline. */
  readonly note: string | null;
}

/** BRIEF's output plus PROPOSE's, which is what SELECT gets to choose from. */
export interface Proposed {
  readonly brief: Brief;
  readonly composition: Proposal | null;
}

/** What the drawer is allowed to see: the corpus it may compare against, the
 *  vocabulary it may place from, and the marks the search already found. */
export interface Selection {
  readonly parts: readonly Part[];
  readonly references: readonly Reference[];
  readonly shortlist: readonly PartHint[];
}

/** Everything DRAW is given. Three sources, none of them a drawing. */
export interface Drawing {
  readonly brief: Brief;
  readonly composition: Proposal | null;
  readonly selection: Selection;
}

/** What SCORE compares. Both sides are rendered SVG; the target is the icon the
 *  benchmark says this concept should look like. */
export interface Scoring {
  readonly svg: string;
  readonly target: string;
}

/** One implementation chosen per stage. */
export interface Route {
  readonly brief: Stage<Concept, Brief>;
  readonly check: Stage<GenerateResult, readonly Issue[]>;
  readonly description: string;
  readonly draw: Stage<Drawing, GenerateResult>;
  readonly name: string;
  readonly propose: Stage<Brief, Proposal | null>;
  readonly score: Stage<Scoring, number>;
  readonly select: Stage<Proposed, Selection>;
}

/** The shape `eval.ts` reaches arms through, written structurally rather than
 *  imported, for the reason `propose.ts` and `harness.ts` both give: an arm
 *  should not depend on the module that measures it. */
export type GenerateLike = (
  concept: Concept,
  options: GenerateOptions
) => Promise<GenerateResult>;

/**
 * A stage failed. The route and the stage are in the message because a stack
 * trace through six injected closures says which function threw and not which
 * arm of the experiment it was.
 */
export class RouteError extends Error {
  readonly route: string;
  readonly stage: string;

  constructor(route: string, stage: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`route "${route}" failed at stage "${stage}": ${why}`);
    this.cause = cause;
    this.name = "RouteError";
    this.route = route;
    this.stage = stage;
  }
}

/**
 * Part ids, checked for measurements.
 *
 * The same check `assertNoGeometry` runs over `Proposal.parts`, applied to the
 * shortlist for the same reason: an id is an opaque handle, and a handle that
 * reads as `4.5` is not one.
 */
const assertPlainIds = (hints: readonly PartHint[]): void => {
  for (const h of hints) {
    if (/\d+\.\d/u.test(h.id)) {
      throw new Error(
        `shortlist carries the part id "${h.id}", which reads as a ` +
          "measurement. A shortlist names marks to look up; it does not say " +
          "how big they are or where they go."
      );
    }
  }
};

// --- the vocabulary search --------------------------------------------------

// Re-exported so a route's stages and the shortlist type stay reachable from
// the module that defines the stages. The search itself lives in `search.ts`
// because `listParts` runs the same one — see that file's header.
export type { PartHint } from "./search.js";
export { DEFAULT_SHORTLIST, searchParts } from "./search.js";

// --- stages -----------------------------------------------------------------

/**
 * BRIEF: the concept as given.
 *
 * What the pipeline does today — tags pass straight through to
 * `conceptPrompt`. It is a stage rather than nothing so that the metaphor
 * table and the concept closure have somewhere to be measured against it.
 */
export const briefAsGiven: Stage<Concept, Brief> = {
  name: "as-given",
  run: (concept) => Promise.resolve({ concept, note: null }),
};

/** PROPOSE: nothing. The drawer starts cold, which is the control. */
export const proposeNothing: Stage<Brief, Proposal | null> = {
  name: "none",
  run: () => Promise.resolve(null),
};

/**
 * PROPOSE: the raster arm, as a stage.
 *
 * `propose` sketches with an image model, critiques the sketches and reads the
 * chosen one into a `Proposal` — and the `Proposal` is all that survives, which
 * is what makes this safe to route. The image never reaches the returned value,
 * so no DRAW stage can be given the picture even by a caller trying to.
 *
 * Injectable, and the injected function is typed to return a `ProposalRun`, so
 * a fake in a test is held to the same no-geometry return as the real one.
 */
export const proposeFromRaster = (
  ask: (
    concept: Concept,
    options: ProposalOptions
  ) => Promise<ProposalRun> = propose,
  options: Omit<ProposalOptions, "corpus" | "parts"> = {},
  onProposal?: (concept: Concept, run: ProposalRun) => void
): Stage<Brief, Proposal | null> => ({
  name: "raster",
  run: async (brief, ctx) => {
    const run = await ask(brief.concept, {
      ...options,
      corpus: ctx.options.corpus ?? [],
      parts: ctx.options.parts,
    });
    onProposal?.(brief.concept, run);
    return run.proposal;
  },
});

/** SELECT: whatever the caller handed in, unchanged. The corpus and the
 *  vocabulary reach the drawer exactly as `generate` receives them today. */
export const selectAsGiven: Stage<Proposed, Selection> = {
  name: "as-given",
  run: (_input, ctx) =>
    Promise.resolve({
      parts: ctx.options.parts ?? [],
      references: ctx.options.corpus ?? [],
      shortlist: [],
    }),
};

/**
 * SELECT: search the vocabulary before drawing, and hand the drawer the
 * shortlist as the vocabulary it can see.
 *
 * The evidence this exists for: the vocabulary holds 1,116 marks, and while
 * search matched curated names only, 61 of them were findable. With provenance
 * in the query, a concept whose part is findable scores well and a concept that
 * matches nothing is drawn from scratch. Which of those happened was an
 * accident of whether the model thought to search and what it typed. Running
 * the search here makes it a property of the route.
 *
 * The shortlist reaches the drawer as `Selection.parts` — the vocabulary
 * `listParts` searches and `part` places. That is the honest mechanism today:
 * the per-icon brief is `conceptPrompt`'s, which renders a name, a category and
 * tags, and there is no field on it for a shortlist. Narrowing the vocabulary
 * says the same thing in the only place the drawer will hear it.
 *
 * A search that matches nothing falls back to the whole vocabulary rather than
 * to none, so the failure mode is "this route did not help", never "this route
 * took the parts away".
 */
export const selectPartFirst = (
  limit = DEFAULT_SHORTLIST
): Stage<Proposed, Selection> => ({
  name: "part-first",
  run: ({ brief, composition }, ctx) => {
    const parts = ctx.options.parts ?? [];
    const { concept } = brief;
    const found = searchParts(
      parts,
      `${concept.name} ${concept.tags?.join(" ") ?? ""} ${concept.category ?? ""}`,
      limit,
      ctx.options.aliases
    );
    // A composition's own part ids come first: they were matched against the
    // sketch's shapes, which is evidence about this icon rather than about the
    // concept's name.
    const proposed = new Set(composition?.parts);
    const byId = new Map(parts.map((p) => [p.id, p]));
    const shortlist: PartHint[] = [
      ...[...proposed]
        .map((id) => byId.get(id))
        .filter((p) => p !== undefined)
        .map((p) => ({
          id: p.id,
          name: p.name ?? null,
          seenIn: p.icons.slice(0, 5),
          usedByIcons: p.icons.length,
        })),
      ...found.filter((h) => !proposed.has(h.id)),
    ].slice(0, limit);
    assertPlainIds(shortlist);

    const ids = new Set(shortlist.map((h) => h.id));
    const narrowed = parts.filter((p) => ids.has(p.id));
    return Promise.resolve({
      parts: narrowed.length > 0 ? narrowed : parts,
      references: ctx.options.corpus ?? [],
      shortlist,
    });
  },
});

/**
 * DRAW: any `GenerateLike`, as a stage.
 *
 * `generate` and `harnessArm(...)` already return the same shape, so both are
 * DRAW implementations without an adapter — which is the fact that made this
 * whole exercise cheap. The stage's job is only to fold the brief, the
 * composition and the selection back into the `GenerateOptions` the drawer
 * takes.
 */
export const drawWith = (
  name: string,
  fn: GenerateLike
): Stage<Drawing, GenerateResult> => ({
  name,
  run: ({ brief, composition, selection }, ctx) =>
    fn(brief.concept, {
      ...ctx.options,
      corpus: [...selection.references],
      parts: [...selection.parts],
      proposal: composition,
    }),
});

/** DRAW: the built-in tool-calling loop. */
export const drawInLoop = drawWith("tool-loop", generate);

/**
 * DRAW: keyed reconstruction.
 *
 * `compileArm` places vocabulary parts from `GenerateOptions.targetPaths`.
 * There is no model on this path, so there is no coordinate a model could
 * emit. Callers that have no path data must not use this stage — the arm
 * throws rather than inventing.
 */
export const drawCompile = drawWith("compile", compileArm());

/**
 * DRAW: host twins from `MARKS` / `twin.ts`.
 *
 * There is no model on this path. 0 `part` ops is the construction, not a leak.
 * The slug is a MARKS key (`plus`, `plus-filled`); anything else throws.
 */
export const drawMark = drawWith("mark", markArm());

/**
 * DRAW: unkeyed host constructions (replay a Central kin, else `stack` /
 * `trays` / `hub`).
 *
 * There is no model on this path. Cosine against a house file must stay null:
 * these are new objects, not reconstructions.
 */
export const drawAnalog = drawWith("analog", analogArm());

/**
 * CHECK: the lint the drawer already ran.
 *
 * `generate` lints the finished canvas itself rather than trusting the model's
 * last `lint` call, and `harnessArm` lints the program's canvas plus the ops
 * the DSL refused. Re-linting here would need the elements back out of an SVG,
 * which is a worse measurement of the same thing.
 */
export const checkLint: Stage<GenerateResult, readonly Issue[]> = {
  name: "lint",
  run: (drawn) => Promise.resolve(drawn.issues),
};

/**
 * CHECK: lint plus the structural panel.
 *
 * The six checks in `eval/blindspot.ts` measure what rendered cosine cannot see
 * — mark count, visual extent, centring, corner ink, dot tiers, margin — and
 * they are corpus rates rather than opinions. They arrive as warnings, not
 * errors: they are set-level rates with Wilson intervals behind them, and
 * failing one icon on a check the corpus itself fails a quarter of the time
 * would be a rule against the set.
 */
export const checkStructural: Stage<GenerateResult, readonly Issue[]> = {
  name: "lint+structural",
  run: async (drawn) => {
    const verdict = inspect(
      drawn.doc.icon ?? "(unnamed)",
      await measureIcon(drawn.svg)
    );
    return [
      ...drawn.issues,
      ...verdict.reasons.map((message) => ({
        message,
        rule: "structural",
        severity: "warn" as const,
      })),
    ];
  },
};

/**
 * SCORE: rendered cosine at best alignment.
 *
 * The committed scorer. `registeredSimilarity` searches a small shift window
 * and takes the best, which is what stopped a correct drawing one unit off
 * centre scoring below a wrong one in the right place.
 */
export const scoreRegistered: Stage<Scoring, number> = {
  name: "registered",
  run: ({ svg, target }) => registeredSimilarity(svg, target),
};

/** SCORE: rendered cosine at fixed position — the scale the 0.737 baseline was
 *  measured on, kept so a route can be read against that number directly. */
export const scorePlain: Stage<Scoring, number> = {
  name: "plain",
  run: ({ svg, target }) => similarity(svg, target),
};

// --- routes -----------------------------------------------------------------

/** The pipeline as it runs today: no proposal, the whole vocabulary, the
 *  built-in loop. Every other route is measured against this one. */
export const direct: Route = {
  brief: briefAsGiven,
  check: checkLint,
  description:
    "The current behaviour. Tags pass through, nothing proposes, the drawer " +
    "sees the whole corpus and the whole vocabulary and starts cold.",
  draw: drawInLoop,
  name: "direct",
  propose: proposeNothing,
  score: scoreRegistered,
  select: selectAsGiven,
};

/** `direct` with one variable changed: SELECT searches the vocabulary first. */
export const partFirst: Route = {
  ...direct,
  description:
    "SELECT searches the part vocabulary for the concept before the drawer " +
    "starts, and the drawer sees the shortlist as its vocabulary. Differs " +
    "from `direct` in exactly one stage.",
  name: "part-first",
  select: selectPartFirst(),
};

/** `direct` with one variable changed: DRAW compiles house paths onto parts. */
export const compile: Route = {
  ...direct,
  description:
    "DRAW compiles house path data onto vocabulary parts. There is no model " +
    "and no coordinate a model could emit: the compiler places parts. " +
    "Requires `targetPaths`. Differs from `direct` in exactly one stage.",
  draw: drawCompile,
  name: "compile",
};

/** `direct` with one variable changed: DRAW writes host twins, no model. */
export const mark: Route = {
  ...direct,
  description:
    "DRAW writes host twins via MARKS and twin.ts. There is no model and no " +
    "coordinate a model could emit. Differs from `direct` in exactly one stage.",
  draw: drawMark,
  name: "mark",
};

/** `direct` with one variable changed: DRAW writes analog constructions. */
export const analog: Route = {
  ...direct,
  description:
    "DRAW writes host analog constructions (replay a Central kin, else " +
    "stack, trays, hub). There is no model and no coordinate a model could " +
    "emit. Differs from `direct` in exactly one stage.",
  draw: drawAnalog,
  name: "analog",
};

/** DRAW: sparse expert gate. Cheap host arms first; agent if they fail. */
export const drawMixture = drawWith("mixture", mixtureArm());

/** `direct` with one variable changed: DRAW is the mixture gate. */
export const mixture: Route = {
  ...direct,
  description:
    "DRAW routes to compile / mark / analog / glyph / agent from evidence " +
    "(house file, MARKS key, named family, part hit, pack-name consensus). " +
    "Third-party packs contribute names only. Differs from `direct` in " +
    "exactly one stage.",
  draw: drawMixture,
  name: "mixture",
};

/** Every route, by name. Flat and enumerable on purpose: this is the listing a
 *  JSON file would have been written for. */
export const ROUTES: Readonly<Record<string, Route>> = {
  analog,
  compile,
  direct,
  mark,
  mixture,
  "part-first": partFirst,
};

export const routeNames = (): string[] => Object.keys(ROUTES).toSorted();

/** Look a route up, failing with the list rather than with `undefined`. */
export const getRoute = (name: string): Route => {
  const route = ROUTES[name];
  if (!route) {
    throw new RouteError(
      name,
      "lookup",
      new Error(`unknown route. Known routes: ${routeNames().join(", ")}.`)
    );
  }
  return route;
};

/** A route as plain data — what a report prints and what a diff between two
 *  runs compares. */
export const describeRoute = (
  route: Route
): {
  description: string;
  name: string;
  stages: Record<string, string>;
} => ({
  description: route.description,
  name: route.name,
  stages: {
    brief: route.brief.name,
    check: route.check.name,
    draw: route.draw.name,
    propose: route.propose.name,
    score: route.score.name,
    select: route.select.name,
  },
});

const step = async <In, Out>(
  route: string,
  stage: Stage<In, Out>,
  kind: string,
  input: In,
  ctx: RouteContext
): Promise<Out> => {
  try {
    return await stage.run(input, ctx);
  } catch (error) {
    throw new RouteError(route, `${kind}/${stage.name}`, error);
  }
};

/**
 * Run one route over one concept.
 *
 * Returns exactly what `generate` returns, which is the whole point: this is a
 * `GenerateFn`, so `evaluate({ generate: arm(route) })` measures a route with
 * no change to the eval at all.
 *
 * `clean` is recomputed from CHECK's issues rather than carried through from
 * the drawer, because a route that checks more has to be able to disagree with
 * the drawer about whether the icon is clean. That is what a CHECK stage is
 * for.
 */
export const runRoute = async (
  route: Route,
  concept: Concept,
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const ctx: RouteContext = { concept, options };
  const brief = await step(route.name, route.brief, "brief", concept, ctx);
  const composition = await step(
    route.name,
    route.propose,
    "propose",
    brief,
    ctx
  );
  if (composition !== null) {
    // The gate between PROPOSE and DRAW. The type already makes a coordinate
    // unrepresentable; this catches the case the type cannot — a stage that
    // built a `Proposal` by hand instead of deriving one through `compose`.
    assertNoGeometry(composition);
  }
  const selection = await step(
    route.name,
    route.select,
    "select",
    { brief, composition },
    ctx
  );
  const drawn = await step(
    route.name,
    route.draw,
    "draw",
    { brief, composition, selection },
    ctx
  );
  const issues = await step(route.name, route.check, "check", drawn, ctx);
  return {
    ...drawn,
    clean: issues.every((i) => i.severity !== "error"),
    issues: [...issues],
  };
};

/** A route as the `GenerateFn` every arm is reached through. */
export const arm =
  (route: Route): GenerateLike =>
  (concept, options) =>
    runRoute(route, concept, options);

/** Score one drawing against its target, through the route's own scorer. Kept
 *  off `runRoute` because the eval owns scoring and a route that scored itself
 *  would be marking its own homework; this is here so a caller comparing two
 *  routes can assert they agree on the scorer before believing the comparison. */
export const scoreRoute = (
  route: Route,
  scoring: Scoring,
  ctx: RouteContext
): Promise<number> => step(route.name, route.score, "score", scoring, ctx);
