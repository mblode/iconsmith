import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStudioPath, studioAvailable } from "./studio-availability.ts";

describe("Studio availability", () => {
  it("keeps the local foundry available and disables Vercel deployments", () => {
    assert.equal(studioAvailable({}), true);
    assert.equal(studioAvailable({ VERCEL: "1" }), false);
  });

  it("covers the Studio page and data routes without hiding the marketing site", () => {
    assert.equal(isStudioPath("/studio"), true);
    assert.equal(isStudioPath("/studio/thread"), true);
    assert.equal(isStudioPath("/api/studio/library"), true);
    assert.equal(isStudioPath("/"), false);
    assert.equal(isStudioPath("/api-catalog"), false);
  });
});
