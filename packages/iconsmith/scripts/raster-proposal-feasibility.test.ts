import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  evaluateRasterProposalFixture,
  RasterProposalUnsupportedError,
  SUNBURST_OUTLINED_24_FIXTURE,
} from "./raster-proposal-feasibility.js";
import type { RasterProposalFixture } from "./raster-proposal-feasibility.js";

const raster = (body: string): Promise<Buffer> =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5">${body}</svg>`
    ),
    { density: 600 }
  )
    .resize(256, 256, { background: "#fff", fit: "contain" })
    .flatten({ background: "#fff" })
    .png()
    .toBuffer();

const digest = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const retainedSunburstCrop = path.resolve(
  process.cwd(),
  "../../.staging/wave-fb-images25-api-transparent-2026-09-09/outlined24.png"
);

const hostFixture = (image: Buffer): RasterProposalFixture => ({
  blockBindings: [[0], [1]],
  concept: "two-blocks",
  expectation: {
    adjacency: ["block 2 sits right of block 1"],
    blocks: [
      { cell: "left", shape: "square", size: "dominant" },
      { cell: "right", shape: "square", size: "dominant" },
    ],
  },
  finish: "outlined" as const,
  nativeSize: 24 as const,
  program: [
    "icon two-blocks",
    "finish outlined",
    "rect 3,8 6x8 r1",
    "rect 15,8 6x8 r1",
    "",
  ].join("\n"),
  provenance: {
    label: "Synthetic separated-block host fixture",
    origin: "synthetic-host-fixture" as const,
    references: [],
  },
  sourceDimensions: { height: 256, width: 256 },
  sourceSha256: digest(image),
});

describe("offline raster proposal feasibility", () => {
  it("produces an exact editable replay without raw path data", async () => {
    const image = await raster(
      '<rect x="3" y="8" width="6" height="8"/><rect x="15" y="8" width="6" height="8"/>'
    );
    const result = await evaluateRasterProposalFixture(
      image,
      hostFixture(image)
    );
    expect(result.diagnosticOnly).toBe(true);
    expect(result.editableReplay).toBe(true);
    expect(result.qualificationEligible).toBe(false);
    expect(result.replayProgram).toContain("rect 3,8 6x8 r1");
    expect(result.replayProgram).not.toMatch(/^raw\b/mu);
    expect(result.svg).toContain("<svg");
    expect(result.proposal).not.toHaveProperty("thumbnail");
    expect(result.proposal.thumbnailSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("refuses a connected two-element hypothesis that the pixel reader under-segments", async () => {
    const connected = await raster(
      '<rect x="3" y="5" width="17" height="14"/><circle cx="17" cy="17" r="4"/>'
    );
    await expect(
      evaluateRasterProposalFixture(connected, {
        ...hostFixture(connected),
        expectation: {
          adjacency: ["block 2 overlaps block 1"],
          blocks: [
            { cell: "center", shape: "square", size: "dominant" },
            {
              cell: "bottom-right",
              shape: "square",
              size: "small",
            },
          ],
        },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("expected 2 semantic block(s)"),
      name: "RasterProposalUnsupportedError",
      observed: { elements: 1 },
    });
  });

  it.skipIf(!existsSync(retainedSunburstCrop))(
    "refuses the retained D492 Sunburst crop when the offline pixel reader observes one block",
    async () => {
      const image = await readFile(retainedSunburstCrop);
      await expect(
        evaluateRasterProposalFixture(image, SUNBURST_OUTLINED_24_FIXTURE)
      ).rejects.toMatchObject({
        message: expect.stringContaining("expected 2 semantic block(s)"),
        name: "RasterProposalUnsupportedError",
        observed: { elements: 1 },
      });
    }
  );

  it("refuses raw path attempts and filesystem-path provenance", async () => {
    const image = await raster(
      '<rect x="3" y="8" width="6" height="8"/><rect x="15" y="8" width="6" height="8"/>'
    );
    await expect(
      evaluateRasterProposalFixture(image, {
        ...hostFixture(image),
        program: "icon two-blocks\nfinish outlined\nraw M0 0L1 1\n",
      })
    ).rejects.toBeInstanceOf(RasterProposalUnsupportedError);
    await expect(
      evaluateRasterProposalFixture(image, {
        ...hostFixture(image),
        provenance: {
          ...hostFixture(image).provenance,
          label: "/tmp/sketch.png",
        },
      })
    ).rejects.toThrow("not a filesystem path");
  });

  it("refuses changed source bytes, source dimensions, and any reference exposure", async () => {
    const image = await raster(
      '<rect x="3" y="8" width="6" height="8"/><rect x="15" y="8" width="6" height="8"/>'
    );
    await expect(
      evaluateRasterProposalFixture(image, {
        ...hostFixture(image),
        sourceSha256: "0".repeat(64),
      })
    ).rejects.toThrow("source bytes or source dimensions differ");
    await expect(
      evaluateRasterProposalFixture(image, {
        ...hostFixture(image),
        sourceDimensions: { height: 24, width: 24 },
      })
    ).rejects.toThrow("source bytes or source dimensions differ");
    await expect(
      evaluateRasterProposalFixture(image, {
        ...hostFixture(image),
        nativeSize: 16,
      })
    ).rejects.toThrow("DSL optical size differs");
    await expect(
      evaluateRasterProposalFixture(image, {
        ...hostFixture(image),
        provenance: {
          ...hostFixture(image).provenance,
          references: [{ licence: "declared-only", set: "unknown" }],
        },
      })
    ).rejects.toThrow("refuse reference exposure");
  });
});
