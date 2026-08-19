/**
 * The arm, without an image model.
 *
 * The network calls are one function (`sketch`) and are not what can go wrong.
 * What can go wrong is the wiring: a proposal the model may consult forever, a
 * proposal that turns up in a comparison sheet beside the draft it produced, a
 * tool offered when there is nothing behind it, or an arm that quietly becomes
 * the control arm when the image model fails. Those are what is tested.
 */
import { describe, expect, it } from "vitest";

import type { Proposal } from "./compose.js";
import type { Reference } from "./licence.js";
import { asReferences } from "./licence.js";
import type { GenerateLike, ProposalRun } from "./propose.js";
import { proposalArm } from "./propose.js";
import { SLOTS, referenceSet } from "./references.js";
import { createTools } from "./tools.js";

const PROVENANCE = {
  date: "2026-08-19",
  licenses: ["MIT"],
  origin: "original" as const,
  set: "blode-icons",
};

const icon = (name: string): { name: string; svg: string } => ({
  name,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20" stroke="#000" fill="none"/></svg>`,
});

const corpus = (...names: string[]): Reference[] =>
  asReferences(names.map(icon), PROVENANCE);

const PROPOSAL: Proposal = {
  adjacency: ["block 2 sits inside block 1"],
  blocks: [
    { cell: "center", shape: "square", size: "dominant" },
    { cell: "center", shape: "square", size: "small" },
  ],
  elements: 2,
  parts: ["folder"],
  thumbnail: "aGVsbG8=",
};

describe("the proposal tool", () => {
  it("is not offered at all when there is no proposal", () => {
    const { tools } = createTools({});
    expect("proposal" in tools).toBe(false);
    expect("cohort" in tools).toBe(false);
  });

  it("hands over the composition once and refuses the second time", async () => {
    const { state, tools } = createTools({ proposal: PROPOSAL });
    const first = await tools.proposal.execute?.({}, {} as never);
    expect(first).toMatchObject({ image: PROPOSAL.thumbnail });
    expect(state.proposed).toBe(true);
    expect(() => tools.proposal.execute?.({}, {} as never)).toThrow(
      /already been read/u
    );
  });

  it("describes the composition in words, with no coordinates in the text", async () => {
    const { tools } = createTools({ proposal: PROPOSAL });
    const out = (await tools.proposal.execute?.({}, {} as never)) as {
      summary: string;
    };
    expect(out.summary).toContain("2 element(s)");
    expect(out.summary).toContain("sits inside");
    expect(out.summary).not.toMatch(/\d+\.\d/u);
  });

  /**
   * The load-bearing one. `compare` is the only tool that puts the draft and
   * other images in one frame; if the proposal could join it, the model would
   * have a tracing view and the arm would stop measuring composition.
   */
  it("never appears in a compare sheet", async () => {
    const { tools } = createTools({
      corpus: corpus("folder", "folder-open"),
      proposal: PROPOSAL,
    });
    const out = (await tools.compare.execute?.(
      { concept: "folder" },
      {} as never
    )) as { image: string | null; names: string[] };
    expect(out.names).toEqual(["(your draft)", "folder", "folder-open"]);
    expect(out.image).not.toContain(PROPOSAL.thumbnail);
  });
});

describe("turn, flip and cohort", () => {
  const parts = [
    {
      closed: false,
      d: "M0 0L4 0L4 6",
      h: 6,
      icons: ["a"],
      id: "p1",
      instances: 3,
      name: "tick",
      nodes: 3,
      sizeRange: [1, 1] as [number, number],
      w: 4,
    },
  ];

  it("places a part turned and flipped, and records both in the document", async () => {
    const { canvas, tools } = createTools({ parts });
    await tools.part.execute?.(
      { flip: true, id: "tick", turn: "cw", x: 4, y: 4 },
      {} as never
    );
    const doc = canvas.toJSON({ icon: "x", keyline: null });
    expect(doc.draw[0]).toMatchObject({ flip: true, op: "part", turn: 1 });
  });

  it("offers cohort only when a family was measured, and applies it", async () => {
    const { canvas, tools } = createTools({
      cohort: { x: [4, 20], y: [4, 20] },
      parts,
    });
    await tools.rect.execute?.({ h: 4, w: 4, x: 2, y: 2 }, {} as never);
    const out = (await tools.cohort.execute?.({}, {} as never)) as {
      fitted: boolean;
    };
    expect(out.fitted).toBe(true);
    const box = canvas.bbox();
    expect(box?.x0).toBeCloseTo(4, 1);
    expect(box?.y1).toBeCloseTo(20, 1);
  });
});

const SET = corpus(
  "folder-1",
  "folder-open",
  "folder-add",
  "folder-cloud",
  "clock",
  "arrow-up-right",
  "calendar-1",
  "battery",
  "bell",
  "cloud",
  "cup",
  "dice",
  "eye",
  "flag",
  "gift",
  "heart"
);

describe("reference slots", () => {
  it("fills the slots without repeating an icon", () => {
    const slots = referenceSet(SET, {
      concept: "folder-2",
      tags: ["folder"],
    });
    expect(slots.all.length).toBeLessThanOrEqual(SLOTS);
    expect(new Set(slots.all.map((r) => r.name)).size).toBe(slots.all.length);
    expect(slots.anchors.map((r) => r.name)).toContain("clock");
    expect(slots.all.map((r) => r.name)).toContain("folder-open");
  });

  /**
   * The family slots hold what the nearest slots did not already take, which
   * for a well-named set is usually nothing: `folder-open` is both the nearest
   * concept and a cohort sibling, and showing it twice would spend two of the
   * fourteen on one icon.
   */
  it("gives the family slots to icons the concept slots did not take", () => {
    const slots = referenceSet(SET, {
      concept: "folder-2",
      tags: ["folder"],
    });
    const near = new Set(slots.concept.map((r) => r.name));
    expect(slots.siblings.every((r) => !near.has(r.name))).toBe(true);
  });

  it("never shows the icon being drawn", () => {
    const slots = referenceSet(SET, { concept: "clock" });
    expect(slots.all.map((r) => r.name)).not.toContain("clock");
  });

  it("spans the idiom rather than the concept in the anchor slots", () => {
    const a = referenceSet(SET, { concept: "cup" }).anchors.map((r) => r.name);
    const b = referenceSet(SET, { concept: "flag" }).anchors.map((r) => r.name);
    expect(a).toEqual(b);
  });
});

const drawn =
  (seen: { proposal?: Proposal | null }): GenerateLike =>
  (_concept, options) => {
    seen.proposal = options.proposal;
    return Promise.resolve({
      clean: true,
      doc: { draw: [], icon: "x", keyline: null },
      issues: [],
      steps: 1,
      svg: "<svg/>",
      text: "",
      trace: [],
    });
  };

const proposed = (): Promise<ProposalRun> =>
  Promise.resolve({
    chosen: 0,
    images: [],
    models: [],
    ms: 0,
    proposal: PROPOSAL,
    reason: null,
    references: [],
    usd: 0.034,
  });

describe("the arm", () => {
  it("passes the proposal into the same generator the control arm uses", async () => {
    const seen: { proposal?: Proposal | null } = {};
    let banked = 0;
    const arm = proposalArm({
      generate: drawn(seen),
      onProposal: (_c, run) => {
        banked += run.usd ?? 0;
      },
      propose: proposed,
    });

    await arm({ name: "folder-2" }, { corpus: SET });
    expect(seen.proposal).toBe(PROPOSAL);
    // Banked separately rather than added to the generation's token bill: the
    // two arms' `usd` have to stay comparable in the place they are compared.
    expect(banked).toBeCloseTo(0.034, 5);
  });

  it("fails the icon rather than silently drawing without a proposal", async () => {
    const arm = proposalArm({
      generate: () => {
        throw new Error("the drawer must not be reached");
      },
      propose: () => Promise.reject(new Error("no image came back")),
    });
    await expect(arm({ name: "folder-2" }, { corpus: SET })).rejects.toThrow(
      /no image came back/u
    );
  });
});
