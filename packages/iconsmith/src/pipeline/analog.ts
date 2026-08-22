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
 * not import `corpus/`. Beyond stack / trays / hub, name *tokens* pick an
 * existing family: `office-mail` is envelope because `mail` is already a kin,
 * not because a new drawing was written. Two different families in one name
 * stay `unknown` — overlaying them is not the named object. A leftover hub
 * word (`tree-house`) is not an org chart. Glyph slugs stay unvolunteered.
 * A paint recipe that can fire must resolve to a family in both paints —
 * `checkmark` draws the house check, not unknown. `home` draws the house
 * pentagon, not a frame-and-dot. `heart` draws the closed lobes, not
 * three circles or a disc. `shield` draws the heater, not a diamond
 * with a cap. `zap` draws the bolt, not a frame-and-dot. Pause, play,
 * chevron, arrow, bookmark, share, airdrop, and airplane resolve the
 * same way — recipe tokens, no kin row. Lantern, otter, and paper-plane
 * are net-new families: no house file, no kin row. Analog must not
 * volunteer a star. The composer writes the program. The model does
 * not. `construct` in the generate loop adopts that program.
 */
import type { Canvas, Spec } from "../tools/canvas.js";
import { declareKeyline } from "../tools/declare.js";
import { run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import {
  frame,
  hbar,
  lozenge,
  mass,
  program as iconProgram,
  ring as paintRing,
  vbar,
} from "../tools/twin.js";
import type { Finish, Issue, Part } from "../types.js";
import { audit } from "./audit.js";
import type { GenerateResult } from "./generate.js";
import type { GenerateLike } from "./harness.js";
import { pairPrograms } from "./pair.js";
import { holdoutBrief, recipeFor } from "./recipe.js";
import { compileIcon } from "./reconstruct.js";
import { overlap, tokens } from "./search.js";

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

/** Lantern room, one beam pair, a shaft, footing.
 *  Under the 8-element ceiling; shaft meets lantern and footing.
 */
export const tower = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    ...frame(finish, 9, 3, 6, 5, 1),
    hbar(finish, 5, 5, 4),
    hbar(finish, 15, 5, 4),
    mass(finish, 9.5, 7, 5, 11, 1),
    mass(finish, 5, 18, 14, 3, 1),
  ]);

/** A mountain range: a 45° peak and a shoulder. Square so `fit` cannot shear. */
export const peak = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    ...lozenge(finish, 12, 12, 8),
    ...lozenge(finish, 8, 16, 3),
  ]);

/** One peak, a crater, and smoke inside the tip — volcano, not a range. */
export const volcano = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    ...lozenge(finish, 12, 12, 8),
    "circle 12,6 r1.5",
    "dot 10,5 terminal",
    "dot 12,4.5 terminal",
    "dot 14,5 terminal",
  ]);

/** Eyepiece, barrel, objective, tripod. Wide 20×16 — the tube is not landscape-tall.
 *  Barrel meets the objective ring so a 0.3px almost-touch cannot warn. */
export const tube = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 3, 5, 6, 5, 1),
    mass(finish, 6, 4, 13, 7, 2),
    ...paintRing(finish, 18, 7.5, 3),
    vbar(finish, 8, 10, 8),
    vbar(finish, 15, 10, 8),
    hbar(finish, 8, 10, 7),
  ]);

/** Saguaro: trunk and two arms that meet it, a pot.
 *  Separate pad discs sat 0.02px off the arms after `fit` and warned. */
export const plant = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 10, 2, 4, 14, 2),
    mass(finish, 5, 7, 5, 4, 2),
    mass(finish, 14, 9, 5, 4, 2),
    mass(finish, 5, 16, 14, 4, 1),
  ]);

/** Horse body, neck, head, a 45° diamond horn, legs.
 *  The filled head grows by half a stroke so the outer edge is the outlined
 *  ink (`diamond` already pads itself). The horn sits in the forehead so it
 *  cannot almost-touch the neck. Square so the horn stays on 45° after `fit`. */
export const horn = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    mass(finish, 4, 12, 13, 6, 3),
    mass(finish, 11, 8, 7, 9, 2),
    finish === "filled" ? "circle 17,8 r4.5" : "circle 17,8 r3.5",
    ...lozenge(finish, 18, 6.5, 3),
    vbar(finish, 7, 15, 5),
    vbar(finish, 13, 15, 5),
  ]);

/** Dome cap, stem, spots — the mushroom, not a rounded tray.
 *  Filled has no stroke, so the cap grows by half a stroke to keep tall. */
export const mushroom = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    finish === "filled" ? "circle 12,9 r8" : "circle 12,9 r7",
    mass(finish, 10, 16, 4, 4, 1),
    "dot 8,7 floating",
    "dot 15,8 floating",
  ]);

/** Two 45° triangles meeting at a pinch — the readable hourglass, on square. */
export const hourglass = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    hbar(finish, 4, 4, 16),
    "line 4,4 20,20 off-axis",
    "line 20,4 4,20 off-axis",
    hbar(finish, 4, 20, 16),
  ]);

/** Two stacked crescents — a banana thick enough to occupy wide 20×16.
 *  A filled half-arc does not hang a stroke below its diameter, so the
 *  lower crescent sits one unit lower under fill and both paints occupy
 *  20×16 before `fit`. */
export const banana = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    "arc 12,11 r9 half from left",
    finish === "filled"
      ? "arc 12,17 r9 half from left"
      : "arc 12,16 r9 half from left",
  ]);

/** Fruit, calyx, seeds — kiwi, not a cookie glyph.
 *  Calyx sits on the fruit so the 0.46px almost-touch cannot warn. */
export const kiwi = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    finish === "filled" ? "circle 12,12 r9" : "circle 12,12 r8",
    vbar(finish, 12, 4, 4),
    mass(finish, 12, 4, 4, 3, 1),
    "dot 10,12 more",
    "dot 14,12 more",
    "dot 12,15 more",
  ]);

/** Body, anvil, hinge — stapler on wide 20×16. */
export const stapler = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 3, 5, 18, 6, 2),
    mass(finish, 3, 13, 18, 5, 1),
    vbar(finish, 5, 5, 8),
  ]);

/** Hull, mast, diamond sail. Square so the sail stays on 45°. */
export const sailboat = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    vbar(finish, 8, 4, 14),
    ...lozenge(finish, 14, 10, 6),
    mass(finish, 4, 16, 16, 4, 2),
  ]);

/** Rectangle and a V flap — envelope / mail. */
export const envelope = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    ...frame(finish, 3, 5, 18, 14, 2),
    "line 3,5 12,13 off-axis",
    "line 12,13 21,5 off-axis",
  ]);

/** Dome, skirt, clapper — a bell, not a hub. */
/**
 * House bell: outlined is the dome plus a seated clapper; filled is one
 * evenodd silhouette. Not a stack of discs and a terminal dot.
 */
export const bell = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "portrait", [
    mass(finish, 4, 3, 16, 14, 5),
    mass(finish, 8, 17, 8, 4, 2),
  ]);

/** A C-shaped crescent — moon, not a full disc. */
export const moon = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", ["arc 12,12 r8 three-quarter from top"]);

/**
 * House sun: a disc and eight short ticks at the compass points. Not four
 * long bars — those read as a plus, not rays.
 */
export const sun = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    finish === "filled" ? "circle 12,12 r6" : "circle 12,12 r5",
    "line 12,2 12,3",
    "line 12,21 12,22",
    "line 2,12 3,12",
    "line 21,12 22,12",
    "line 5,5 4,4 off-axis",
    "line 19,5 20,4 off-axis",
    "line 19,19 20,20 off-axis",
    "line 5,19 4,20 off-axis",
  ]);

/**
 * Two strokes crossing at the centre. House outlined plus-large is four
 * open strokes from the hub; filled is one evenodd compound. The bars
 * are the primitive form that occupies the same visual extent.
 */
export const plus = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    hbar(finish, 4, 12, 16),
    vbar(finish, 12, 4, 16),
  ]);

/**
 * A face and hands. House outlined is `circle 12,12 r9` plus a polyline;
 * filled is a solid disc with the hands cut out, hole immediately after
 * the disc — not a ring restamped as a disc.
 */
export const clock = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "circle",
    finish === "filled"
      ? ["circle 12,12 r10", "hole rect 11,7 2x6", "hole rect 12,11 5x2"]
      : ["circle 12,12 r9", "line 12,7 12,12 16,12"]
  );

/**
 * House check: outlined is the open tick (`M20 6 9 17l-5-5`); filled is a
 * badge disc with that tick cut out (evenodd). Not a thick tick, and not a
 * tick drawn on top of a disc. Recipe tokens (`check`, `tick`, `checkmark`)
 * resolve here — not a new kin row.
 */
export const check = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "wide",
    finish === "filled"
      ? ["rect 2,3 20x16 r4", "hole line 3,14 7,18 21,4"]
      : ["line 3,14 7,18 21,4"]
  );

/**
 * House lock: shackle, body, keyhole as separate strokes; filled is one
 * evenodd compound with each hole immediately after the solid it cuts.
 */
export const lock = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "tall",
    finish === "filled"
      ? [
          "rect 4,9 16x13 r4",
          "hole rect 11,13 2x5",
          "circle 12,7 r5",
          "hole circle 12,7 r3",
        ]
      : [
          "rect 5,10 14x11 r3",
          "arc 12,7 r4 half from left",
          "line 8,7 8,10",
          "line 16,7 16,10",
          "line 12,14 12,17",
        ]
  );

/** House ring: centre-line hoop, or `circle` then `hole circle` immediately. */
export const ring = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "circle", paintRing(finish, 12, 12, 9));

/**
 * House cloud: two overlapping blobs that share a baseline
 * (`circle 9,12` left, `circle 17,14` right). Three discs on `wide`
 * read as balloons, and `fit` onto 20×16 squashes the 22×16 silhouette
 * the house files actually occupy.
 */
export const cloud = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, null, [
    finish === "filled" ? "circle 9,12 r8" : "circle 9,12 r7",
    finish === "filled" ? "circle 17,14 r6" : "circle 17,14 r5",
  ]);

/**
 * House home: one pentagon, both paints. Outlined is the outer stroke
 * (peak and walls, no inner roof). Filled is the same silhouette — a
 * body mass with the roof diamond seated on the eaves, not a diamond
 * drawn through the walls. No door: the house files are a solid
 * pentagon. Portrait 18×20. The eaves sit high (y=8) so the roof
 * matches the house file rather than a tall A-frame.
 */
export const home = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "portrait",
    finish === "filled"
      ? [mass(finish, 4, 8, 16, 12, 1), ...lozenge(finish, 12, 8, 5)]
      : ["line 12,3 20,8 20,20 4,20 4,8 12,3 off-axis"]
  );

/**
 * House heart: compile of the blode file is one evenodd compound
 * (`part heart-0`). Outlined is that closed silhouette, not two arcs
 * or three circles. Filled is the same body — overlapping lobe masses
 * and a seated point — not a disc and not three circles restamped as
 * solids. Recipe tokens resolve here — not a new kin row.
 */
export const heart = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "landscape",
    finish === "filled"
      ? [
          mass(finish, 3, 4, 9, 8, 3),
          mass(finish, 12, 4, 9, 8, 3),
          ...lozenge(finish, 12, 13.5, 6.5),
        ]
      : ["line 8,4 3,8 3,11 12,20 21,11 21,8 16,4 12,6 8,4 off-axis"]
  );

/** Head and a diamond tip — map pin. Path 14×18 + stroke is tall 16×20. */
export const pin = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    finish === "filled" ? "circle 12,8 r8" : "circle 12,8 r7",
    ...lozenge(finish, 12, 15, 4),
  ]);

/** Pole and a fly — flag. */
export const flag = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    vbar(finish, 5, 3, 18),
    mass(finish, 5, 3, 14, 9, 1),
  ]);

/** Bow, shaft, bit — a key. Path 18×14 + stroke is wide 20×16. */
export const key = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    ...paintRing(finish, 7, 12, 6),
    hbar(finish, 13, 12, 6),
    vbar(finish, 17, 5, 14),
    vbar(finish, 19, 12, 5),
  ]);

/** Two leaves and a spine — a book. */
export const book = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    mass(finish, 4, 4, 7, 16, 1),
    mass(finish, 13, 4, 7, 16, 1),
    vbar(finish, 12, 4, 16),
  ]);

/** Body, lens, viewfinder — a camera. */
export const camera = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 3, 8, 18, 10, 2),
    ...paintRing(finish, 12, 13, 3),
    mass(finish, 7, 5, 5, 4, 1),
  ]);

/** Shaft, eraser, diamond tip — a pencil. */
export const pencil = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 5, 3, 14, 4, 1),
    mass(finish, 5, 7, 14, 8, 0.5),
    ...lozenge(finish, 12, 17, 4),
  ]);

/**
 * House shield: compile is one heater silhouette (`part shield-0`) on
 * portrait. Outlined is that closed outline — peaked top, sides, a
 * point — not a 45° diamond with a cap. Filled is the same body (a
 * mass seated on a diamond point). Recipe tokens resolve here.
 */
export const shield = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "portrait",
    finish === "filled"
      ? [mass(finish, 4, 4, 16, 11, 2), ...lozenge(finish, 12, 14, 8)]
      : ["line 12,3 20,7 20,13 12,21 4,13 4,7 12,3 off-axis"]
  );

/**
 * House zap: compile is one bolt silhouette (`part zap-0`). Outlined
 * is that closed zigzag, not a frame-and-dot. Filled is the same
 * lightning as three bars on the bolt's centre-lines. Recipe tokens
 * (`zap`, `lightning`) resolve here — not a new kin row.
 */
export const zap = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "portrait",
    finish === "filled"
      ? [
          "line 13,4 5,14 off-axis",
          "line 5,14 19,10 off-axis",
          "line 19,10 11,20 off-axis",
        ]
      : ["line 13,3 13,9 20,9 11,21 11,15 4,15 13,3 off-axis"]
  );

/**
 * House pause: two rounded uprights. Compile is those two bars in both
 * paints — not a frame-and-dot, and not one slab.
 */
export const pause = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "portrait", [
    mass(finish, 4, 3, 4, 18, 2),
    mass(finish, 16, 3, 4, 18, 2),
  ]);

/**
 * House play: a rounded-back triangle pointing right. Outlined is that
 * silhouette — a stadium back plus two edges to the point — not a
 * sharp chevron. Filled is the same marks; a closed polyline has no
 * inside under fill. No portrait `fit`: the body is 18×18, and
 * stretching it onto 18×20 is what dropped the house match.
 */
export const play = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, null, [
    mass(finish, 5, 4, 10, 16, 3),
    "line 15,4 21,12 off-axis",
    "line 21,12 15,20 off-axis",
  ]);

/**
 * House chevron-right: one open tick pointing right. Filled is that
 * stroke as two bars. `chevron-right` tokens to this family — not a kin row.
 */
export const chevron = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, null, [
    "line 9,6 15,12 off-axis",
    "line 15,12 9,18 off-axis",
  ]);

/**
 * House arrow-right: a shaft plus a chevron head. Filled is those three
 * bars (compile is one evenodd compound). `arrow-right` tokens here.
 */
export const arrow = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, null, [
    "line 5,12 19,12",
    "line 12,5 19,12 off-axis",
    "line 19,12 12,19 off-axis",
  ]);

/**
 * House bookmark: a tall ribbon with a V bite at the foot. Outlined is
 * that closed outline; filled is the body plus the two tails.
 */
export const bookmark = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 5, 3, 14, 14, 2),
    "line 5,17 12,21 off-axis",
    "line 19,17 12,21 off-axis",
  ]);

/**
 * House share: three nodes and two connectors. Filled is those discs
 * plus the bars (compile is one evenodd compound).
 */
export const share = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "circle", [
    "circle 18,5 r3",
    "circle 5,12 r3",
    "circle 18,19 r3",
    "line 15,7 8,11 off-axis",
    "line 8,13 15,17 off-axis",
  ]);

/**
 * House airdrop: a dome, two off-axis beams (`M4 11L11 16.5`), a stem,
 * and a seated capsule. Filled is the same marks as solids.
 */
export const airdrop = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "portrait", [
    "arc 12,11 r8 half from left",
    "line 4,11 11,16.5 off-axis",
    "line 13,16.5 20,11 off-axis",
    "line 12,11 12,16",
    mass(finish, 8, 17, 8, 4, 2),
  ]);

/**
 * House airplane: a jet silhouette pointing NE. Outlined is that
 * closed outline; filled is two-point bars on the same edges. A
 * handful of open ticks reads as a sketch, not the house path.
 */
export const airplane = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    null,
    finish === "filled"
      ? [
          "line 3,6 9.5,11 off-axis",
          "line 9.5,11 13.5,7 off-axis",
          "line 13.5,7 21,4 off-axis",
          "line 9.5,11 3,15.5 off-axis",
          "line 13,8 18,21 off-axis",
          "line 7.5,13 8.5,21 off-axis",
          "line 17,10.5 19.5,7.5 off-axis",
        ]
      : [
          "line 3,6 13.5,7 21,4 17,10.5 18,21 13,14 9.5,11 8.5,21 3,15.5 9.5,11 3,6 off-axis",
        ]
  );

/**
 * Net-new hanging lantern: handle, body, flame. No house file. Both
 * paints share the same masses so pairing stays clean.
 */
export const lantern = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    "arc 12,5 r5 half from left",
    mass(finish, 4, 7, 16, 13, 2),
    finish === "filled" ? "circle 12,14 r2.5" : "circle 12,14 r2",
  ]);

/**
 * Net-new otter: head, body, tail. No house file. Two-point tail so
 * filled paint is a bar, not a closed polyline.
 */
export const otter = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, null, [
    mass(finish, 2, 6, 8, 8, 4),
    mass(finish, 7, 6, 12, 10, 3),
    "line 18,14 21,18 off-axis",
  ]);

/**
 * Net-new paper plane: a dart, not a jet. `paper-plane` must not fall
 * through to airplane via `plane`. Outlined is the closed silhouette;
 * filled is those edges as two-point bars.
 */
export const paperplane = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(
    slug,
    finish,
    "wide",
    finish === "filled"
      ? [
          "line 4,12 20,6 off-axis",
          "line 20,6 13,12 off-axis",
          "line 13,12 20,18 off-axis",
          "line 20,18 4,12 off-axis",
        ]
      : ["line 4,12 20,6 13,12 20,18 4,12 off-axis"]
  );

/** Neck and a diamond body — a flask, not a beaker stack. */
export const flask = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 10, 3, 4, 6, 1),
    ...lozenge(finish, 12, 15, 8),
  ]);

/** Blade and a stem — a leaf. */
export const leaf = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    ...lozenge(finish, 12, 12, 8),
    vbar(finish, 12, 18, 2),
  ]);

/** Fruit and a leaf — apple, no seeds (those are kiwi). */
export const apple = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    finish === "filled" ? "circle 12,12 r9" : "circle 12,12 r8",
    vbar(finish, 12, 4, 3),
    mass(finish, 13, 4, 4, 2.5, 1),
  ]);

/** Nose, body, fins — a rocket. Path 14×18 + stroke is tall 16×20. */
export const rocket = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    ...lozenge(finish, 12, 6, 3),
    mass(finish, 8, 8, 8, 9, 2),
    mass(finish, 5, 15, 5, 6, 1),
    mass(finish, 14, 15, 5, 6, 1),
  ]);

/** Diamond fly and a floor — a tent. */
export const tent = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    ...lozenge(finish, 12, 10, 8),
    hbar(finish, 4, 18, 16),
  ]);

/** Body, tail, eye — a fish. */
export const fish = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 3, 5, 12, 14, 5),
    ...lozenge(finish, 17, 12, 4),
    "circle 8,11 r1",
  ]);

/** Cabin, body, wheels — a car. */
export const car = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "wide", [
    mass(finish, 7, 5, 10, 5, 1),
    mass(finish, 3, 8, 18, 7, 2),
    finish === "filled" ? "circle 8,17 r3" : "circle 8,17 r2",
    finish === "filled" ? "circle 16,17 r3" : "circle 16,17 r2",
  ]);

/** Cup, handles, stem, base — a trophy. */
export const trophy = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 5, 3, 14, 7, 3),
    hbar(finish, 5, 6, 3),
    hbar(finish, 16, 6, 3),
    vbar(finish, 12, 10, 8),
    mass(finish, 5, 18, 14, 3, 1),
  ]);

/** Head and a handle — a hammer. */
export const hammer = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    mass(finish, 4, 6, 14, 5, 1),
    vbar(finish, 8, 11, 10),
  ]);

/** Rails and rungs — a ladder. */
export const ladder = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    vbar(finish, 5, 3, 18),
    vbar(finish, 19, 3, 18),
    hbar(finish, 5, 7, 14),
    hbar(finish, 5, 12, 14),
    hbar(finish, 5, 17, 14),
  ]);

/** Two legs joined at the foot — a horseshoe magnet. */
export const magnet = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    mass(finish, 4, 4, 4, 13, 1),
    mass(finish, 16, 4, 4, 13, 1),
    mass(finish, 4, 14, 16, 6, 2),
  ]);

/** Ring, shank, flukes — an anchor. Path 14×18 + stroke is tall 16×20. */
export const anchor = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    ...paintRing(finish, 12, 6, 3),
    vbar(finish, 12, 9, 7),
    hbar(finish, 5, 16, 14),
    ...lozenge(finish, 12, 18, 3),
  ]);

/** Bowl, stem, foot — a wine glass. */
export const wine = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "tall", [
    mass(finish, 7, 3, 10, 8, 3),
    vbar(finish, 12, 11, 6),
    hbar(finish, 6, 18, 12),
  ]);

/** Centre and four petals — a flower. */
export const flower = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    "circle 12,6 r3.5",
    "circle 18,12 r3.5",
    "circle 12,18 r3.5",
    "circle 6,12 r3.5",
    finish === "filled" ? "circle 12,12 r3.5" : "circle 12,12 r3",
  ]);

/**
 * A framed mark with a centre node. The honest drawing when no token, kin,
 * or named part answers — not a hub, which is an org chart.
 */
export const unknown = (slug: string, finish: Finish = "outlined"): string =>
  iconProgram(slug, finish, "square", [
    ...frame(finish, 4, 4, 16, 16, 2),
    "dot 12,12 node",
  ]);

/** `bananas` answers a part named `banana`. Shorter than four letters is
 *  a preposition, not a stem. */
const sameStem = (query: string, name: string): boolean => {
  const q = tokens(query).join("");
  const n = tokens(name).join("");
  if (q.length < 4 || n.length < 4) {
    return false;
  }
  if (q === n) {
    return true;
  }
  return q === `${n}s` || n === `${q}s` || q === `${n}es` || n === `${q}es`;
};

const FAMILY_DRAW = {
  airdrop,
  airplane,
  anchor,
  apple,
  arrow,
  banana,
  bell,
  book,
  bookmark,
  camera,
  car,
  check,
  chevron,
  clock,
  cloud,
  envelope,
  fish,
  flag,
  flask,
  flower,
  hammer,
  heart,
  home,
  horn,
  hourglass,
  key,
  kiwi,
  ladder,
  lantern,
  leaf,
  lock,
  magnet,
  moon,
  mushroom,
  otter,
  paperplane,
  pause,
  peak,
  pencil,
  pin,
  plant,
  play,
  plus,
  ring,
  rocket,
  sailboat,
  share,
  shield,
  stapler,
  sun,
  tent,
  tower,
  trophy,
  tube,
  volcano,
  wine,
  zap,
} as const;

export type AnalogFamilyId = keyof typeof FAMILY_DRAW;

/**
 * Ordinary names and synonyms → a family id, so analog and composeFromParts
 * resolve offline without a corpus extract. Glyph slugs are deliberately
 * absent: analog must not volunteer those.
 */
export const ANALOG_KINS: Readonly<Record<string, AnalogFamilyId>> = {
  aloe: "plant",
  beacon: "tower",
  binoculars: "tube",
  cactus: "plant",
  champagne: "wine",
  crescent: "moon",
  "e-mail": "envelope",
  email: "envelope",
  eruption: "volcano",
  fungi: "mushroom",
  glass: "wine",
  goblet: "wine",
  keys: "key",
  kiwifruit: "kiwi",
  letter: "envelope",
  lighthouse: "tower",
  location: "pin",
  mail: "envelope",
  "map-pin": "pin",
  marker: "pin",
  minaret: "tower",
  mountain: "peak",
  narwhal: "horn",
  notification: "bell",
  obelisk: "tower",
  plantain: "banana",
  pushpin: "pin",
  pyramid: "peak",
  saguaro: "plant",
  sandglass: "hourglass",
  skiff: "sailboat",
  spyglass: "tube",
  "staple-gun": "stapler",
  succulent: "plant",
  summit: "peak",
  telescope: "tube",
  toadstool: "mushroom",
  unicorn: "horn",
  "wine-glass": "wine",
  yacht: "sailboat",
};

/** Synonym → family token. Same table as {@link ANALOG_KINS}. */
export const ANALOG_ALIASES: Readonly<Record<string, AnalogFamilyId>> =
  ANALOG_KINS;

/**
 * Icon-set noise, not a concept. `mail-icon` is mail; the composer strips
 * these so a new compound does not need a new kin row.
 */
export const ANALOG_MODIFIERS: ReadonlySet<string> = new Set([
  "alt",
  "app",
  "filled",
  "icon",
  "image",
  "large",
  "logo",
  "mark",
  "new",
  "outline",
  "outlined",
  "small",
  "solid",
  "symbol",
]);

/**
 * Glyph slugs analog must not volunteer. Restated here so this module does
 * not import `glyphs.ts` — a host form is asked for by name.
 */
const UNVOLUNTEERED = new Set([
  "briefcase",
  "cake",
  "compass",
  "cookie",
  "database",
  "fingerprint",
  "microscope",
  "strikethrough",
  "umbrella",
  "wifi",
]);

/** Words that *are* a connected tree. `chart` only counts next to one of these. */
const HUB_TOKENS = new Set([
  "chart",
  "graph",
  "hierarchy",
  "network",
  "org",
  "sitemap",
  "tree",
]);

/** Tokens that can name a concept. Digits and {@link ANALOG_MODIFIERS} drop. */
export const contentTokens = (...parts: readonly string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const token of tokens(part)) {
      if (
        /^\d+$/u.test(token) ||
        ANALOG_MODIFIERS.has(token) ||
        seen.has(token)
      ) {
        continue;
      }
      seen.add(token);
      out.push(token);
    }
  }
  return out;
};

/**
 * One token → a family already in this module, or null.
 * Exact family id, exact kin, or a plural stem. No substring (`mailbox`
 * is not mail; that would volunteer a family the name did not ask for).
 */
/** Recipe id → family, when that construction exists. One table, both paints. */
const familyFromRecipe = (query: string): AnalogFamilyId | null => {
  const recipe = recipeFor(query);
  if (recipe !== null && Object.hasOwn(FAMILY_DRAW, recipe.id)) {
    return recipe.id as AnalogFamilyId;
  }
  return null;
};

export const familyFromToken = (token: string): AnalogFamilyId | null => {
  if (token.length < 3 || UNVOLUNTEERED.has(token)) {
    return null;
  }
  if (Object.hasOwn(FAMILY_DRAW, token)) {
    return token as AnalogFamilyId;
  }
  const fromRecipe = familyFromRecipe(token);
  if (fromRecipe !== null) {
    return fromRecipe;
  }
  const kin = ANALOG_KINS[token];
  if (kin !== undefined) {
    return kin;
  }
  for (const id of Object.keys(FAMILY_DRAW) as AnalogFamilyId[]) {
    if (sameStem(token, id)) {
      return id;
    }
  }
  for (const [name, id] of Object.entries(ANALOG_KINS)) {
    if (sameStem(token, name)) {
      return id;
    }
  }
  return null;
};

/**
 * Unique family named by the content tokens, or null.
 * Two different families (`flag-mail`) is not a composition we can draw
 * honestly — unknown, not a pick. A glyph token blocks a volunteer.
 */
export const familyFromTokens = (
  ...parts: readonly string[]
): AnalogFamilyId | null => {
  const found = new Set<AnalogFamilyId>();
  let glyph = false;
  for (const token of contentTokens(...parts)) {
    if (UNVOLUNTEERED.has(token)) {
      glyph = true;
      continue;
    }
    const id = familyFromToken(token);
    if (id !== null) {
      found.add(id);
    }
  }
  if (glyph || found.size !== 1) {
    return null;
  }
  return [...found][0] ?? null;
};

const isHubName = (...parts: readonly string[]): boolean => {
  const found = contentTokens(...parts);
  if (found.length === 0) {
    return false;
  }
  return found.every((token) => HUB_TOKENS.has(token));
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
export const BANANA_HINT = /\b(?:bananas?|plantain)\b/iu;
export const KIWI_HINT = /\b(?:kiwi|kiwifruit)\b/iu;
export const STAPLER_HINT = /\b(?:staplers?|staple-gun)\b/iu;
export const ENVELOPE_HINT = /\b(?:envelopes?|mails?|letters?|e-?mails?)\b/iu;
export const BELL_HINT = /\b(?:bells?|notification)\b/iu;
export const MOON_HINT = /\b(?:moons?|crescent)\b/iu;
export const SUN_HINT = /\b(?:suns?)\b/iu;
export const CLOUD_HINT = /\b(?:clouds?)\b/iu;
export const HEART_HINT = /\b(?:hearts?)\b/iu;
export const HOME_HINT = /\bhomes?\b/iu;
export const PIN_HINT = /\b(?:pins?|map-pin|location|pushpin|marker)\b/iu;
export const FLAG_HINT = /\b(?:flags?)\b/iu;
export const KEY_HINT = /\b(?:keys?)\b/iu;
export const BOOK_HINT = /\b(?:books?)\b/iu;
export const CAMERA_HINT = /\b(?:cameras?)\b/iu;
export const PENCIL_HINT = /\b(?:pencils?)\b/iu;
export const SHIELD_HINT = /\b(?:shields?)\b/iu;
export const FLASK_HINT = /\b(?:flasks?)\b/iu;
export const LEAF_HINT = /\b(?:leaf|leaves)\b/iu;
export const APPLE_HINT = /\b(?:apples?)\b/iu;
export const ROCKET_HINT = /\b(?:rockets?)\b/iu;
export const TENT_HINT = /\b(?:tents?)\b/iu;
export const FISH_HINT = /\b(?:fish(?:es)?)\b/iu;
export const CAR_HINT = /\b(?:cars?)\b/iu;
export const TROPHY_HINT = /\b(?:troph(?:y|ies))\b/iu;
export const HAMMER_HINT = /\b(?:hammers?)\b/iu;
export const LADDER_HINT = /\b(?:ladders?)\b/iu;
export const MAGNET_HINT = /\b(?:magnets?)\b/iu;
export const ANCHOR_HINT = /\b(?:anchors?)\b/iu;
export const WINE_HINT =
  /\b(?:wines?|goblets?|wine-glass|champagne|glasses)\b/iu;
export const FLOWER_HINT = /\b(?:flowers?)\b/iu;
export const PLUS_HINT = /\b(?:plus)\b/iu;
export const CLOCK_HINT = /\b(?:clocks?)\b/iu;
export const ZAP_HINT = /\b(?:zaps?|lightning)\b/iu;
export const PAUSE_HINT = /\b(?:pause|pauses)\b/iu;
export const PLAY_HINT = /\b(?:play|plays)\b/iu;
export const CHEVRON_HINT = /\b(?:chevrons?)\b/iu;
export const ARROW_HINT = /\b(?:arrows?)\b/iu;
export const BOOKMARK_HINT = /\b(?:bookmarks?)\b/iu;
export const SHARE_HINT = /\b(?:shares?)\b/iu;
export const AIRDROP_HINT = /\b(?:airdrops?)\b/iu;
export const PAPER_PLANE_HINT = /\bpaper[- ]?planes?\b/iu;
export const LANTERN_HINT = /\b(?:lanterns?)\b/iu;
export const OTTER_HINT = /\b(?:otters?)\b/iu;
export const AIRPLANE_HINT = /\b(?:airplanes?|aeroplanes?|planes?)\b/iu;

const FAMILY_HINTS: readonly { hint: RegExp; id: AnalogFamilyId }[] = [
  { hint: TOWER_HINT, id: "tower" },
  { hint: VOLCANO_HINT, id: "volcano" },
  { hint: PEAK_HINT, id: "peak" },
  { hint: TUBE_HINT, id: "tube" },
  { hint: PLANT_HINT, id: "plant" },
  { hint: HORN_HINT, id: "horn" },
  { hint: MUSHROOM_HINT, id: "mushroom" },
  { hint: HOURGLASS_HINT, id: "hourglass" },
  { hint: SAILBOAT_HINT, id: "sailboat" },
  { hint: BANANA_HINT, id: "banana" },
  { hint: KIWI_HINT, id: "kiwi" },
  { hint: STAPLER_HINT, id: "stapler" },
  { hint: ENVELOPE_HINT, id: "envelope" },
  { hint: BELL_HINT, id: "bell" },
  { hint: MOON_HINT, id: "moon" },
  { hint: SUN_HINT, id: "sun" },
  { hint: CLOUD_HINT, id: "cloud" },
  { hint: HEART_HINT, id: "heart" },
  { hint: HOME_HINT, id: "home" },
  { hint: PIN_HINT, id: "pin" },
  { hint: FLAG_HINT, id: "flag" },
  { hint: KEY_HINT, id: "key" },
  { hint: BOOK_HINT, id: "book" },
  { hint: CAMERA_HINT, id: "camera" },
  { hint: PENCIL_HINT, id: "pencil" },
  { hint: SHIELD_HINT, id: "shield" },
  { hint: FLASK_HINT, id: "flask" },
  { hint: LEAF_HINT, id: "leaf" },
  { hint: APPLE_HINT, id: "apple" },
  { hint: ROCKET_HINT, id: "rocket" },
  { hint: TENT_HINT, id: "tent" },
  { hint: FISH_HINT, id: "fish" },
  { hint: CAR_HINT, id: "car" },
  { hint: TROPHY_HINT, id: "trophy" },
  { hint: HAMMER_HINT, id: "hammer" },
  { hint: LADDER_HINT, id: "ladder" },
  { hint: MAGNET_HINT, id: "magnet" },
  { hint: ANCHOR_HINT, id: "anchor" },
  { hint: WINE_HINT, id: "wine" },
  { hint: FLOWER_HINT, id: "flower" },
  { hint: PLUS_HINT, id: "plus" },
  { hint: CLOCK_HINT, id: "clock" },
  { hint: ZAP_HINT, id: "zap" },
  { hint: PAUSE_HINT, id: "pause" },
  { hint: PLAY_HINT, id: "play" },
  { hint: CHEVRON_HINT, id: "chevron" },
  { hint: ARROW_HINT, id: "arrow" },
  { hint: BOOKMARK_HINT, id: "bookmark" },
  { hint: SHARE_HINT, id: "share" },
  { hint: AIRDROP_HINT, id: "airdrop" },
  { hint: PAPER_PLANE_HINT, id: "paperplane" },
  { hint: LANTERN_HINT, id: "lantern" },
  { hint: OTTER_HINT, id: "otter" },
  { hint: AIRPLANE_HINT, id: "airplane" },
];

const resolveFamilyId = (slug: string, text: string): AnalogFamilyId | null => {
  const asked = familyFromRecipe(slug);
  if (asked !== null) {
    return asked;
  }
  const kin = ANALOG_KINS[slug];
  if (kin !== undefined) {
    return kin;
  }
  for (const id of Object.keys(FAMILY_DRAW) as AnalogFamilyId[]) {
    if (sameStem(slug, id)) {
      return id;
    }
  }
  for (const [name, id] of Object.entries(ANALOG_KINS)) {
    if (sameStem(slug, name)) {
      return id;
    }
  }
  const fromTokens = familyFromTokens(slug, text);
  if (fromTokens !== null) {
    return fromTokens;
  }
  const named = contentTokens(slug, text);
  const families = new Set<AnalogFamilyId>();
  let glyph = false;
  for (const token of named) {
    if (UNVOLUNTEERED.has(token)) {
      glyph = true;
    }
    const id = familyFromToken(token);
    if (id !== null) {
      families.add(id);
    }
  }
  if (glyph || families.size > 1) {
    return null;
  }
  for (const { hint, id } of FAMILY_HINTS) {
    if (hint.test(text)) {
      return id;
    }
  }
  return null;
};

/**
 * Place the vocabulary marks whose names share a token, a plural stem, or
 * a token-resolved family with the query. Named anchors only — the model
 * never emits a coordinate. `office-mail` reaches a part named `envelope`
 * because `mail` already names that family. When the extract is empty, the
 * same token walk returns that family's program. Null when the tokens name
 * nothing, or name two families, or a glyph.
 */
export const composeFromParts = (
  slug: string,
  parts: readonly Part[],
  finish: Finish = "outlined"
): string | null => {
  const want = contentTokens(slug);
  const extra: AnalogFamilyId[] = [];
  for (const token of want) {
    const id = familyFromToken(token);
    if (id !== null && !want.includes(id) && !extra.includes(id)) {
      extra.push(id);
    }
  }
  want.push(...extra);
  const named = parts.filter((p) => {
    const name = p.name ?? "";
    const alias = ANALOG_KINS[slug] ?? "";
    return (
      name.length > 0 &&
      (overlap(tokens(name), want) > 0 ||
        sameStem(slug, name) ||
        want.some((token) => sameStem(token, name)) ||
        (alias.length > 0 && sameStem(alias, name)))
    );
  });
  if (named.length > 0) {
    // House compile of a named silhouette is one `part … fill`, not a
    // stack of three marks at arbitrary anchors. The model never emits
    // a coordinate; `fill` is the canvas scaling to the keyline.
    const address = named[0]?.name ?? named[0]?.id;
    if (!address) {
      return null;
    }
    return iconProgram(slug, finish, "square", [`part ${address} fill`]);
  }
  if (parts.length === 0) {
    const id = resolveFamilyId(slug, slug);
    if (id !== null) {
      return FAMILY_DRAW[id](slug, finish);
    }
  }
  return null;
};

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
 * else unknown. Hub is only a family, for graph / tree / org. A cylinder name
 * stays `stack` / `trays` so `database` does not become a retitled `server`
 * when no kin file exists.
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
  const id = resolveFamilyId(slug, text);
  if (id !== null) {
    return { id, source: FAMILY_DRAW[id](slug, finish) };
  }
  if (isHubName(slug, text)) {
    return { id: "hub", source: hub(slug, 3, finish) };
  }
  return null;
};

/**
 * The host analog the generate loop may adopt. A holdout (`star`) and
 * an honest unknown stay null — `construct` must not place a
 * frame-and-dot as if it were the named object.
 */
export const hostConstruction = (
  query: string,
  finish: Finish = "outlined"
): { id: string; source: string } | null => {
  if (holdoutBrief(query) !== null) {
    return null;
  }
  return familyOf(query, query, finish);
};

/** Write the host analog onto a generate canvas. Coordinates stay in analog. */
export const adoptHost = (
  canvas: Canvas,
  query: string,
  finish: Finish = "outlined",
  parts: readonly Part[] = [],
  spec?: Spec
): { family: string; placed: number } => {
  const host = hostConstruction(query, finish);
  if (!host) {
    throw new Error(
      `no host analog for "${query}" — compose it from listParts and primitives`
    );
  }
  const drawn = runDsl(host.source, [...parts], spec ? { spec } : {});
  if (drawn.errors.length > 0) {
    throw new Error(drawn.errors.join("; "));
  }
  canvas.clear();
  canvas.elements.push(...drawn.canvas.elements);
  return { family: host.id, placed: canvas.elements.length };
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
  return [{ id: "unknown", source: unknown(slug, finish) }];
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

/** Replay compiles one paint; families write both. Pair the counterpart. */
const withPair = (
  result: Omit<GenerateResult, "text"> & { text?: string },
  id: string,
  extras: readonly Part[] | undefined,
  slug: string,
  parts: readonly Part[],
  text: string,
  collide: boolean,
  neighbor: AnalogNeighbor | undefined,
  finish: Finish,
  spec?: Spec
): Omit<GenerateResult, "text"> & { text?: string } => {
  if (id === "replay" || result.program === undefined) {
    return result;
  }
  const want = finish === "filled" ? "outlined" : "filled";
  const other = analogConstructions(
    slug,
    parts,
    text,
    collide,
    neighbor,
    want
  ).find((row) => row.id === id);
  if (other === undefined) {
    return result;
  }
  const issues = pairPrograms(
    result.issues,
    finish,
    result.program,
    other.source,
    [...parts, ...(extras ?? []), ...(other.extras ?? [])],
    spec
  );
  return {
    ...result,
    clean: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
};

/**
 * Unkeyed DRAW as a `GenerateFn`.
 *
 * No model. A look, when the caller passed `ask`, collides the catalog and
 * keeps the construction the vision scores as the named object. Without a
 * look, a name hint picks one construction so `database` is trays and
 * `unicorn` is a horn rather than both. A name nobody has a drawing for
 * is `unknown`, not a hub.
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
        const paired = withPair(
          best.result,
          best.id,
          best.extras,
          concept.name,
          parts,
          text,
          collide,
          neighbor,
          finish,
          options.spec
        );
        return {
          ...paired,
          audit: best.audit,
          brief,
          extras: best.extras,
          text: brief,
        };
      }
    }
    const brief = analogBrief(chosen.id, concept.name, options.analogOf);
    const paired = withPair(
      chosen.result,
      chosen.id,
      chosen.extras,
      concept.name,
      parts,
      text,
      collide,
      neighbor,
      finish,
      options.spec
    );
    return { ...paired, brief, extras: chosen.extras, text: brief };
  };
