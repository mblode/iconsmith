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
 * not import `corpus/`. Beyond stack / trays / hub, name tokens pick a
 * concept family (tower, peak, volcano, tube, plant, horn, mushroom,
 * hourglass, sailboat) written with the same twin helpers glyphs use, so
 * both paints are ops, not a generic tree. Families are host constructions,
 * not house twins: a cactus is a plant, not a hub, and still not Central.
 * Those families are analog, not glyphs: a token must ask for them.
 * `composeFromParts` places a named vocabulary part at a named anchor when
 * one answers. The composer writes the program. The model does not.
 */
import type { Spec } from "../tools/canvas.js";
import { declareKeyline } from "../tools/declare.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import {
  frame,
  hbar,
  lozenge,
  mass,
  program as iconProgram,
  ring,
  vbar,
} from "../tools/twin.js";
import type { Finish, Issue, Part } from "../types.js";
import { audit } from "./audit.js";
import type { GenerateResult } from "./generate.js";
import type { GenerateLike } from "./harness.js";
import { compileIcon } from "./reconstruct.js";
import { overlap, rankParts, tokens } from "./search.js";

/** The rim of a stack seen edge-on. Named in the vocabulary; `stack` looks it
 *  up by that name so a coordinate never has to name a part id. */
export const STACK_PART = "ellipse-flat";

/** Replace the `icon …` line. The rest of the program — keyline, `part` ops —
 *  is the analog's compiled placement and must stay. */
export const retitle = (program: string, slug: string): string =>
  program.replace(/^icon[^\n]*/mu, `icon ${slug}`);

/**
 * Compile `analogPaths` onto `parts`, then name the program `slug`. Local
 * unmatched subpaths are pushed onto `extras` so the DSL runner can place
 * them — same seam as `compileArm`.
 *
 * The keyline is declared here rather than by `compileIcon`, but it is
 * *measured* rather than assumed. An earlier revision appended `keyline square`
 * unconditionally, reasoning that an analog ends in `fit` and so keeps the
 * promise; `fit` scales content into the live area and preserves its aspect, so
 * it makes nothing square that was not, and a fan that lands at 18.0×15.5
 * declared a box it misses. `declareKeyline` names what the drawing measures.
 */
export const replay = (
  slug: string,
  analogPaths: readonly string[],
  parts: readonly Part[],
  extras: Part[] = []
): string => {
  const compiled = retitle(compileIcon(slug, analogPaths, parts, extras), slug);
  const fitted = /(?:^|\n)fit(?:\s|$)/mu.test(compiled)
    ? compiled
    : `${compiled.trimEnd()}\nfit\n`;
  return declareKeyline(fitted, slug, [...parts, ...extras]).source;
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
  count = 3,
  finish: Finish = "outlined"
): string => {
  const part = parts.find((p) => p.name === STACK_PART || p.id === STACK_PART);
  if (!part) {
    throw new Error(`stack: no \`${STACK_PART}\` in the vocabulary`);
  }
  const size = 16;
  const band = part.h * (size / part.w);
  const stride = band + 1 + 1.9;
  const address = part.name ?? part.id;
  const lines = [`icon ${slug}`, "keyline tall", `finish ${finish}`, ""];
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
export const hub = (
  slug: string,
  leaves = 3,
  finish: Finish = "outlined"
): string => {
  if (leaves !== 3) {
    throw new Error("hub draws three children; other fan-outs are not written");
  }
  // No `keyline` line: a node over three children fits at 18.0×15.5, which is
  // no house keyline, and the honest reading of that is a `keyline` warn rather
  // than a `square` this drawing misses by 2.5. `declareKeyline` adds one if a
  // caller's spec ever makes the fan land on a box.
  return declareKeyline(
    [
      `icon ${slug}`,
      `finish ${finish}`,
      "",
      "circle 12,6 r2",
      "circle 5,17 r2",
      "circle 12,17 r2",
      "circle 19,17 r2",
      vbar(finish, 12, 8, 7),
      hbar(finish, 7, 17, 3),
      hbar(finish, 14, 17, 3),
      "fit",
      "",
    ].join("\n"),
    slug
  ).source;
};

/**
 * Three stadiums stacked, no vocabulary required.
 *
 * `stack` needs `ellipse-flat` in the extract. `iconsmith new` does not extract
 * 2,085 files as a side effect of drawing one icon, so unkeyed DRAW still has
 * to speak "cylinder" when `-p` was never passed. The rim geometry is the
 * primitive, not a medoid: same host coordinates `stack` already writes.
 */
export const trays = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 5, 3, 14, 3, 2),
    mass(finish, 5, 10.5, 14, 3, 2),
    mass(finish, 5, 18, 14, 3, 2),
  ]);

/**
 * Lantern room, beams, shaft, footing — lighthouse, beacon, tower.
 * Analog family, not a glyph: selected by a name token, never volunteered
 * for a name that does not ask for it.
 */
export const tower = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    ...frame(finish, 9, 3, 6, 4, 1),
    "circle 12,5 r1",
    hbar(finish, 5, 5, 3),
    hbar(finish, 16, 5, 3),
    mass(finish, 10, 8, 4, 9, 1),
    hbar(finish, 8, 8, 8),
    mass(finish, 7, 17, 10, 3, 1),
  ]);

/** Stepped cone — mountain, peak, pyramid. Smoke belongs on volcano. */
export const peak = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 4, 15, 16, 4, 1),
    mass(finish, 7, 11, 10, 4, 1),
    mass(finish, 10, 7, 4, 4, 1),
  ]);

/** Stepped cone, crater lip, and three smoke dots — volcano. */
export const volcano = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 4, 15, 16, 4, 1),
    mass(finish, 7, 11, 10, 4, 1),
    mass(finish, 10, 8, 4, 3, 1),
    "dot 10,5 floating",
    "dot 12,3 floating",
    "dot 14,5 floating",
  ]);

/** Barrel, eyepiece, objective, tripod — telescope, spyglass. */
export const tube = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "landscape", [
    mass(finish, 3, 9, 13, 5, 2),
    mass(finish, 16, 10, 2, 3, 1),
    ...ring(finish, 18, 11.5, 2.5),
    vbar(finish, 7, 15, 4),
    vbar(finish, 13, 15, 4),
    hbar(finish, 7, 15, 6),
  ]);

/** Saguaro trunk, two arms, a pot — cactus, succulent. */
export const plant = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 10, 3, 4, 13, 2),
    mass(finish, 6, 7, 4, 5, 2),
    mass(finish, 14, 10, 4, 5, 2),
    mass(finish, 8, 16, 8, 4, 1),
  ]);

/** Body, neck, head, diamond horn, legs — unicorn, narwhal. */
export const horn = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "landscape", [
    mass(finish, 4, 11, 11, 6, 3),
    mass(finish, 13, 8, 4, 5, 2),
    "circle 17,8 r2.5",
    ...lozenge(finish, 19, 4.5, 2),
    vbar(finish, 7, 17, 3),
    vbar(finish, 12, 17, 3),
    hbar(finish, 3, 13, 2),
  ]);

/** Cap, stem, spots — mushroom, toadstool. */
export const mushroom = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 5, 5, 14, 7, 3),
    mass(finish, 10, 12, 4, 6, 1),
    "dot 8,8 floating",
    "dot 13,7 floating",
    hbar(finish, 6, 19, 12),
  ]);

/** Two bulbs and a waist — hourglass, sandglass. */
export const hourglass = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 6, 3, 12, 6, 1),
    mass(finish, 9, 9, 6, 6, 1),
    mass(finish, 6, 15, 12, 6, 1),
  ]);

/** Hull, mast, sail — sailboat, yacht. */
export const sailboat = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "landscape", [
    mass(finish, 4, 16, 16, 4, 2),
    vbar(finish, 12, 5, 11),
    mass(finish, 13, 6, 6, 8, 1),
  ]);

/**
 * Place the vocabulary marks whose names share a token with the query.
 * Named anchors only — the model never emits a coordinate. Null when no
 * named part answers, so a provenance-only hit does not become a drawing.
 */
export const composeFromParts = (
  slug: string,
  parts: readonly Part[],
  finish: Finish = "outlined"
): string | null => {
  const want = tokens(slug);
  const named = rankParts(parts, slug, 3).filter(
    (m) => overlap(tokens(m.part.name ?? ""), want) > 0
  );
  if (named.length === 0) {
    return null;
  }
  const ops = named.slice(0, 3).map((m, i) => {
    const address = m.part.name ?? m.part.id;
    let anchor = "bottom";
    if (i === 0) {
      anchor = "center";
    } else if (i === 1) {
      anchor = "top";
    }
    return `part ${address} at ${anchor} size 12`;
  });
  return iconProgram(slug, finish, "square", ops);
};

/** Names that are a pile of rims, not a tree. Whole tokens, not `data`. */
export const STACK_HINT =
  /\b(?:beaker|cylinder|database|drum|server|storage|trays?)\b/iu;
/** Names that are a connected tree. `org-chart` hits `org`. */
export const HUB_HINT = /\b(?:graph|hierarchy|network|org|sitemap|tree)\b/iu;
export const TOWER_HINT = /\b(?:lighthouse|beacon|tower|minaret|obelisk)\b/iu;
export const PEAK_HINT = /\b(?:mountain|peak|pyramid|summit)\b/iu;
export const VOLCANO_HINT = /\b(?:volcano|eruption)\b/iu;
export const TUBE_HINT = /\b(?:telescope|spyglass|binoculars)\b/iu;
export const PLANT_HINT = /\b(?:cactus|succulent|aloe|saguaro)\b/iu;
export const HORN_HINT = /\b(?:unicorn|narwhal)\b/iu;
export const MUSHROOM_HINT = /\b(?:mushroom|toadstool|fungi)\b/iu;
export const HOURGLASS_HINT = /\b(?:hourglass|sandglass)\b/iu;
export const SAILBOAT_HINT = /\b(?:sailboat|yacht|skiff)\b/iu;

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
 * in, the hinted family, then stack (if the rim exists), trays, hub. Without
 * one, a name token picks a family, else a house kin, else composeFromParts,
 * else hub. A cylinder name stays `stack` / `trays` so `database` does not become
 * a retitled `server` when no kin file exists.
 *
 * `glyphs.ts` is deliberately not consulted here. A revision that put it first
 * returned the host construction alone for any name that had one, which meant
 * analog stopped collating its own families for exactly the concepts somebody
 * had already hand-drawn — and made a set of ten of them look like ten analog
 * draws in the record. A host form is a thing to ask for by name
 * (`unkeyed: "glyph"`), not a thing another arm quietly answers with.
 */
const familyOf = (
  slug: string,
  text: string,
  finish: Finish
): { id: string; source: string } | null => {
  if (TOWER_HINT.test(text)) {
    return { id: "tower", source: tower(slug, finish) };
  }
  if (VOLCANO_HINT.test(text)) {
    return { id: "volcano", source: volcano(slug, finish) };
  }
  if (PEAK_HINT.test(text)) {
    return { id: "peak", source: peak(slug, finish) };
  }
  if (TUBE_HINT.test(text)) {
    return { id: "tube", source: tube(slug, finish) };
  }
  if (PLANT_HINT.test(text)) {
    return { id: "plant", source: plant(slug, finish) };
  }
  if (HORN_HINT.test(text)) {
    return { id: "horn", source: horn(slug, finish) };
  }
  if (MUSHROOM_HINT.test(text)) {
    return { id: "mushroom", source: mushroom(slug, finish) };
  }
  if (HOURGLASS_HINT.test(text)) {
    return { id: "hourglass", source: hourglass(slug, finish) };
  }
  if (SAILBOAT_HINT.test(text)) {
    return { id: "sailboat", source: sailboat(slug, finish) };
  }
  if (HUB_HINT.test(text)) {
    return { id: "hub", source: hub(slug, 3, finish) };
  }
  return null;
};

export const analogConstructions = (
  slug: string,
  parts: readonly Part[],
  text: string,
  collide: boolean,
  neighbor?: AnalogNeighbor,
  finish: Finish = "outlined"
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
  const family = familyOf(slug, text, finish);
  if (collide) {
    const out: { extras?: Part[]; id: string; source: string }[] = [
      ...replayed,
    ];
    if (family !== null) {
      out.push(family);
    }
    if (hasStackRim(parts)) {
      out.push({ id: "stack", source: stack(slug, parts, 3, finish) });
    }
    out.push(
      { id: "trays", source: trays(slug, finish) },
      { id: "hub", source: hub(slug, 3, finish) }
    );
    return out.filter(
      (row, i, all) => all.findIndex((r) => r.id === row.id) === i
    );
  }
  if (STACK_HINT.test(text)) {
    return hasStackRim(parts)
      ? [{ id: "stack", source: stack(slug, parts, 3, finish) }]
      : [{ id: "trays", source: trays(slug, finish) }];
  }
  if (family !== null) {
    return [family];
  }
  if (replayed.length > 0) {
    return replayed;
  }
  const composed = composeFromParts(slug, parts, finish);
  if (composed !== null) {
    return [{ id: "compose", source: composed }];
  }
  return [{ id: "hub", source: hub(slug, 3, finish) }];
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
  const drawn = runDsl(source, [...parts], spec ? { spec } : {});
  const issues: Issue[] = [
    ...drawn.errors.map((message) => ({
      message,
      rule: "dsl",
      severity: "error" as const,
    })),
    ...lint(drawn.canvas, { keyline: drawn.keyline }),
  ];
  const trace = traceOf(source);
  return {
    clean: issues.every((i) => i.severity !== "error"),
    doc: drawn.canvas.toJSON({
      icon: drawn.icon ?? slug,
      keyline: drawn.keyline,
    }),
    issues,
    program: source,
    steps: trace.length,
    svg: drawn.canvas.toSVG(),
    trace,
  };
};

/**
 * Unkeyed DRAW as a `GenerateFn`.
 *
 * No model. A look, when the caller passed `ask`, collides the catalog and
 * keeps the construction the vision scores as the named object. Without a
 * look, a name hint picks one construction so `database` is trays and
 * `unicorn` is a horn rather than both.
 */
export const analogArm =
  (): GenerateLike =>
  async (concept, options = {}) => {
    const parts = options.parts ?? [];
    const finish = options.finish ?? "outlined";
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
      neighbor,
      finish
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
          finish,
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
          extras: best.extras,
          text: brief,
        };
      }
    }
    const brief = analogBrief(chosen.id, concept.name, options.analogOf);
    return { ...chosen.result, brief, extras: chosen.extras, text: brief };
  };
