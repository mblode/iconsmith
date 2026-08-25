import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refuseStudioSession, sessionMintedAt } from "./session-owner.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Mints an id the same way eve's vendored `@workflow/world/ulid` does: ten
 * base32 characters of millisecond time, then sixteen of randomness. Written
 * out rather than imported because that module is not exported from the `eve`
 * package — a deep import fails `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 */
const sessionId = (mintedAt: number, random = "0123456789ABCDEF"): string => {
  let time = "";
  let remaining = mintedAt;
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  return `wrun_${time}${random}`;
};

/** Mirrors world-vercel's region tag without coupling the test to its private codec. */
const regionTaggedSessionId = (mintedAt: number): string => sessionId(mintedAt + 2 ** 47);

const request = (path: string) => new Request(`https://blode.co${path}`);

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);
const policy = { maxAgeMs: DAY_MS, now: NOW };

describe("sessionMintedAt", () => {
  it("reads the timestamp eve encoded into the id, so no store has to remember it", () => {
    assert.equal(sessionMintedAt(sessionId(NOW)), NOW);
  });

  it("clears Vercel's region tag before reading the timestamp", () => {
    assert.equal(sessionMintedAt(regionTaggedSessionId(NOW)), NOW);
  });

  it("rejects a string that is not an id eve could have minted", () => {
    // Crockford omits I, L, O, and U; the length is exact, not a lower bound.
    assert.equal(sessionMintedAt("wrun_0000000000IIIIIIIIIIIIIIII"), undefined);
    assert.equal(sessionMintedAt("wrun_0123"), undefined);
    assert.equal(sessionMintedAt("../../etc/passwd"), undefined);
  });
});

describe("refuseStudioSession", () => {
  it("leaves the routes that address no session alone, so a first visit still works", () => {
    // Creating a session, and the two unauthenticated probes beside it.
    assert.equal(refuseStudioSession(request("/eve/v1/session"), policy), undefined);
    assert.equal(refuseStudioSession(request("/eve/v1/info"), policy), undefined);
    assert.equal(refuseStudioSession(request("/eve/v1/health"), policy), undefined);
  });

  it("passes every route the Studio itself calls", () => {
    for (const id of [sessionId(NOW - 60_000), regionTaggedSessionId(NOW - 60_000)]) {
      for (const path of [
        `/eve/v1/session/${id}`,
        `/eve/v1/session/${id}/cancel`,
        `/eve/v1/session/${id}/stream`,
        // The zone prefix survives on a local run; the Vercel service strips it.
        `/iconsmith/eve/v1/session/${id}/stream`,
      ]) {
        assert.equal(refuseStudioSession(request(path), policy), undefined, path);
      }
    }
  });

  it("refuses the destructive routes the Studio never calls", () => {
    const id = sessionId(NOW - 60_000);
    for (const suffix of ["/reset", "/clear", "/compact"]) {
      assert.equal(
        refuseStudioSession(request(`/eve/v1/session/${id}${suffix}`), policy)?.code,
        "session_route_forbidden",
        suffix,
      );
    }
  });

  it("refuses a subagent transcript, which is a read the Studio never makes", () => {
    const id = sessionId(NOW - 60_000);
    assert.equal(
      refuseStudioSession(request(`/eve/v1/session/${id}/subagents/call_1/${id}/stream`), policy)
        ?.code,
      "session_route_forbidden",
    );
  });

  it("refuses an id that is not the shape eve mints", () => {
    assert.equal(
      refuseStudioSession(request("/eve/v1/session/not-a-run-id/stream"), policy)?.code,
      "session_not_found",
    );
  });

  it("refuses an id older than the session it names could still run", () => {
    // eve keeps a timed-out session's stored data, so without this the whole
    // transcript streams to an id-holder indefinitely.
    for (const id of [sessionId(NOW - DAY_MS - 1000), regionTaggedSessionId(NOW - DAY_MS - 1000)]) {
      assert.equal(
        refuseStudioSession(request(`/eve/v1/session/${id}/stream`), policy)?.code,
        "session_expired",
      );
    }
    assert.equal(
      refuseStudioSession(
        request(`/eve/v1/session/${sessionId(NOW - DAY_MS + 1000)}/stream`),
        policy,
      ),
      undefined,
    );
  });

  it("refuses an id minted further ahead of this clock than skew explains", () => {
    assert.equal(
      refuseStudioSession(
        request(`/eve/v1/session/${sessionId(NOW + 60 * 60 * 1000)}/stream`),
        policy,
      )?.code,
      "session_expired",
    );
    // Five minutes is what eve's own validateUlidTimestamp tolerates.
    assert.equal(
      refuseStudioSession(request(`/eve/v1/session/${sessionId(NOW + 60_000)}/stream`), policy),
      undefined,
    );
  });
});
