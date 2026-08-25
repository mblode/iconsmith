import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { studioFaultFromUnknown, studioFaultMessage } from "./fault.ts";

describe("studioFaultMessage", () => {
  it("keeps a short agent sentence", () => {
    assert.equal(
      studioFaultMessage("The paired icon pipeline failed."),
      "The paired icon pipeline failed.",
    );
  });

  it("does not put a Next 404 document in the studio banner", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>404: This page could not be found.</title></head><body><h1 class="next-error-h1">404</h1><h2>This page could not be found.</h2></body></html>`;
    assert.equal(studioFaultMessage(html), "The icon agent could not be reached.");
  });
});

describe("studioFaultFromUnknown", () => {
  it("uses the fallback when the throw is not an Error", () => {
    assert.equal(
      studioFaultFromUnknown("nope", "The studio could not reach the drawer."),
      "The studio could not reach the drawer.",
    );
  });

  it("reads a message field that is not an Error instance", () => {
    assert.equal(
      studioFaultFromUnknown({ message: "The paired icon pipeline failed." }, "fallback"),
      "The paired icon pipeline failed.",
    );
  });
});
