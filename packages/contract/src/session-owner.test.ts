import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDeadStudioSession,
  refuseForeignSessionTurn,
  refuseStudioBody,
  refuseStudioSession,
  sessionMintedAt,
  STUDIO_OWNER_HEADER,
  studioOwnerHeaders,
  studioPrincipalId,
} from "./session-owner.ts";

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

describe("sessionRoute normalisation", () => {
  const id = sessionId(NOW - 60_000);

  it("recognises a session route however the router spelled it", () => {
    // Each of these reaches the same eve route. Matching only the exact
    // "/eve/v1/session/" substring reported them as addressing no session,
    // which refuseStudioSession reads as permission to continue — so a policy
    // that looks enforced was skipped outright.
    for (const path of [
      `/EVE/V1/SESSION/${id}/reset`,
      `/eve/v1//session/${id}/reset`,
      `//eve//v1//session//${id}//reset`,
      `/eve/v1/session/${id}/RESET`,
      `/eve/v1/%73ession/${id}/reset`,
      // %2F is not decoded by URL.pathname, so a raw split would read
      // "session/<id>/reset" as one segment and match nothing.
      `/eve/v1/session%2F${id}%2Freset`,
      `/iconsmith/Eve/v1/Session/${id}/reset`,
    ]) {
      assert.equal(
        refuseStudioSession(request(path), policy)?.code,
        "session_route_forbidden",
        path,
      );
    }
  });

  it("keeps the id's case, so a lower-cased forgery is still a forgery", () => {
    assert.equal(
      refuseStudioSession(request(`/eve/v1/session/${id.toLowerCase()}/stream`), policy)?.code,
      "session_not_found",
    );
  });

  it("still opens the create route under the same normalisation", () => {
    for (const path of ["/eve/v1/session", "/EVE/V1/SESSION", "/eve//v1//session/"]) {
      assert.equal(refuseStudioSession(request(path), policy), undefined, path);
    }
  });
});

const jsonPost = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://blode.co/eve/v1/session", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

describe("refuseStudioBody", () => {
  it("passes the body the eve client actually builds", async () => {
    // createMessageBody in eve/dist/src/client/session.js emits only these.
    assert.equal(
      await refuseStudioBody(
        jsonPost({
          clientContext: ["studio"],
          message: "a padlock",
          outputSchema: { type: "object" },
          turnPolicy: "queue",
        }),
      ),
      undefined,
    );
  });

  it("refuses a caller-supplied callback, on create and on follow-up alike", async () => {
    // eve requires only that the url be absolute, path-match the body token,
    // and not name a private host; every public host passes, and the session's
    // terminal output is POSTed there.
    const callback = {
      callId: "call_1",
      subagentName: "studio",
      token: "t0ken",
      url: "https://attacker.example/eve/v1/callback/t0ken",
    };
    const refusals = await Promise.all(
      [
        "https://blode.co/eve/v1/session",
        `https://blode.co/eve/v1/session/${sessionId(NOW - 60_000)}`,
      ].map((url) =>
        refuseStudioBody(
          new Request(url, {
            body: JSON.stringify({ callback, message: "a padlock" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        ),
      ),
    );
    for (const refusal of refusals) {
      assert.equal(refusal?.code, "session_field_forbidden");
      assert.match(refusal?.message ?? "", /callback/u);
    }
  });

  it("refuses a caller-chosen mode or capabilities", async () => {
    const mode = await refuseStudioBody(jsonPost({ message: "a padlock", mode: "task" }));
    assert.equal(mode?.code, "session_field_forbidden");
    const capabilities = await refuseStudioBody(
      jsonPost({ capabilities: { requestInput: false }, message: "a padlock" }),
    );
    assert.equal(capabilities?.code, "session_field_forbidden");
  });

  it("names every field it refused, so a client author is not left guessing", async () => {
    const refusal = await refuseStudioBody(
      jsonPost({ capabilities: {}, message: "a padlock", mode: "task" }),
    );
    assert.match(refusal?.message ?? "", /'capabilities', 'mode'/u);
  });

  it("leaves the body readable for the channel that reads it next", async () => {
    // clone(), not json(): eve parses the same request afterwards and a
    // consumed body would fail its own parse.
    const post = jsonPost({ message: "a padlock" });
    assert.equal(await refuseStudioBody(post), undefined);
    assert.deepEqual(await post.json(), { message: "a padlock" });
  });

  it("passes a body eve itself should reject, rather than mislabelling a 400 as a 403", async () => {
    const broken = new Request("https://blode.co/eve/v1/session", {
      body: "{not json",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(await refuseStudioBody(broken), undefined);
  });

  it("ignores requests that carry no JSON body", async () => {
    assert.equal(await refuseStudioBody(request("/eve/v1/session/x/stream")), undefined);
  });
});

const withToken = (token: string) =>
  new Request("https://blode.co/eve/v1/session", {
    headers: { [STUDIO_OWNER_HEADER]: token },
  });

describe("studioPrincipalId", () => {
  it("gives two browsers different principals, which none() could not", async () => {
    // none() returns one module-level ANONYMOUS_SESSION_AUTH_CONTEXT to every
    // caller, so auth.current and auth.initiator were the same object and no
    // continuation check could ever fire.
    const mine = await studioPrincipalId(withToken("11111111-1111-4111-8111-111111111111"));
    const theirs = await studioPrincipalId(withToken("22222222-2222-4222-8222-222222222222"));
    assert.notEqual(mine, theirs);
    assert.equal(mine, await studioPrincipalId(withToken("11111111-1111-4111-8111-111111111111")));
  });

  it("does not put the token itself into durable session state", async () => {
    const token = "11111111-1111-4111-8111-111111111111";
    const principal = await studioPrincipalId(withToken(token));
    assert.ok(!principal.includes(token));
    assert.match(principal, /^studio-[0-9a-f]{32}$/u);
  });

  it("falls back to eve's anonymous principal, so a header-less client still works", async () => {
    assert.equal(await studioPrincipalId(request("/eve/v1/session")), "anonymous");
    assert.equal(await studioPrincipalId(withToken("   ")), "anonymous");
  });
});

const principal = (principalId: string) => ({ principalId });

describe("refuseForeignSessionTurn", () => {
  it("refuses a caller who is not the browser that opened the session", async () => {
    const mine = principal(await studioPrincipalId(withToken("mine")));
    const theirs = principal(await studioPrincipalId(withToken("theirs")));
    assert.equal(
      refuseForeignSessionTurn({ current: theirs, initiator: mine })?.code,
      "session_not_owner",
    );
  });

  it("refuses a caller who presents no token at all for a bound session", async () => {
    const mine = principal(await studioPrincipalId(withToken("mine")));
    assert.equal(
      refuseForeignSessionTurn({ current: principal("anonymous"), initiator: mine })?.code,
      "session_not_owner",
    );
  });

  it("lets the browser that opened the session continue it", async () => {
    const mine = principal(await studioPrincipalId(withToken("mine")));
    assert.equal(refuseForeignSessionTurn({ current: mine, initiator: mine }), undefined);
  });

  it("leaves a session nobody bound alone, in both directions", async () => {
    // A session opened before the client sent the header has an unbound
    // initiator. Refusing the one caller who brought a token would punish the
    // only caller with a credential, and would strand every session already
    // open when the header shipped.
    const anonymous = principal("anonymous");
    const mine = principal(await studioPrincipalId(withToken("mine")));
    assert.equal(refuseForeignSessionTurn({ current: mine, initiator: anonymous }), undefined);
    assert.equal(refuseForeignSessionTurn({ current: anonymous, initiator: anonymous }), undefined);
  });

  it("leaves an unprotected agent alone, which reports both as null", () => {
    // docs/guides/session-context.md: "Unprotected agents expose auth.current
    // and auth.initiator as null."
    assert.equal(refuseForeignSessionTurn({ current: null, initiator: null }), undefined);
    assert.equal(refuseForeignSessionTurn({}), undefined);
  });
});

const withStorage = <T>(storage: unknown, run: () => T): T => {
  const previous = Reflect.get(globalThis, "sessionStorage");
  Reflect.set(globalThis, "sessionStorage", storage);
  try {
    return run();
  } finally {
    Reflect.set(globalThis, "sessionStorage", previous);
  }
};

const workingStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

/** Blocked site data makes the accessor itself throw, not return null. */
const blockedStorage = () => ({
  getItem() {
    throw new Error("The operation is insecure.");
  },
  setItem() {
    throw new Error("The operation is insecure.");
  },
});

const UUID = /^[0-9a-f-]{36}$/u;

describe("studioOwnerHeaders", () => {
  it("mints one token per tab and sends it under the header the server reads", () => {
    const storage = workingStorage();
    const first = withStorage(storage, () => studioOwnerHeaders());
    const second = withStorage(storage, () => studioOwnerHeaders());

    assert.equal(first[STUDIO_OWNER_HEADER], second[STUDIO_OWNER_HEADER]);
    assert.match(first[STUDIO_OWNER_HEADER] ?? "", UUID);
  });

  it("binds two tabs to principals that disagree", async () => {
    const mine = withStorage(workingStorage(), () => studioOwnerHeaders());
    const theirs = withStorage(workingStorage(), () => studioOwnerHeaders());

    assert.notEqual(mine[STUDIO_OWNER_HEADER], theirs[STUDIO_OWNER_HEADER]);
    // The header is only worth what the server derives from it: two tabs must
    // land on two principals, or `refuseForeignSessionTurn` has nothing to
    // compare and the whole binding is decoration.
    assert.notEqual(
      await studioPrincipalId(withToken(mine[STUDIO_OWNER_HEADER] ?? "")),
      await studioPrincipalId(withToken(theirs[STUDIO_OWNER_HEADER] ?? "")),
    );
  });

  it("sends no header at all when storage throws, rather than a token per call", async () => {
    assert.deepEqual(
      withStorage(blockedStorage(), () => studioOwnerHeaders()),
      {},
    );

    // Why absent and not fresh-each-time. A token that cannot be read back is a
    // DIFFERENT token next request, so the session's initiator is a bound
    // `studio-` principal its own follow-up can never match, and the visitor is
    // locked out of the session they just opened. `anonymous` is unbound, and
    // refuseForeignSessionTurn skips an unbound initiator by design.
    const perCall = async () => await studioPrincipalId(withToken(crypto.randomUUID()));
    assert.equal(
      refuseForeignSessionTurn({
        current: { principalId: await perCall() },
        initiator: { principalId: await perCall() },
      })?.code,
      "session_not_owner",
    );

    const unbound = await studioPrincipalId(request("/eve/v1/session"));
    assert.equal(
      refuseForeignSessionTurn({
        current: { principalId: unbound },
        initiator: { principalId: unbound },
      }),
      undefined,
    );
  });

  it("sends no header outside a secure context, where randomUUID does not exist", () => {
    // defineProperty, not assignment: `globalThis.crypto` is an accessor with
    // no setter, so a plain write fails silently and the stub never lands --
    // the test then passes against the real crypto and proves nothing.
    const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
    try {
      // A dev server reached over a bare LAN IP. Throwing inside the header
      // resolver would fail the request instead of degrading to unbound.
      assert.deepEqual(
        withStorage(workingStorage(), () => studioOwnerHeaders()),
        {},
      );
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, "crypto", previous);
      }
    }
  });
});

describe("isDeadStudioSession", () => {
  /**
   * Every refusal `refuseStudioSession` can mint about an *id* has to be one
   * the client acts on, or the studio keeps a cursor the server will refuse
   * forever. This walks the refusals rather than restating the codes, so a
   * fourth one added above fails here until it is classified.
   */
  it("covers every id refusal the policy can mint", () => {
    const stale = sessionId(NOW - DAY_MS - 1000);
    for (const path of [`/eve/v1/session/not-a-run-id/stream`, `/eve/v1/session/${stale}/stream`]) {
      const refusal = refuseStudioSession(request(path), policy);
      assert.ok(refusal, `expected a refusal for ${path}`);
      assert.ok(isDeadStudioSession(refusal), `${refusal.code} is unclassified`);
    }
  });

  it("covers eve's own 409 for an id with nothing runnable behind it", () => {
    // Verified against production: POST to a well-formed id inside its window
    // answers {"code":"session_not_active", ...} with status 409.
    assert.equal(isDeadStudioSession({ code: "session_not_active" }), true);
  });

  it("spares a session refused for the route rather than for the id", () => {
    // The id in the path may be live; discarding it would lose working state.
    const refusal = refuseStudioSession(request(`/eve/v1/session/${sessionId(NOW)}/reset`), policy);
    assert.equal(refusal?.code, "session_route_forbidden");
    assert.equal(isDeadStudioSession(refusal), false);
  });

  it("ignores errors that carry no code, so a transport blip is still retryable", () => {
    for (const error of [
      new Error("This Studio session has expired. Start a new one."),
      { code: "rate_limited" },
      { code: 7 },
      undefined,
      null,
    ]) {
      assert.equal(isDeadStudioSession(error), false);
    }
  });
});
