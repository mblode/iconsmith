import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  corruptControlSvg,
  generateAiControlPacket,
} from "./ai-control-packet.js";

const repo = path.resolve(import.meta.dirname, "../../..");
const blode =
  "/Users/mblode/Code/mblode/blode-icons/packages/blode-icons-react";

test("host corruption carries a measured objective probe", async () => {
  const svg = readFileSync(path.join(blode, "icons-svg/folder-1.svg"), "utf-8");
  const result = await corruptControlSvg(svg, 0);
  expect(result.probe.changedPixels).toBeGreaterThan(80);
  expect(result.svg).not.toBe(svg);
});

test("builds blinded packets from actual canonical library sources", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "ai-controls-")),
    "packet"
  );
  const result = await generateAiControlPacket({
    cohortsFile: path.join(blode, "icons-data/_cohorts.json"),
    conceptsFile: path.join(blode, "icons-data/_concepts.json"),
    developmentManifest: path.join(
      repo,
      "docs/log/quality-development-campaign-manifest-2026-09-07.json"
    ),
    library: path.join(blode, "icons-svg"),
    out,
    sourceCount: 10,
  });
  expect(result.manifest.manifest).toMatchObject({
    instrumentQualified: false,
    scoredStimuli: 20,
    sourceNegatives: 10,
    sourcePositives: 10,
  });
  expect(result.packet.images).toHaveLength(10);
  expect(JSON.stringify(result.packet)).not.toContain("sourceSlug");
  expect(result.sealed).toHaveLength(20);
  expect(
    new Set(result.sealed.map((row) => (row as { kind: string }).kind))
  ).toEqual(new Set(["positive", "negative"]));
});

test("builds independent qualification controls across paint and native-size strata", async () => {
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), "ai-qualification-")),
    "packet"
  );
  const result = await generateAiControlPacket({
    cohortsFile: path.join(blode, "icons-data/_cohorts.json"),
    conceptsFile: path.join(blode, "icons-data/_concepts.json"),
    developmentManifest: path.join(
      repo,
      "docs/log/quality-development-campaign-manifest-2026-09-07.json"
    ),
    library: path.join(blode, "icons-svg"),
    out,
    qualification: true,
    qualificationVersion: "v3",
    sourceCount: 8,
  });
  const allRows = result.sealed as {
    canonicalArtifactHash: string;
    family: string;
    finish: string;
    kind: string;
    nativeSize: number;
    presentationOf?: string;
    recognitionAnswer: string;
    recognitionChoices: string[];
  }[];
  const rows = allRows.filter(({ presentationOf }) => !presentationOf);
  const developmentFamilies = new Set(
    (
      JSON.parse(
        readFileSync(
          path.join(
            repo,
            "docs/log/quality-development-campaign-manifest-2026-09-07.json"
          ),
          "utf-8"
        )
      ) as { manifest: { concepts: { family: string }[] } }
    ).manifest.concepts.map(({ family }) => family)
  );
  expect(rows).toHaveLength(8);
  expect(new Set(rows.map(({ family }) => family))).toHaveLength(8);
  expect(rows.some(({ family }) => developmentFamilies.has(family))).toBe(
    false
  );
  expect(rows.filter(({ kind }) => kind === "positive")).toHaveLength(4);
  expect(rows.filter(({ kind }) => kind === "negative")).toHaveLength(4);
  expect(
    rows.every(
      ({ recognitionAnswer, recognitionChoices }) =>
        recognitionChoices.length >= 3 &&
        recognitionChoices.includes(recognitionAnswer)
    )
  ).toBe(true);
  const presentations = allRows.filter(({ presentationOf }) => presentationOf);
  expect(presentations).toHaveLength(2);
  expect(
    presentations.every(
      ({ canonicalArtifactHash, presentationOf }) =>
        canonicalArtifactHash !== presentationOf &&
        rows.some(
          ({ canonicalArtifactHash: original }) => original === presentationOf
        )
    )
  ).toBe(true);
  expect(
    Object.fromEntries(
      ["outlined-16", "outlined-24", "filled-16", "filled-24"].map(
        (stratum) => [
          stratum,
          rows.filter(
            ({ finish, nativeSize }) => `${finish}-${nativeSize}` === stratum
          ).length,
        ]
      )
    )
  ).toEqual({
    "filled-16": 2,
    "filled-24": 2,
    "outlined-16": 2,
    "outlined-24": 2,
  });
  expect(result.manifest.manifest).toMatchObject({
    independentSourceFamilies: 8,
    presentationControls: 2,
    qualificationEligible: false,
    sourceNegatives: 4,
    sourcePositives: 4,
  });
});
