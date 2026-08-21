import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import type { Part } from "../types.js";
import { SPEC } from "./canvas.js";
import type { CohortMember } from "./cohort.js";
import { buildCohorts, measure } from "./cohort.js";
import { run } from "./dsl.js";
import { lint } from "./lint.js";

const PARTS: Part[] = [
  {
    closed: true,
    d: "M0 0L8 0L8 6L0 6Z",
    h: 6,
    icons: ["cloud", "rain"],
    id: "p0031",
    instances: 12,
    name: "cloud",
    nodes: 4,
    sizeRange: [6, 10],
    w: 8,
  },
];

/** Visual extent = path bbox + stroke width, half added on each side. */
const extent = (canvas: ReturnType<typeof run>["canvas"]) => {
  const b = canvas.bbox();
  if (!b) {
    throw new Error("empty canvas");
  }
  return {
    cx: b.x0 + b.w / 2,
    cy: b.y0 + b.h / 2,
    h: b.h + SPEC.stroke,
    w: b.w + SPEC.stroke,
  };
};

test("an arc is the house strike-through construction: two half-circles and a bar", () => {
  const r = run(
    `
    icon strikethrough
    keyline circle
    finish outlined
    arc 12,12 r9 half from left
    arc 12,12 r9 half from left ccw
    line 3,12 21,12
    fit
    `
  );
  expect(r.errors).toStrictEqual([]);
  expect(r.canvas.elements.map((e) => e.kind)).toEqual(["arc", "arc", "line"]);
  expect(
    lint(r.canvas, { keyline: "circle" }).filter((i) => i.severity === "error")
  ).toEqual([]);
});

test("every op parses", () => {
  const r = run(
    `
    # a comment, and a blank line follow

    icon    cloud-rain
    keyline wide
    rect    2,3 8x6 r2
    circle  12,12 r4
    diamond 12,12 r5
    arc     12,12 r8 half from left
    line    4,18 9,18 14,18
    dot     18,18 floating
    part    cloud at 3,4 size 8
    center
    fit
    `,
    PARTS
  );
  expect(r.errors).toStrictEqual([]);
  expect(r.icon).toBe("cloud-rain");
  expect(r.keyline).toBe("wide");
  expect(r.canvas.elements.map((e) => e.kind)).toStrictEqual([
    "rect",
    "circle",
    "line",
    "arc",
    "line",
    "dot",
    "part",
  ]);
});

test("every dot role is reachable from the language, at its spec size", () => {
  const roles = Object.keys(SPEC.dots);
  const r = run(
    [
      "icon dots",
      ...roles.map((role, i) => `dot ${4 + i * 4},12 ${role}`),
    ].join("\n"),
    PARTS
  );
  expect(r.errors).toStrictEqual([]);
  expect(
    r.canvas.elements.map((e) => bbox(parsePath(e.d)).w + SPEC.stroke)
  ).toStrictEqual(
    roles.map((role) => SPEC.dots[role as keyof typeof SPEC.dots])
  );
  // A bare `dot` still means the smallest tier.
  const bare = run("dot 12,12", PARTS);
  expect(
    bare.canvas.elements[0].kind === "dot" && bare.canvas.elements[0].role
  ).toBe("terminal");
});

test("an unknown op reports the fix instead of throwing", () => {
  const r = run("icon x\nsquiggle 3,3", PARTS);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain("line 2 (squiggle 3,3)");
  expect(r.errors[0]).toContain('unknown op "squiggle"');
  // The message has to name the way out, not just the wall.
  expect(r.errors[0]).toContain("expected one of");
  for (const op of [
    "rect",
    "circle",
    "arc",
    "line",
    "dot",
    "part",
    "center",
    "fit",
  ]) {
    expect(r.errors[0]).toContain(op);
  }
});

test("an unknown part points at the vocabulary", () => {
  const r = run("part unicorn at center", PARTS);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain('unknown part "unicorn"');
  expect(r.errors[0]).toContain("listParts");
});

test("an unknown keyline and an unknown dot role both name the alternatives", () => {
  const r = run("keyline hexagon\ndot 12,12 enormous", PARTS);
  expect(r.errors).toHaveLength(2);
  expect(r.errors[0]).toContain("wide");
  expect(r.errors[1]).toContain("terminal");
  expect(r.keyline).toBeNull();
});

test("a bad line reports and the rest of the program still runs", () => {
  const r = run("rect nope 8x6\ncircle 12,12 r4", PARTS);
  expect(r.errors).toHaveLength(1);
  expect(r.canvas.elements).toHaveLength(1);
  expect(r.canvas.elements[0].kind).toBe("circle");
});

test("fit on the wide keyline yields a visual extent of exactly 20.0 × 16.0", () => {
  // 9 × 7 is the wide keyline's inner aspect, so both axes bind at once and the
  // result is exact rather than fitted on the tighter axis alone.
  const r = run("keyline wide\nrect 0,0 9x7\nfit", PARTS);
  expect(r.errors).toStrictEqual([]);
  const e = extent(r.canvas);
  expect(e.w).toBe(20);
  expect(e.h).toBe(16);
  expect([e.cx, e.cy]).toStrictEqual([12, 12]);
});

test("fit on the square keyline yields a visual extent of exactly 18.0 × 18.0", () => {
  const r = run("keyline square\nrect 0,0 4x4 r0\nfit", PARTS);
  const e = extent(r.canvas);
  expect([e.w, e.h]).toStrictEqual([18, 18]);
});

test("fit never overflows the keyline on the unbound axis", () => {
  // A tall shape on a wide keyline: height binds, width must come out under 20.
  const r = run("keyline wide\nrect 0,0 4x12 r0\nfit", PARTS);
  const e = extent(r.canvas);
  expect(e.h).toBe(16);
  expect(e.w).toBeLessThanOrEqual(20);
});

test("fit with no keyline declared falls back to square", () => {
  const a = run("rect 0,0 4x4 r0\nfit", PARTS);
  const b = run("keyline square\nrect 0,0 4x4 r0\nfit", PARTS);
  expect(a.canvas.toSVG()).toBe(b.canvas.toSVG());
});

test("center puts the content centre on (12,12)", () => {
  const r = run("rect 0,0 4x4 r0\ncircle 3,3 r1\ncenter", PARTS);
  expect(r.errors).toStrictEqual([]);
  const e = extent(r.canvas);
  expect([e.cx, e.cy]).toStrictEqual([12, 12]);
  // Centring must not resize anything.
  expect([e.w, e.h]).toStrictEqual([6, 6]);
});

test("centre is spelled either way", () => {
  const a = run("rect 0,0 4x4 r0\ncenter", PARTS);
  const b = run("rect 0,0 4x4 r0\ncentre", PARTS);
  expect(a.canvas.toSVG()).toBe(b.canvas.toSVG());
});

test("an anchor names a centre; a bare coordinate names the top-left", () => {
  const anchored = run("part cloud at center size 8", PARTS);
  const placed = run("part cloud at 4,6 size 8", PARTS);
  const a = anchored.canvas.bbox();
  const p = placed.canvas.bbox();
  if (!(a && p)) {
    throw new Error("empty canvas");
  }
  expect([a.x0 + a.w / 2, a.y0 + a.h / 2]).toStrictEqual([12, 12]);
  expect([p.x0, p.y0]).toStrictEqual([4, 6]);
});

test("size sets the part's longest side; fill takes the keyline", () => {
  const sized = run("part cloud at center size 8", PARTS);
  const filled = run("keyline wide\npart cloud fill", PARTS);
  const s = sized.canvas.bbox();
  const f = filled.canvas.bbox();
  if (!(s && f)) {
    throw new Error("empty canvas");
  }
  expect(Math.max(s.w, s.h)).toBe(8);
  // fill scales to the keyline less the stroke: 8×6 into 18×14 binds on width.
  expect(f.w + SPEC.stroke).toBe(20);
});

test("a part placed by the DSL stays a reference in the document", () => {
  const r = run("part cloud at center size 8\nfit", PARTS);
  const doc = r.canvas.toJSON({ icon: r.icon, keyline: r.keyline });
  expect(doc.draw[0].op).toBe("part");
  expect(doc.draw[0]).toMatchObject({ id: "p0031" });
});

test("an empty program is not an error", () => {
  const r = run("# nothing but a comment\n\n", PARTS);
  expect(r.errors).toStrictEqual([]);
  expect(r.canvas.bbox()).toBeNull();
});

/** A family, measured the way `iconsmith lint` measures one: draw the siblings,
 *  take each one's path bbox. */
const family = (programs: Record<string, string>): CohortMember[] =>
  Object.entries(programs).map(([name, src]) => {
    const r = run(src, PARTS);
    expect(r.errors).toStrictEqual([]);
    return { box: measure(r.canvas.elements.map((e) => e.d)), name };
  });

const SIBLINGS = {
  "bell-1": "rect 4,3 16x16 r2",
  "bell-2": "rect 4,3 16x16 r2",
};

test("cohort lands a new icon on its family's measured extent", () => {
  const cohorts = buildCohorts(family(SIBLINGS));
  // 10×10 shares the siblings' 1:1 aspect, so both axes bind and the landing
  // is exact rather than fitted on y alone.
  const r = run("icon bell-3\nrect 2,2 10x10 r2\ncohort", PARTS, { cohorts });
  expect(r.errors).toStrictEqual([]);
  const b = r.canvas.bbox();
  expect(b && [b.x0, b.x1, b.y0, b.y1]).toStrictEqual([4, 20, 3, 19]);
});

test("an icon drawn with cohort has no cohort-align finding; the same icon without one does", () => {
  const cohorts = buildCohorts(family(SIBLINGS));
  const draw = (src: string) => {
    const r = run(`icon bell-3\n${src}`, PARTS, { cohorts });
    expect(r.errors).toStrictEqual([]);
    const members = [
      ...family(SIBLINGS),
      { box: measure(r.canvas.elements.map((e) => e.d)), name: "bell-3" },
    ];
    const [cohort] = buildCohorts(members);
    return lint(r.canvas, { cohort: { cohort, name: "bell-3" } })
      .filter((i) => i.rule === "cohort-align")
      .map((i) => i.message);
  };
  // Drawn to its own extent, bell-3 splits the family and lint says by how far.
  const alone = draw("rect 5,4 14x14 r2");
  expect(alone).toHaveLength(2);
  expect(alone[0]).toContain("jumps the icon 1.00px");
  // Same drawing, conformed at draw time: nothing left for lint to find.
  expect(draw("rect 5,4 14x14 r2\ncohort")).toStrictEqual([]);
});

test("cohort resolves by cohort key, by sibling name, and by the icon's own name", () => {
  const cohorts = buildCohorts(family(SIBLINGS));
  const box = (src: string) => {
    const r = run(src, PARTS, { cohorts });
    expect(r.errors).toStrictEqual([]);
    return r.canvas.bbox();
  };
  const drawing = "rect 2,2 10x10 r2";
  expect(box(`icon bell-3\n${drawing}\ncohort bell`)).toStrictEqual(
    box(`icon bell-3\n${drawing}\ncohort bell-1`)
  );
  expect(box(`icon bell-3\n${drawing}\ncohort`)).toStrictEqual(
    box(`icon bell-3\n${drawing}\ncohort bell`)
  );
});

test("a # inside a cohort key is not a comment", () => {
  const cohorts = buildCohorts(
    family({
      "bell-1-filled": "rect 4,3 16x16 r2",
      "bell-2-filled": "rect 4,3 16x16 r2",
    })
  );
  expect(cohorts[0].name).toBe("bell#filled");
  const r = run("rect 2,2 10x10 r2\ncohort bell#filled", PARTS, { cohorts });
  expect(r.errors).toStrictEqual([]);
  const b = r.canvas.bbox();
  expect(b && [b.y0, b.y1]).toStrictEqual([3, 19]);
});

test("a drawing of the wrong shape lands on y and reports what x is left over", () => {
  const cohorts = buildCohorts(family(SIBLINGS));
  // 10×14: y binds (16/14), leaving x 11.5 wide (11.43 quantised onto the
  // 0.25 grid) against a family that spans 16.
  const r = run("icon bell-3\nrect 2,2 10x14 r2\ncohort", PARTS, { cohorts });
  const b = r.canvas.bbox();
  expect(b && [b.y0, b.y1]).toStrictEqual([3, 19]);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain("x is off by 4.50px");
  expect(r.errors[0]).toContain("Redraw it");
});

test("a family with no agreed extent has nothing to inherit, and says so", () => {
  const cohorts = buildCohorts(
    family({
      "bell-1": "rect 4,3 16x16 r2",
      "bell-2": "rect 2,2 12x12 r2",
      "bell-3": "rect 6,6 8x8 r2",
    })
  );
  const r = run("rect 2,2 10x10 r2\ncohort bell", PARTS, { cohorts });
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain("no agreed extent");
  // The geometry is left where it was drawn rather than snapped to an
  // arbitrary group.
  const b = r.canvas.bbox();
  expect(b && [b.x0, b.y0]).toStrictEqual([2, 2]);
});

test("cohort with nothing to resolve against names what is known", () => {
  const cohorts = buildCohorts(family(SIBLINGS));
  expect(run("cohort owl", PARTS, { cohorts }).errors[0]).toContain(
    "known: bell"
  );
  expect(run("cohort bell", PARTS).errors[0]).toContain(
    "no cohorts were supplied"
  );
  expect(run("cohort", PARTS, { cohorts }).errors[0]).toContain(
    "or an `icon <slug>` line"
  );
});

test("fit after cohort is refused, because it undoes the inheritance", () => {
  const cohorts = buildCohorts(family(SIBLINGS));
  const r = run("icon bell-3\nrect 2,2 10x10 r2\ncohort\nfit", PARTS, {
    cohorts,
  });
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain("fit after cohort");
  // Refused, not half-applied: the cohort extent still stands.
  const b = r.canvas.bbox();
  expect(b && [b.x0, b.x1]).toStrictEqual([4, 20]);
});

test("a named turn places the part turned, transposing its extent", () => {
  const r = run("part cloud at 2,3 turn cw", PARTS);
  expect(r.errors).toStrictEqual([]);
  const b = r.canvas.bbox();
  // The part is 8x6; a quarter-turn makes it 6x8, seated at the coordinate.
  expect([b?.x0, b?.y0, b?.w, b?.h]).toStrictEqual([2, 3, 6, 8]);
});

test("a turn survives into the document as a turn", () => {
  const r = run("part cloud turn half", PARTS);
  expect(r.canvas.toJSON().draw).toStrictEqual([
    { id: "p0031", op: "part", scale: 1, turn: 2, x: 8, y: 9 },
  ]);
});

test("fill scales a turned part to the keyline it actually occupies", () => {
  const r = run("keyline tall\npart cloud fill turn ccw", PARTS);
  expect(r.errors).toStrictEqual([]);
  // 8x6 turned is 6x8; `tall` is 16x20 visual, so 14x18 of path room. The
  // height binds: 18/8 = 2.25, giving 13.5 x 18.
  expect(extent(r.canvas)).toStrictEqual({ cx: 12, cy: 12, h: 20, w: 15.5 });
});

test("flip mirrors the part and survives into the document", () => {
  const r = run("part cloud at 2,3 flip", PARTS);
  expect(r.errors).toStrictEqual([]);
  // A reflection leaves the extent alone, so the seating is unchanged.
  const b = r.canvas.bbox();
  expect([b?.x0, b?.y0, b?.w, b?.h]).toStrictEqual([2, 3, 8, 6]);
  expect(r.canvas.toJSON().draw).toStrictEqual([
    { flip: true, id: "p0031", op: "part", scale: 1, turn: 0, x: 2, y: 3 },
  ]);
});

test("flip and turn are recorded together", () => {
  const r = run("part cloud at 2,3 turn cw flip", PARTS);
  expect(r.errors).toStrictEqual([]);
  expect(r.canvas.toJSON().draw).toStrictEqual([
    { flip: true, id: "p0031", op: "part", scale: 1, turn: 1, x: 2, y: 3 },
  ]);
});

test("a part is placed unmirrored unless the program writes flip", () => {
  // The guard the whole design rests on: chirality is never inferred. A check
  // mark, a comma and an `S` are chiral, and their mirror is wrong rather than
  // another orientation, so `flip` has to be in the program text.
  for (const src of ["part cloud", "part cloud turn cw", "part cloud fill"]) {
    expect(run(src, PARTS).canvas.toJSON().draw[0]).not.toHaveProperty("flip");
  }
});

test("an unnamed turn is refused rather than read as an angle", () => {
  const r = run("part cloud turn 37", PARTS);
  expect(r.errors[0]).toMatch(/unknown turn "37" — expected one of/u);
});

test("a diagonal line is refused until the program says off-axis", () => {
  // `airdrop`'s beam: grid-legal endpoints, 38.16°, 6.84° off 45°. Legitimate —
  // 29.3% of the set's stroked icons have an edge like it — but the program has
  // to say so, the way `raw` has to be written out.
  const bare = run("line 4,11 11,16.5");
  expect(bare.errors[0]).toMatch(/off the nearest axis/u);
  expect(bare.canvas.elements).toStrictEqual([]);

  const asked = run("line 4,11 11,16.5 off-axis");
  expect(asked.errors).toStrictEqual([]);
  expect(asked.canvas.toJSON().draw).toStrictEqual([
    {
      offAxis: true,
      op: "line",
      points: [
        [4, 11],
        [11, 16.5],
      ],
    },
  ]);
});

test("off-axis is permission, so an axial line is still snapped and unmarked", () => {
  const r = run("line 4,4 16,4.3 off-axis");
  expect(r.errors).toStrictEqual([]);
  expect(r.canvas.toJSON().draw).toStrictEqual([
    {
      op: "line",
      points: [
        [4, 4],
        [16, 4],
      ],
    },
  ]);
});
