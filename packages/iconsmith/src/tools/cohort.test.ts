import { describe, expect, it } from "vitest";

import type { CohortManifest, CohortMember } from "./cohort.js";
import {
  buildCohorts,
  cohortOf,
  inferCohort,
  splits,
  verdict,
} from "./cohort.js";
import { completeProgram, run } from "./dsl.js";
import { lint } from "./lint.js";

/** Path for a box, so a member can be measured the way a real icon is. */
const box = (x0: number, y0: number, x1: number, y1: number) =>
  `M${x0} ${y0}L${x1} ${y0}L${x1} ${y1}L${x0} ${y1}Z`;

const member = (
  name: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): CohortMember => ({
  box: { h: y1 - y0, w: x1 - x0, x0, x1, y0, y1 },
  name,
});

/**
 * The real thing, measured from blode-icons: the folder family agrees on
 * y0 = 4.00 and then splits, nine icons ending at 20.00 and seven at 19.00.
 * Toggling `folder-download` for `folder-cloud` moves the bottom edge 1px.
 */
const FOLDERS: CohortMember[] = [
  member("folder-add-left", 2, 4, 21, 20),
  member("folder-add-right", 3, 4, 21, 20),
  member("folder-bookmarks", 2, 4, 21, 20),
  member("folder-cloud", 2, 4, 21, 20),
  member("folder-link", 2, 4, 21, 20),
  member("folder-link-2", 2, 4, 21, 20),
  member("folder-paper", 3, 4, 21, 20),
  member("folder-restricted", 2, 4, 21, 20),
  member("folder-shield", 3, 4, 22, 20),
  member("folder-1", 3, 4, 21, 19),
  member("folder-2", 3, 4, 21, 19),
  member("folder-delete", 3, 4, 21, 19),
  member("folder-download", 3, 4, 21, 19),
  member("folder-upload", 3, 4, 21, 19),
  member("folder-open", 3, 4, 21.64, 19),
  member("folder-open-front", 1.34, 4, 22.66, 19),
];

const folderCohort = () => {
  const [cohort] = buildCohorts(FOLDERS);
  return cohort;
};

const viewFor = (name: string) => ({ cohort: folderCohort(), name });

describe("cohort membership", () => {
  it("infers a cohort from the first name segment, per style", () => {
    expect(inferCohort("folder-open")).toBe("folder");
    expect(inferCohort("folder-1")).toBe("folder");
    // Filled and outline are drawn to different silhouettes and never swap.
    expect(inferCohort("folder-open-filled")).toBe("folder#filled");
    expect(inferCohort("eye")).toBe(inferCohort("eye-off"));
  });

  it("takes a manifest entry over the inferred prefix", () => {
    // The case prefixes cannot reach: `play` and `pause` swap in a transport
    // control and share no name, while `user-group` shares one with `user`
    // and is a different silhouette.
    const manifest: CohortManifest = {
      transport: ["play", "pause", "stop"],
      "user-group": ["user-group", "user-group-add"],
    };
    expect(cohortOf("pause", manifest)).toBe("transport");
    expect(cohortOf("play", manifest)).toBe("transport");
    expect(cohortOf("user-group", manifest)).toBe("user-group");
    expect(cohortOf("user", manifest)).toBe("user");
  });
});

describe("cohort splits", () => {
  it("finds the folder family's bottom-edge split", () => {
    const [axis] = splits(folderCohort());
    expect(axis.axis).toBe("y");
    expect(axis.groups[0]).toMatchObject({ hi: 20, lo: 4 });
    expect(axis.groups[0].members).toHaveLength(9);
    expect(axis.groups[1]).toMatchObject({ hi: 19, lo: 4 });
    expect(axis.groups[1].members).toContain("folder-download");
    expect(axis.groups[1].members).toContain("folder-open");
  });

  it("does not call a family with no convention a split", () => {
    // Six icons, six different extents: there is nothing here to violate.
    const members = Array.from({ length: 6 }, (_, i) =>
      member(`thing-${i}`, 4, 4 + i, 20, 20)
    );
    const [cohort] = buildCohorts(members);
    expect(splits(cohort)).toEqual([]);
  });

  it("says nothing about a cohort of one", () => {
    const [cohort] = buildCohorts([member("lone", 4, 4, 20, 20)]);
    expect(splits(cohort)).toEqual([]);
    expect(verdict({ cohort, name: "lone" })).toEqual({
      agrees: false,
      messages: [],
    });
  });
});

describe("lint with a cohort", () => {
  const lintFolder = (name: string, m: CohortMember) =>
    lint(
      {
        elements: [
          { d: box(m.box.x0, m.box.y0, m.box.x1, m.box.y1), id: "e0" },
        ],
      },
      { cohort: viewFor(name) }
    );

  it("errors on an icon on the wrong side of its cohort's split", () => {
    const issues = lintFolder(
      "folder-download",
      member("folder-download", 3, 4, 21, 19)
    );
    const align = issues.find((i) => i.rule === "cohort-align");
    expect(align?.severity).toBe("error");
    // The message has to name the fix, not just the fact.
    expect(align?.message).toContain("y 4.00..19.00");
    expect(align?.message).toContain("9 span 4.00..20.00");
    expect(align?.message).toContain("jumps the icon 1.00px");
  });

  it("stays quiet for an icon in its cohort's majority group", () => {
    const issues = lintFolder(
      "folder-cloud",
      member("folder-cloud", 2, 4, 21, 20)
    );
    expect(issues.map((i) => i.rule)).not.toContain("cohort-align");
  });

  it("does not fire `centred` on folder-open, which its family agrees with", () => {
    // Alone, folder-open reads as off-centre at (12.32, 11.50). It sits there
    // because every folder it swaps with sits at 11.50 and shares its left
    // edge; recentring it would break the alignment, not restore one.
    const m = member("folder-open", 3, 4, 21.64, 19);
    expect(
      lint({ elements: [{ d: box(3, 4, 21.64, 19), id: "e0" }] }).map(
        (i) => i.rule
      )
    ).toContain("centred");
    expect(lintFolder("folder-open", m).map((i) => i.rule)).not.toContain(
      "centred"
    );
  });

  it("still fires `centred` on an icon that shares no edge with its family", () => {
    const members = [
      member("thing-1", 4, 4, 20, 20),
      member("thing-2", 4, 4, 20, 20),
      member("thing-3", 6.5, 4.5, 21.5, 19.5),
    ];
    const [cohort] = buildCohorts(members);
    const issues = lint(
      { elements: [{ d: box(6.5, 4.5, 21.5, 19.5), id: "e0" }] },
      { cohort: { cohort, name: "thing-3" } }
    );
    expect(issues.map((i) => i.rule)).toContain("centred");
  });
});

describe("completeProgram replays under the run options that drew the doc", () => {
  const squareFamily = () =>
    buildCohorts([
      member("badge-1", 4, 4, 20, 20),
      member("badge-2", 4, 4, 20, 20),
      member("badge-cloud", 4, 4, 20, 20),
    ]);

  it("confirms a program that ends in `cohort`, given the same cohorts", () => {
    // The program arm builds its document with the run's cohorts, so the
    // replay assertion must use them too. Without them the `cohort` op throws
    // ("no cohorts were supplied…") on replay and a valid program is falsely
    // called incomplete.
    const cohorts = squareFamily();
    const program =
      "icon badge-new\nkeyline square\nrect 4,4 16x16 r2\ncohort badge\n";
    const drawn = run(program, [], { cohorts });
    expect(drawn.errors).toEqual([]);
    const doc = drawn.canvas.toJSON({
      icon: drawn.icon,
      keyline: drawn.keyline,
    });

    expect(completeProgram(doc, program, [], { cohorts })).toBe(true);
    // Dropping the cohorts is the bug: the same program no longer replays.
    expect(completeProgram(doc, program, [])).toBe(false);
  });
});
