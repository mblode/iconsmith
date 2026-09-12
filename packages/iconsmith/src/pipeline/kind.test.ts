import { describe, expect, it } from "vitest";

import { MARK_TWINS, isMarkName, markFromSlug } from "./kind.js";
import { MARK_NAMES } from "./marks.js";

describe("MARK_TWINS", () => {
  it("covers every mark", () => {
    expect(Object.keys(MARK_TWINS).toSorted()).toEqual(
      [...MARK_NAMES].toSorted()
    );
  });
});

describe("markFromSlug", () => {
  it("reads a filled twin off the stem", () => {
    expect(markFromSlug("plus-filled")).toEqual({
      finish: "filled",
      mark: "plus",
    });
    expect(markFromSlug("hamburger-menu")).toEqual({
      finish: "outlined",
      mark: "hamburger-menu",
    });
    expect(markFromSlug("not-a-mark")).toBeNull();
    expect(isMarkName("plus")).toBe(true);
    expect(isMarkName("plus-filled")).toBe(false);
  });
});
