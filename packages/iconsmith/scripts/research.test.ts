import { describe, expect, it } from "vitest";

import { BASELINE } from "../src/pipeline/eval.js";
import { judgeConcept, judgeLab, parseDemo, SUSPICIOUS } from "./research.js";
import type { DemoConcept } from "./research.js";

const sample = (
  over: Partial<DemoConcept["samples"][number]> = {}
): DemoConcept["samples"][number] => ({
  clean: true,
  cosine: 0.79,
  errors: 0,
  partsFound: 3,
  structural: [],
  ...over,
});

const keyed = (over: Partial<DemoConcept> = {}): DemoConcept => ({
  concept: "pull-request",
  hasAnswerKey: true,
  requested: 5,
  samples: [sample()],
  ...over,
});

const reach = (over: Partial<DemoConcept> = {}): DemoConcept => ({
  concept: "database",
  hasAnswerKey: false,
  requested: 5,
  samples: [sample({ cosine: null })],
  ...over,
});

describe("judgeConcept", () => {
  it("will not call N=1 a finding even when the gates hold", () => {
    const v = judgeConcept(keyed({ requested: 1 }));
    expect(v.arrived).toBe(false);
    expect(v.stage).toBe("screen");
    expect(v.reasons[0]).toMatch(/not a finding/u);
  });

  it("arrives on a decision set that clears the house-indistinguishable band", () => {
    const v = judgeConcept(keyed());
    expect(v.arrived).toBe(true);
    expect(v.stage).toBe("decide");
  });

  it("treats a part-compiled near-copy as reconstruction, not a leak", () => {
    const v = judgeConcept(
      keyed({
        requested: 1,
        samples: [sample({ cosine: 0.999, partsFound: 6, policy: "compile" })],
      })
    );
    expect(v.arrived).toBe(true);
    expect(v.stage).toBe("decide");
  });

  it("rejects a leak rather than celebrating it", () => {
    const v = judgeConcept(
      keyed({ samples: [sample({ cosine: SUSPICIOUS, partsFound: 0 })] })
    );
    expect(v.arrived).toBe(false);
    expect(v.reasons.join(",")).toMatch(/leak/u);
  });

  it("rejects a keyed drawing below the cross-set baseline", () => {
    const v = judgeConcept(
      keyed({ samples: [sample({ cosine: BASELINE - 0.05 })] })
    );
    expect(v.arrived).toBe(false);
    expect(v.reasons.join(",")).toMatch(/below baseline/u);
  });

  it("rejects an unkeyed cosine, because there is nothing to be cosine to", () => {
    const v = judgeConcept(reach({ samples: [sample({ cosine: 0.8 })] }));
    expect(v.arrived).toBe(false);
    expect(v.reasons.join(",")).toMatch(/must not quote/u);
  });

  it("treats analog N=1 on unkeyed as a decision when the gates hold", () => {
    const v = judgeConcept(
      reach({
        requested: 1,
        samples: [sample({ cosine: null, partsFound: 4, policy: "analog" })],
      })
    );
    expect(v.arrived).toBe(true);
    expect(v.stage).toBe("decide");
  });

  it("does not let analog skip the unkeyed gates", () => {
    const dirty = judgeConcept(
      reach({
        requested: 1,
        samples: [
          sample({
            cosine: null,
            partsFound: 4,
            policy: "analog",
            structural: ["extent"],
          }),
        ],
      })
    );
    expect(dirty.arrived).toBe(false);
    expect(dirty.stage).toBe("decide");
    expect(dirty.reasons.join(",")).toMatch(/panel/u);

    const noParts = judgeConcept(
      reach({
        requested: 1,
        samples: [sample({ cosine: null, partsFound: 0, policy: "analog" })],
      })
    );
    expect(noParts.arrived).toBe(false);
    expect(noParts.reasons).toContain("no part ops");

    const quoted = judgeConcept(
      reach({
        requested: 1,
        samples: [sample({ cosine: 0.8, partsFound: 4, policy: "analog" })],
      })
    );
    expect(quoted.arrived).toBe(false);
    expect(quoted.reasons.join(",")).toMatch(/must not quote/u);
  });

  it("arrives on a host mark at N=1 with no parts and a null cosine", () => {
    const v = judgeConcept(
      reach({
        requested: 1,
        samples: [sample({ cosine: null, partsFound: 0, policy: "mark" })],
      })
    );
    expect(v.arrived).toBe(true);
    expect(v.stage).toBe("decide");
  });

  it("does not let a mark skip the structural panel", () => {
    const v = judgeConcept(
      reach({
        requested: 1,
        samples: [
          sample({
            cosine: null,
            partsFound: 0,
            policy: "mark",
            structural: ["extent"],
          }),
        ],
      })
    );
    expect(v.arrived).toBe(false);
    expect(v.reasons.join(",")).toMatch(/panel/u);
  });

  it("rejects a mark that quotes an answer-key cosine", () => {
    const v = judgeConcept(
      reach({
        requested: 1,
        samples: [sample({ cosine: 0.99, partsFound: 0, policy: "mark" })],
      })
    );
    expect(v.arrived).toBe(false);
    expect(v.reasons.join(",")).toMatch(/must not quote/u);
  });

  it("does not call a host mark with 0 parts a leak", () => {
    const v = judgeConcept(
      reach({
        requested: 1,
        samples: [sample({ cosine: null, partsFound: 0, policy: "mark" })],
      })
    );
    expect(v.reasons.join(",")).not.toMatch(/leak/u);
  });

  it("still uses markGates when a keyed row is labelled a mark", () => {
    const v = judgeConcept(
      keyed({
        requested: 1,
        samples: [sample({ cosine: null, partsFound: 0, policy: "mark" })],
      })
    );
    expect(v.arrived).toBe(true);
    expect(v.reasons.join(",")).not.toMatch(/leak|no part ops/u);
  });

  it("requires the program to have used the vocabulary", () => {
    const v = judgeConcept(keyed({ samples: [sample({ partsFound: 0 })] }));
    expect(v.arrived).toBe(false);
    expect(v.reasons).toContain("no part ops");
  });
});

describe("judgeLab", () => {
  it("arrives only when every concept arrives on a decision set", () => {
    expect(judgeLab([keyed(), reach()]).arrived).toBe(true);
    expect(judgeLab([keyed(), reach({ requested: 1 })]).arrived).toBe(false);
  });
});

describe("parseDemo", () => {
  it("reads the file the demo script writes", () => {
    const rows = parseDemo(
      JSON.stringify([
        {
          concept: "pull-request",
          hasAnswerKey: true,
          requested: 1,
          samples: [sample()],
        },
      ])
    );
    expect(rows[0]?.concept).toBe("pull-request");
    expect(rows[0]?.samples).toHaveLength(1);
  });
});
