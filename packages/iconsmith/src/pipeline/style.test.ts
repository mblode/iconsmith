import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { specAt } from "../tools/canvas.js";
import { completeProgram, run } from "../tools/dsl.js";
import type { Part } from "../types.js";
import { generate } from "./generate.js";
import type { GenerateResult } from "./generate.js";
import { DEFAULT_POLICY } from "./policy.js";
import {
  STYLE_COMPILER,
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
  styleHash,
} from "./style.js";
import { createTools } from "./tools.js";

const definition = () => ({
  calibration: "unvalidated",
  compiler: STYLE_COMPILER,
  id: "test-thin",
  masters: {
    large: specAt(),
    small: specAt({ radius: 1, size: 16, stroke: 1.5 }),
  },
  parts: [],
  policy: DEFAULT_POLICY,
  references: [],
  rubric: "Test rubric: judge the selected thin family at native size.",
});
const selected = () => selectStyle(createStyleRevision(definition()), "small");
const program = (finish = "outlined") =>
  `icon container\nfinish ${finish}\nrect 4,4 16x16 r1`;
const privateSourceChild = (id: string, y: number): Part => ({
  closed: false,
  d: `M0 ${y}H2`,
  h: 0,
  icons: ["private-source"],
  id,
  instances: 1,
  nodes: 1,
  sizeRange: [2, 2],
  sourceAssemblyOnly: "private-source-assembly",
  w: 2,
});
const drawing = (style = selected(), finish = "outlined"): GenerateResult => {
  const half = style.spec.stroke / 2;
  const source =
    finish === "filled"
      ? `icon container\nfinish filled\nrect ${4 - half},${4 - half} ${16 + style.spec.stroke}x${16 + style.spec.stroke} r1`
      : program(finish);
  const compiled = compileStyle(style, source);
  const replay = run(source, [...style.parts], { spec: style.spec });
  return {
    clean: true,
    doc: replay.canvas.toJSON({ icon: replay.icon, keyline: replay.keyline }),
    issues: [],
    program: source,
    steps: 1,
    styleKey: style.key,
    svg: compiled.svg,
    text: "",
    trace: ["rect"],
  };
};
const extra: Part = {
  closed: true,
  d: "M0 0H8V8H0Z",
  h: 8,
  icons: ["body"],
  id: "body",
  instances: 1,
  nodes: 4,
  sizeRange: [8, 8],
  w: 8,
};

describe("pinned styles", () => {
  it("lets the selected-style model inspect a clean render before it finishes", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        calls += 1;
        const operations =
          calls === 1
            ? [{ input: { h: 16, r: 1, w: 16, x: 4, y: 4 }, name: "rect" }]
            : [
                { input: {}, name: "render" },
                { input: {}, name: "lint" },
              ];
        return {
          content:
            calls < 3
              ? operations.map(({ name, input }) => ({
                  input: JSON.stringify(input),
                  toolCallId: `${name}-${calls}`,
                  toolName: name,
                  type: "tool-call" as const,
                }))
              : [
                  {
                    text: "I inspected the render; complete.",
                    type: "text" as const,
                  },
                ],
          finishReason: calls < 3 ? "tool-calls" : "stop",
          usage: {
            inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
            outputTokens: { reasoning: 0, text: 1, total: 1 },
          },
          warnings: [],
        };
      },
    });
    const result = await generate(
      { name: "container" },
      {
        maxSteps: 4,
        model,
        style: selected(),
      }
    );
    expect(calls).toBe(3);
    expect(result.text).toContain("inspected the render");
  });

  it("rejects unavailable compilers, unsupported canvas units and unknown masters", () => {
    expect(() =>
      createStyleRevision({ ...definition(), compiler: "old" })
    ).toThrow();
    expect(() =>
      createStyleRevision({
        ...definition(),
        masters: { native: { ...specAt(), canvas: 16 } },
      })
    ).toThrow();
    expect(() =>
      selectStyle(createStyleRevision(definition()), "missing")
    ).toThrow("Unavailable");
  });

  it("pins content independently of JSON key order and prevents mutation", () => {
    const input = definition();
    const revision = createStyleRevision(input);
    expect(
      createStyleRevision(
        Object.fromEntries(Object.entries(input).toReversed())
      ).hash
    ).toBe(revision.hash);
    input.masters.small.stroke = 9;
    expect(revision.definition.masters.small.stroke).toBe(1.5);
    expect(() => {
      revision.definition.masters.small.stroke = 9;
    }).toThrow();
    expect(selectStyle(revision, "small").key).not.toBe(
      selectStyle(revision, "large").key
    );
    expect(() => compileStyle({ ...selected() }, program())).toThrow(
      "not admitted"
    );
  });

  it("keeps source admission and master-specific parts", () => {
    expect(() =>
      createStyleRevision({
        ...definition(),
        references: [
          {
            master: "small",
            name: "foreign",
            provenance: {
              date: "2026-09-05",
              origin: "original",
              set: "raycast",
            },
            svg: "<svg/>",
          },
        ],
      })
    ).toThrow("raycast");
    const revision = createStyleRevision({
      ...definition(),
      parts: [
        {
          master: "small",
          part: extra,
          provenance: { date: "2026-09-05", origin: "original" },
        },
      ],
    });
    expect(selectStyle(revision, "small").parts).toHaveLength(1);
    expect(selectStyle(revision, "large").parts).toHaveLength(0);
  });

  it("replays the exact SVG and refuses altered artifacts or another master", () => {
    const style = selected();
    const artifact = compileStyle(style, program());
    expect(artifact.svg).toContain('stroke-width="1.5"');
    expect(replayStyle(style, artifact)).toBe(artifact.svg);
    expect(() => replayStyle(style, { ...artifact, compiler: "old" })).toThrow(
      "unavailable"
    );
    expect(() => replayStyle(style, { ...artifact, svg: "<svg/>" })).toThrow(
      "differs"
    );
    expect(() =>
      replayStyle(selectStyle(style.revision, "large"), artifact)
    ).toThrow("unavailable");
    const result = drawing(style);
    expect(
      completeProgram(result.doc, result.program, [], { spec: style.spec })
    ).toBe(true);
    // The old document comparison cannot see stroke width. Exact SVG replay
    // is necessary even when that legacy check happens to pass.
    expect(run(result.program ?? "").canvas.toSVG()).not.toBe(result.svg);
    const retiered = run(program().replace("r1", "r3"), [], {
      spec: style.spec,
    });
    const doc = retiered.canvas.toJSON({
      icon: retiered.icon,
      keyline: retiered.keyline,
    });
    expect(
      completeProgram(doc, program().replace("r1", "r3"), [], {
        spec: style.spec,
      })
    ).toBe(true);
    expect(completeProgram(doc, program().replace("r1", "r3"))).toBe(false);
  });

  it("disables implicit house lookup while preserving the old tool surface", async () => {
    const empty = createTools({ allowHouseConstruction: false });
    expect(empty.tools).not.toHaveProperty("listParts");
    expect(empty.tools).not.toHaveProperty("part");
    const scoped = createTools({
      allowHouseConstruction: false,
      parts: [extra],
    });
    expect(scoped.tools).not.toHaveProperty("construct");
    expect(createTools().tools).toHaveProperty("construct");
    const found = await scoped.tools.listParts.execute?.(
      { query: "home" },
      { messages: [], toolCallId: "test" }
    );
    expect(found).not.toHaveProperty("constructable");
    expect(found).not.toHaveProperty("construction");
  });

  it("refuses missing, mismatched and tampered companion contexts before model calls", async () => {
    const style = selected();
    const companion = compileStyle(style, program("filled"));
    await Promise.all(
      [
        { companion },
        { companion, finish: "filled" as const, style },
        { companion: { ...companion, svg: "tampered" }, style },
        { companion: { ...companion, master: "other" }, style },
        { companion: { ...companion, style: "other" }, style },
      ].map((options) =>
        expect(
          generate(
            { name: "container" },
            { ...options, model: "test/not-called" }
          )
        ).rejects.toThrow()
      )
    );
  });

  it("generates through the model tools under the pinned spec without a house shortcut", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: (options) => {
        calls += 1;
        expect(options.maxOutputTokens).toBe(8192);
        expect(options.providerOptions?.anthropic).toEqual({
          effort: "medium",
        });
        if (calls === 1) {
          const brief = options.prompt.find(
            (message) => message.role === "user"
          );
          expect(JSON.stringify(brief)).toContain("Study them before drawing");
          expect(JSON.stringify(brief)).toContain("Reference: container");
          expect(JSON.stringify(brief)).toContain(
            "Unapproved companion draft (filled)"
          );
          expect(JSON.stringify(brief)).toContain("Keep the opening generous");
          expect(JSON.stringify(brief)).not.toContain("already holds");
          expect(brief?.content.some((part) => part.type === "file")).toBe(
            true
          );
        }
        expect(
          options.tools?.some(
            (tool) => tool.type === "function" && tool.name === "construct"
          )
        ).toBe(false);
        return {
          content:
            calls === 1
              ? [
                  {
                    input: JSON.stringify({ h: 16, r: 1, w: 16, x: 4, y: 4 }),
                    toolCallId: "rect",
                    toolName: "rect",
                    type: "tool-call",
                  },
                ]
              : [{ text: "done", type: "text" }],
          finishReason: calls === 1 ? "tool-calls" : "stop",
          usage: {
            inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
            outputTokens: { reasoning: 0, text: 1, total: 1 },
          },
          warnings: [],
        };
      },
    });
    const style = selectStyle(
      createStyleRevision({
        ...definition(),
        references: [
          {
            master: "small",
            name: "container",
            provenance: { date: "2026-09-05", origin: "original" },
            svg: compileStyle(selected(), program()).svg,
          },
        ],
      }),
      "small"
    );
    const result = await generate(
      { guidance: "Keep the opening generous", name: "home" },
      {
        companion: compileStyle(style, program("filled")),
        maxOutputTokens: 8192,
        maxSteps: 2,
        model,
        providerOptions: { anthropic: { effort: "medium" } },
        style,
      }
    );
    expect(calls).toBeGreaterThan(0);
    expect(result.styleKey).toBe(style.key);
    expect(result.svg).toContain('stroke-width="1.5"');
    const completedCalls = calls;
    await Promise.all(
      [0, -1, 1.5, 16_385, Number.POSITIVE_INFINITY].map((maxOutputTokens) =>
        expect(
          generate({ name: "home" }, { maxOutputTokens, model, style })
        ).rejects.toThrow("maxOutputTokens")
      )
    );
    expect(calls).toBe(completedCalls);
    await expect(
      generate({ name: "home" }, { model, parts: [], style })
    ).rejects.toThrow("owns");
  });
});

it.each(["MNaN NaNLNaN NaN", " ", "M0 0L1e309 0"])(
  "rejects malformed admitted part geometry before generation: %s",
  (d) => {
    expect(() =>
      createStyleRevision({
        ...definition(),
        parts: [
          {
            master: "small",
            part: { ...extra, d },
            provenance: { date: "2026-09-05", origin: "original" },
          },
        ],
      })
    ).toThrow("Invalid geometry for style part");
  }
);

it.each([
  ["stroke width", { strokeWidth: 2 }],
  ["stroke cap", { cap: "butt" as const }],
  ["stroke join", { join: "bevel" as const }],
])(
  "rejects a source assembly child whose %s differs from its master",
  (_, drift) => {
    const child: Part = {
      closed: false,
      d: "M0 0H4V4",
      h: 4,
      icons: ["assembly"],
      id: "assembly-child",
      instances: 1,
      nodes: 2,
      sizeRange: [4, 4],
      w: 4,
    };
    const sibling = { ...child, d: "M0 0V4", id: "assembly-sibling", w: 0 };
    const semantics = {
      cap: "round" as const,
      join: "round" as const,
      kind: "stroke" as const,
      strokeWidth: 1.5,
      ...drift,
    };
    const assembly: Part = {
      ...child,
      d: "M0 0H4V4M0 0V4",
      id: "assembly",
      nodes: 3,
      sourceAssembly: {
        children: [child, sibling].map((part) => ({
          partHash: styleHash(part),
          partId: part.id,
          semantics,
          x: 0,
          y: 0,
        })),
        finish: "outlined",
        sourceHash: "0".repeat(64),
        viewBox: "0 0 24 24",
      },
    };
    expect(() =>
      createStyleRevision({
        ...definition(),
        parts: [child, sibling, assembly].map((part) => ({
          master: "small",
          part,
          provenance: { date: "2026-09-08", origin: "original" },
        })),
      })
    ).toThrow("child paint drift");
  }
);

it("binds private source children to one existing owning assembly", () => {
  const children = [
    privateSourceChild("private-a", 0),
    privateSourceChild("private-b", 1),
  ];
  const assembly: Part = {
    closed: false,
    d: children.map(({ d }) => d).join(""),
    h: 1,
    icons: ["private-source"],
    id: "private-source-assembly",
    instances: 1,
    nodes: 2,
    sizeRange: [2, 2],
    sourceAssembly: {
      children: children.map((part) => ({
        partHash: styleHash(part),
        partId: part.id,
        semantics: {
          cap: "round",
          join: "round",
          kind: "stroke",
          strokeWidth: 1.5,
        },
        x: 0,
        y: 0,
      })),
      finish: "outlined",
      sourceHash: "0".repeat(64),
      viewBox: "0 0 24 24",
    },
    w: 2,
  };
  const entries = [...children, assembly].map((part) => ({
    master: "small",
    part,
    provenance: { date: "2026-09-08", origin: "original" as const },
  }));
  expect(() =>
    createStyleRevision({ ...definition(), parts: entries })
  ).not.toThrow();

  const missing = structuredClone(entries);
  missing.pop();
  expect(() =>
    createStyleRevision({ ...definition(), parts: missing })
  ).toThrow("missing assembly");

  const forged = structuredClone(entries);
  forged[2].part.sourceAssemblyOnly = "private-source-assembly";
  expect(() => createStyleRevision({ ...definition(), parts: forged })).toThrow(
    "cannot itself be a private dependency"
  );

  const foreign = structuredClone(entries);
  foreign[0].part.sourceAssemblyOnly = "foreign-assembly";
  expect(() =>
    createStyleRevision({ ...definition(), parts: foreign })
  ).toThrow("private child");
});

it("rejects caller-supplied mixed fill and stroke children in a filled assembly", () => {
  const fill: Part = {
    closed: true,
    d: "M0 0H1V1H0Z",
    h: 1,
    icons: ["mixed"],
    id: "mixed-fill",
    instances: 1,
    nodes: 4,
    sizeRange: [1, 1],
    sourceFillRule: "nonzero",
    w: 1,
  };
  const stroke: Part = {
    closed: false,
    d: "M1 0V1",
    h: 1,
    icons: ["mixed"],
    id: "mixed-stroke",
    instances: 1,
    nodes: 1,
    sizeRange: [1, 1],
    w: 0,
  };
  const assembly: Part = {
    ...fill,
    d: `${fill.d}${stroke.d}`,
    id: "mixed-assembly",
    nodes: 5,
    sourceAssembly: {
      children: [
        {
          partHash: styleHash(fill),
          partId: fill.id,
          semantics: { fillRule: "nonzero", kind: "fill" },
          x: 0,
          y: 0,
        },
        {
          partHash: styleHash(stroke),
          partId: stroke.id,
          semantics: {
            cap: "round",
            join: "round",
            kind: "stroke",
            strokeWidth: 1.5,
          },
          x: 0,
          y: 0,
        },
      ],
      finish: "filled",
      sourceHash: "1".repeat(64),
      viewBox: "0 0 24 24",
    },
    sourceFillRule: undefined,
  };
  expect(() =>
    createStyleRevision({
      ...definition(),
      parts: [fill, stroke, assembly].map((part) => ({
        master: "small",
        part,
        provenance: { date: "2026-09-08", origin: "original" as const },
      })),
    })
  ).toThrow("mixes fill and stroke paint");
});
