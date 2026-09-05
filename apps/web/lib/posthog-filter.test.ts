import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CaptureResult } from "posthog-js";

import { shouldDropClientEvent } from "./posthog-filter.ts";

const exception = (value: string, frame?: string): CaptureResult => ({
  event: "$exception",
  properties: {
    $exception_list: [
      {
        stacktrace: frame ? { frames: [{ filename: frame }] } : undefined,
        type: "Error",
        value,
      },
    ],
  },
});

describe("shouldDropClientEvent", () => {
  it("drops verified browser-extension failures", () => {
    assert.equal(shouldDropClientEvent(exception("Invalid call to runtime.sendMessage().")), true);
    assert.equal(
      shouldDropClientEvent(exception("boom", "chrome-extension://abc/content.js")),
      true,
    );
  });

  it("keeps Studio network and cancellation failures", () => {
    assert.equal(shouldDropClientEvent(exception("NetworkError: Eve could not be reached")), false);
    assert.equal(
      shouldDropClientEvent(exception("AbortError: drawing stopped unexpectedly")),
      false,
    );
  });

  it("keeps application errors that pass through the Next client runtime", () => {
    assert.equal(
      shouldDropClientEvent(
        exception("Internal Next.js error", "/node_modules/next/dist/client/app-router.js"),
      ),
      false,
    );
    assert.equal(shouldDropClientEvent(exception("adoptedStyleSheets is undefined")), false);
  });

  it("drops events attributed to local development", () => {
    assert.equal(
      shouldDropClientEvent({
        event: "$pageview",
        properties: { $current_url: "http://localhost:3210/iconsmith/studio" },
      }),
      true,
    );
  });
});
