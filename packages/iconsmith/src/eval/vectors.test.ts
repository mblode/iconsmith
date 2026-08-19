import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { dot, EmbeddingError, loadEmbeddings } from "./vectors.js";

const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-vectors-"));

const write = (
  name: string,
  rows: number[][],
  index: Record<string, unknown>
): void => {
  writeFileSync(
    path.join(dir, `${name}.f32`),
    Buffer.from(new Float32Array(rows.flat()).buffer)
  );
  writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify({
      builtAt: "2026-08-19T00:00:00Z",
      dim: rows[0]?.length ?? 0,
      ids: rows.map((_, i) => `x/${i}`),
      model: "test",
      normalised: true,
      ...index,
    })
  );
};

describe("loadEmbeddings", () => {
  it("reports null for an absent sidecar rather than throwing", () => {
    // This is the degradation path the whole design turns on: a machine with no
    // Python must still run an eval, with the embedding metrics reporting null.
    expect(loadEmbeddings(dir, "nothing-here")).toBeNull();
  });

  it("reads rows back by id", () => {
    write("ok", [
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const e = loadEmbeddings(dir, "ok");
    expect(e?.rows).toBe(2);
    expect([...(e?.get("x/1") ?? [])]).toEqual([0, 1, 0]);
    expect(e?.get("x/9")).toBeNull();
  });

  it("throws when the byte count and the row count disagree", () => {
    // A mis-sized sidecar does not fail to read; it reads the wrong icon's
    // vector and returns a plausible number, which is the worst kind of bug.
    write("short", [[1, 0, 0]], { ids: ["x/0", "x/1"] });
    expect(() => loadEmbeddings(dir, "short")).toThrow(EmbeddingError);
  });

  it("throws when the index does not declare its rows normalised", () => {
    write("raw", [[3, 4]], { normalised: false });
    expect(() => loadEmbeddings(dir, "raw")).toThrow(EmbeddingError);
  });
});

describe("dot", () => {
  it("is the cosine of two unit vectors", () => {
    expect(dot(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
    expect(dot(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });
});
