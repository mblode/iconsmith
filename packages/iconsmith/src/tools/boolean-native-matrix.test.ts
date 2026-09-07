import sharp from "sharp";
import { expect, test } from "vitest";

import { parsePath } from "../geometry/path.js";
import { Canvas } from "./canvas.js";
import { run } from "./dsl.js";
import { programFromDoc } from "./twin.js";

interface Probe {
  clear: readonly [number, number][];
  ink: readonly [number, number][];
  minInk?: number;
  name: string;
  source: string;
}

const cases: Probe[] = [
  {
    clear: [
      [9, 12],
      [15, 12],
    ],
    ink: [
      [4, 12],
      [20, 12],
    ],
    name: "connected cutters",
    source:
      "rect 2,2 20x20 r2\nrect 6,8 6x8 r1\nrect 12,8 6x8 r1\nunion\nsubtract",
  },
  {
    clear: [
      [10, 12],
      [12, 12],
      [14, 12],
    ],
    ink: [[4, 12]],
    name: "overlapping cutters",
    source:
      "rect 2,2 20x20 r2\ncircle 10,12 r4\ncircle 14,12 r4\nunion\nsubtract",
  },
  {
    clear: [
      [12, 6],
      [12, 14],
    ],
    ink: [
      [4, 10],
      [20, 10],
    ],
    name: "tangent cutters",
    source:
      "rect 2,2 20x20 r2\ncircle 12,6 r4\ncircle 12,14 r4\nunion\nsubtract",
  },
  {
    clear: [
      [12, 12],
      [15, 12],
    ],
    ink: [[5, 12]],
    name: "nested holes remain monotonic",
    source: "rect 2,2 20x20 r2\nhole circle 12,12 r6\nhole circle 12,12 r3",
  },
  {
    clear: [
      [7, 12],
      [17, 12],
    ],
    ink: [
      [12, 12],
      [12, 4],
    ],
    minInk: 64,
    name: "one-unit bridge",
    source:
      "rect 2,2 20x20 r1\nrect 3,6 8.5x12 r1\nrect 12.5,6 8.5x12 r1\nunion\nsubtract",
  },
  {
    clear: [[12, 18]],
    ink: [
      [6, 18],
      [18, 18],
    ],
    name: "rounded Boolean join",
    source: "rect 2,2 20x20 r0\nrect 9,15 6x9 r0\nsubtract r1",
  },
];

const alphaAt = (
  data: Buffer,
  size: number,
  point: readonly [number, number]
) => {
  const x = Math.floor((point[0] / 24) * size);
  const y = Math.floor((point[1] / 24) * size);
  return data[(y * size + x) * 4 + 3];
};

test.each(cases)(
  "$name preserves native raster polarity and exact topology replay",
  async ({ clear, ink, minInk = 128, source }) => {
    const result = run(`icon boolean-native-matrix\nfinish filled\n${source}`);
    expect(result.errors).toEqual([]);
    expect(
      parsePath(result.canvas.elements[0].d).every((path) => path.closed)
    ).toBe(true);
    const doc = result.canvas.toJSON();
    expect(Canvas.fromJSON(doc).toSVG()).toBe(result.canvas.toSVG());
    expect(run(programFromDoc(doc)).canvas.toSVG()).toBe(result.canvas.toSVG());
    for (const size of [16, 24]) {
      // eslint-disable-next-line no-await-in-loop
      const data = await sharp(Buffer.from(result.canvas.toSVG()))
        .resize(size, size)
        .ensureAlpha()
        .raw()
        .toBuffer();
      for (const point of ink) {
        expect(alphaAt(data, size, point)).toBeGreaterThan(minInk);
      }
      for (const point of clear) {
        expect(alphaAt(data, size, point)).toBeLessThan(128);
      }
    }
  }
);
