import { describe, expect, it } from "vitest";

import { withCacheBreakpoints } from "./generate.js";

/**
 * These assertions are worth their length because the failure they guard is
 * silent. Drop the breakpoints and every generation still succeeds, still
 * lints, still scores the same -- it just costs roughly three times as much,
 * and nothing in the output says so. Measured on `git-fork` against Sonnet:
 * a median of $0.022 per step uncached against $0.007 per step cached.
 */
const user = (text: string) =>
  ({ content: text, role: "user" }) as Parameters<
    typeof withCacheBreakpoints
  >[0][number];

describe("withCacheBreakpoints", () => {
  it("marks the first and last message", () => {
    const out = withCacheBreakpoints([user("a"), user("b"), user("c")]);
    expect(out[0].providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
    });
    expect(out[2].providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
    });
  });

  it("leaves the middle unmarked, staying inside Anthropic's limit of four", () => {
    const out = withCacheBreakpoints([
      user("a"),
      user("b"),
      user("c"),
      user("d"),
    ]);
    const marked = out.filter(
      (m) => m.providerOptions?.anthropic?.cacheControl !== undefined
    );
    expect(marked).toHaveLength(2);
  });

  it("marks a lone message once rather than twice", () => {
    const out = withCacheBreakpoints([user("only")]);
    expect(out).toHaveLength(1);
    expect(out[0].providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
    });
  });

  it("does not mutate the caller's messages", () => {
    const input = [user("a"), user("b")];
    withCacheBreakpoints(input);
    expect(input[0].providerOptions).toBeUndefined();
  });

  it("returns an empty list unchanged", () => {
    expect(withCacheBreakpoints([])).toEqual([]);
  });
});
