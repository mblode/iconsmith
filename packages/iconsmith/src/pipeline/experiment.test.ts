import { describe, expect, it } from "vitest";

import {
  applyVerdict,
  decideExperiment,
  parseConceptClass,
  parseExpertId,
  runExperiment,
  scoreSlice,
  winnerOf,
} from "./experiment.js";
import type { Hypothesis, Trial } from "./experiment.js";
import type { GenerateResult } from "./generate.js";
import { DEFAULT_MIXTURE, mixtureSample } from "./mixture.js";

const sample = (
  expert: "agent" | "analog",
  concept: string,
  over: {
    clean?: boolean;
    errors?: number;
    parts?: number;
    unknown?: boolean;
  } = {}
) => {
  const unknown = over.unknown === true;
  const result: GenerateResult = {
    brief: unknown ? `analog unknown ${concept}` : `${expert} ${concept}`,
    clean: over.clean ?? true,
    doc: { draw: [], icon: concept, keyline: "square" },
    issues: Array.from({ length: over.errors ?? 0 }, (_, i) => ({
      message: `e${i}`,
      rule: "gap" as const,
      severity: "error" as const,
    })),
    program: `icon ${concept}\n${"part x\n".repeat(over.parts ?? 0)}`,
    steps: 1,
    svg: "<svg/>",
    text: "",
    trace: [],
  };
  return mixtureSample(expert, concept, result);
};

const hypothesis: Hypothesis = {
  claim: "agent beats analog on pack-inventory",
  class: "pack-inventory",
  control: "analog",
  id: "agent-over-analog",
  treatment: "agent",
};

const trial = (
  concept: string,
  winner: "agent" | "analog" | "tie"
): Trial => {
  const control = sample("analog", concept, {
    parts: winner === "analog" ? 2 : 0,
    unknown: winner === "agent",
  });
  const treatment = sample("agent", concept, {
    parts: winner === "agent" ? 2 : winner === "tie" ? 0 : 0,
  });
  return {
    concept,
    control,
    treatment,
    winner:
      winner === "tie" ? "tie" : winner === "agent" ? "agent" : "analog",
  };
};

describe("winnerOf", () => {
  it("prefers a known clean drawing over unknown analog", () => {
    expect(
      winnerOf(
        sample("analog", "xyzzy", { unknown: true }),
        sample("agent", "xyzzy", { parts: 1 })
      )
    ).toBe("agent");
  });

  it("ties two equal clean drawings", () => {
    expect(
      winnerOf(sample("analog", "home"), sample("agent", "home"))
    ).toBe("tie");
  });
});

describe("decideExperiment", () => {
  it("screens out a treatment that loses the feedback set", () => {
    const screen = scoreSlice([
      trial("a", "analog"),
      trial("b", "analog"),
      trial("c", "agent"),
    ]);
    const verdict = decideExperiment(screen, null);
    expect(verdict.status).toBe("screened-out");
    expect(verdict.decision).toBeNull();
    expect(verdict.reasons[0]).toMatch(/screened out/u);
  });

  it("refuses to keep on the screen alone", () => {
    const screen = scoreSlice([trial("a", "tie"), trial("b", "tie")]);
    expect(decideExperiment(screen, null).status).toBe("discard");
  });

  it("keeps when the hold-out is strictly better and no dirtier", () => {
    const screen = scoreSlice([trial("a", "tie"), trial("b", "agent")]);
    const decision = scoreSlice([trial("c", "agent"), trial("d", "tie")]);
    const verdict = decideExperiment(screen, decision);
    expect(verdict.status).toBe("keep");
    expect(verdict.spent).toBe(4);
  });

  it("discards a hold-out tie even after a friendly screen", () => {
    const screen = scoreSlice([trial("a", "agent")]);
    const decision = scoreSlice([trial("b", "tie"), trial("c", "tie")]);
    expect(decideExperiment(screen, decision).status).toBe("discard");
  });
});

describe("runExperiment", () => {
  it("skips selection when the screen loses", async () => {
    const drawn: string[] = [];
    const report = await runExperiment({
      draw: (expert, concept) => {
        drawn.push(`${expert}:${concept.name}`);
        return Promise.resolve({
          brief: `${expert} ${concept.name}`,
          clean: expert === "analog",
          doc: { draw: [], icon: concept.name, keyline: "square" },
          issues:
            expert === "agent"
              ? [{ message: "dirty", rule: "gap", severity: "error" }]
              : [],
          program:
            expert === "analog"
              ? `icon ${concept.name}\npart rim\n`
              : `icon ${concept.name}\n`,
          steps: 1,
          svg: "<svg/>",
          text: "",
          trace: [],
        });
      },
      feedback: ["one"],
      hypothesis,
      selection: ["two"],
    });
    expect(report.status).toBe("screened-out");
    expect(drawn).toEqual(["analog:one", "agent:one"]);
    expect(report.selectionTrials).toEqual([]);
  });
});

describe("applyVerdict", () => {
  it("promotes the treatment on keep and leaves other classes alone", () => {
    const next = applyVerdict(DEFAULT_MIXTURE.weights, hypothesis, "keep");
    expect(next["pack-inventory"][0]).toBe("agent");
    expect(next["pack-inventory"]).toEqual(["agent", "analog"]);
    expect(next["net-new"]).toEqual([...DEFAULT_MIXTURE.weights["net-new"]]);
    const discarded = applyVerdict(
      DEFAULT_MIXTURE.weights,
      hypothesis,
      "discard"
    );
    expect(discarded["pack-inventory"]).toEqual(["analog", "agent"]);
  });
});

describe("parsers", () => {
  it("names the known experts and classes", () => {
    expect(parseExpertId("analog")).toBe("analog");
    expect(() => parseExpertId("lucide")).toThrow(/unknown expert/u);
    expect(parseConceptClass("net-new")).toBe("net-new");
    expect(() => parseConceptClass("pretty")).toThrow(/unknown concept class/u);
  });
});
