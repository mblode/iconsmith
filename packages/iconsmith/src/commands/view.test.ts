/**
 * The viewer, minus the socket.
 *
 * Everything worth testing here is a pure function: which files become cards,
 * what a score means on the scale it was calibrated on, and what markup a card
 * turns into. `node:http` is tested by Node; what is not tested anywhere else
 * is that a cosine is never drawn as a percentage of 1.0, which is the one way
 * this page could mislead the person reading it.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseIconSvg } from "../corpus/load.js";
import { BASELINE, CEILING } from "../pipeline/eval.js";
import type { ViewCard, ViewPaint } from "./view.js";
import {
  FLOOR,
  buildPage,
  cardIssues,
  constructionSteps,
  counterpartSlug,
  discoverIcons,
  escapeHtml,
  iconMarkup,
  keylineOf,
  loadMetrics,
  loadTrace,
  parseLog,
  placeOnScale,
  stagedHouse,
  twinProgram,
  twinShapes,
} from "./view.js";

const temp = () => mkdtempSync(path.join(tmpdir(), "iconsmith-view-"));

const ICON =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4L20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

const paint = (over: Partial<ViewPaint> = {}): ViewPaint => ({
  checks: [],
  finish: "outlined",
  program: null,
  shapes: parseIconSvg(ICON),
  ...over,
});

const card = (over: Partial<ViewCard> = {}): ViewCard => ({
  against: null,
  icon: { file: "/tmp/x/bananas.svg", group: "x", slug: "bananas" },
  issues: [],
  paints: [paint()],
  ...over,
});

describe("discoverIcons", () => {
  it("finds icons in the directory and one level below it", () => {
    const dir = temp();
    writeFileSync(path.join(dir, "loose.svg"), ICON);
    mkdirSync(path.join(dir, "round-outlined-radius-3-stroke-2"));
    writeFileSync(
      path.join(dir, "round-outlined-radius-3-stroke-2", "bananas.svg"),
      ICON
    );
    expect(discoverIcons(dir).map((i) => [i.slug, i.group])).toEqual([
      ["loose", null],
      ["bananas", "round-outlined-radius-3-stroke-2"],
    ]);
  });

  it("stops at one level, so a corpus checkout cannot be served by accident", () => {
    const dir = temp();
    mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    writeFileSync(path.join(dir, "a", "b", "deep.svg"), ICON);
    expect(discoverIcons(dir)).toEqual([]);
  });

  it("ignores everything that is not an .svg", () => {
    const dir = temp();
    writeFileSync(path.join(dir, "notes.md"), "# no");
    writeFileSync(path.join(dir, "icon.svg"), ICON);
    expect(discoverIcons(dir).map((i) => i.slug)).toEqual(["icon"]);
  });

  it("skips the staged house copy, which is an answer key not a sample", () => {
    const dir = temp();
    mkdirSync(path.join(dir, "pull-request"));
    writeFileSync(path.join(dir, "pull-request", "pull-request.svg"), ICON);
    writeFileSync(
      path.join(dir, "pull-request", "pull-request.house.svg"),
      ICON
    );
    expect(discoverIcons(dir).map((i) => i.slug)).toEqual(["pull-request"]);
  });

  it("sorts, so a reload does not reshuffle the page", () => {
    const dir = temp();
    for (const name of ["c.svg", "a.svg", "b.svg"]) {
      writeFileSync(path.join(dir, name), ICON);
    }
    expect(discoverIcons(dir).map((i) => i.slug)).toEqual(["a", "b", "c"]);
  });

  it("skips a filled twin whose outlined half is staged, so one icon is one card", () => {
    const dir = temp();
    writeFileSync(path.join(dir, "plus.svg"), ICON);
    writeFileSync(path.join(dir, "plus-filled.svg"), ICON);
    expect(discoverIcons(dir).map((i) => i.slug)).toEqual(["plus"]);
  });

  it("keeps a filled drawing that is the only paint staged for its concept", () => {
    const dir = temp();
    writeFileSync(path.join(dir, "plus-filled.svg"), ICON);
    expect(discoverIcons(dir).map((i) => i.slug)).toEqual(["plus-filled"]);
  });
});

describe("counterpartSlug", () => {
  it("maps a numbered sample onto the concept directory", () => {
    expect(
      counterpartSlug({
        file: "/tmp/demo/pull-request/pull-request-1.svg",
        group: "pull-request",
        slug: "pull-request-1",
      })
    ).toBe("pull-request");
  });

  it("leaves a numbered house slug at the root alone", () => {
    expect(
      counterpartSlug({
        file: "/tmp/cloud-2.svg",
        group: null,
        slug: "cloud-2",
      })
    ).toBe("cloud-2");
  });

  it("maps a filled twin onto the concept directory", () => {
    expect(
      counterpartSlug({
        file: "/tmp/demo/plus/plus-filled.svg",
        group: "plus",
        slug: "plus-filled",
      })
    ).toBe("plus");
  });
});

describe("stagedHouse", () => {
  it("reads the sibling answer key and nothing else", () => {
    const dir = temp();
    writeFileSync(path.join(dir, "plus.svg"), ICON);
    writeFileSync(path.join(dir, "plus.house.svg"), ICON);
    expect(stagedHouse(path.join(dir, "plus.svg"))).toBe(ICON);
    expect(stagedHouse(path.join(dir, "missing.svg"))).toBeNull();
  });
});

describe("placeOnScale", () => {
  it("spends the bar on floor..ceiling, not on 0..1", () => {
    expect(placeOnScale(FLOOR).score).toBe(0);
    expect(placeOnScale(CEILING).score).toBe(100);
  });

  it("puts the 0.737 baseline near the middle, where it was measured", () => {
    // (0.737 - 0.482) / (1 - 0.482) = 0.492. A percent-of-100 bar would put it
    // at 74%, which reads as a passing grade rather than as the target.
    expect(placeOnScale(BASELINE).baseline).toBeCloseTo(49.2, 1);
    expect(placeOnScale(BASELINE).score).toBeCloseTo(49.2, 1);
  });

  it("clamps a score below the floor rather than drawing it off the bar", () => {
    expect(placeOnScale(0.1).score).toBe(0);
    expect(placeOnScale(0.1).verdict).toBe("weak");
  });

  it("reads the baseline band as arrival, not as a middling grade", () => {
    expect(placeOnScale(BASELINE).verdict).toBe("at-baseline");
    expect(placeOnScale(BASELINE - 0.01).verdict).toBe("at-baseline");
    expect(placeOnScale(BASELINE + 0.05).verdict).toBe("over");
  });

  it("calls a near-perfect score suspect, because 1.0 means one drawing", () => {
    expect(placeOnScale(0.99).verdict).toBe("suspect");
    expect(placeOnScale(1).label).toMatch(/leak/u);
  });

  it("calls a near-perfect score with parts a reconstruction, not a leak", () => {
    expect(placeOnScale(0.99, 3).verdict).toBe("reconstruction");
    expect(placeOnScale(0.99, 3).label).toMatch(/reconstruction/u);
    expect(placeOnScale(0.99, 3).label).not.toMatch(/leak/u);
  });

  it("still calls a near-perfect score with no parts a leak", () => {
    expect(placeOnScale(0.99, 0).verdict).toBe("suspect");
    expect(placeOnScale(0.99, 0).label).toMatch(/leak/u);
  });

  it("calls a host mark at 0.99 reconstruction, not a leak", () => {
    expect(placeOnScale(0.99, 0, "mark").verdict).toBe("reconstruction");
    expect(placeOnScale(0.99, 0, "mark").label).not.toMatch(
      /check for a leak/u
    );
    expect(placeOnScale(0.99, 0, "mark").label).toMatch(/host mark/u);
  });

  it("still calls analog at 0.99 with no parts a leak", () => {
    expect(placeOnScale(0.99, 0, "analog").verdict).toBe("suspect");
    expect(placeOnScale(0.99, 0, "analog").label).toMatch(/leak/u);
  });
});

describe("iconMarkup", () => {
  it("keeps stroke width and cap, which is what the grid is read against", () => {
    const markup = iconMarkup(parseIconSvg(ICON));
    expect(markup).toContain('stroke-width="1.9"');
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).toContain('stroke="currentColor"');
  });

  it("draws a filled shape as fill, not as a hairline outline", () => {
    const markup = iconMarkup(
      parseIconSvg('<svg><path d="M4 4L20 20Z" fill="currentColor"/></svg>')
    );
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('fill-rule="evenodd"');
    expect(markup).not.toContain("stroke=");
  });

  it("carries nothing across but geometry — no script, no handler", () => {
    const hostile =
      '<svg onload="steal()"><script>steal()</script>' +
      '<path d="M4 4L20 20" stroke="currentColor" onclick="steal()"/></svg>';
    const markup = iconMarkup(parseIconSvg(hostile));
    expect(markup).not.toContain("steal");
    expect(markup).not.toContain("<script");
    expect(markup).toContain("M4 4L20 20");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that change the parse", () => {
    expect(escapeHtml(`<a href="x" id='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;"
    );
  });
});

describe("buildPage", () => {
  const opts = { against: null, dir: ".staging" };

  it("says so when there is nothing to show", () => {
    expect(buildPage([], opts)).toContain("No .svg files");
  });

  it("draws the 24 unit grid and the optical boxes once, for reuse", () => {
    const html = buildPage([card()], opts);
    expect(html).toContain('<g id="grid">');
    expect(html).toContain('<g id="keyline">');
    expect(html).toContain('<use href="#grid"/>');
    // The outer and inner keyline dimensions: 20x20 inset by 2, 16x16 by 4.
    expect(html).toContain('width="20"');
    expect(html).toContain('width="16"');
  });

  it("names the slug and the count", () => {
    const html = buildPage([card()], opts);
    expect(html).toContain("bananas");
    expect(html).toContain("1 icon(s) · 0 error(s)");
  });

  it("says clean rather than showing an empty list", () => {
    expect(buildPage([card()], opts)).toContain("clean");
  });

  it("separates an error from a warning, and marks the card", () => {
    const found = paint({
      checks: [
        { message: "Canvas is empty.", rule: "empty", status: "error" },
        { message: "off the axis", rule: "off-axis", status: "warn" },
      ],
    });
    const html = buildPage(
      [card({ issues: cardIssues([found]), paints: [found] })],
      opts
    );
    expect(html).toContain('<li class="error">');
    expect(html).toContain('<li class="warn">');
    expect(html).toContain("has-error");
    expect(html).toContain("1 icon(s) · 1 error(s)");
  });

  it("escapes a lint message rather than letting it reach the parser", () => {
    const html = buildPage(
      [
        card({
          paints: [
            paint({
              checks: [
                { message: "<img onerror=x>", rule: "bleed", status: "warn" },
              ],
            }),
          ],
        }),
      ],
      opts
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("marks the unnumbered file in a concept directory as the pick", () => {
    const html = buildPage(
      [
        card({
          icon: {
            file: "/tmp/demo/pull-request/pull-request.svg",
            group: "pull-request",
            slug: "pull-request",
          },
        }),
      ],
      opts
    );
    expect(html).toContain('<span class="pick">selected</span>');
  });

  it("shows the generation policy next to selected", () => {
    const html = buildPage(
      [
        card({
          icon: {
            file: "/tmp/demo/pull-request/pull-request.svg",
            group: "pull-request",
            slug: "pull-request",
          },
          metrics: { partsFound: 4, policy: "compile" },
        }),
      ],
      opts
    );
    expect(html).toContain('<span class="pick">selected</span>');
    expect(html).toContain('<span class="policy">compile</span>');
  });

  it("shows lost when the sidecar says the sample was lost", () => {
    const html = buildPage(
      [card({ metrics: { lost: true, policy: "analog" } })],
      opts
    );
    expect(html).toContain('<span class="lost">lost</span>');
    expect(html).toContain('<span class="policy">analog</span>');
  });

  it("renders a mark policy as a span", () => {
    const html = buildPage(
      [card({ metrics: { partsFound: 0, policy: "mark" } })],
      opts
    );
    expect(html).toContain('<span class="policy">mark</span>');
  });

  it("escapes a policy rather than letting it reach the parser", () => {
    const html = buildPage(
      [card({ metrics: { policy: "<img onerror=x>" } })],
      opts
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("calls a part-compiled 0.99 a reconstruction, not a leak", () => {
    const html = buildPage(
      [
        card({
          against: { score: 0.99, shapes: parseIconSvg(ICON), variant: "v" },
          metrics: { partsFound: 4, policy: "compile" },
        }),
      ],
      opts
    );
    expect(html).toContain("reconstruction — compiled from parts");
    expect(html).not.toContain("check for a leak");
  });

  it("still calls a 0.95 with no parts a leak", () => {
    const html = buildPage(
      [
        card({
          against: { score: 0.95, shapes: parseIconSvg(ICON), variant: "v" },
        }),
      ],
      opts
    );
    expect(html).toContain("suspect — check for a leak");
    expect(html).not.toContain("compiled from parts");
  });

  it("calls a host mark at 0.99 reconstruction, not a leak", () => {
    const html = buildPage(
      [
        card({
          against: { score: 0.99, shapes: parseIconSvg(ICON), variant: "v" },
          metrics: { partsFound: 0, policy: "mark" },
        }),
      ],
      opts
    );
    expect(html).toContain("host mark — same construction, not a leak");
    expect(html).not.toContain("check for a leak");
  });

  it("shows the house icon beside the generated one under --against", () => {
    const html = buildPage(
      [
        card({
          against: {
            score: 0.71,
            shapes: parseIconSvg(ICON),
            variant: "round-outlined-radius-3-stroke-2",
          },
        }),
      ],
      { against: "round-outlined-radius-3-stroke-2", dir: ".staging" }
    );
    expect(html).toContain(">outlined<");
    expect(html).toContain(">house<");
  });

  it("draws the score against 0.737, at the position the scale gives it", () => {
    const score = 0.71;
    const html = buildPage(
      [
        card({
          against: { score, shapes: parseIconSvg(ICON), variant: "v" },
        }),
      ],
      opts
    );
    const p = placeOnScale(score);
    expect(html).toContain(
      `class="mark reading" style="left:${p.score.toFixed(2)}%"`
    );
    expect(html).toContain(
      `class="mark baseline" style="left:${p.baseline.toFixed(2)}%"`
    );
    expect(html).toContain(`baseline ${BASELINE}`);
    expect(html).toContain(`floor ${FLOOR}`);
    expect(html).toContain("same drawing");
    // The number itself, at the precision the metric supports — and never as a
    // percentage, which is the misreading the whole scale exists to prevent.
    expect(html).toContain("<strong>0.710</strong>");
    expect(html).not.toContain("71%");
  });

  it("distinguishes a missing counterpart from a low score", () => {
    const html = buildPage(
      [card({ against: { score: null, shapes: null, variant: "v" } })],
      { against: "v", dir: ".staging" }
    );
    expect(html).toContain("no <code>v</code> counterpart");
    expect(html).not.toContain('class="mark reading"');
  });

  it("opens brief, thinking and program as always-visible stages", () => {
    const html = buildPage(
      [
        card({
          paints: [paint({ program: "part git-fork\nfit" })],
          trace: {
            brief: "Draw `pull-request`.",
            log: '<img onerror=x>{"type":"item"}',
            program: "part git-fork\nfit",
          },
        }),
      ],
      opts
    );
    expect(html).toContain("<h3>Brief</h3>");
    expect(html).toContain("<h3>Thinking</h3>");
    expect(html).toContain("<h3>Program (outlined)</h3>");
    expect(html).toContain("<h3>Construction (outlined)</h3>");
    expect(html).toContain("Draw `pull-request`.");
    expect(html).toContain("part git-fork");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("shows both paints and the full QA chain, not only failures", () => {
    const html = buildPage(
      [
        card({
          paints: [
            paint({
              checks: [
                {
                  message:
                    'Visual extent 18.0×18.0 matches declared keyline "square" (18×18).',
                  rule: "keyline",
                  status: "pass",
                },
                {
                  message: "Every stroked edge sits on 0/45/90.",
                  rule: "off-axis",
                  status: "pass",
                },
              ],
            }),
            paint({
              finish: "filled",
              shapes: parseIconSvg(
                '<svg><path d="M4 4L20 20Z" fill="currentColor"/></svg>'
              ),
            }),
          ],
        }),
      ],
      opts
    );
    expect(html).toContain(">outlined<");
    expect(html).toContain(">filled<");
    expect(html).toContain("clean — every house check passed");
    expect(html).toContain('<li class="pass">');
    expect(html).toContain("0/45/90");
    expect(html).toContain("declared keyline &quot;square&quot;");
  });

  /** The umbrella bug: a filled paint sitting off-keyline and off-centre while
   *  the card said clean, because only one paint's lint reached the status. */
  it("counts a finding from either paint against the icon", () => {
    const filledOnly = card({
      issues: [
        {
          message: "centre is (12.00, 11.00)",
          rule: "centred",
          severity: "warn",
        },
        {
          message: "Visual extent 16.0×18.0 matches no keyline",
          rule: "keyline",
          severity: "error",
        },
      ],
      paints: [
        paint(),
        paint({
          checks: [
            {
              message: "centre is (12.00, 11.00)",
              rule: "centred",
              status: "warn",
            },
            {
              message: "Visual extent 16.0×18.0 matches no keyline",
              rule: "keyline",
              status: "error",
            },
          ],
          finish: "filled",
        }),
      ],
    });
    const html = buildPage([filledOnly], opts);
    expect(html).toContain("1 icon(s) · 1 error(s)");
    expect(html).toContain("has-error");
    expect(html).toContain("1 error(s) · 1 warning(s) across 2 paint(s)");
    expect(html).not.toContain("clean — every house check passed");
  });

  /** The fingerprint bug: a recorded `severity: "error"` that the page never
   *  read, so the header said zero and the card said clean. */
  it("counts what the arm recorded, not only what the page re-lints", () => {
    const html = buildPage(
      [
        card({
          issues: [
            {
              message: 'keyline "square" wants 18×18',
              rule: "keyline",
              severity: "error",
            },
          ],
          metrics: {
            clean: false,
            issues: [
              {
                message: 'keyline "square" wants 18×18',
                rule: "keyline",
                severity: "error",
              },
            ],
            policy: "compile",
          },
        }),
      ],
      opts
    );
    expect(html).toContain("1 icon(s) · 1 error(s)");
    expect(html).toContain("<h3>as recorded</h3>");
    expect(html).toContain("wants 18×18");
  });

  it("says so when the arm called a drawing unclean without naming a finding", () => {
    const html = buildPage(
      [card({ metrics: { clean: false, policy: "compile" } })],
      opts
    );
    expect(html).toContain("<h3>as recorded</h3>");
    expect(html).toContain("without recording a finding");
  });

  it("shows a waiver as its own state, not as a pass", () => {
    const html = buildPage(
      [
        card({
          paints: [
            paint({
              checks: [
                {
                  message: "Waived by `off-axis`: the program asked for it",
                  rule: "off-axis",
                  status: "waived",
                },
              ],
            }),
          ],
        }),
      ],
      opts
    );
    expect(html).toContain('<li class="waived">');
    expect(html).toContain("1 icon(s) · 0 error(s)");
    // A waiver is a decision, not an open question: it must not make the icon
    // look unfinished either.
    expect(html).toContain('<p class="clean">clean');
  });

  it("says a paint has no program rather than showing an empty block", () => {
    const html = buildPage([card()], opts);
    expect(html).toContain("no program — this paint was read off disk");
  });
});

const check = (status: "error" | "pass" | "waived" | "warn") => ({
  message: `m-${status}`,
  rule: "keyline",
  status,
});

describe("cardIssues", () => {
  it("takes the union of every paint and drops passes and waivers", () => {
    expect(
      cardIssues([
        paint({ checks: [check("pass"), check("warn")] }),
        paint({ checks: [check("waived"), check("error")], finish: "filled" }),
      ])
    ).toEqual([
      { message: "m-warn", rule: "keyline", severity: "warn" },
      { message: "m-error", rule: "keyline", severity: "error" },
    ]);
  });

  it("collapses the same measurement reached in both paints", () => {
    expect(
      cardIssues([
        paint({ checks: [check("warn")] }),
        paint({ checks: [check("warn")], finish: "filled" }),
      ])
    ).toHaveLength(1);
  });

  it("keeps what the arm recorded", () => {
    expect(
      cardIssues(
        [paint()],
        [{ message: "recorded", rule: "keyline", severity: "error" }]
      )
    ).toEqual([{ message: "recorded", rule: "keyline", severity: "error" }]);
  });
});

describe("loadTrace", () => {
  it("reads the sidecars sitting next to a sample svg", () => {
    const dir = temp();
    const file = path.join(dir, "pull-request-1.svg");
    writeFileSync(file, ICON);
    writeFileSync(path.join(dir, "pull-request-1.brief.md"), "Draw it.\n");
    writeFileSync(
      path.join(dir, "pull-request-1.log.jsonl"),
      '{"type":"item"}\n'
    );
    writeFileSync(path.join(dir, "pull-request-1.icon"), "part git-fork\n");
    expect(loadTrace(file)).toEqual({
      brief: "Draw it.\n",
      log: '{"type":"item"}\n',
      program: "part git-fork\n",
    });
  });
});

describe("loadMetrics", () => {
  it("reads the json sidecar sitting next to a sample svg", () => {
    const dir = temp();
    const file = path.join(dir, "pull-request-1.svg");
    writeFileSync(file, ICON);
    writeFileSync(
      path.join(dir, "pull-request-1.json"),
      `${JSON.stringify({
        cosine: 0.99,
        partsFound: 4,
        policy: "compile",
      })}\n`
    );
    expect(loadMetrics(file)).toEqual({
      partsFound: 4,
      policy: "compile",
    });
  });

  it("reads the arm's own verdict, so a recorded error cannot go missing", () => {
    const dir = temp();
    const file = path.join(dir, "fingerprint.svg");
    writeFileSync(file, ICON);
    writeFileSync(
      path.join(dir, "fingerprint.json"),
      `${JSON.stringify({
        clean: false,
        issues: [
          {
            message: 'keyline "square" wants 18×18',
            rule: "keyline",
            severity: "error",
          },
          { message: "not an issue", rule: "keyline" },
        ],
        policy: "compile",
      })}\n`
    );
    expect(loadMetrics(file)).toEqual({
      clean: false,
      issues: [
        {
          message: 'keyline "square" wants 18×18',
          rule: "keyline",
          severity: "error",
        },
      ],
      policy: "compile",
    });
  });

  it("returns undefined when there is no sidecar", () => {
    const dir = temp();
    const file = path.join(dir, "loose.svg");
    writeFileSync(file, ICON);
    expect(loadMetrics(file)).toBeUndefined();
  });
});

describe("keylineOf", () => {
  it("reads the declared keyline from a program", () => {
    expect(keylineOf("icon wifi\nkeyline wide\nfinish outlined\n")).toBe(
      "wide"
    );
    expect(keylineOf("rect 4,4 16x16\n")).toBeNull();
  });
});

describe("parseLog / constructionSteps", () => {
  it("turns JSONL thinking into titled steps, not a raw dump", () => {
    const log = [
      '{"type":"reasoning","text":"needle on 45"}',
      '{"type":"item","item":{"type":"agent_message","text":"drew the ring"}}',
    ].join("\n");
    expect(parseLog(log)).toEqual([
      { kind: "reasoning", text: "needle on 45" },
      { kind: "item", text: "drew the ring" },
    ]);
  });

  it("lists the ops in a program as the construction chain", () => {
    const steps = constructionSteps(
      "icon compass\nkeyline circle\nfinish outlined\n\ndiamond 12,12 r5\n"
    );
    expect(steps.map((s) => s.kind)).toEqual([
      "icon",
      "keyline",
      "finish",
      "diamond",
    ]);
    expect(steps.find((s) => s.kind === "diamond")?.text).toBe("12,12 r5");
  });
});

describe("twinShapes", () => {
  it("emits the other paint of a host glyph from the same program", () => {
    const dir = temp();
    const file = path.join(dir, "compass.svg");
    writeFileSync(file, ICON);
    const twin = twinShapes("compass", file, "outlined", null);
    expect(twin).not.toBeNull();
    expect(twin?.every((s) => s.filled)).toBe(true);
  });
});

describe("twinProgram", () => {
  it("writes the host glyph's own filled construction, not a derivation", () => {
    const source = twinProgram("compass", "outlined", null);
    expect(source).toContain("finish filled");
    expect(source).toContain("circle");
  });

  /** A comment is not a program. The reach set shipped filled "programs" that
   *  were a lone `#` note beside a rendered filled thumbnail. */
  it("derives real ops for a program with no host construction", () => {
    const source = twinProgram(
      "bananas",
      "outlined",
      ["icon bananas", "finish outlined", "circle 12,12 r9"].join("\n")
    );
    expect(source).toContain("finish filled");
    expect(source).toContain("hole circle 12,12 r8");
    expect(
      source?.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"))
        .length
    ).toBeGreaterThan(1);
  });

  it("has nothing to say when there is no program and no host twin", () => {
    expect(twinProgram("bananas", "outlined", null)).toBeNull();
  });
});
