/**
 * Analogical replay: compile a neighbor's drawing as this concept.
 *
 * Unkeyed icons have no house SVG. Asking a coding agent with tag-search is a
 * local max: `database` tags hit `storage` (filled dock, wrong) and `server`
 * (stacked trays, closer style). Replaying `server` as `database` is that
 * local max in the compiler: same language, wrong object. A cylinder is a
 * stack of the set's own `ellipse-flat` rim, not a retitled server.
 *
 * `replay` still compiles caller-supplied path `d` strings — this module does
 * not import `corpus/`. `stack` is a pile of one vocabulary mark; `trays` is
 * the same pile in primitives so DRAW still speaks cylinder without an
 * extract; `hub` is a tree of the `circle` primitive. When a Central file
 * shares a name with the concept (`cookies` for `cookie`, `wifi-full` for
 * `wifi`), replay compiles that file: the house drawing is the program, so
 * curves stay house curves. The composer writes the program. The model does
 * not.
 */
import type { Spec } from "../tools/canvas.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import type { Issue, Part } from "../types.js";
import { audit } from "./audit.js";
import type { GenerateResult } from "./generate.js";
import { GLYPHS, isGlyphName } from "./glyphs.js";
import type { GenerateLike } from "./harness.js";
import { compileIcon } from "./reconstruct.js";

/** The rim of a stack seen edge-on. Named in the vocabulary; `stack` looks it
 *  up by that name so a coordinate never has to name a part id. */
export const STACK_PART = "ellipse-flat";

/** Replace the `icon …` line. The rest of the program — keyline, `part` ops —
 *  is the analog's compiled placement and must stay. */
export const retitle = (program: string, slug: string): string =>
  program.replace(/^icon[^\n]*/mu, `icon ${slug}`);

/** Compile `analogPaths` onto `parts`, then name the program `slug`.
 *  Local unmatched subpaths are pushed onto `extras` so the DSL runner
 *  can place them — same seam as `compileArm`. */
export const replay = (
  slug: string,
  analogPaths: readonly string[],
  parts: readonly Part[],
  extras: Part[] = []
): string => {
  const source = retitle(compileIcon(slug, analogPaths, parts, extras), slug);
  return /(?:^|\n)fit(?:\s|$)/mu.test(source)
    ? source
    : `${source.trimEnd()}\nfit\n`;
};

/**
 * First stroked neighbor, or null when every candidate is filled.
 *
 * Tag-search for `database` ranks `storage` (a filled dock) above `server`
 * (stacked trays). Compiling a filled analog onto an outlined vocabulary
 * copies the wrong language: the house set is stroked, and a fill-expanded
 * dock is not a cylinder stack. Order among candidates is not enough —
 * `storage` can sit first — so filled drawings are skipped on purpose.
 */
export const preferStroked = (
  candidates: readonly { filled: boolean; slug: string }[]
): string | null => {
  for (const c of candidates) {
    if (!c.filled) {
      return c.slug;
    }
  }
  return null;
};

/** Tokens that mean a negative or partial variant of the same mark. */
const KIN_STOP = new Set([
  "dashed",
  "disabled",
  "disconnected",
  "no",
  "none",
  "off",
  "placeholder",
  "weak",
]);

const stemTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 0 && !/^\d+$/u.test(t));

/**
 * How strongly a house slug is the same drawing under another name.
 *
 * The gap list is exact (`cookie`, `wifi`, `fingerprint`). Central files the
 * same object as `cookies`, `wifi-full`, `finger-print-1`. A token overlap of
 * zero on those pairs is a hyphen and a plural, not a different icon.
 * Score 0 when the slug *is* the query — that is keyed compile, not analog.
 */
export const kinScore = (query: string, slug: string): number => {
  if (slug === query) {
    return 0;
  }
  const qTok = stemTokens(query);
  const sTok = stemTokens(slug);
  const qC = qTok.join("");
  const sC = sTok.join("");
  if (qC.length < 4) {
    return 0;
  }
  let score = 0;
  if (sC === qC) {
    score += 80;
  }
  if (slug.startsWith(`${query}-`)) {
    score += 60;
  }
  if (qTok.length === 1 && sTok.includes(qTok[0] ?? "")) {
    score += 40;
  }
  if (sC.startsWith(qC) && sC.length <= qC.length + 2) {
    score += 50;
  }
  if (score === 0) {
    return 0;
  }
  score -= sTok.filter((t) => KIN_STOP.has(t)).length * 25;
  score -=
    sTok.filter((t) => !(qTok.includes(t) || KIN_STOP.has(t))).length * 2;
  return score;
};

export const KIN_FLOOR = 20;

/**
 * The same drawing under another filename: hyphens and trailing indexes, not
 * a neighbour. `strikethrough` / `strike-through` and `fingerprint` /
 * `finger-print-1` compact to the same letters. `wifi` / `wifi-full` do not
 * — that is a variant, and compiling it as the concept is frankenstein.
 */
export const sameLetters = (query: string, slug: string): boolean => {
  if (slug === query) {
    return false;
  }
  const compact = (s: string) => stemTokens(s).join("");
  const q = compact(query);
  return q.length >= 4 && q === compact(slug);
};

/**
 * Best stroked house slug that is this concept under another name, or null.
 *
 * Candidates are already ranked by the caller or not — this re-scores, drops
 * filled drawings, and refuses a match below {@link KIN_FLOOR} so `lab` does
 * not analog `microphone`.
 */
export const pickKin = (
  query: string,
  candidates: readonly { filled: boolean; slug: string }[]
): string | null => {
  const ranked = candidates
    .map((c) => ({ ...c, score: kinScore(query, c.slug) }))
    .filter((c) => c.score > KIN_FLOOR)
    .toSorted((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return preferStroked(ranked);
};

const quantize = (n: number): number => Math.round(n * 4) / 4;

/**
 * Stack one vocabulary mark `count` times, spaced so lint's 1px gap clears
 * the stroke. The model never emits a coordinate: the stride is the part's
 * own height plus the spec's stroke plus the gap rule.
 */
export const stack = (
  slug: string,
  parts: readonly Part[],
  count = 3
): string => {
  const part = parts.find((p) => p.name === STACK_PART || p.id === STACK_PART);
  if (!part) {
    throw new Error(`stack: no \`${STACK_PART}\` in the vocabulary`);
  }
  const size = 16;
  const band = part.h * (size / part.w);
  const stride = band + 1 + 1.9;
  const address = part.name ?? part.id;
  const lines = [`icon ${slug}`, "keyline tall", "finish outlined", ""];
  for (let i = 0; i < count; i += 1) {
    lines.push(`part ${address} at 4,${quantize(3 + i * stride)} size ${size}`);
  }
  lines.push("fit", "");
  return lines.join("\n");
};

/**
 * A parent node with a row of children, joined on-axis.
 *
 * `stack` piles one mark and never connects them, which is why a cylinder
 * of `ellipse-flat` reads as three eyes. Concepts that *are* a tree — a
 * sitemap, an org chart — need the joins. The nodes are `circle`, not a
 * clustered part: the same reason keyed compile emits `circle` for a ring.
 */
export const hub = (slug: string, leaves = 3): string => {
  if (leaves !== 3) {
    throw new Error("hub draws three children; other fan-outs are not written");
  }
  return [
    `icon ${slug}`,
    "keyline square",
    "finish outlined",
    "",
    "circle 12,6 r2",
    "circle 5,17 r2",
    "circle 12,17 r2",
    "circle 19,17 r2",
    "line 12,8 12,15",
    "line 7,17 10,17",
    "line 14,17 17,17",
    "fit",
    "",
  ].join("\n");
};

/**
 * Three stadiums stacked, no vocabulary required.
 *
 * `stack` needs `ellipse-flat` in the extract. `iconsmith new` does not extract
 * 2,085 files as a side effect of drawing one icon, so unkeyed DRAW still has
 * to speak "cylinder" when `-p` was never passed. The rim geometry is the
 * primitive, not a medoid: same host coordinates `stack` already writes.
 */
export const trays = (slug: string): string =>
  [
    `icon ${slug}`,
    "keyline tall",
    "finish outlined",
    "",
    // Path box 14×18 + stroke 2 → visual 16×20, the tall keyline.
    "rect 5,3 14x3 r2",
    "rect 5,10.5 14x3 r2",
    "rect 5,18 14x3 r2",
    "fit",
    "",
  ].join("\n");

/** Names that are a pile of rims, not a tree. Whole tokens, not `data`. */
export const STACK_HINT =
  /\b(?:beaker|cylinder|database|drum|server|storage|trays?)\b/iu;
/** Names that are a connected tree. `org-chart` hits `org`. */
export const HUB_HINT = /\b(?:graph|hierarchy|network|org|sitemap|tree)\b/iu;

export const hasStackRim = (parts: readonly Part[]): boolean =>
  parts.some((p) => p.name === STACK_PART || p.id === STACK_PART);

/** A Central file compiled as this concept. Paths only — no third-party SVG. */
export interface AnalogNeighbor {
  readonly paths: readonly string[];
  readonly slug: string;
}

/**
 * Which host programs to collide.
 *
 * With a look (`collide`), volume then curate: a house kin if one was handed
 * in, then stack (if the rim exists), trays, hub. Without one, a house kin
 * is the drawing — existing icons feed the design — unless the name is a
 * cylinder stack, which stays `stack` / `trays` so `database` does not become
 * a retitled `server` when no kin file exists.
 */
export const analogConstructions = (
  slug: string,
  parts: readonly Part[],
  text: string,
  collide: boolean,
  neighbor?: AnalogNeighbor
): readonly { extras?: Part[]; id: string; source: string }[] => {
  const extras: Part[] = [];
  const replayed =
    neighbor !== undefined && neighbor.paths.length > 0
      ? [
          {
            extras,
            id: "replay",
            source: replay(slug, neighbor.paths, parts, extras),
          },
        ]
      : [];
  const glyphed = isGlyphName(slug)
    ? [{ id: "glyph", source: GLYPHS[slug](slug, "outlined") }]
    : [];
  if (!collide && glyphed.length > 0) {
    return glyphed;
  }
  if (collide) {
    const out: { id: string; source: string }[] = [...glyphed, ...replayed];
    if (hasStackRim(parts)) {
      out.push({ id: "stack", source: stack(slug, parts) });
    }
    out.push(
      { id: "trays", source: trays(slug) },
      { id: "hub", source: hub(slug) }
    );
    return out;
  }
  if (STACK_HINT.test(text)) {
    return hasStackRim(parts)
      ? [{ id: "stack", source: stack(slug, parts) }]
      : [{ id: "trays", source: trays(slug) }];
  }
  if (replayed.length > 0) {
    return replayed;
  }
  return [{ id: "hub", source: hub(slug) }];
};

const traceOf = (source: string): string[] =>
  source
    .split("\n")
    .map((l) => l.replace(/(?<lead>^|\s)#.*$/u, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/u)[0].toLowerCase());

const analogBrief = (id: string, slug: string, of?: string): string =>
  id === "replay" && of !== undefined
    ? `analog replay ${of} ${slug}`
    : `analog ${id} ${slug}`;

const fromProgram = (
  source: string,
  slug: string,
  parts: readonly Part[],
  spec?: Spec
): Omit<GenerateResult, "text"> & { text?: string } => {
  const program = runDsl(source, [...parts], spec ? { spec } : {});
  const issues: Issue[] = [
    ...program.errors.map((message) => ({
      message,
      rule: "dsl",
      severity: "error" as const,
    })),
    ...lint(program.canvas, { keyline: program.keyline }),
  ];
  const trace = traceOf(source);
  return {
    clean: issues.every((i) => i.severity !== "error"),
    doc: program.canvas.toJSON({
      icon: program.icon ?? slug,
      keyline: program.keyline,
    }),
    issues,
    program: source,
    steps: trace.length,
    svg: program.canvas.toSVG(),
    trace,
  };
};

/**
 * Unkeyed DRAW as a `GenerateFn`.
 *
 * No model. A look, when the caller passed `ask`, collides the catalog and
 * keeps the construction the vision scores as the named object. Without a
 * look, a name hint picks one construction so `database` is trays and
 * `unicorn` is a hub rather than both.
 */
export const analogArm =
  (): GenerateLike =>
  async (concept, options = {}) => {
    const parts = options.parts ?? [];
    const text = [concept.name, ...(concept.tags ?? [])].join(" ");
    const collide = options.ask !== undefined;
    const neighbor =
      options.analogOf !== undefined && (options.analogPaths?.length ?? 0) > 0
        ? { paths: options.analogPaths ?? [], slug: options.analogOf }
        : undefined;
    const catalog = analogConstructions(
      concept.name,
      parts,
      text,
      collide,
      neighbor
    );
    const drawn = catalog.map((row) => ({
      ...row,
      result: fromProgram(
        row.source,
        concept.name,
        [...parts, ...(row.extras ?? [])],
        options.spec
      ),
    }));
    const [chosen] = drawn;
    if (chosen === undefined) {
      throw new Error("analogArm: empty construction catalog");
    }
    const { ask, lookReferences = [] } = options;
    if (ask) {
      let best:
        | ((typeof drawn)[number] & {
            audit: Awaited<ReturnType<typeof audit>>;
          })
        | undefined;
      for (const row of drawn) {
        // Catalog order is the look sequence so a stub ask can count turns.
        // oxlint-disable-next-line no-await-in-loop
        const reviewed = await audit({
          ask,
          concept,
          finish: "outlined",
          kind: "analog",
          references: lookReferences,
          svg: row.result.svg,
        });
        if (
          best === undefined ||
          reviewed.sc > best.audit.sc ||
          (reviewed.sc === best.audit.sc && reviewed.pq > best.audit.pq)
        ) {
          best = { ...row, audit: reviewed };
        }
      }
      if (best) {
        const brief = analogBrief(best.id, concept.name, options.analogOf);
        return {
          ...best.result,
          audit: best.audit,
          brief,
          text: brief,
        };
      }
    }
    const brief = analogBrief(chosen.id, concept.name, options.analogOf);
    return { ...chosen.result, brief, text: brief };
  };
