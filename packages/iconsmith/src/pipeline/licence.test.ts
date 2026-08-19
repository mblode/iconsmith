/**
 * The runtime half of the licence gate. The compile-time half — the part that
 * actually stops a third-party pack reaching a prompt — is `licence.test-d.ts`,
 * run by `tsc`, because `tsconfig.json` excludes `*.test.ts` from typechecking.
 *
 * What is left for runtime is the parse boundary: provenance read back out of a
 * JSON record, where `origin: "central"` is a claim and not a guarantee.
 */
import { describe, expect, it } from "vitest";

import type { Provenance } from "../types.js";
import { asReference, asReferences, LicenceError } from "./licence.js";

const icon = { name: "arrow-right", svg: "<svg/>" };
const house: Provenance = { date: "2026-08-19", origin: "central" };

describe("asReference", () => {
  it("passes the author's own work through unchanged", () => {
    expect(asReference(icon, house)).toBe(icon);
  });

  it("passes a record whose only licence is MIT", () => {
    expect(
      asReference(icon, { ...house, licenses: ["MIT"], set: "blode-icons" })
    ).toBe(icon);
  });

  it("refuses an origin outside the house set", () => {
    // The union makes this unwritable in source; JSON off disk does not care,
    // which is the only reason the check exists at runtime at all.
    const foreign = { ...house, origin: "phosphor" } as unknown as Provenance;
    expect(() => asReference(icon, foreign)).toThrow(LicenceError);
  });

  it("refuses a house origin claimed over a foreign set", () => {
    // The one that a licence check alone would miss: tabler is MIT, so
    // `licenses: ["MIT"]` is true and useless. The set is what gives it away.
    expect(() =>
      asReference(icon, {
        ...house,
        licenses: ["MIT"],
        origin: "literal",
        set: "tabler",
      })
    ).toThrow(/not one of/u);
  });

  it("refuses any licence that is not MIT", () => {
    expect(() => asReference(icon, { ...house, licenses: ["ISC"] })).toThrow(
      /ISC/u
    );
  });

  it("accepts MIT however the record spells it", () => {
    expect(() =>
      asReference(icon, { ...house, licenses: [" mit license "] })
    ).not.toThrow();
  });

  it("names the icon and the failing field, because the caller holds a record", () => {
    expect(() =>
      asReference(icon, { ...house, licenses: ["CC-BY-4.0"] })
    ).toThrow(/arrow-right.*CC-BY-4\.0/su);
  });
});

describe("asReferences", () => {
  it("fails the whole set on one bad member", () => {
    expect(() => asReferences([icon], { ...house, licenses: ["ISC"] })).toThrow(
      LicenceError
    );
  });

  it("returns every member when the provenance is clean", () => {
    expect(asReferences([icon, icon], house)).toHaveLength(2);
  });
});
