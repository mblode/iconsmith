/**
 * Who may continue, read, or destroy a Studio session.
 *
 * eve does not answer this, and says so twice in one page. From
 * `node_modules/eve/docs/guides/auth-and-route-protection.md`: "Route auth does
 * not enforce session ownership. If multiple users or tenants can reach the
 * same route, you must implement the per-user, per-tenant, or per-session
 * authorization your application requires", and — of a persistent session — "it
 * does not hide the persistent session's conversation history or artifacts from
 * a caller who is otherwise allowed to continue that session; session ownership
 * remains an application policy."
 *
 * `agent/channels/eve.ts` ends its auth walk in `none()`, because the Studio is
 * a public demo with no login and cannot grow one without ceasing to be a demo.
 * `none()` accepts, so every id-addressed route was anonymous and the session id
 * was the entire credential:
 *
 * - `GET /eve/v1/session/:id/stream` replays the whole transcript from index
 *   zero — every brief, attachment name, annotation, and rendered SVG.
 * - `POST /eve/v1/session/:id` appends a billable turn to someone else's
 *   conversation; the channel's own rate-limit note prices the worst one at
 *   about $0.45 and four minutes of compute.
 * - `POST .../reset` retires that session terminally and `POST .../clear`
 *   deletes its model history.
 *
 * **Why this is not a per-owner check.** The policy that belongs here is an
 * opaque owner token minted on first contact and compared against the session's
 * recorded initiator. Neither half is reachable from an `AuthFn`. It receives a
 * `Request` and returns a principal, so it can never put a `Set-Cookie` on a
 * *successful* response — the token cannot be minted at the only moment the
 * session id first exists. And nothing in eve's public surface reads a stored
 * session's `auth.initiator` from outside a run: `initiator` appears on
 * `InstrumentationSession` and on `ctx.session.auth`, both of which exist only
 * once a turn is already executing, which is after the point `GET /stream` has
 * to be decided. Recording the binding ourselves needs a store shared across
 * instances, and this app has none — Vercel's filesystem is read-only, every
 * cold start is a fresh process, and `package.json` declares no KV, Redis, or
 * Upstash client. `lib/request-guards.ts` and the `requestCounts` map in
 * `agent/channels/eve.ts` both carry the same admission about their own state.
 *
 * **So this narrows the capability rather than binding it,** and every rule
 * below is chosen to cost a first-party visitor nothing:
 *
 * 1. Only the routes the Studio actually calls are reachable anonymously.
 * 2. The id must be the shape eve mints, not an arbitrary string.
 * 3. The id stops working when the session it names stops being able to run.
 *
 * What remains open after all three: a caller who obtains a live session id
 * within its lifetime can still read and continue it. Closing that needs the
 * owner token, and the token needs somewhere to be written. See
 * `refuseStudioSession` for the seam.
 */

/**
 * The refusal shape is exactly `ForbiddenError`'s option object, so the caller
 * rethrows it without translating. `code` is machine-readable because the three
 * refusals mean different things to whoever is reading a log: a wrong route, a
 * forged id, and an expired one are three different reports.
 */
export interface StudioSessionRefusal {
  readonly code: string;
  readonly message: string;
}

export interface StudioSessionPolicy {
  /**
   * How long after minting a session id may still be used. Pass the agent's
   * `limits.sessionTimeoutMs`, which `agent/channels/eve.ts` reads from the
   * definition rather than restating; the expiry rule below is why the two have
   * to be the same number.
   */
  readonly maxAgeMs: number;
  /**
   * Tolerance for an id minted slightly ahead of this instance's clock.
   * Defaults to the five minutes eve's own `validateUlidTimestamp` allows,
   * which calls it "tight ... to prevent abuse from client-generated ULIDs with
   * manipulated future timestamps while still tolerating minor clock skew".
   */
  readonly clockSkewMs?: number;
  readonly now?: number;
}

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The empty suffix is the follow-up route (`POST /eve/v1/session/:id`), which
 * also carries `respond`.
 *
 * The Studio calls `send`, `respond`, `cancel`, and `resume` and nothing else —
 * grep `agent.` in `components/studio/studio-app.tsx`. So `/reset`, `/clear`,
 * `/compact`, and the `/subagents/:callId/:childSessionId/stream` read are
 * unreachable from the product and refusing them anonymously regresses nobody,
 * while removing the destructive half of the surface outright. A developer
 * still reaches them: `localDev()` and `vercelOidc()` sit ahead of the public
 * entry in the auth walk, so this policy never sees their requests.
 */
const STUDIO_SESSION_ROUTES = new Set(["", "/cancel", "/stream"]);

const SESSION_PREFIX = "/eve/v1/session/";

/**
 * The id and the operation named by a path, or `undefined` when the path
 * addresses no session at all.
 *
 * Searched for rather than anchored at the start, because the two hosts
 * disagree about the prefix: the Vercel service sees `/eve/v1/...` after
 * `lib/eve-vercel-routes.ts` transforms the request path back, while a local
 * run can still see the zone's `/iconsmith` in front of it.
 *
 * The create route `/eve/v1/session` leaves no id behind the prefix and so
 * returns `undefined`, which is the intended answer — starting a session has to
 * stay open or the demo has no first turn.
 */
const sessionRoute = (
  pathname: string,
): { readonly sessionId: string; readonly suffix: string } | undefined => {
  const at = pathname.indexOf(SESSION_PREFIX);
  if (at === -1) {
    return undefined;
  }

  const addressed = pathname.slice(at + SESSION_PREFIX.length);
  const boundary = addressed.indexOf("/");
  const sessionId = boundary === -1 ? addressed : addressed.slice(0, boundary);
  if (!sessionId) {
    return undefined;
  }
  return { sessionId, suffix: boundary === -1 ? "" : addressed.slice(boundary) };
};

/**
 * eve mints a session id as `wrun_` plus a 26-character ULID — its vendored
 * `@workflow/world/ulid` calls it "the `wrun_` prefix followed by a 26-char
 * ULID ... Validates the exact shape ... rather than a loose length bound, so
 * callers can't smuggle arbitrary strings through APIs that persist a run ID
 * verbatim". That module is not exported from the `eve` package (a deep import
 * fails `ERR_PACKAGE_PATH_NOT_EXPORTED`), so the shape is restated here.
 *
 * The alphabet is Crockford base32, which omits I, L, O, and U. Nothing is
 * captured: `tsconfig.json` targets ES2017, which predates named capture
 * groups, and oxlint's `prefer-named-capture-group` rejects numbered ones, so
 * the ten time characters are sliced out by offset instead.
 */
const RUN_ID_PREFIX = "wrun_";
const RUN_ID = /^wrun_[0-9A-HJKMNP-TV-Z]{26}$/u;
const RUN_ID_TIME_LENGTH = 10;
/** Vercel marks region-tagged run ids with the high bit of the 48-bit ULID time. */
const REGION_TAG_BIT = 2 ** 47;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The millisecond timestamp a session id carries in its own first ten
 * characters, or `undefined` when the string is not an id eve could have
 * minted.
 *
 * This is what makes an age rule enforceable with no store at all: the id
 * states its own birth, so the server needs to remember nothing to know how old
 * it is. Ten base32 characters are 50 bits, comfortably inside the 53 a double
 * holds exactly, so the running total below never loses precision.
 */
export const sessionMintedAt = (sessionId: string): number | undefined => {
  if (!RUN_ID.test(sessionId)) {
    return undefined;
  }

  const start = RUN_ID_PREFIX.length;
  let minted = 0;
  for (const character of sessionId.slice(start, start + RUN_ID_TIME_LENGTH)) {
    minted = minted * 32 + CROCKFORD.indexOf(character);
  }

  /**
   * `@workflow/world-vercel` embeds its region tag by setting the most-significant
   * bit of the ULID's 48-bit timestamp. Its own decoder clears that bit before
   * reading the creation time; without the same step here, every production id
   * appears to come from after the year 6400 and is refused as expired.
   *
   * The region and codec-version fields live in the random half of the ULID and
   * do not affect this age check.
   */
  return minted >= REGION_TAG_BIT ? minted - REGION_TAG_BIT : minted;
};

/**
 * The reason to refuse this request, or `undefined` to let the auth walk carry
 * on. A request that addresses no session id — creating one, `/info`,
 * `/health` — is always `undefined`: the brief for a public demo is that a
 * first visit works, so absence of a session opens and only a mismatch closes.
 *
 * **The seam for real ownership.** When the Studio can hand a session id back
 * to a first-party endpoint that owns a response, this function is where the
 * binding check goes: sign the id into an `HttpOnly` cookie at claim time, and
 * refuse here unless the presented cookie carries the id in the path. The claim
 * needs a window, and `sessionMintedAt` already supplies one that needs no
 * store — a session may only be claimed within seconds of its own minting, so
 * an id obtained later, from a log or a screenshot or a shared machine, is
 * unclaimable. That needs a server action and one client call, neither of which
 * exists yet; until it does, the rules below are the whole policy.
 */
export const refuseStudioSession = (
  request: Request,
  policy: StudioSessionPolicy,
): StudioSessionRefusal | undefined => {
  const route = sessionRoute(new URL(request.url).pathname);
  if (!route) {
    return undefined;
  }

  if (!STUDIO_SESSION_ROUTES.has(route.suffix)) {
    return {
      code: "session_route_forbidden",
      message: "This Studio session operation is not available.",
    };
  }

  const minted = sessionMintedAt(route.sessionId);
  if (minted === undefined) {
    return { code: "session_not_found", message: "No such Studio session." };
  }

  /**
   * An expired id is refused rather than replayed, and that is the point rather
   * than a side effect. eve's own note on `sessionTimeoutMs` is that
   * "expiration does not delete stored session data" — so past the deadline the
   * session can no longer take a turn, but its whole transcript still streams
   * to anyone holding the id, forever. Tying the id's usable life to the
   * session's configured one closes an otherwise unbounded read window, and
   * costs a returning visitor only the replay of a conversation that could not
   * have been continued anyway.
   *
   * A timestamp in the future is not staleness but a forgery: eve mints ids
   * from `Date.now()`, so nothing legitimate is ahead of this clock by more
   * than skew.
   */
  const now = policy.now ?? Date.now();
  const age = now - minted;
  if (age > policy.maxAgeMs || age < -(policy.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS)) {
    return {
      code: "session_expired",
      message: "This Studio session has expired. Start a new one.",
    };
  }

  return undefined;
};
