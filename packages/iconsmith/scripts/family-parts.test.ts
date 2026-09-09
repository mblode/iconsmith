import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  compileStyle,
  replayStyle,
  selectStyle,
  createStyleRevision,
  STYLE_COMPILER,
  styleHash,
} from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";
import { run as runDsl } from "../src/tools/dsl.js";
import {
  admitFamilyParts,
  createFamilySourceExactResolver,
  familySourceAssembly,
  familySourceAssemblyProgram,
  familySourceParts,
  familySourceProgram,
  inspectFamilySourceAdmission,
  inspectNativeSourceFidelity,
  inspectSourceBoundRegionEvidence,
} from "./family-parts.js";
import { SOURCE_FEATURE_ADMISSION_PROFILE } from "./source-feature-admission-profile.js";

const revision = () =>
  createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "family-test",
    masters: { "24": SPEC },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "test",
  });
const provenance = {
  date: "2026-09-07",
  licenses: ["MIT"],
  origin: "literal" as const,
  set: "blode-icons",
};
const requestSha256 = "1".repeat(64);
const hostManifestPath = "/host/source-exact.json";
const hostManifestSha256 = "0".repeat(64);
const bellSourceUrl = new URL(
  "../corpus/round-filled-radius-3-stroke-2/bell.svg",
  import.meta.url
);
test("keeps a source compound and counter together in an immutable revision", async () => {
  const initial = revision();
  const result = await admitFamilyParts(initial, "24", [
    {
      finish: "filled",
      name: "box",
      provenance,
      svg: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
    },
  ]);
  expect(initial.definition.parts).toHaveLength(0);
  expect(result.definition.parts).toHaveLength(1);
  expect(result.definition.parts[0].part.d.match(/M/gu)).toHaveLength(2);
});
test("shares exact source parts and placements with editable evidence programs", () => {
  const source = {
    finish: "filled" as const,
    name: "box",
    provenance,
    svg: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
  };
  expect(familySourceParts(source)).toMatchObject([
    { id: "box-filled-0", x: 4, y: 4 },
  ]);
  expect(familySourceProgram(source)).toBe(
    "icon box\nfinish filled\npart box-filled-0 at 4,4 scale 1"
  );
});
test("refuses mismatched paint and unsupported masks", async () => {
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "outlined",
        name: "box",
        provenance,
        svg: '<svg><path fill="black" stroke="black" d="M4 4H20V20H4Z"/></svg>',
      },
    ])
  ).rejects.toThrow("incompatible");
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "filled",
        name: "box",
        provenance,
        svg: '<svg><mask id="m"/></svg>',
      },
    ])
  ).rejects.toThrow("unsupported");
});
test("preserves nonzero source ink instead of imposing parity counters", async () => {
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "filled",
        name: "box",
        provenance,
        svg: '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
      },
    ])
  ).resolves.toMatchObject({
    definition: { parts: [{ part: { sourceFillRule: "nonzero" } }] },
  });
});

test("reports a lost native counter independently of aggregate raster error", async () => {
  const expected =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M2 2H22V22H2ZM11 11H13V13H11Z"/></svg>';
  const actual =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/></svg>';
  const result = await inspectNativeSourceFidelity(actual, expected, 24, [
    {
      height: 2,
      id: "small-counter",
      polarity: "clear",
      width: 2,
      x: 11,
      y: 11,
    },
  ]);

  expect(result.aggregateError).toBeLessThan(0.01);
  expect(result.status).toBe("topology-mismatch");
  expect(result.expectedTopology.map(({ holes }) => holes)).toEqual([1, 1, 1]);
  expect(result.actualTopology.map(({ holes }) => holes)).toEqual([0, 0, 0]);
  expect(result.features[0].status).toBe("mismatch");
  expect(result.features[0].thresholds.map(({ status }) => status)).toEqual([
    "mismatch",
    "mismatch",
    "mismatch",
  ]);
});

test.skipIf(!existsSync(bellSourceUrl))(
  "measures real compiled bell clearance and ink control at native 16 and 24",
  async () => {
    const sourceSvg = await readFile(bellSourceUrl, "utf-8");
    const source = {
      finish: "filled" as const,
      name: "bell",
      provenance: {
        date: "2026-09-07",
        icon: "bell.svg",
        origin: "central" as const,
        set: "central",
        version: "round-filled-radius-3-stroke-2",
      },
      svg: sourceSvg,
    };
    const disposition = await inspectFamilySourceAdmission(
      revision(),
      "24",
      source
    );
    expect(disposition.indexed.localFeature).toEqual({
      status: "not-measured",
    });
    const admitted = await admitFamilyParts(revision(), "24", [source]);
    const artifact = compileStyle(
      selectStyle(admitted, "24"),
      familySourceProgram(source)
    );
    const regions = [
      {
        height: 1.5,
        id: "body-clapper-clearance",
        polarity: "clear" as const,
        width: 8,
        x: 8,
        y: 17.5,
      },
      {
        height: 4,
        id: "body-ink-control",
        polarity: "ink" as const,
        width: 4,
        x: 10,
        y: 8,
      },
    ];

    for (const size of [16, 24] as const) {
      // The real admitted program is compared with its source, not a fabricated corpus.
      // eslint-disable-next-line no-await-in-loop
      const result = await inspectNativeSourceFidelity(
        artifact.svg,
        sourceSvg,
        size,
        regions
      );
      expect(result.features.map(({ id, status }) => ({ id, status }))).toEqual(
        [
          { id: "body-clapper-clearance", status: "match" },
          { id: "body-ink-control", status: "match" },
        ]
      );
      for (const feature of result.features) {
        expect(feature.thresholds).toHaveLength(3);
        expect(
          feature.thresholds.every(({ actual }) => actual.sampledPixels > 0)
        ).toBe(true);
        expect(
          feature.thresholds.some(({ actual }) => actual.targetPixels > 0)
        ).toBe(true);
      }
    }
  }
);

test("keeps threshold-sensitive feature differences uncertain", async () => {
  const expected =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="white" d="M11 11H13V13H11Z"/></svg>';
  const actual =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="rgb(150 150 150)" d="M11 11H13V13H11Z"/></svg>';
  const result = await inspectNativeSourceFidelity(actual, expected, 24, [
    {
      height: 2,
      id: "threshold-sensitive-counter",
      polarity: "clear",
      width: 2,
      x: 11,
      y: 11,
    },
  ]);

  expect(result.features[0].status).toBe("uncertain");
  expect(
    new Set(result.features[0].thresholds.map(({ status }) => status)).size
  ).toBeGreaterThan(1);
});

test("keeps an unsampled native feature region uncertain", async () => {
  const svg =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/></svg>';
  const result = await inspectNativeSourceFidelity(svg, svg, 16, [
    {
      height: 0.1,
      id: "subpixel-probe",
      polarity: "clear",
      width: 0.1,
      x: 0,
      y: 0,
    },
  ]);

  expect(result.features[0].status).toBe("uncertain");
  expect(
    result.features[0].thresholds.map(({ actual, status }) => ({
      sampledPixels: actual.sampledPixels,
      status,
    }))
  ).toEqual([
    { sampledPixels: 0, status: "uncertain" },
    { sampledPixels: 0, status: "uncertain" },
    { sampledPixels: 0, status: "uncertain" },
  ]);
});

test("keeps equal occupancy and peak clearance uncertain when the local mask shifts", async () => {
  const expected =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="white" d="M10 10H11V11H10Z"/></svg>';
  const actual =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="white" d="M11 10H12V11H11Z"/></svg>';
  const result = await inspectNativeSourceFidelity(actual, expected, 24, [
    {
      height: 1,
      id: "shifted-clear-pixel",
      polarity: "clear",
      width: 2,
      x: 10,
      y: 10,
    },
  ]);

  expect(result.features[0].status).toBe("uncertain");
  for (const threshold of result.features[0].thresholds) {
    expect(threshold.actual.occupancy).toBe(threshold.expected.occupancy);
    expect(threshold.actual.peakClearancePx).toBe(
      threshold.expected.peakClearancePx
    );
    expect(threshold.actual.targetMask).not.toBe(threshold.expected.targetMask);
    expect(threshold.status).toBe("uncertain");
  }
});

test("refuses invalid feature polarity and duplicate region ids", async () => {
  const svg =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/></svg>';
  const region = {
    height: 2,
    id: "probe",
    polarity: "clear" as const,
    width: 2,
    x: 2,
    y: 2,
  };

  await expect(
    inspectNativeSourceFidelity(svg, svg, 24, [
      { ...region, polarity: "unknown" as "clear" },
    ])
  ).rejects.toThrow("polarity must be clear or ink");
  await expect(
    inspectNativeSourceFidelity(svg, svg, 24, [region, region])
  ).rejects.toThrow("duplicate native feature region id");
});

test("outlined family keeps filled source boundaries and mixed solid details replayable", async () => {
  const result = await admitFamilyParts(revision(), "24", [
    {
      finish: "outlined",
      name: "boundary",
      provenance,
      svg: '<svg viewBox="0 0 24 24" fill="none"><path fill="currentColor" fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M9 12H15"/></svg>',
    },
  ]);
  const selection = selectStyle(result, "24");
  const artifact = compileStyle(
    selection,
    "icon boundary\nfinish outlined\npart boundary-outlined-0 at 4,4\npart boundary-outlined-1 at 9,12"
  );
  expect(artifact.svg).toContain('fill-rule="evenodd"');
  expect(artifact.svg).toContain('stroke-width="2"');
  const { run, completeProgram } = await import("../src/tools/dsl.js");
  const { Canvas } = await import("../src/tools/canvas.js");
  const drawn = run(artifact.program, [...selection.parts], {
    spec: selection.spec,
  });
  const doc = drawn.canvas.toJSON({ icon: drawn.icon, keyline: drawn.keyline });
  expect(
    completeProgram(doc, artifact.program, selection.parts, {
      spec: selection.spec,
    })
  ).toBe(true);
  expect(
    Canvas.fromJSON(doc, [...selection.parts], selection.spec).toSVG()
  ).toBe(artifact.svg);
});

const houseSourceUrl = (file: string) =>
  new URL(
    `../../../../blode-icons/packages/blode-icons-react/icons-svg/${file}`,
    import.meta.url
  );

test.skipIf(!existsSync(houseSourceUrl("branch-simple.svg")))(
  "source-exact binds an admitted profiled source and exact replay to one registry",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "branch-simple",
      provenance,
      svg: await readFile(houseSourceUrl("branch-simple.svg"), "utf-8"),
    };
    const resolver = await createFamilySourceExactResolver({
      hostManifestPath,
      hostManifestSha256,
      master: "24",
      representation: "indexed",
      requestSha256,
      revision: revision(),
      source,
    });
    const selection = selectStyle(resolver.revision, "24");
    const program = `icon branch-simple\nfinish outlined\nsource-exact ${resolver.bindingId}`;
    const artifact = compileStyle(selection, program, {
      sourceExact: resolver,
    });
    expect(artifact.sourceExactRegistryHash).toBe(resolver.registryHash);
    expect(replayStyle(selection, artifact, { sourceExact: resolver })).toBe(
      artifact.svg
    );
    expect(
      runDsl(program, [...selection.parts], {
        sourceExact: resolver,
        spec: { ...selection.spec, size: 16 },
      }).errors
    ).toContainEqual(
      expect.stringContaining("source-exact master spec mismatch")
    );
    const otherRequestResolver = await createFamilySourceExactResolver({
      hostManifestPath,
      hostManifestSha256,
      master: "24",
      representation: "indexed",
      requestSha256: "2".repeat(64),
      revision: revision(),
      source,
    });
    expect(otherRequestResolver.bindingId).not.toBe(resolver.bindingId);
    expect(() =>
      replayStyle(selection, artifact, { sourceExact: otherRequestResolver })
    ).toThrow("Replay unavailable for this source-exact registry");
    expect(() =>
      compileStyle(selection, program, {
        sourceExact: { ...resolver },
      })
    ).toThrow("source-exact programs require one matching icon");
    expect(() =>
      compileStyle(selection, `${program} at 1,2`, { sourceExact: resolver })
    ).toThrow("source-exact programs require one matching icon");
    expect(() =>
      compileStyle(selection, `${program}\ncenter`, { sourceExact: resolver })
    ).toThrow("source-exact programs require one matching icon");
    expect(() =>
      compileStyle(
        selection,
        `${program.replace("source-exact", "SOURCE-EXACT")}\nfit`,
        {
          sourceExact: resolver,
        }
      )
    ).toThrow("source-exact programs require one matching icon");
    expect(() =>
      compileStyle(selection, program.replace("branch-simple", "branch"), {
        sourceExact: resolver,
      })
    ).toThrow("source-exact programs require one matching icon");
    expect(() =>
      compileStyle(
        selection,
        "icon branch-simple\nfinish outlined\nsource-exact source-unknown",
        {
          sourceExact: resolver,
        }
      )
    ).toThrow("unknown source-exact binding");
    expect(() =>
      compileStyle(selection, program.replace("outlined", "filled"), {
        sourceExact: resolver,
      })
    ).toThrow("source-exact finish mismatch");
    await expect(
      createFamilySourceExactResolver({
        hostManifestPath,
        hostManifestSha256,
        master: "24",
        representation: "indexed",
        requestSha256,
        revision: revision(),
        source: { ...source, svg: `${source.svg}\n` },
      })
    ).rejects.toThrow("requires a pinned source-feature profile");
    await expect(
      createFamilySourceExactResolver({
        hostManifestPath,
        hostManifestSha256,
        master: "24",
        representation: "indexed",
        requestSha256,
        revision: revision(),
        source: {
          ...source,
          provenance: { ...source.provenance, set: "central" },
        },
      })
    ).rejects.toThrow("requires a pinned source-feature profile");
    await expect(
      createFamilySourceExactResolver({
        hostManifestPath,
        hostManifestSha256,
        master: "16",
        representation: "indexed",
        requestSha256,
        revision: revision(),
        source,
      })
    ).rejects.toThrow("requires a pinned source-feature profile");
    await expect(
      createFamilySourceExactResolver({
        hostManifestPath,
        hostManifestSha256,
        master: "24",
        representation: "indexed",
        requestSha256: "not-a-hash",
        revision: revision(),
        source,
      })
    ).rejects.toThrow("requires an exact request sha256");
  }
);

test.skipIf(!existsSync(houseSourceUrl("bell-filled.svg")))(
  "source-exact cannot turn Bell extraction into admission authority",
  async () => {
    const source = {
      finish: "filled" as const,
      name: "bell",
      provenance,
      svg: await readFile(houseSourceUrl("bell-filled.svg"), "utf-8"),
    };
    expect(familySourceParts(source)).toHaveLength(1);
    await expect(
      createFamilySourceExactResolver({
        hostManifestPath,
        hostManifestSha256,
        master: "24",
        representation: "indexed",
        requestSha256,
        revision: revision(),
        source,
      })
    ).rejects.toThrow("refused (refused/uncertain)");
  }
);

test.skipIf(!existsSync(houseSourceUrl("strawberry.svg")))(
  "source-exact explicitly refuses admitted assembly origin replay until semantics are preserved",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "strawberry",
      provenance,
      svg: await readFile(houseSourceUrl("strawberry.svg"), "utf-8"),
    };
    const disposition = await inspectFamilySourceAdmission(
      revision(),
      "24",
      source
    );
    expect(disposition.assembly.status).toBe("admitted");
    await expect(
      createFamilySourceExactResolver({
        hostManifestPath,
        hostManifestSha256,
        master: "24",
        representation: "assembly",
        requestSha256,
        revision: revision(),
        source,
      })
    ).rejects.toThrow("assembly origin replay is not implemented safely");
  }
);

test.skipIf(!existsSync(houseSourceUrl("airplane-up-filled.svg")))(
  "keeps valid indexed admission when its optional assembly fails",
  async () => {
    const source = {
      finish: "filled" as const,
      name: "airplane-up",
      provenance,
      svg: await readFile(houseSourceUrl("airplane-up-filled.svg"), "utf-8"),
    };
    await expect(
      inspectFamilySourceAdmission(revision(), "24", source)
    ).resolves.toEqual({
      assembly: {
        aggregateErrorBySize: { 16: 0.013373161764705882 },
        localFeature: { status: "not-measured" },
        reason: "airplane-up: assembly 16px source fidelity failed",
        status: "refused",
      },
      indexed: {
        aggregateErrorBySize: {
          16: 0.00664828431372549,
          24: 0.006617647058823529,
        },
        localFeature: { status: "not-measured" },
        status: "admitted",
      },
      source: { finish: "filled", name: "airplane-up" },
    });
    const admitted = await admitFamilyParts(revision(), "24", [source]);
    expect(admitted.definition.parts).toHaveLength(2);
    expect(
      admitted.definition.parts.every(
        ({ part }) => !part.sourceAssembly && !part.sourceAssemblyOnly
      )
    ).toBe(true);
  }
);

test.skipIf(!existsSync(houseSourceUrl("audible.svg")))(
  "admits a valid assembly with private children when indexed reconstruction fails",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "audible",
      provenance,
      svg: await readFile(houseSourceUrl("audible.svg"), "utf-8"),
    };
    const disposition = await inspectFamilySourceAdmission(
      revision(),
      "24",
      source
    );
    expect(disposition).toEqual({
      assembly: {
        aggregateErrorBySize: {
          16: 0.007965686274509803,
          24: 0.009327342047930284,
        },
        localFeature: { status: "not-measured" },
        status: "admitted",
      },
      indexed: {
        aggregateErrorBySize: {
          16: 0.00857843137254902,
          24: 0.010083061002178649,
        },
        localFeature: { status: "not-measured" },
        reason: "audible: 24px source fidelity failed",
        status: "refused",
      },
      source: { finish: "outlined", name: "audible" },
    });
    const admitted = await admitFamilyParts(revision(), "24", [source]);
    const alias = familySourceAssembly(source);
    const children = admitted.definition.parts.filter(
      ({ part }) => !part.sourceAssembly
    );
    expect(children).toHaveLength(4);
    expect(
      children.every(({ part }) => part.sourceAssemblyOnly === alias.id)
    ).toBe(true);
    const selection = selectStyle(admitted, "24");
    expect(() => compileStyle(selection, familySourceProgram(source))).toThrow(
      "private to assembly"
    );
    expect(
      compileStyle(selection, familySourceAssemblyProgram(source)).svg
    ).toContain("<path");
  }
);

test.skipIf(!existsSync(houseSourceUrl("angularjs.svg")))(
  "reports unsupported optional assembly without hiding indexed refusal",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "angularjs",
      provenance,
      svg: await readFile(houseSourceUrl("angularjs.svg"), "utf-8"),
    };
    const disposition = await inspectFamilySourceAdmission(
      revision(),
      "24",
      source
    );
    expect(disposition.assembly).toEqual({
      localFeature: { status: "not-measured" },
      reason:
        "angularjs: source assembly has unsupported inherited or resource semantics",
      status: "unsupported",
    });
    expect(disposition.indexed).toEqual({
      aggregateErrorBySize: { 16: 0.03987438725490196 },
      localFeature: { status: "not-measured" },
      reason: "angularjs: 16px source fidelity failed",
      status: "refused",
    });
    await expect(admitFamilyParts(revision(), "24", [source])).rejects.toThrow(
      "angularjs: 16px source fidelity failed"
    );
  }
);

test.skipIf(!existsSync(houseSourceUrl("bell-filled.svg")))(
  "enforces fixed local-feature profiles through public admission APIs",
  async () => {
    const files = new Map([
      ["bell", "bell-filled.svg"],
      ["bike", "bike-filled.svg"],
      ["branch-simple", "branch-simple.svg"],
      ["color-palette", "color-palette-filled.svg"],
      ["keyframe", "keyframe-filled.svg"],
      ["strawberry", "strawberry.svg"],
      ["zoom-in", "zoom-in-filled.svg"],
    ]);
    for (const profile of SOURCE_FEATURE_ADMISSION_PROFILE.entries) {
      const file = files.get(profile.sourceName);
      expect(file).toBeDefined();
      const candidate = {
        finish: profile.finish,
        name: profile.sourceName,
        provenance,
        // eslint-disable-next-line no-await-in-loop
        svg: await readFile(houseSourceUrl(file as string), "utf-8"),
      };
      // eslint-disable-next-line no-await-in-loop
      const disposition = await inspectFamilySourceAdmission(
        revision(),
        profile.targetMaster,
        candidate
      );
      const measured = disposition[profile.representation];
      expect(measured.localFeature).toMatchObject({
        evidenceBySize: { 16: expect.any(Object), 24: expect.any(Object) },
        profileHash: SOURCE_FEATURE_ADMISSION_PROFILE.profileHash,
        profileVersion: SOURCE_FEATURE_ADMISSION_PROFILE.version,
        status: profile.sourceName === "bell" ? "uncertain" : "pass",
      });
      if (profile.sourceName === "bell") {
        expect(measured.status).toBe("refused");
        // eslint-disable-next-line no-await-in-loop
        await expect(
          admitFamilyParts(revision(), profile.targetMaster, [candidate])
        ).rejects.toThrow("local feature uncertain");
      } else {
        expect(measured.status).toBe("admitted");
        // eslint-disable-next-line no-await-in-loop
        await expect(
          admitFamilyParts(revision(), profile.targetMaster, [candidate])
        ).resolves.toBeDefined();
      }
    }
  }
);

test.skipIf(!existsSync(houseSourceUrl("strawberry.svg")))(
  "does not bypass a calibrated representation with an unmeasured alternative or stale source",
  async () => {
    const svg = await readFile(houseSourceUrl("strawberry.svg"), "utf-8");
    const source = {
      finish: "outlined" as const,
      name: "strawberry",
      provenance,
      svg,
    };
    const disposition = await inspectFamilySourceAdmission(
      revision(),
      "24",
      source
    );
    expect(disposition.assembly).toMatchObject({
      localFeature: { status: "pass" },
      status: "admitted",
    });
    expect(disposition.indexed).toMatchObject({
      localFeature: { status: "profile-refused" },
      reason: expect.stringContaining("not independently profiled"),
      status: "refused",
    });

    const drifted = await inspectFamilySourceAdmission(revision(), "24", {
      ...source,
      svg: svg.replace("</svg>", "<!-- drift --></svg>"),
    });
    expect(drifted.indexed).toMatchObject({
      localFeature: { status: "profile-refused" },
      reason: expect.stringContaining("hash mismatch"),
      status: "refused",
    });
    expect(drifted.assembly).toMatchObject({
      localFeature: { status: "profile-refused" },
      reason: expect.stringContaining("hash mismatch"),
      status: "refused",
    });
  }
);

test.skipIf(!existsSync(houseSourceUrl("keyframe-filled.svg")))(
  "reports a named profiled source on another optical master as not measured",
  async () => {
    const source = {
      finish: "filled" as const,
      name: "keyframe",
      provenance,
      svg: await readFile(houseSourceUrl("keyframe-filled.svg"), "utf-8"),
    };
    const master16 = createStyleRevision({
      ...revision().definition,
      masters: { "16": { ...SPEC, size: 16 } },
    });
    const disposition = await inspectFamilySourceAdmission(
      master16,
      "16",
      source
    );
    expect(disposition.indexed).toMatchObject({
      localFeature: { status: "not-measured" },
      status: "admitted",
    });
  }
);

test.skipIf(!existsSync(houseSourceUrl("arrow-up.svg")))(
  "places actual overlapping arrow source children as one replayable ordered assembly",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "arrow-up",
      provenance,
      svg: await readFile(houseSourceUrl("arrow-up.svg"), "utf-8"),
    };
    const admitted = await admitFamilyParts(revision(), "24", [source]);
    const assembly = familySourceAssembly(source);
    expect(admitted.definition.parts.map(({ part }) => part.id)).toContain(
      assembly.id
    );
    const selection = selectStyle(admitted, "24");
    const artifact = compileStyle(
      selection,
      familySourceAssemblyProgram(source)
    );
    expect(artifact.svg.match(/<path /gu)).toHaveLength(2);
    const fidelityBySize = await Promise.all(
      ([16, 24] as const).map((size) =>
        inspectNativeSourceFidelity(artifact.svg, source.svg, size)
      )
    );
    for (const fidelity of fidelityBySize) {
      expect(fidelity.aggregateError).toBe(0);
      expect(fidelity.status).toBe("match");
    }
    const { run } = await import("../src/tools/dsl.js");
    const { Canvas } = await import("../src/tools/canvas.js");
    const drawn = run(
      familySourceAssemblyProgram(source),
      [...selection.parts],
      {
        spec: selection.spec,
      }
    );
    drawn.canvas.transform(0.75, 2, 3);
    expect(drawn.canvas.elements).toHaveLength(2);
    expect(drawn.canvas.toJSON().draw).toHaveLength(1);
    expect(
      Canvas.fromJSON(
        drawn.canvas.toJSON(),
        [...selection.parts],
        selection.spec
      ).toSVG()
    ).toBe(drawn.canvas.toSVG());
    const [handle] = drawn.canvas.elements;
    expect(drawn.canvas.remove(handle.id).removed).toHaveLength(2);
  }
);

test.skipIf(!existsSync(houseSourceUrl("arrow-up.svg")))(
  "rejects grouped source missing children, identity drift, nesting, amplification and bounds drift",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "arrow-up",
      provenance,
      svg: await readFile(houseSourceUrl("arrow-up.svg"), "utf-8"),
    };
    const admitted = await admitFamilyParts(revision(), "24", [source]);
    const definition = () =>
      structuredClone(admitted.definition) as typeof admitted.definition;
    const assemblyIndex = admitted.definition.parts.findIndex(({ part }) =>
      Boolean(part.sourceAssembly)
    );
    const childIndex = admitted.definition.parts.findIndex(
      ({ part }) => part.id === "arrow-up-outlined-0"
    );

    const missing = definition();
    missing.parts.splice(childIndex, 1);
    expect(() => createStyleRevision(missing)).toThrow("missing child");

    const drift = definition();
    drift.parts[childIndex].part.d += "M0 0";
    expect(() => createStyleRevision(drift)).toThrow("child identity drift");

    const nested = definition();
    nested.parts[childIndex].part.sourceAssembly = structuredClone(
      nested.parts[assemblyIndex].part.sourceAssembly
    );
    nested.parts.unshift(nested.parts.splice(assemblyIndex, 1)[0]);
    expect(() => createStyleRevision(nested)).toThrow("maximum depth 1");

    const amplified = definition();
    const assembly = amplified.parts[assemblyIndex].part.sourceAssembly;
    if (!assembly) {
      throw new Error("missing test assembly");
    }
    assembly.children = Array.from({ length: 65 }, () =>
      structuredClone(assembly.children[0])
    );
    expect(() => createStyleRevision(amplified)).toThrow();

    const bounds = definition();
    const boundsAssembly = bounds.parts[assemblyIndex].part.sourceAssembly;
    if (!boundsAssembly) {
      throw new Error("missing test assembly");
    }
    boundsAssembly.children[0].x += 1;
    expect(() => createStyleRevision(bounds)).toThrow("source-bound extent");

    expect(styleHash(admitted.definition.parts[childIndex].part)).toBe(
      admitted.definition.parts[assemblyIndex].part.sourceAssembly?.children[0]
        .partHash
    );
  }
);

test.skipIf(!existsSync(houseSourceUrl("pie-chart-1.svg")))(
  "refuses an actual duplicate stroke assembly whose butt caps differ from the round master",
  async () => {
    const source = {
      finish: "outlined" as const,
      name: "pie-chart-1",
      provenance,
      svg: await readFile(houseSourceUrl("pie-chart-1.svg"), "utf-8"),
    };
    const admitted = await admitFamilyParts(revision(), "24", [source]);
    expect(admitted.definition.parts.map(({ part }) => part.id)).not.toContain(
      familySourceAssembly(source).id
    );
    expect(() =>
      compileStyle(
        selectStyle(
          createStyleRevision({
            ...admitted.definition,
            parts: [
              ...admitted.definition.parts,
              {
                master: "24",
                part: familySourceAssembly(source).part,
                provenance,
              },
            ],
          }),
          "24"
        ),
        familySourceAssemblyProgram(source)
      )
    ).toThrow("child paint drift");
  }
);

test.skipIf(!existsSync(houseSourceUrl("golden-gate-bridge-filled.svg")))(
  "keeps actual duplicate evenodd children separate even when source admission remains refused",
  async () => {
    const source = {
      finish: "filled" as const,
      name: "golden-gate-bridge",
      provenance,
      svg: await readFile(
        houseSourceUrl("golden-gate-bridge-filled.svg"),
        "utf-8"
      ),
    };
    await expect(admitFamilyParts(revision(), "24", [source])).rejects.toThrow(
      "16px source fidelity failed"
    );
    const indexed = familySourceParts(source);
    const assembly = familySourceAssembly(source);
    const isolated = createStyleRevision({
      ...revision().definition,
      masters: { "24": { ...SPEC, partGeometry: "source" as const } },
      parts: [...indexed, assembly].map(({ part }) => ({
        master: "24",
        part,
        provenance,
      })),
    });
    const artifact = compileStyle(
      selectStyle(isolated, "24"),
      familySourceAssemblyProgram(source)
    );
    expect(artifact.svg.match(/<path /gu)).toHaveLength(2);
    const fidelityBySize = await Promise.all(
      ([16, 24] as const).map((size) =>
        inspectNativeSourceFidelity(artifact.svg, source.svg, size)
      )
    );
    for (const fidelity of fidelityBySize) {
      expect(fidelity.status).toBe("match");
    }
  }
);

test("refuses grouped inheritance, transforms, resources and non-house bounds before assembly admission", () => {
  const base = (svg: string) => ({
    finish: "outlined" as const,
    name: "guard",
    provenance,
    svg,
  });
  expect(() =>
    familySourceAssembly(
      base(
        '<svg viewBox="0 0 24 24"><g><path d="M1 1H2"/><path d="M3 3H4"/></g></svg>'
      )
    )
  ).toThrow("inherited or resource semantics");
  expect(() =>
    familySourceAssembly(
      base(
        '<svg viewBox="0 0 24 24"><path transform="scale(2)" d="M1 1H2"/><path d="M3 3H4"/></svg>'
      )
    )
  ).toThrow("inherited or resource semantics");
  expect(() =>
    familySourceAssembly(
      base(
        '<svg viewBox="0 0 24 24"><defs/><path stroke="url(#p)" d="M1 1H2"/><path d="M3 3H4"/></svg>'
      )
    )
  ).toThrow("inherited or resource semantics");
  expect(() =>
    familySourceAssembly(
      base(
        '<svg viewBox="0 0 48 48"><path d="M1 1H2"/><path d="M3 3H4"/></svg>'
      )
    )
  ).toThrow("viewBox 0 0 24 24");
});

const sourceBoundRequest = (
  actualSvg: string,
  sourceSvg: string,
  overrides: Record<string, unknown> = {}
) => {
  const source = {
    finish: "filled" as const,
    name: "bound-source",
    provenance,
    svg: sourceSvg,
  };
  return {
    actualFinish: "filled" as const,
    actualMaster: "24",
    actualSvg,
    declaration: {
      finish: "filled" as const,
      master: "24",
      mode: "development-only" as const,
      rasterization: { kind: "native-master" as const },
      regions: [
        {
          counterContract: true,
          height: 2,
          id: "small-counter",
          polarity: "clear" as const,
          semanticRole: "counter" as const,
          width: 2,
          x: 11,
          y: 11,
        },
      ],
      sourceName: source.name,
      sourceSha256: createHash("sha256").update(sourceSvg).digest("hex"),
    },
    nativeSize: 24 as const,
    revision: revision(),
    source,
    ...overrides,
  };
};

const sourceBoundExpected =
  '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M2 2H22V22H2ZM11 11H13V13H11Z"/></svg>';

test("passes exact development-only source-bound local evidence", async () => {
  const result = await inspectSourceBoundRegionEvidence(
    sourceBoundRequest(sourceBoundExpected, sourceBoundExpected)
  );

  expect(result.status).toBe("pass");
  expect(result.binding).toMatchObject({
    actualSvgSha256: createHash("sha256")
      .update(sourceBoundExpected)
      .digest("hex"),
    finish: "filled",
    master: "24",
    masterNativeSize: 24,
    nativeSize: 24,
    rasterization: { kind: "native-master" },
    sourceName: "bound-source",
  });
  expect(result.regions).toEqual([
    expect.objectContaining({
      mismatchThresholds: [],
      sourceCounterSuitability: "source-counter-stable",
      status: "match",
    }),
  ]);
});

test("separates native-master evidence from explicitly resampled evidence", async () => {
  const base = sourceBoundRequest(sourceBoundExpected, sourceBoundExpected);
  await expect(
    inspectSourceBoundRegionEvidence({ ...base, nativeSize: 16 })
  ).rejects.toThrow("native raster size does not match master");

  const resampled = await inspectSourceBoundRegionEvidence({
    ...base,
    declaration: {
      ...base.declaration,
      rasterization: { kind: "resampled-source" },
    },
    nativeSize: 16,
  });
  expect(resampled.binding).toMatchObject({
    master: "24",
    masterNativeSize: 24,
    nativeSize: 16,
    rasterization: { kind: "resampled-source" },
  });
  expect(resampled.status).toBe("uncertain");

  const native16 = await inspectSourceBoundRegionEvidence({
    ...base,
    actualMaster: "16",
    declaration: { ...base.declaration, master: "16" },
    nativeSize: 16,
    revision: createStyleRevision({
      ...base.revision.definition,
      masters: {
        ...base.revision.definition.masters,
        "16": { ...SPEC, size: 16 },
      },
    }),
  });
  expect(native16.binding).toMatchObject({
    master: "16",
    masterNativeSize: 16,
    nativeSize: 16,
    rasterization: { kind: "native-master" },
  });
  expect(native16.status).toBe("uncertain");

  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        rasterization: { kind: "resampled-source" },
      },
    })
  ).rejects.toThrow("resampled raster size matches master");
});

test.each([
  [
    "threshold-limited",
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="rgb(150 150 150)" d="M11 11H13V13H11Z"/></svg>',
    "source-counter-threshold-limited",
  ],
  [
    "absent",
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/></svg>',
    "source-counter-absent",
  ],
] as const)(
  "keeps an exact source %s counter contract uncertain",
  async (_name, sourceSvg, expectedSuitability) => {
    const result = await inspectSourceBoundRegionEvidence(
      sourceBoundRequest(sourceSvg, sourceSvg)
    );

    expect(result.fidelity.status).toBe("match");
    expect(result.fidelity.features[0].status).toBe("match");
    expect(result.regions[0]?.sourceCounterSuitability).toBe(
      expectedSuitability
    );
    expect(result.status).toBe("uncertain");
  }
);

test("fails persistent source-bound counter loss despite aggregate admission error", async () => {
  const actual =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/></svg>';
  const result = await inspectSourceBoundRegionEvidence(
    sourceBoundRequest(actual, sourceBoundExpected)
  );

  expect(result.fidelity.aggregateError).toBeLessThan(0.01);
  expect(result.status).toBe("fail");
  expect(result.regions[0]).toMatchObject({
    mismatchThresholds: [64, 128, 192],
    persistentChangedMaskPositions: 4,
    sourceCounterSuitability: "source-counter-stable",
  });
});

test("retains threshold-sensitive source-bound evidence as uncertain", async () => {
  const expected =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="white" d="M11 11H13V13H11Z"/></svg>';
  const actual =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2H22V22H2Z"/><path fill="rgb(150 150 150)" d="M11 11H13V13H11Z"/></svg>';
  const result = await inspectSourceBoundRegionEvidence(
    sourceBoundRequest(actual, expected)
  );

  expect(result.status).toBe("uncertain");
  expect(result.regions[0].mismatchThresholds.length).toBeLessThan(2);
});

test("rejects source-bound hash, master, and paint drift", async () => {
  const base = sourceBoundRequest(sourceBoundExpected, sourceBoundExpected);
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: { ...base.declaration, sourceSha256: "0".repeat(64) },
    })
  ).rejects.toThrow("source hash mismatch");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: { ...base.declaration, master: "16" },
    })
  ).rejects.toThrow("master mismatch");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      actualFinish: "outlined",
    })
  ).rejects.toThrow("paint mismatch");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      actualMaster: "missing",
      declaration: { ...base.declaration, master: "missing" },
    })
  ).rejects.toThrow();
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        mode: "production" as "development-only",
      },
    })
  ).rejects.toThrow("must be development-only");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        rasterization: { kind: "unknown" as "native-master" },
      },
    })
  ).rejects.toThrow("invalid source-bound rasterization");
});

test("rejects invalid, duplicate, and non-clear counter-bound regions", async () => {
  const base = sourceBoundRequest(sourceBoundExpected, sourceBoundExpected);
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: { ...base.declaration, regions: [] },
    })
  ).rejects.toThrow("declaration is empty");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        regions: [base.declaration.regions[0], base.declaration.regions[0]],
      },
    })
  ).rejects.toThrow("duplicate source-bound feature region id");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        regions: [{ ...base.declaration.regions[0], polarity: "ink" as const }],
      },
    })
  ).rejects.toThrow("counter contract must have clear polarity");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        regions: [
          {
            ...base.declaration.regions[0],
            semanticRole: "invented" as "counter",
          },
        ],
      },
    })
  ).rejects.toThrow("invalid source-bound semantic role");
  await expect(
    inspectSourceBoundRegionEvidence({
      ...base,
      declaration: {
        ...base.declaration,
        regions: [{ ...base.declaration.regions[0], width: 14 }],
      },
    })
  ).rejects.toThrow("must fit the 24-unit viewBox");
});
