import { describe, expect, it } from "vitest";

import { answerableSlugs, rankAt1, semanticRank } from "./semantic.js";
import type { SemanticResult } from "./semantic.js";
import type { Embeddings } from "./vectors.js";

const fake = (rows: Record<string, number[]>): Embeddings => {
  const vectors = new Map(
    Object.entries(rows).map(([id, v]) => {
      const norm = Math.hypot(...v);
      return [id, new Float32Array(v.map((x) => x / norm))] as const;
    })
  );
  return {
    builtAt: "",
    dim: 2,
    get: (id) => vectors.get(id) ?? null,
    has: (id) => vectors.has(id),
    ids: [...vectors.keys()],
    model: "fake",
    rows: vectors.size,
  };
};

const bank = { bin: "trash", info: "info", rubbish: "trash", ufo: "ufo" };

const text = fake({
  bin: [1, 0],
  info: [0, 1],
  rubbish: [0.9, 0.1],
  ufo: [-1, 0],
});

const unit = (v: number[]): Float32Array => {
  const norm = Math.hypot(...v);
  return new Float32Array(v.map((x) => x / norm));
};

describe("semanticRank", () => {
  it("ranks 1 when the icon's own concept scores highest", () => {
    const r = semanticRank(unit([1, 0]), "trash", bank, text);
    expect(r.rank).toBe(1);
    expect(r.concept).toBe("bin");
    expect(r.margin).toBeGreaterThan(0);
  });

  it("takes the best of several concepts mapping to one slug", () => {
    // `bin` and `rubbish` both answer `trash`. An icon nearer `rubbish` should
    // be credited with `rubbish`, not penalised against `bin`.
    const r = semanticRank(unit([0.9, 0.1]), "trash", bank, text);
    expect(r.concept).toBe("rubbish");
    expect(r.rank).toBe(1);
  });

  it("reports a negative margin when a wrong concept wins", () => {
    const r = semanticRank(unit([0, 1]), "trash", bank, text);
    expect(r.rank).toBeGreaterThan(1);
    expect(r.margin).toBeLessThan(0);
  });

  it("returns a null rank when the slug answers no concept", () => {
    // Not the same fact as ranking last: the question is unanswerable, and
    // scoring it 0 would make the metric measure concept-table coverage.
    const r = semanticRank(unit([1, 0]), "not-in-the-bank", bank, text);
    expect(r.rank).toBeNull();
    expect(r.concept).toBeNull();
  });

  it("reports the bank size the rank is out of", () => {
    expect(semanticRank(unit([1, 0]), "trash", bank, text).outOf).toBe(4);
  });
});

const result = (rank: number | null): SemanticResult => ({
  best: 0,
  concept: rank === null ? null : "c",
  margin: 0,
  outOf: 4,
  rank,
});

describe("rankAt1", () => {
  it("drops unanswerable icons instead of counting them as failures", () => {
    expect(rankAt1([result(1), result(1), result(null)])).toBe(1);
  });

  it("is 0 when nothing is answerable", () => {
    expect(rankAt1([result(null)])).toBe(0);
  });
});

describe("answerableSlugs", () => {
  it("is the set of slugs the bank has questions for", () => {
    expect([...answerableSlugs(bank)].toSorted()).toEqual([
      "info",
      "trash",
      "ufo",
    ]);
  });
});
