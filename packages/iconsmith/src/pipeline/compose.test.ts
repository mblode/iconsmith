/**
 * What the raster is allowed to say.
 *
 * The tests that matter here are not the ones checking that two squares read as
 * two blocks — they are the ones checking that nothing else comes out. A
 * proposal is the only channel from an image model into this pipeline, so its
 * *shape* is the guarantee, and the shape is what is asserted.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { assertNoGeometry, compose, describeProposal } from "./compose.js";
import type { Proposal } from "./compose.js";

const draw = (body: string): Promise<Buffer> =>
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

const blank = (): Promise<Buffer> =>
  sharp({
    create: { background: "#fff", channels: 3, height: 256, width: 256 },
  })
    .png()
    .toBuffer();

describe("compose", () => {
  it("counts separated marks as elements and places them in cells", async () => {
    const p = await compose(
      await draw(
        '<rect x="2" y="9" width="6" height="6"/><rect x="16" y="9" width="6" height="6"/>'
      )
    );
    expect(p.elements).toBe(2);
    expect(p.blocks.map((b) => b.cell)).toEqual(["left", "right"]);
    expect(p.adjacency).toEqual(["block 2 sits right of block 1"]);
  });

  it("reads containment, which is the relation a drawer cannot guess", async () => {
    const p = await compose(
      await draw(
        '<rect x="3" y="3" width="18" height="18"/><circle cx="12" cy="12" r="3"/>'
      )
    );
    expect(p.elements).toBe(2);
    expect(p.adjacency).toEqual(["block 2 sits inside block 1"]);
    expect(p.blocks[0].size).toBe("dominant");
    expect(p.blocks[1].size).not.toBe("dominant");
  });

  it("bands sizes relative to the largest block, not in canvas units", async () => {
    const p = await compose(
      await draw(
        '<rect x="2" y="2" width="20" height="8"/><rect x="10" y="18" width="4" height="4"/>'
      )
    );
    expect(p.blocks[0].shape).toBe("wide");
    expect(p.blocks[0].size).toBe("dominant");
    expect(p.blocks[1].size).toBe("small");
  });

  it("says so when the sketch is empty rather than inventing a composition", async () => {
    const p = await compose(await blank());
    expect(p.elements).toBe(0);
    expect(p.blocks).toEqual([]);
    expect(describeProposal(p)).toContain("empty");
  });

  it("carries a 48px thumbnail and no other image", async () => {
    const p = await compose(await draw('<circle cx="12" cy="12" r="8"/>'));
    const meta = await sharp(Buffer.from(p.thumbnail, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([48, 48]);
  });

  /**
   * The invariant, stated as arithmetic. Every number that survives into a
   * proposal is a count or an ordinal, so nothing in it can be read as a
   * position or a size: there is no fractional value, and no value above the
   * number of blocks.
   */
  it("contains no number that is not a count or an ordinal", async () => {
    const p = await compose(
      await draw(
        '<rect x="3" y="4" width="14" height="10"/><circle cx="18" cy="17" r="4"/><rect x="4" y="17" width="4" height="4"/>'
      )
    );
    const { thumbnail: _thumbnail, ...words } = p;
    const numbers = [
      ...JSON.stringify(words).matchAll(/-?\d+(?:\.\d+)?/gu),
    ].map((m) => Number(m[0]));
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(p.elements);
    }
  });

  it("refuses a proposal that has grown a field it should not have", () => {
    const base: Proposal = {
      adjacency: [],
      blocks: [{ cell: "center", shape: "square", size: "dominant" }],
      elements: 1,
      parts: [],
      thumbnail: "",
    };
    expect(() => assertNoGeometry(base)).not.toThrow();

    const widened = {
      ...base,
      blocks: [{ ...base.blocks[0], x: 3, y: 4 }],
    } as unknown as Proposal;
    expect(() => assertNoGeometry(widened)).toThrow(/extra field/u);

    const smuggled = { ...base, adjacency: ["block 1 is at 3.25, 4.5"] };
    expect(() => assertNoGeometry(smuggled)).toThrow(/adjacency line/u);

    const miscounted = { ...base, elements: 4 };
    expect(() => assertNoGeometry(miscounted)).toThrow(/block count/u);
  });
});
