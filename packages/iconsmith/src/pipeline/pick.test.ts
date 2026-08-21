import { describe, expect, it } from "vitest";

import { better, pick } from "./pick.js";

describe("pick", () => {
  it("prefers part ops over a leaky cosine", () => {
    const leak = {
      cosine: 0.95,
      errors: 0,
      partsFound: 0,
      structural: [] as string[],
    };
    const vocab = {
      cosine: 0.79,
      errors: 0,
      partsFound: 6,
      structural: [] as string[],
    };
    expect(better(vocab, leak)).toBeLessThan(0);
    expect(pick([leak, vocab])).toEqual(vocab);
  });

  it("prefers a clean fewer-part drawing over a dirty analog with more parts", () => {
    const dirty = {
      cosine: null,
      errors: 1,
      partsFound: 4,
      structural: [] as string[],
    };
    const clean = {
      cosine: null,
      errors: 0,
      partsFound: 3,
      structural: [] as string[],
    };
    expect(pick([dirty, clean])).toEqual(clean);
  });
});
