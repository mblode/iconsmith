/**
 * `iconsmith view` — look at what was drawn, on the grid it was drawn on.
 *
 * Every other command in this CLI reports numbers about icons. None of them
 * shows an icon, and the failures this project cares about are visual: a stroke
 * half a unit off the grid, a mark that clears the keyline by one unit instead
 * of two, a reconstruction that scores well and depicts the wrong thing. Those
 * are cheap to see and expensive to read out of a lint table, so this serves a
 * page rather than printing one.
 *
 * Three decisions are worth stating, because each of them had a shorter wrong
 * version:
 *
 * 1. **No dependency, no framework, no build step.** `node:http` writes one
 *    string. A viewer that needs an install is a viewer nobody opens, and every
 *    package added here is a package the published CLI carries forever for the
 *    sake of a development convenience.
 *
 * 2. **The page draws geometry, never the file.** Each icon is re-emitted from
 *    `parseIconSvg`'s shapes rather than inlined as source. The staging
 *    directory is generated output, but it is still arbitrary files on disk
 *    being served to a browser, and inlining an `.svg` verbatim would run any
 *    `<script>` or `on*=` handler inside it with the page's origin. Rebuilding
 *    from the parsed shapes means only path data, stroke width and cap survive
 *    the trip. A wrapping `<g opacity>` is dropped — Central emits none.
 *    Filled paths keep `fill-rule="evenodd"` so a hole stays a hole; without
 *    it the knockout subpath would paint as ink.
 *
 * 3. **A score is drawn against 0.737, never against 100%.** See `placeOnScale`.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { styleText } from "node:util";

import type { Command } from "commander";

import type { Corpus, CorpusShape } from "../corpus/load.js";
import {
  FILLED_VARIANT,
  HOUSE_VARIANT,
  loadCorpus,
  parseIconSvg,
} from "../corpus/load.js";
import { BASELINE, CEILING } from "../pipeline/eval.js";
import { loadParts } from "../pipeline/generate.js";
import { glyphFromSlug, GLYPH_WHY, GLYPHS } from "../pipeline/glyphs.js";
import { markFromSlug } from "../pipeline/kind.js";
import { MARKS } from "../pipeline/marks.js";
import { pairCanvases } from "../pipeline/pair.js";
import { compilePaint } from "../pipeline/reconstruct.js";
import { SPEC } from "../tools/canvas.js";
import { run as runDsl } from "../tools/dsl.js";
import { review } from "../tools/lint.js";
import type { Check } from "../tools/lint.js";
import { similarity } from "../tools/render.js";
import { adaptProgram } from "../tools/twin.js";
import type { Finish, Issue, Keyline, Part } from "../types.js";
import { assertDirectory, readText } from "./read.js";

/**
 * The bottom of the scale: what "no information" scores.
 *
 * Two icons of this set share a 24×24 canvas, a 1.9 stroke and a great deal of
 * white, so an unrelated pair does not score 0 — `bench/stress-cosine.v1.json`
 * measures 150 unrelated pairs at a median of 0.569 and a 25th percentile of
 * 0.472. A scale anchored at 0 would spend half its length on cosine values no
 * drawing can produce, which is precisely how a 0.62 comes to look like a
 * passing grade. Anchoring at the floor spends the whole bar on the range that
 * discriminates.
 */
export const FLOOR = 0.482;

/** Above this, a zero-part silhouette is the same drawing leaking into the
 *  score — a bug in whatever produced the staging directory. The same cosine
 *  *with* parts is reconstruction: the compiler working. `pipeline/eval.ts`
 *  applies the same threshold to a whole eval; a viewer applies it per icon. */
const SUSPICIOUS = 0.95;

/** How close to `BASELINE` still reads as "at baseline". Rendered cosine on a
 *  single pair is not decidable to three places — the stress bench puts its
 *  usable separation at AUC 0.86 — so a band is more honest than a threshold. */
const AT_BASELINE = 0.02;

const PORT = 3211;

/** One `.svg` found under the served directory. `group` is the subdirectory it
 *  came from — in practice a variant key, since `repair` and `conform` both
 *  stage as `.staging/<variant>/<slug>.svg` — and is null for a file sitting
 *  directly in the directory the caller named. */
export interface ViewIcon {
  file: string;
  group: string | null;
  slug: string;
}

/** The corpus slug `--against` should look up.
 *
 * Best-of-N stages samples as `pull-request/pull-request-1.svg`. Matching on
 * the filename as-is looks for a house icon named `pull-request-1`, which is
 * not a thing. The subdirectory is the concept, so a slug that is that name
 * plus a trailing index is a sample of it. A filled twin `plus/plus-filled.svg`
 * is the same concept in the other paint. A real house icon `cloud-2` sitting
 * at the served directory's root keeps its own slug: it has no group. */
export const counterpartSlug = (icon: ViewIcon): string => {
  if (!icon.group) {
    return icon.slug;
  }
  if (icon.slug === icon.group) {
    return icon.group;
  }
  const prefix = `${icon.group}-`;
  if (!icon.slug.startsWith(prefix)) {
    return icon.slug;
  }
  const rest = icon.slug.slice(prefix.length);
  if (/^\d+$/u.test(rest) || rest === "filled") {
    return icon.group;
  }
  return icon.slug;
};

/** Demo stages the house SVG next to the samples as `slug.house.svg`. That
 *  file is the answer key (or the nearest house twin, when the slugs differ).
 *  Prefer it over a corpus lookup so `plus` can sit beside `plus-large`. */
export const stagedHouse = (file: string): string | null => {
  const sibling = file.replace(/\.svg$/u, ".house.svg");
  return existsSync(sibling) ? readFileSync(sibling, "utf-8") : null;
};

/** The house counterpart, when `--against` asked for one. `shapes` is null when
 *  the corpus does not draw this slug at all, which is a different fact from a
 *  low score and is shown as one. */
export interface ViewComparison {
  score: number | null;
  shapes: CorpusShape[] | null;
  variant: string;
}

/** Brief, agent log and program beside a staged SVG. Null when that stage
 *  was never written — a repair dump has none of these. */
export interface ViewTrace {
  brief: string | null;
  log: string | null;
  program: string | null;
}

const KEYLINE_NAMES: readonly Keyline[] = [
  "circle",
  "landscape",
  "portrait",
  "square",
  "tall",
  "wide",
];

const isKeyline = (name: string): name is Keyline =>
  KEYLINE_NAMES.some((k) => k === name);

/** The keyline a `.icon` program declared, so lint judges the drawing against
 *  the box it claimed rather than whichever box happens to fit. */
export const keylineOf = (program: string | null): Keyline | null => {
  const match = program?.match(
    /^keyline\s+(?<name>circle|landscape|portrait|square|tall|wide)\b/mu
  );
  const name = match?.groups?.name;
  return name !== undefined && isKeyline(name) ? name : null;
};

export interface ReasonStep {
  kind: string;
  text: string;
}

const textsOf = (value: unknown): string[] => {
  if (typeof value === "string" && value.trim() !== "") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(textsOf);
  }
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: string[] = [];
    for (const key of [
      "text",
      "thinking",
      "content",
      "message",
      "delta",
      "reasoning",
      "item",
    ]) {
      if (key in rec) {
        out.push(...textsOf(rec[key]));
      }
    }
    return out;
  }
  return [];
};

/** JSONL (Codex `--json`, session dumps) becomes titled steps; prose stays one
 *  block. The viewer shows this always, not only when something failed. */
export const parseLog = (log: string): ReasonStep[] => {
  const steps: ReasonStep[] = [];
  const seen = new Set<string>();
  for (const line of log.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const kind = String(row.type ?? row.role ?? "step");
      for (const text of textsOf(row)) {
        const key = `${kind}\0${text}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        steps.push({ kind, text });
      }
    } catch {
      steps.push({ kind: "log", text: trimmed });
    }
  }
  return steps;
};

/** The ops in a program, as the construction chain. Comments stay as notes. */
export const constructionSteps = (program: string): ReasonStep[] =>
  program
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      if (line.startsWith("#")) {
        return { kind: "note", text: line.replace(/^#\s*/u, "") };
      }
      const [kind, ...rest] = line.split(/\s+/u);
      return { kind: kind ?? "op", text: rest.join(" ") || kind };
    });

const otherFinish = (finish: Finish): Finish =>
  finish === "filled" ? "outlined" : "filled";

/**
 * Sidecar extras for a compile program: `{stem}.parts.json`, then
 * `{stem}.extras.json`, then a directory `parts.json`. A compile that parks
 * `part heart-0` cannot replay without these; a paint that still cannot be
 * drawn is a dsl error.
 */
export const loadViewParts = (file: string): Part[] => {
  const base = file.replace(/\.svg$/u, "");
  const dir = path.dirname(file);
  const candidates = [
    `${base}.parts.json`,
    `${base}.extras.json`,
    path.join(dir, "parts.json"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(candidate, "utf-8")) as unknown;
      if (Array.isArray(raw)) {
        return raw as Part[];
      }
      if (raw !== null && typeof raw === "object" && "parts" in raw) {
        return loadParts(candidate);
      }
    } catch {
      // One bad sidecar must not take the page down.
    }
  }
  return [];
};

const shapesFromProgram = (
  source: string,
  extras: readonly Part[] = []
): CorpusShape[] | null => {
  const drawn = runDsl(source, [...extras]);
  if (drawn.errors.length > 0) {
    return null;
  }
  return parseIconSvg(drawn.canvas.toSVG());
};

/**
 * A program the DSL refused, as a finding rather than as a missing paint.
 *
 * Returning `null` and moving on made a refused op indistinguishable from one
 * nobody asked for: the derived twin simply did not appear, the card showed one
 * paint, and the reason — which is a real defect in the drawing or in the
 * derivation — reached nobody. This is the same failure the reach set shipped in
 * four other places, so it gets the same treatment: say what broke, on the card,
 * at `error`, because a paint the page cannot draw is not a judgement call.
 */
const refusal = (
  what: string,
  finish: Finish,
  errors: readonly string[]
): Issue => ({
  message: `The ${finish} paint could not be drawn from its ${what}: ${errors.join("; ")}`,
  rule: "dsl",
  severity: "error",
});

/**
 * One paint of one drawing: the program that made it, what it drew, and what
 * the house spec makes of it.
 *
 * A card holds a list of these rather than a drawing plus a "twin", because
 * the twin was a second-class citizen and it showed. Its lint ran into a
 * separate block that the card's status did not read, so an icon whose filled
 * paint sat off-keyline and off-centre was labelled clean; and its program was
 * never rendered at all, so a thumbnail appeared with nothing to explain it.
 * Both paints are the same kind of thing and are now the same type.
 */
export interface ViewPaint {
  /** The full house-spec chain for this paint, passes and waivers included. */
  checks: Check[];
  finish: Finish;
  /** Null only for a paint read off disk with no program to derive from — a
   *  repair dump, or a shipped corpus icon. */
  program: string | null;
  shapes: CorpusShape[];
}

/**
 * Lint a paint through its own canvas rather than through its rendered SVG.
 *
 * The re-parse is what silenced the `off-axis` escape hatch. `Canvas.line`
 * records `offAxis` on the element that needed it, `lint.ts` reads that flag
 * and waives the rule — and `parseIconSvg` keeps path data, stroke width and
 * cap, so a round trip through the SVG drops the declaration on the floor.
 * The compass then warned four times about a diagonal its own program had
 * asked for by name. Draw the program, lint the canvas, render the shapes:
 * one drawing, and the page cannot report a different one than it shows.
 */
const paintProgram = (
  source: string,
  extras: readonly Part[] = []
): {
  canvas?: ReturnType<typeof runDsl>["canvas"];
  errors: readonly string[];
  paint: ViewPaint | null;
} => {
  const drawn = runDsl(source, [...extras]);
  if (drawn.errors.length > 0) {
    return { errors: drawn.errors, paint: null };
  }
  const { canvas } = drawn;
  return {
    canvas,
    errors: [],
    paint: {
      checks: review(canvas, { keyline: drawn.keyline }),
      finish: canvas.finish,
      program: source,
      shapes: parseIconSvg(canvas.toSVG()),
    },
  };
};

const stemOf = (slug: string): string =>
  slug.endsWith("-filled") ? slug.slice(0, -"-filled".length) : slug;

/** The program the host would write for this slug in this finish, when the
 *  slug names a glyph or a mark. Both write each finish directly rather than
 *  deriving one from the other, so a chosen filled composition survives. */
const hostProgram = (slug: string, finish: Finish): string | null => {
  const stem = stemOf(slug);
  const glyph = glyphFromSlug(stem);
  if (glyph !== null) {
    return GLYPHS[glyph.glyph](stem, finish);
  }
  const mark = markFromSlug(stem);
  return mark === null ? null : MARKS[mark.mark](stem, finish);
};

/**
 * The program for the other paint of this drawing, as a program.
 *
 * A comment is not a program. The reach set shipped filled "programs" that
 * were a single `#` note — "host band ribbons — open arcs enclose nothing
 * under fill" — beside a filled thumbnail that had been rendered some other
 * way, which is the page describing one drawing and showing another. There are
 * only two honest sources for the other paint: a host construction that writes
 * both finishes, or `adaptProgram` re-painting the one program there is. Both
 * return ops. Neither invents a coordinate.
 */
/**
 * Compile the other paint from a staged house sibling, when one exists.
 *
 * `{stem}-filled.house.svg` next to `{stem}.svg` is the filled house file
 * twin-eval writes. Compiling it is the keyed path; `adaptProgram` is only
 * the fallback when that file is missing.
 */
export const compileHouseTwin = (
  file: string,
  slug: string,
  want: Finish,
  extras: readonly Part[] = []
): { extras: Part[]; source: string } | null => {
  const dir = path.dirname(file);
  const stem = stemOf(slug);
  const houseFile =
    want === "filled"
      ? path.join(dir, `${stem}-filled.house.svg`)
      : path.join(dir, `${stem}.house.svg`);
  if (!existsSync(houseFile) || houseFile === file) {
    return null;
  }
  const paths = parseIconSvg(readFileSync(houseFile, "utf-8")).map((s) => s.d);
  if (paths.length === 0) {
    return null;
  }
  return compilePaint(stem, paths, want, extras);
};

export const twinProgram = (
  slug: string,
  finish: Finish,
  program: string | null,
  file?: string,
  extras: readonly Part[] = []
): string | null => {
  const want = otherFinish(finish);
  const host = hostProgram(slug, want);
  if (host !== null) {
    return host;
  }
  if (file !== undefined) {
    const compiled = compileHouseTwin(file, slug, want, extras);
    if (compiled !== null) {
      return compiled.source;
    }
  }
  return program === null ? null : adaptProgram(program, want);
};

/** The other paint's shapes. Derived from {@link twinProgram} when there is a
 *  program to derive from; a sibling `*-filled.svg` is the last resort. */
export const twinShapes = (
  slug: string,
  file: string,
  finish: Finish,
  program: string | null,
  extras: readonly Part[] = []
): CorpusShape[] | null => {
  const want = otherFinish(finish);
  const compiled = compileHouseTwin(file, slug, want, extras);
  if (compiled !== null) {
    return shapesFromProgram(compiled.source, [...extras, ...compiled.extras]);
  }
  const source = twinProgram(slug, finish, program, file, extras);
  if (source !== null) {
    return shapesFromProgram(source, extras);
  }
  const twinFile =
    want === "filled"
      ? file.replace(/\.svg$/u, "-filled.svg")
      : file.replace(/-filled\.svg$/u, ".svg");
  if (twinFile !== file && existsSync(twinFile)) {
    return parseIconSvg(readFileSync(twinFile, "utf-8"));
  }
  return null;
};

const hostBrief = (slug: string): string | null => {
  const glyph = glyphFromSlug(stemOf(slug));
  return glyph === null ? null : GLYPH_WHY[glyph.glyph];
};

/** Sidecars next to `slug.svg`: `slug.brief.md`, `slug.log.jsonl`, `slug.icon`. */
export const loadTrace = (file: string): ViewTrace => {
  const base = file.replace(/\.svg$/u, "");
  const read = (suffix: string): string | null => {
    const next = `${base}${suffix}`;
    return existsSync(next) ? readFileSync(next, "utf-8") : null;
  };
  return {
    brief: read(".brief.md"),
    log: read(".log.jsonl"),
    program: read(".icon"),
  };
};

/** What the demo (and any later arm) records beside a sample. Optional fields:
 *  a repair dump has none of these, and a lost sample has `lost` but no cosine. */
export interface ViewMetrics {
  /**
   * What the arm concluded about its own drawing.
   *
   * Read, not ignored. The reach set recorded `clean: false` and a
   * `severity: "error"` keyline issue for `fingerprint`, and the card said
   * clean and the header said zero errors — because the page re-linted the
   * staged SVG and never opened the sidecar. Two verdicts on one drawing, with
   * the page showing whichever one flattered it. A recorded finding is now part
   * of the icon's status; when the page's own lint disagrees, both are shown
   * and the disagreement is the finding.
   */
  clean?: boolean;
  issues?: Issue[];
  lost?: boolean;
  partsFound?: number;
  policy?: string;
}

const SEVERITIES = new Set(["error", "warn"]);

const asIssue = (raw: unknown): Issue | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const { message, rule, severity } = rec;
  if (
    typeof message !== "string" ||
    typeof rule !== "string" ||
    typeof severity !== "string" ||
    !SEVERITIES.has(severity)
  ) {
    return null;
  }
  return { message, rule, severity: severity as Issue["severity"] };
};

const asMetrics = (raw: unknown): ViewMetrics | undefined => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const metrics: ViewMetrics = {};
  if (typeof rec.clean === "boolean") {
    metrics.clean = rec.clean;
  }
  if (Array.isArray(rec.issues)) {
    const issues = rec.issues
      .map(asIssue)
      .filter((i): i is Issue => i !== null);
    if (issues.length > 0) {
      metrics.issues = issues;
    }
  }
  if (typeof rec.lost === "boolean") {
    metrics.lost = rec.lost;
  }
  if (typeof rec.partsFound === "number" && Number.isFinite(rec.partsFound)) {
    metrics.partsFound = rec.partsFound;
  }
  if (typeof rec.policy === "string" && rec.policy !== "") {
    metrics.policy = rec.policy;
  }
  return Object.keys(metrics).length === 0 ? undefined : metrics;
};

/** Sidecar next to `slug.svg`: `slug.json`. Demo writes `policy`, `partsFound`
 *  and `lost` so a compiled 0.99 is not read as a leak. A missing or unreadable
 *  sidecar is undefined, not a throw — one bad file must not take the page down. */
export const loadMetrics = (file: string): ViewMetrics | undefined => {
  const sidecar = file.replace(/\.svg$/u, ".json");
  if (!existsSync(sidecar)) {
    return undefined;
  }
  try {
    return asMetrics(JSON.parse(readFileSync(sidecar, "utf-8")) as unknown);
  } catch {
    return undefined;
  }
};

/** Everything the page needs about one icon, gathered before any HTML exists.
 *  Keeping the gather and the render apart is what makes the render testable
 *  without a socket, a corpus or a filesystem. */
export interface ViewCard {
  against: ViewComparison | null;
  icon: ViewIcon;
  /**
   * Every finding this icon has, from any paint and from the arm's own record,
   * deduplicated. **This is the icon's status**, and the only thing the header
   * counts.
   *
   * It is one field rather than one per paint because the previous arrangement
   * had two, and a reader has to be able to answer "is this icon finished"
   * without reading three lists and taking the union themselves. Where a
   * finding came from is a display detail, kept on the paint that found it.
   */
  issues: Issue[];
  metrics?: ViewMetrics;
  /** Outlined first, then filled. Never empty: the file on disk is always one
   *  paint even when nothing can derive the other. */
  paints: ViewPaint[];
  trace?: ViewTrace;
}

/**
 * Every finding about an icon, from every paint and from the arm's record.
 *
 * A `pass` contributes nothing. A declared `off-axis` does contribute: it is a
 * `warn` like any other, because the declaration is the choice and the warning
 * is the request to confirm it. Duplicates collapse, because the same
 * measurement reached twice (both paints sit off the same keyline) is one fact
 * about the drawing.
 */
export const cardIssues = (
  paints: readonly ViewPaint[],
  recorded: readonly Issue[] = []
): Issue[] => {
  const out: Issue[] = [];
  for (const paint of paints) {
    for (const check of paint.checks) {
      if (check.status === "error" || check.status === "warn") {
        out.push({
          message: check.message,
          rule: check.rule,
          severity: check.status,
        });
      }
    }
  }
  out.push(...recorded);
  const seen = new Set<string>();
  return out.filter((i) => {
    const key = `${i.severity}\u0000${i.rule}\u0000${i.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Every `.svg` in `dir`, plus every `.svg` one level below it.
 *
 * One level, not a full walk. The real layout is `.staging/<variant>/*.svg`, so
 * a viewer that only read the top level would show an empty page against the
 * directory people actually have; a viewer that recursed without limit would
 * happily serve a checkout of the 62,550-file corpus if someone pointed it at
 * one. One level covers the layout this tool produces and nothing else.
 */
export const discoverIcons = (dir: string): ViewIcon[] => {
  const icons: ViewIcon[] = [];
  const collect = (from: string, group: string | null): void => {
    const names = readdirSync(from).toSorted();
    const present = new Set(names);
    for (const name of names) {
      if (name.endsWith(".svg")) {
        // Demo stages the house SVG next to the samples as `slug.house.svg`.
        // That file is the answer key, not a drawing to review, and looking it
        // up as a slug would search the corpus for `pull-request.house`.
        if (name.endsWith(".house.svg")) {
          continue;
        }
        // `plus-filled.svg` beside `plus.svg` is the same concept in the other
        // paint — which is what `counterpartSlug` already says about it — and a
        // card shows every paint it can reach. Two cards for one icon put the
        // same pair of thumbnails on the page twice and made a ten-icon set
        // read as twenty. A filled file standing alone still gets its own card.
        if (
          name.endsWith("-filled.svg") &&
          present.has(`${name.slice(0, -"-filled.svg".length)}.svg`)
        ) {
          continue;
        }
        icons.push({
          file: path.join(from, name),
          group,
          slug: name.slice(0, -".svg".length),
        });
      }
    }
  };
  collect(dir, null);
  for (const entry of readdirSync(dir, { withFileTypes: true }).toSorted(
    (a, b) => a.name.localeCompare(b.name)
  )) {
    if (entry.isDirectory()) {
      collect(path.join(dir, entry.name), entry.name);
    }
  }
  return icons;
};

/** Where a score sits on the floor-to-ceiling bar, as percentages of the bar's
 *  width, plus the one-word reading of it. */
export interface Placement {
  baseline: number;
  label: string;
  score: number;
  verdict:
    | "at-baseline"
    | "over"
    | "reconstruction"
    | "strong"
    | "suspect"
    | "weak";
}

/**
 * Put a score on the scale it was calibrated on.
 *
 * **This is the review point of the whole command.** A rendered cosine is not a
 * percentage and must never be drawn as one. 0.737 is the measured median
 * cosine between two mature icon sets drawing the same concept: it is what "a
 * different professional set's take" scores, and it is the most an independent
 * drawing can honestly aim at. Drawn as a percent-of-100 bar, 0.737 reads as a
 * C grade and 1.0 reads as the goal — exactly backwards, since 1.0 with no
 * parts *and a model that wrote the program* means the two files are the same
 * drawing and something has leaked. The same cosine *with* parts is
 * reconstruction: the compiler assembled the house icon from vocabulary.
 * A host mark matching the same construction at ≥0.95 is also reconstruction
 * (`twin.ts` wrote it); 0 `part` ops is the construction, not a leak.
 *
 * So the bar runs floor → ceiling, the baseline is marked inside it at 49%, and
 * a score past the baseline is labelled as beyond a cross-set take rather than
 * as nearly perfect. Positions are clamped, because a cosine below the floor is
 * still a real reading and should sit at the end of the bar rather than off it.
 */
export const placeOnScale = (
  score: number,
  partsFound?: number,
  policy?: string
): Placement => {
  const span = CEILING - FLOOR;
  const pct = (v: number) =>
    Math.min(100, Math.max(0, ((v - FLOOR) / span) * 100));
  const hostMark = policy === "mark";
  let verdict: Placement["verdict"] = "weak";
  if (score >= SUSPICIOUS && (hostMark || (partsFound ?? 0) >= 1)) {
    verdict = "reconstruction";
  } else if (score >= SUSPICIOUS) {
    verdict = "suspect";
  } else if (score > BASELINE + AT_BASELINE) {
    verdict = "over";
  } else if (score >= BASELINE - AT_BASELINE) {
    verdict = "at-baseline";
  } else if (score >= FLOOR + (BASELINE - FLOOR) / 2) {
    verdict = "strong";
  }
  const reconstruction = hostMark
    ? "host mark — same construction, not a leak"
    : "reconstruction — compiled from parts";
  const label = {
    "at-baseline": "at the cross-set baseline",
    over: "past a cross-set take",
    reconstruction,
    strong: "approaching the baseline",
    suspect: "suspect — check for a leak",
    weak: "near the floor",
  }[verdict];
  return { baseline: pct(BASELINE), label, score: pct(score), verdict };
};

const ESCAPES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};

/** Slugs come from filenames and lint messages quote them, so both reach the
 *  page as text. Escaped rather than trusted: a directory is a thing anyone can
 *  put a `<` in. */
export const escapeHtml = (text: string): string =>
  text.replaceAll(/["&'<>]/gu, (c) => ESCAPES[c]);

/**
 * Parsed shapes back to markup.
 *
 * Every shape becomes a `<path>` carrying only what `parseIconSvg` kept: the
 * geometry, whether it is ink or outline, its stroke width and its cap. Joins
 * are set once on the group as `round` — `CorpusShape` does not carry the join,
 * and every icon in the house variant is drawn with round joins, so inheriting
 * it is exact for the set this views and visibly wrong for nothing it can be
 * pointed at.
 */
export const iconMarkup = (shapes: CorpusShape[]): string =>
  shapes
    .map((s) =>
      s.filled
        ? `<path d="${escapeHtml(s.d)}" fill="currentColor" fill-rule="evenodd"/>`
        : `<path d="${escapeHtml(s.d)}" fill="none" stroke="currentColor" stroke-width="${s.strokeWidth}" stroke-linecap="${s.cap}"/>`
    )
    .join("");

/** The 24 unit gridlines, every 4th one stronger, drawn once into `<defs>` and
 *  reused by every card. Presentation attributes rather than CSS classes: a
 *  `<use>` renders into a shadow tree that document stylesheets cannot select
 *  into, but inherited `currentColor` crosses the boundary, so this is the form
 *  that survives both the reuse and the light/dark switch. */
const gridDefs = (): string => {
  const lines: string[] = [];
  for (let i = 0; i <= SPEC.canvas; i += 1) {
    const strong = i % 4 === 0;
    const attrs = `stroke="currentColor" stroke-width="${strong ? 0.08 : 0.04}" opacity="${strong ? 0.5 : 0.28}"`;
    lines.push(
      `<line x1="${i}" y1="0" x2="${i}" y2="${SPEC.canvas}" ${attrs}/>`,
      `<line x1="0" y1="${i}" x2="${SPEC.canvas}" y2="${i}" ${attrs}/>`
    );
  }
  // The optical boxes, as the widest and narrowest dimensions any keyline uses
  // — 20 and 16 in the current SPEC. Derived rather than written down, so a
  // fifth key shape added to `SPEC.keylines` shows up here instead of quietly
  // disagreeing with lint. Clearance is what these make visible: a mark that
  // touches the outer box is at the 2-unit margin the set keeps.
  const dims = Object.values(SPEC.keylines).flat();
  const boxes = [Math.max(...dims), Math.min(...dims)]
    .map((size) => {
      const at = (SPEC.canvas - size) / 2;
      return `<rect x="${at}" y="${at}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="0.12" opacity="0.45" stroke-dasharray="0.6 0.6"/>`;
    })
    .join("");
  return `<svg class="sprite" aria-hidden="true"><defs><g id="grid">${lines.join("")}</g><g id="keyline">${boxes}</g></defs></svg>`;
};

const stage = (shapes: CorpusShape[], label: string): string =>
  `<figure class="stage"><svg viewBox="0 0 ${SPEC.canvas} ${SPEC.canvas}" role="img" aria-label="${escapeHtml(label)}"><use href="#grid"/><use href="#keyline"/><g class="ink">${iconMarkup(shapes)}</g></svg><figcaption>${escapeHtml(label)}</figcaption></figure>`;

/** The score, as a bar with three marks on it: the floor at one end, the
 *  baseline where it actually falls, and the reading. The numbers are printed
 *  beside it because a bar alone cannot be read to three places. */
const scaleMarkup = (
  score: number,
  partsFound?: number,
  policy?: string
): string => {
  const p = placeOnScale(score, partsFound, policy);
  return [
    `<div class="scale ${p.verdict}">`,
    `<div class="track">`,
    `<span class="mark baseline" style="left:${p.baseline.toFixed(2)}%"></span>`,
    `<span class="mark reading" style="left:${p.score.toFixed(2)}%"></span>`,
    "</div>",
    `<div class="legend"><span>floor ${FLOOR}</span><span class="at" style="left:${p.baseline.toFixed(2)}%">baseline ${BASELINE}</span><span>${CEILING} = same drawing</span></div>`,
    `<p class="reading-out"><strong>${score.toFixed(3)}</strong> — ${escapeHtml(p.label)}</p>`,
    "</div>",
  ].join("");
};

const checkList = (checks: readonly Check[]): string =>
  `<ul class="qa">${checks
    .map(
      (c) =>
        `<li class="${c.status}"><span class="status">${c.status}</span><span class="rule">${escapeHtml(c.rule)}</span>${escapeHtml(c.message)}</li>`
    )
    .join("")}</ul>`;

const issuesMarkup = (checks: readonly Check[]): string => {
  if (checks.length === 0) {
    return '<p class="clean">clean</p>';
  }
  const dirty = checks.some((c) => c.status !== "pass");
  const banner = dirty
    ? ""
    : '<p class="clean">clean — every house check passed</p>';
  return `${banner}${checkList(checks)}`;
};

/** `clean` means no errors. An arm that said dirty without naming one
 *  cannot look like 0 error(s) — that is the fingerprint lie. */
export const recordedUncleanIssue = (): Issue => ({
  message:
    "The arm recorded this drawing as not clean without recording an error. Whatever it objected to is not in this list.",
  rule: "recorded",
  severity: "error",
});

/** Fold the arm's `clean: false` into the card's findings so the header
 *  and the verdict count the same thing. */
export const withRecordedStatus = (card: ViewCard): ViewCard => {
  if (card.metrics?.clean !== false) {
    return card;
  }
  if (card.issues.some((issue) => issue.severity === "error")) {
    return card;
  }
  return { ...card, issues: [...card.issues, recordedUncleanIssue()] };
};

/** The arm's own verdict, shown next to the page's. Only when it has something
 *  the page's lint did not reach: `clean: false` with no error attached is the
 *  state that let `fingerprint` pass, so it is stated rather than dropped. */
const recordedMarkup = (metrics: ViewMetrics | undefined): string => {
  const issues = [...(metrics?.issues ?? [])];
  const contradicts =
    metrics?.clean === false &&
    issues.every((issue) => issue.severity !== "error");
  if (issues.length === 0 && !contradicts) {
    return "";
  }
  const checks: Check[] = issues.map((i) => ({
    message: i.message,
    rule: i.rule,
    status: i.severity,
  }));
  if (contradicts) {
    const extra = recordedUncleanIssue();
    checks.push({
      message: extra.message,
      rule: extra.rule,
      status: extra.severity,
    });
  }
  return `<section class="paint recorded"><h3>as recorded</h3>${checkList(checks)}</section>`;
};

const stepsMarkup = (steps: ReasonStep[]): string =>
  `<ol class="steps">${steps
    .map(
      (s) =>
        `<li><span class="kind">${escapeHtml(s.kind)}</span>${escapeHtml(s.text)}</li>`
    )
    .join("")}</ol>`;

const reasonMarkup = (title: string, inner: string): string =>
  inner === ""
    ? ""
    : `<section class="reason"><h3>${escapeHtml(title)}</h3>${inner}</section>`;

const thinkingMarkup = (log: string, steps: ReasonStep[]): string => {
  if (steps.length === 0) {
    return "";
  }
  if (steps.every((s) => s.kind === "log")) {
    return `<pre>${escapeHtml(log)}</pre>`;
  }
  return stepsMarkup(steps);
};

const reasoningMarkup = (trace: ViewTrace | undefined): string => {
  const brief = trace?.brief?.trim() || "";
  const log = trace?.log?.trim() || "";
  const thinking = log === "" ? [] : parseLog(log);
  return [
    reasonMarkup("Brief", brief === "" ? "" : `<p>${escapeHtml(brief)}</p>`),
    reasonMarkup("Thinking", thinkingMarkup(log, thinking)),
  ].join("");
};

/** The construction and the source for one paint. Both, because the ops read
 *  as a chain and the program is the artefact — and neither is the other. */
const programMarkup = (paint: ViewPaint): string => {
  const program = paint.program?.trim() || "";
  if (program === "") {
    return reasonMarkup(
      `Program (${paint.finish})`,
      '<p class="absent">no program — this paint was read off disk</p>'
    );
  }
  const built = constructionSteps(program);
  return [
    reasonMarkup(
      `Construction (${paint.finish})`,
      built.length === 0 ? "" : stepsMarkup(built)
    ),
    reasonMarkup(
      `Program (${paint.finish})`,
      `<pre>${escapeHtml(program)}</pre>`
    ),
  ].join("");
};

const paintMarkup = (paint: ViewPaint): string =>
  [
    `<section class="paint"><h3>${escapeHtml(paint.finish)}</h3>`,
    issuesMarkup(paint.checks),
    programMarkup(paint),
    "</section>",
  ].join("");

const comparisonMarkup = (
  against: ViewComparison,
  partsFound?: number,
  policy?: string
): string => {
  if (!against.shapes) {
    return `<p class="absent">no <code>${escapeHtml(against.variant)}</code> counterpart in the corpus</p>`;
  }
  return against.score === null
    ? ""
    : scaleMarkup(against.score, partsFound, policy);
};

const paintOrder = (finish: Finish): number => (finish === "outlined" ? 0 : 1);

const cardMarkup = (card: ViewCard): string => {
  const { against, icon, metrics, trace } = card;
  const { lost, partsFound, policy } = metrics ?? {};
  const paints = card.paints.toSorted(
    (a, b) => paintOrder(a.finish) - paintOrder(b.finish)
  );
  const stages = paints
    .filter((p) => p.shapes.length > 0)
    .map((p) => stage(p.shapes, p.finish));
  if (against?.shapes) {
    stages.push(stage(against.shapes, "house"));
  }
  const errors = card.issues.filter((i) => i.severity === "error").length;
  const warnings = card.issues.filter((i) => i.severity === "warn").length;
  const recordedDirty = metrics?.clean === false;
  const picked = icon.group !== null && icon.slug === icon.group;
  const badges = [
    picked ? '<span class="pick">selected</span>' : "",
    policy ? `<span class="policy">${escapeHtml(policy)}</span>` : "",
    lost ? '<span class="lost">lost</span>' : "",
  ].join("");
  // Stated once, above both paints, so the card answers "is this finished"
  // before the reader has to take a union of two lists themselves.
  const verdict =
    errors === 0 && !recordedDirty && card.issues.length === 0
      ? '<p class="clean">clean — every house check passed, in every paint</p>'
      : `<p class="verdict">${errors} error(s) · ${warnings} warning(s) across ${paints.length} paint(s)</p>`;
  return [
    `<article class="card${errors > 0 || recordedDirty ? " has-error" : ""}${picked ? " selected" : ""}" id="${escapeHtml(icon.slug)}">`,
    `<div class="stages">${stages.join("")}</div>`,
    `<h2><a href="#${escapeHtml(icon.slug)}">${escapeHtml(icon.slug)}</a>${badges}</h2>`,
    `<p class="meta">${escapeHtml(icon.group ?? path.dirname(icon.file))} · ${paints.map((p) => p.finish).join(" + ")}</p>`,
    verdict,
    paints.map(paintMarkup).join(""),
    recordedMarkup(metrics),
    against ? comparisonMarkup(against, partsFound, policy) : "",
    reasoningMarkup(trace),
    "</article>",
  ].join("");
};

/** Everything about the page that is not a card. Inline, because the whole
 *  point of a zero-dependency viewer is that it is one response. */
const STYLE = `
:root { color-scheme: light dark; --bg: #fbfbfa; --fg: #16150f; --muted: #6b6b63; --line: #e2e1db; --card: #fff; --error: #b3261e; --warn: #8a6100; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #12120f; --fg: #edece5; --muted: #9a9a90; --line: #2c2b26; --card: #1a1a16; --error: #f2846a; --warn: #d9ac52; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { margin: 0 0 1.5rem; display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap; }
h1 { font-size: 1.1rem; margin: 0; }
header .count { color: var(--muted); }
.sprite { position: absolute; width: 0; height: 0; }
.grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(28rem, 1fr)); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
.card.has-error { border-color: var(--error); }
.card.selected { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 18%, transparent); }
.pick { margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; color: #1f8a4c; }
.policy { margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; color: var(--muted); }
.lost { margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; color: var(--error); }
.card h2 { font-size: 0.95rem; margin: 0.75rem 0 0.1rem; font-weight: 600; }
.card h2 a { color: inherit; text-decoration: none; }
.meta { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.78rem; }
.stages { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr)); }
.stage { margin: 0; }
.stage svg { width: 100%; height: auto; display: block; color: var(--fg); }
.stage figcaption { color: var(--muted); font-size: 0.7rem; text-align: center; padding-top: 0.35rem; letter-spacing: 0.04em; text-transform: lowercase; }
.clean { margin: 0 0 0.35rem; color: #1f8a4c; font-size: 0.8rem; }
.verdict { margin: 0 0 0.5rem; font-size: 0.8rem; font-weight: 600; }
.paint { margin: 0.7rem 0 0; border-top: 1px solid var(--line); padding-top: 0.45rem; }
.paint h3 { margin: 0 0 0.3rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.paint.recorded h3 { color: var(--warn); }
.qa .declared .status { color: var(--muted); }
.qa, .issues { margin: 0; padding: 0; list-style: none; font-size: 0.8rem; }
.qa li, .issues li { padding: 0.28rem 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 3.2rem 6.2rem 1fr; gap: 0.45rem; align-items: start; }
.qa .status, .issues .rule, .qa .rule { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.68rem; }
.qa .status { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding-top: 0.12rem; }
.qa .pass .status { color: #1f8a4c; }
.qa .warn .status, .issues .warn { color: var(--warn); }
.qa .error .status, .issues .error { color: var(--error); }
.qa .rule, .issues .rule { color: var(--muted); padding-top: 0.12rem; }
.scale { margin-top: 0.9rem; }
.track { position: relative; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--line), color-mix(in srgb, var(--fg) 30%, var(--line))); }
.mark { position: absolute; top: -4px; width: 2px; height: 14px; margin-left: -1px; border-radius: 1px; }
.mark.baseline { background: var(--fg); }
.mark.reading { background: var(--warn); width: 4px; margin-left: -2px; }
.at-baseline .mark.reading, .over .mark.reading, .reconstruction .mark.reading { background: #1f8a4c; }
.suspect .mark.reading { background: var(--error); }
.legend { position: relative; height: 1.4rem; color: var(--muted); font-size: 0.68rem; display: flex; justify-content: space-between; padding-top: 0.3rem; }
.legend .at { position: absolute; top: 0.3rem; transform: translateX(-50%); white-space: nowrap; }
.reading-out { margin: 0.4rem 0 0; font-size: 0.8rem; }
.absent { margin: 0.6rem 0 0; color: var(--muted); font-size: 0.8rem; }
.reason { margin: 0.7rem 0 0; border-top: 1px solid var(--line); padding-top: 0.45rem; }
.reason h3 { margin: 0 0 0.3rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.reason p { margin: 0; font-size: 0.82rem; }
.reason pre { margin: 0.15rem 0 0; max-height: 16rem; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.reason .steps { margin: 0; padding: 0; list-style: none; }
.reason .steps li { padding: 0.22rem 0; border-top: 1px solid var(--line); font-size: 0.8rem; }
.reason .steps .kind { display: inline-block; min-width: 5.4rem; margin-right: 0.45rem; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.68rem; color: var(--muted); }
.trace { margin: 0.55rem 0 0; border-top: 1px solid var(--line); padding-top: 0.35rem; }
.trace summary { cursor: pointer; color: var(--muted); font-size: 0.78rem; }
.trace pre { margin: 0.4rem 0 0; max-height: 16rem; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.empty { color: var(--muted); }
`;

export interface PageOptions {
  against: string | null;
  dir: string;
}

/**
 * The whole page, from cards. Pure: same cards in, same bytes out.
 *
 * The header counts `card.issues`, which is every paint's findings and the
 * arm's own record. It used to count one paint's, which is how a set with a
 * recorded `severity: "error"` in it announced itself as "0 error(s)".
 */
export const buildPage = (cards: ViewCard[], opts: PageOptions): string => {
  const shown = cards.map(withRecordedStatus);
  const errors = shown.reduce(
    (n, c) => n + c.issues.filter((i) => i.severity === "error").length,
    0
  );
  const body =
    shown.length === 0
      ? `<p class="empty">No .svg files in ${escapeHtml(opts.dir)} or one level below it.</p>`
      : `<div class="grid">${shown.map(cardMarkup).join("")}</div>`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>iconsmith view — ${escapeHtml(opts.dir)}</title>`,
    `<style>${STYLE}</style></head><body>`,
    gridDefs(),
    `<header><h1>${escapeHtml(opts.dir)}</h1>`,
    `<span class="count">${cards.length} icon(s) · ${errors} error(s)${
      opts.against ? ` · against ${escapeHtml(opts.against)}` : ""
    }</span></header>`,
    body,
    "</body></html>",
  ].join("");
};

interface Against {
  corpus: Corpus;
  variant: string;
}

const finishOf = (shapes: CorpusShape[]): Finish =>
  shapes.length > 0 && shapes.every((s) => s.filled) ? "filled" : "outlined";

/**
 * A paint that only exists as a file: lint it exactly as `iconsmith lint`
 * does, so the page and the command never disagree.
 *
 * No `offAxis` is passed and that is correct rather than a shortfall — a
 * shipped SVG carries no declaration, and an undeclared diagonal in a file
 * somebody handed you is exactly what the rule is for. See `LintElement`.
 */
const paintFile = (
  shapes: CorpusShape[],
  keyline: Keyline | null
): ViewPaint => {
  const finish = finishOf(shapes);
  const target = {
    elements: shapes.map((s, i) => ({
      d: s.d,
      id: `e${i}`,
      strokeWidth: s.strokeWidth,
    })),
    finish,
  };
  return { checks: review(target, { keyline }), finish, program: null, shapes };
};

/**
 * Both paints of one staged icon, each with its own program and its own lint.
 *
 * The order of preference is the order of trust. A program is the artefact this
 * project claims to produce, so when there is one it is drawn and linted and
 * the file on disk is only a cross-check; a host construction is the same thing
 * written by the host. Only with neither does the file become the drawing, and
 * then the twin can only come from a sibling file, because nothing here will
 * invent one.
 */
/**
 * Every paint the page can draw for one icon, and every reason it could not
 * draw another.
 *
 * The refusals come back rather than being dropped. A DSL error while deriving
 * the twin used to leave the card with one paint and no explanation, which is
 * the same "a refused op is indistinguishable from one nobody asked for" hole
 * the reach set shipped in its filled programs.
 */
export const paintsOf = (
  icon: ViewIcon,
  source: string,
  program: string | null,
  extras: readonly Part[] = []
): { issues: Issue[]; paints: ViewPaint[] } => {
  const parts = extras.length > 0 ? extras : loadViewParts(icon.file);
  const fromFile = parseIconSvg(source);
  const fileFinish = finishOf(fromFile);
  const primarySource = program ?? hostProgram(icon.slug, fileFinish);
  const drawn =
    primarySource === null
      ? { errors: [] as readonly string[], paint: null }
      : paintProgram(primarySource, parts);
  const issues: Issue[] = [];
  if (drawn.errors.length > 0) {
    issues.push(refusal("program", fileFinish, drawn.errors));
  }
  const primary = drawn.paint;
  if (primary === null || primary.shapes.length === 0) {
    // The shipped file is still a drawing worth showing, but on its own it says
    // nothing about why the program beside it did not run.
    const paints = [paintFile(fromFile, keylineOf(program))];
    const twin = twinShapes(icon.slug, icon.file, fileFinish, null, parts);
    if (twin && twin.length > 0) {
      paints.push(paintFile(twin, null));
    }
    return { issues, paints };
  }
  const paints = [primary];
  const want = otherFinish(primary.finish);
  const compiled = compileHouseTwin(icon.file, icon.slug, want, parts);
  if (compiled !== null) {
    const other = paintProgram(compiled.source, [...parts, ...compiled.extras]);
    if (other.errors.length > 0) {
      issues.push(refusal("house twin", want, other.errors));
    } else if (other.paint && other.paint.shapes.length > 0) {
      paints.push(other.paint);
    }
    return { issues, paints };
  }
  const twinSource = twinProgram(
    icon.slug,
    primary.finish,
    primary.program,
    icon.file,
    parts
  );
  if (twinSource !== null) {
    const other = paintProgram(twinSource, parts);
    if (other.errors.length > 0) {
      issues.push(refusal("outlined twin", want, other.errors));
    } else if (other.paint && other.paint.shapes.length > 0) {
      paints.push(other.paint);
      if (drawn.canvas !== undefined && other.canvas !== undefined) {
        issues.push(
          ...pairCanvases([], primary.finish, drawn.canvas, other.canvas)
        );
      }
    }
  }
  return { issues, paints };
};

const scored = async (
  scores: Map<string, number | null>,
  key: string,
  left: string,
  right: string
): Promise<number | null> => {
  const cached = scores.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const score = await similarity(left, right);
  scores.set(key, score);
  return score;
};

const compare = async (
  icon: ViewIcon,
  source: string,
  finish: Finish,
  against: Against | null,
  scores: Map<string, number | null>
): Promise<ViewComparison | null> => {
  const staged = stagedHouse(icon.file);
  if (staged) {
    return {
      score: await scored(
        scores,
        `${icon.file}:${statSync(icon.file).mtimeMs}:staged`,
        source,
        staged
      ),
      shapes: parseIconSvg(staged),
      variant:
        finish === "filled"
          ? FILLED_VARIANT
          : (against?.variant ?? HOUSE_VARIANT),
    };
  }
  if (against === null) {
    return null;
  }
  const { corpus, variant: outlined } = against;
  const slug = counterpartSlug(icon);
  const variant =
    finish === "filled" && corpus.has(slug, FILLED_VARIANT)
      ? FILLED_VARIANT
      : outlined;
  if (!corpus.has(slug, variant)) {
    return { score: null, shapes: null, variant };
  }
  const house = await corpus.svg(slug, variant);
  return {
    score: await scored(
      scores,
      `${icon.file}:${statSync(icon.file).mtimeMs}:${variant}`,
      source,
      house
    ),
    shapes: parseIconSvg(house),
    variant,
  };
};

/**
 * Read one icon and everything said about it.
 *
 * Scoring is the expensive half — two rasterisations through sharp per icon —
 * and it happens per request so that redrawing an icon and hitting reload shows
 * the new drawing. `scores` memoises on path and mtime, which keeps a reload
 * free while still recomputing the moment a file changes.
 */
const buildCard = async (
  icon: ViewIcon,
  against: Against | null,
  scores: Map<string, number | null>
): Promise<ViewCard> => {
  const source = readText(icon.file, "an .svg icon");
  const trace = loadTrace(icon.file);
  const extras = loadViewParts(icon.file);
  const { issues: refused, paints } = paintsOf(
    icon,
    source,
    trace.program,
    extras
  );
  const metrics = loadMetrics(icon.file);
  return withRecordedStatus({
    against: await compare(icon, source, paints[0].finish, against, scores),
    icon,
    issues: cardIssues(paints, [...refused, ...(metrics?.issues ?? [])]),
    metrics,
    paints,
    trace: {
      brief: trace.brief ?? hostBrief(icon.slug),
      log: trace.log,
      program: trace.program,
    },
  });
};

/** Hand the URL to whatever the platform uses to open one. Detached and
 *  unreferenced: the opener is a fire-and-forget, and a viewer that could not
 *  be opened is still a viewer that is serving. */
const OPENERS: Record<string, [string, string[]]> = {
  darwin: ["open", []],
  win32: ["cmd", ["/c", "start", ""]],
};

const openBrowser = (url: string): void => {
  const [cmd, args] = OPENERS[process.platform] ?? ["xdg-open", []];
  const child = spawn(cmd, [...args, url], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {
    process.stderr.write(`could not open a browser; visit ${url}\n`);
  });
  child.unref();
};

interface ViewOptions {
  against?: string;
  corpus: string;
  open?: boolean;
  port: string;
}

/** `iconsmith view [dir]` — serve the staging directory as a page. */
export const registerViewCommand = (program: Command): void => {
  program
    .command("view")
    .description("serve a directory of icons as a page, on the grid")
    .argument("[dir]", "directory of .svg icons", ".staging")
    .option("-p, --port <n>", "port to listen on", String(PORT))
    // Not `--variant`: this does not select which variant is *shown*, it names
    // the one to compare against, and every icon shown keeps whatever variant
    // it was staged as. `house` is spelled out because the house variant key is
    // 34 characters nobody should retype.
    .option(
      "-a, --against <variant>",
      `compare each slug with its house counterpart ("house" for ${HOUSE_VARIANT}; filled cards use ${FILLED_VARIANT}). A staged *.house.svg sibling wins over a slug lookup.`
    )
    .option("-c, --corpus <dir>", "corpus root, for --against", "corpus")
    .option("--open", "open the page in a browser")
    .action(async (dir: string, opts: ViewOptions) => {
      const json = program.opts().output === "json";
      assertDirectory(dir, "a directory of .svg icons");
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(
          `--port "${opts.port}" is not a port number (1 to 65535).`
        );
      }
      const variant =
        opts.against === "house" ? HOUSE_VARIANT : (opts.against ?? null);
      // Loaded once, before the first request: the corpus index is 30 directory
      // listings, which is cheap once and rude on every reload.
      const against: Against | null = variant
        ? { corpus: await loadCorpus(opts.corpus), variant }
        : null;
      if (against && !against.corpus.variant(variant as string)) {
        throw new Error(
          `Unknown corpus variant "${variant}". The house variant is "${HOUSE_VARIANT}".`
        );
      }
      const scores = new Map<string, number | null>();

      const respond = async (
        req: IncomingMessage,
        res: ServerResponse
      ): Promise<void> => {
        if ((req.url ?? "/") !== "/") {
          // Everything the page needs is inline, so any other path is a
          // browser guessing (`/favicon.ico`) rather than a route.
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found\n");
          return;
        }
        try {
          // The directory is re-read per request, so redrawing an icon and
          // reloading shows the new one without restarting the server.
          const cards = await Promise.all(
            discoverIcons(dir).map((i) => buildCard(i, against, scores))
          );
          res.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          });
          res.end(buildPage(cards, { against: variant, dir }));
        } catch (error: unknown) {
          // A file deleted between the listing and the read is the ordinary
          // case here, and it must not take the server down with it.
          const message =
            error instanceof Error ? error.message : String(error);
          res.writeHead(500, { "content-type": "text/plain" });
          res.end(`${message}\n`);
        }
      };

      const server = createServer(respond);

      // Loopback only, never 0.0.0.0. This serves whatever files it is pointed
      // at with no authentication, which is fine for a viewer on the machine
      // that drew them and is not fine on a shared network.
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      const url = `http://127.0.0.1:${port}/`;
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ against: variant, dir, icons: discoverIcons(dir).length, url })}\n`
        );
      } else {
        const link =
          Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
            ? styleText("cyan", url)
            : url;
        process.stderr.write(`viewing ${dir} at ${link} — ctrl-c to stop\n`);
      }
      if (opts.open) {
        openBrowser(url);
      }
    });
};
