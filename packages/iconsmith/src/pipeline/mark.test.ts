import { describe, expect, it } from "vitest";

import { MarkError, markArm } from "./mark.js";

describe("markArm", () => {
  it("draws outlined plus with no model and no cost", async () => {
    const drawn = await markArm()({ name: "plus" });
    expect(drawn.cost).toBeUndefined();
    expect(drawn.clean).toBe(true);
    expect(drawn.program).toContain("finish outlined");
    expect(drawn.svg).toContain('stroke="currentColor"');
    expect(drawn.trace).toContain("line");
  });

  it("draws the filled twin as fill, not a stroke", async () => {
    const drawn = await markArm()({ name: "plus-filled" });
    expect(drawn.clean).toBe(true);
    expect(drawn.program).toContain("finish filled");
    expect(drawn.svg).toContain('fill="currentColor"');
    expect(drawn.svg).not.toContain("stroke=");
    expect(drawn.trace).toContain("rect");
  });

  it("refuses a slug that is not a mark", async () => {
    await expect(markArm()({ name: "database" })).rejects.toThrow(MarkError);
    await expect(markArm()({ name: "database" })).rejects.toThrow(
      /not a mark/u
    );
  });
});
