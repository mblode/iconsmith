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
import { SPEC } from "../tools/canvas.js";
import { lint } from "../tools/lint.js";
import { similarity } from "../tools/render.js";
import type { Finish, Issue } from "../types.js";
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
  lost?: boolean;
  partsFound?: number;
  policy?: string;
}

const asMetrics = (raw: unknown): ViewMetrics | undefined => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const metrics: ViewMetrics = {};
  if (typeof rec.lost === "boolean") {
    metrics.lost = rec.lost;
  }
  if (typeof rec.partsFound === "number" && Number.isFinite(rec.partsFound)) {
    metrics.partsFound = rec.partsFound;
  }
  if (typeof rec.policy === "string" && rec.policy !== "") {
    metrics.policy = rec.policy;
  }
  if (
    metrics.lost === undefined &&
    metrics.partsFound === undefined &&
    metrics.policy === undefined
  ) {
    return undefined;
  }
  return metrics;
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
  finish: Finish;
  icon: ViewIcon;
  issues: Issue[];
  metrics?: ViewMetrics;
  shapes: CorpusShape[];
  trace?: ViewTrace;
}

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
    for (const name of readdirSync(from).toSorted()) {
      if (name.endsWith(".svg")) {
        // Demo stages the house SVG next to the samples as `slug.house.svg`.
        // That file is the answer key, not a drawing to review, and looking it
        // up as a slug would search the corpus for `pull-request.house`.
        if (name.endsWith(".house.svg")) {
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

const issuesMarkup = (issues: Issue[]): string => {
  if (issues.length === 0) {
    return '<p class="clean">clean</p>';
  }
  return `<ul class="issues">${issues
    .map(
      (i) =>
        `<li class="${i.severity}"><span class="rule">${escapeHtml(i.rule)}</span>${escapeHtml(i.message)}</li>`
    )
    .join("")}</ul>`;
};

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

const detailsMarkup = (title: string, body: string | null): string => {
  if (!body?.trim()) {
    return "";
  }
  return `<details class="trace"><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(body)}</pre></details>`;
};

const cardMarkup = (card: ViewCard): string => {
  const { against, icon, metrics, trace } = card;
  const { lost, partsFound, policy } = metrics ?? {};
  const stages = [stage(card.shapes, "generated")];
  if (against?.shapes) {
    stages.push(stage(against.shapes, "house"));
  }
  const errors = card.issues.filter((i) => i.severity === "error").length;
  const picked = icon.group !== null && icon.slug === icon.group;
  const badges = [
    picked ? '<span class="pick">selected</span>' : "",
    policy ? `<span class="policy">${escapeHtml(policy)}</span>` : "",
    lost ? '<span class="lost">lost</span>' : "",
  ].join("");
  return [
    `<article class="card${errors > 0 ? " has-error" : ""}${picked ? " selected" : ""}" id="${escapeHtml(icon.slug)}">`,
    `<div class="stages">${stages.join("")}</div>`,
    `<h2><a href="#${escapeHtml(icon.slug)}">${escapeHtml(icon.slug)}</a>${badges}</h2>`,
    `<p class="meta">${escapeHtml(icon.group ?? path.dirname(icon.file))} · ${card.finish}</p>`,
    issuesMarkup(card.issues),
    against ? comparisonMarkup(against, partsFound, policy) : "",
    detailsMarkup("brief", trace?.brief ?? null),
    detailsMarkup("thinking", trace?.log ?? null),
    detailsMarkup("program", trace?.program ?? null),
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
.grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
.card.has-error { border-color: var(--error); }
.card.selected { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 18%, transparent); }
.pick { margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; color: #1f8a4c; }
.policy { margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; color: var(--muted); }
.lost { margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; color: var(--error); }
.card h2 { font-size: 0.95rem; margin: 0.75rem 0 0.1rem; font-weight: 600; }
.card h2 a { color: inherit; text-decoration: none; }
.meta { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.78rem; }
.stages { display: flex; gap: 0.75rem; }
.stage { flex: 1 1 0; margin: 0; }
.stage svg { width: 100%; height: auto; display: block; color: var(--fg); }
.stage figcaption { color: var(--muted); font-size: 0.7rem; text-align: center; padding-top: 0.35rem; }
.clean { margin: 0; color: var(--muted); }
.issues { margin: 0; padding: 0; list-style: none; font-size: 0.8rem; }
.issues li { padding: 0.25rem 0; border-top: 1px solid var(--line); }
.issues .rule { display: inline-block; min-width: 7rem; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.72rem; }
.issues .error { color: var(--error); }
.issues .warn { color: var(--warn); }
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

/** The whole page, from cards. Pure: same cards in, same bytes out. */
export const buildPage = (cards: ViewCard[], opts: PageOptions): string => {
  const errors = cards.reduce(
    (n, c) => n + c.issues.filter((i) => i.severity === "error").length,
    0
  );
  const body =
    cards.length === 0
      ? `<p class="empty">No .svg files in ${escapeHtml(opts.dir)} or one level below it.</p>`
      : `<div class="grid">${cards.map(cardMarkup).join("")}</div>`;
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

/** Lint one shipped icon exactly as `iconsmith lint` does, so the page and the
 *  command never disagree. The finish is read off the file rather than assumed:
 *  a filled icon carries no stroke, and judging it as outlined inflates every
 *  extent by the house stroke width and reports a 20×20 disc as 22×22. */
const inspect = (
  shapes: CorpusShape[]
): { finish: Finish; issues: Issue[] } => {
  const finish: Finish =
    shapes.length > 0 && shapes.every((s) => s.filled) ? "filled" : "outlined";
  return {
    finish,
    issues: lint({
      elements: shapes.map((s, i) => ({
        d: s.d,
        id: `e${i}`,
        strokeWidth: s.strokeWidth,
      })),
      finish,
    }),
  };
};

interface Against {
  corpus: Corpus;
  variant: string;
}

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
  const shapes = parseIconSvg(source);
  const { finish, issues } = inspect(shapes);
  const trace = loadTrace(icon.file);
  const metrics = loadMetrics(icon.file);
  const staged = stagedHouse(icon.file);
  if (staged) {
    const key = `${icon.file}:${statSync(icon.file).mtimeMs}:staged`;
    let score = scores.get(key);
    if (score === undefined) {
      score = await similarity(source, staged);
      scores.set(key, score);
    }
    return {
      against: {
        score,
        shapes: parseIconSvg(staged),
        variant:
          finish === "filled"
            ? FILLED_VARIANT
            : (against?.variant ?? HOUSE_VARIANT),
      },
      finish,
      icon,
      issues,
      metrics,
      shapes,
      trace,
    };
  }
  if (!against) {
    return { against: null, finish, icon, issues, metrics, shapes, trace };
  }
  const { corpus, variant: outlined } = against;
  const slug = counterpartSlug(icon);
  const variant =
    finish === "filled" && corpus.has(slug, FILLED_VARIANT)
      ? FILLED_VARIANT
      : outlined;
  if (!corpus.has(slug, variant)) {
    return {
      against: { score: null, shapes: null, variant },
      finish,
      icon,
      issues,
      metrics,
      shapes,
      trace,
    };
  }
  const house = await corpus.svg(slug, variant);
  const key = `${icon.file}:${statSync(icon.file).mtimeMs}:${variant}`;
  let score = scores.get(key);
  if (score === undefined) {
    score = await similarity(source, house);
    scores.set(key, score);
  }
  return {
    against: { score, shapes: parseIconSvg(house), variant },
    finish,
    icon,
    issues,
    metrics,
    shapes,
    trace,
  };
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
