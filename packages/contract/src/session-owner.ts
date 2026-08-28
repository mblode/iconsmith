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
 * within its lifetime can still read and continue it.
 *
 * **The write half of that is now bound, and the read half is not.** The
 * paragraph above was half wrong about why. The owner token does need somewhere
 * to be written, but eve already writes it: a session's `auth.initiator` is
 * pinned at creation and "a follow-up message updates `auth.current` but leaves
 * `auth.initiator` alone" (`docs/guides/auth-and-route-protection.md`). What
 * made the comparison useless was the other end. `none()` returns one
 * module-level constant to every caller — `ANONYMOUS_SESSION_AUTH_CONTEXT` in
 * `node_modules/eve/dist/src/public/channels/auth.js` — so `current` and
 * `initiator` were the same object and could not disagree. `studioPrincipalId`
 * below replaces that constant with a per-browser one, which is the half this
 * app can supply.
 *
 * Three things the binding does not do, each of which matters more than what it
 * does:
 *
 * - **It is not authentication.** The browser mints the token and keeps it in
 *   `sessionStorage`; `principalType` stays `anonymous`. It proves that two
 *   requests came from the same tab, which is what "a stranger may not spend my
 *   session" needs, and nothing else. Anyone may mint one.
 * - **It does not close `GET /stream`.** Route auth is decided before any turn
 *   runs, and `auth.initiator` is readable only from inside one, so the read
 *   path still has no owner to compare against. An id holder reads the whole
 *   transcript exactly as before.
 * - **A caller that sends no token is not refused.** Every such caller collapses
 *   onto the same `anonymous` principal and is bound to nothing, because the
 *   Studio has to keep working for a client that has not shipped the header. The
 *   binding is therefore opt-in per browser, and worth nothing against a caller
 *   who simply omits it — its whole value is that a *victim's* session, opened
 *   with a token, cannot be continued without that token.
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

const SESSION_PREFIX = ["eve", "v1", "session"] as const;

/**
 * A path split into the segments a router sees, with the spellings that mean
 * the same route to a router folded together first.
 *
 * The empties are dropped, which collapses `//` and any leading or trailing
 * slash; each segment is percent-decoded, so `%2F` cannot hide a boundary. Both
 * were fail-*open* before: this policy located its prefix with `indexOf` on the
 * raw path, and a spelling it failed to recognise was reported as "addresses no
 * session", which `refuseStudioSession` reads as permission to continue. A
 * matcher that has to agree with someone else's router should err toward
 * matching, because a false match costs one refused request and a missed match
 * costs the whole policy.
 *
 * A segment that will not decode is kept raw rather than dropped, for the same
 * reason.
 */
const pathSegments = (pathname: string): readonly string[] =>
  pathname
    .split("/")
    .flatMap((segment) => {
      try {
        return decodeURIComponent(segment).split("/");
      } catch {
        return [segment];
      }
    })
    .filter(Boolean);

/**
 * The id and the operation named by a path, or `undefined` when the path
 * addresses no session at all.
 *
 * Searched for rather than anchored at the start, because the two hosts
 * disagree about the prefix: the Vercel service sees `/eve/v1/...` after
 * `lib/eve-vercel-routes.ts` transforms the request path back, while a local
 * run can still see the zone's `/iconsmith` in front of it.
 *
 * The prefix and the suffix are matched case-insensitively and the id is not:
 * eve mints ids in upper-case Crockford base32, and lower-casing one would turn
 * a forgery test into a lookup of a session that cannot exist. Folding the
 * suffix's case instead means `/STREAM` is judged by the id and expiry rules
 * rather than waved through as an unrecognised route.
 *
 * The create route `/eve/v1/session` leaves no id behind the prefix and so
 * returns `undefined`, which is the intended answer — starting a session has to
 * stay open or the demo has no first turn.
 */
const sessionRoute = (
  pathname: string,
): { readonly sessionId: string; readonly suffix: string } | undefined => {
  const segments = pathSegments(pathname);
  const at = segments.findIndex(
    (_segment, index) =>
      SESSION_PREFIX.every(
        (expected, offset) => segments[index + offset]?.toLowerCase() === expected,
      ) && segments.length > index + SESSION_PREFIX.length,
  );
  if (at === -1) {
    return undefined;
  }

  const [sessionId, ...rest] = segments.slice(at + SESSION_PREFIX.length);
  if (!sessionId) {
    return undefined;
  }
  return {
    sessionId,
    suffix: rest.length === 0 ? "" : `/${rest.join("/").toLowerCase()}`,
  };
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

/**
 * The refusals that mean the session id the caller presented will never work
 * again, whatever it does next.
 *
 * This is the set a client has to act on rather than report. The Studio keeps
 * its resume cursor in `localStorage`, so an id outlives by weeks the 24 hours
 * `refuseStudioSession` gives it — and a banner offering "Try again" over a
 * dead cursor replays the same dead id forever. Every code here has the one
 * remedy: drop the cursor, open a new session, send the brief again.
 *
 * Two of the three are minted above. `session_not_active` is eve's own, from
 * `POST /eve/v1/session/:id` when nothing runnable stands behind the id (409,
 * "The session is no longer active."), which is what a caller gets for a
 * well-formed id inside its window that the store has since dropped. It is
 * restated here because the remedy is identical and because a client should
 * read one list, not two.
 *
 * `session_route_forbidden` is deliberately absent. It refuses a *route* the
 * Studio has no business calling, and says nothing about the id in the path,
 * which may be perfectly live — discarding a working session over a client bug
 * would turn a harmless no-op into lost work.
 */
export const DEAD_STUDIO_SESSION_CODES: ReadonlySet<string> = new Set([
  "session_expired",
  "session_not_found",
  "session_not_active",
]);

/**
 * Whether a thrown error is one of those refusals.
 *
 * Matched on eve's `ClientError.code`, which it parses off the `code` field of
 * the refusal body, and never on the message: the message is prose meant for a
 * human and is the half of the response most likely to be reworded.
 */
export const isDeadStudioSession = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string" &&
  DEAD_STUDIO_SESSION_CODES.has(error.code);

/**
 * The request header carrying the browser's owner token.
 *
 * The Studio mints one `crypto.randomUUID()` per tab and keeps it in
 * `sessionStorage`, then sends it on every call:
 * `useEveAgent({ headers: () => ({ [STUDIO_OWNER_HEADER]: token }) })`. It is
 * same-origin through the zone rewrite, so no preflight and no CORS allowance
 * are involved.
 */
export const STUDIO_OWNER_HEADER = "x-studio-owner";

/**
 * Where the browser keeps its token.
 *
 * `sessionStorage`, not `localStorage`: the binding should last exactly as long
 * as the tab that opened the session, and a token that outlives it only widens
 * what a stolen one unlocks.
 */
const OWNER_STORAGE_KEY = "iconsmith.studio.owner";

/**
 * The token for this tab, or `undefined` when this browser cannot keep one.
 *
 * Every storage access is guarded because the accessor itself throws when a
 * browser is set to block site data -- it does not merely return null. But a
 * browser that cannot store one must send **no header**, not a fresh token per
 * call, and the difference is the whole binding. A per-call token is not the
 * header-less behaviour it resembles: the create request mints one bound
 * principal and the very next follow-up mints another, so
 * `refuseForeignSessionTurn` compares two `studio-` ids that can never match
 * and locks the visitor out of the session they just opened. Sending nothing
 * lands on `anonymous`, which that check skips by design -- unbound, which is
 * the honest state for a browser that cannot hold a binding.
 *
 * `crypto.randomUUID` is guarded for the same reason: it is undefined outside a
 * secure context, so a dev server reached over a bare LAN IP would otherwise
 * throw inside the header resolver and fail the request rather than degrade.
 */
const ownerToken = (): string | undefined => {
  try {
    const stored = sessionStorage.getItem(OWNER_STORAGE_KEY);
    if (stored) {
      return stored;
    }
  } catch {
    return undefined;
  }

  if (typeof crypto?.randomUUID !== "function") {
    return undefined;
  }

  const minted = crypto.randomUUID();
  try {
    sessionStorage.setItem(OWNER_STORAGE_KEY, minted);
  } catch {
    // A token that cannot be read back next request binds nothing; see above.
    return undefined;
  }
  return minted;
};

/**
 * The browser half of the binding, passed to `useEveAgent({ headers })`.
 *
 * Until a caller sends a token every request collapses onto eve's one
 * `anonymous` principal and no session is bound to anyone, so this is the part
 * that makes the policy above do anything at all. It lives beside the header it
 * sets rather than in its own module so that the name has exactly one
 * definition and both of its users sit next to it.
 *
 * Resolved per request rather than captured at mount, so the first call after a
 * tab restores its `sessionStorage` sends the restored token instead of a
 * closure over whatever was there when the component mounted.
 */
export const studioOwnerHeaders = (): Record<string, string> => {
  const token = ownerToken();
  return token === undefined ? {} : { [STUDIO_OWNER_HEADER]: token };
};

/**
 * eve's own anonymous principal id, which is what a caller sending no token
 * gets. Restated rather than imported because `SessionAuthContext` and its
 * constants are not exported from the `eve` package.
 */
const ANONYMOUS_PRINCIPAL_ID = "anonymous";

/** 128 bits of the digest, which is more than a collision search will find. */
const OWNER_ID_LENGTH = 32;

/**
 * The principal id for this request: one derived from the caller's owner token,
 * or eve's `anonymous` when there is no token.
 *
 * Hashed rather than passed through because the id is durable session state and
 * shows up in instrumentation. A token read out of a log is a working
 * credential for that session; its digest is not.
 *
 * The header-less answer is deliberately the same constant for everybody. That
 * makes a header-less caller indistinguishable from every other header-less
 * caller — which is the pre-existing behaviour, and is why shipping this ahead
 * of the client change costs the Studio nothing.
 */
export const studioPrincipalId = async (request: Request): Promise<string> => {
  const token = request.headers.get(STUDIO_OWNER_HEADER)?.trim();
  if (!token) {
    return ANONYMOUS_PRINCIPAL_ID;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `studio-${hex.slice(0, OWNER_ID_LENGTH)}`;
};

/**
 * Fields the public path refuses outright, because the Studio never sends one
 * and each hands the caller something the product does not use.
 *
 * `callback` is the one that is a hole rather than a widening. eve validates
 * only that the URL is absolute, that its path ends in
 * `/eve/v1/callback/<token>` matching the body's own token, and that the host is
 * not private or reserved (`node_modules/eve/dist/src/channel/session-callback.js`)
 * — every public host passes, and the session's terminal output is then POSTed
 * there. `parseSessionMessageBody` reads it on the follow-up route too, not only
 * on create, which is why this runs on every JSON POST rather than just the
 * create one.
 *
 * `mode` and `capabilities` are surface reduction and it is worth being exact
 * about how little they close, because the obvious story about them is wrong.
 * The obvious story is that a caller sends `mode: "conversation"` to obtain
 * `capabilities: { requestInput: true }` and then answers its own token-limit
 * prompt to raise the session budget. The prompt and the budget bump are real —
 * `harness/session-limit-enforcement.js` parks on the limit and
 * `bumpSessionRuntimeTokenLimits` raises it when the caller grants — but the
 * caller needs to send nothing to get there: the channel's default is
 * `capabilities ?? (mode === "task" ? undefined : { requestInput: true })` and
 * `mode` already defaults to conversation. Conversation mode is also what
 * `agent/tools/ask_question.ts` exists for, so it cannot be traded away. What
 * refusing the two fields actually buys is that a public caller cannot flip the
 * agent into `task` mode, and cannot turn the human off; the budget remains
 * self-granted and is the rate limit's problem, not this one's.
 */
const FORBIDDEN_BODY_FIELDS = ["callback", "capabilities", "mode"] as const;

/**
 * The reason to refuse this request's body, or `undefined` when there is
 * nothing in it the public path declines to serve.
 *
 * `clone()` rather than `json()`, because the channel reads the same request
 * afterwards and a consumed body would fail its own parse. The cost is the body
 * buffered twice, which the channel's `uploadPolicy` bounds at four parts of
 * 2.2 MB; the create body is always JSON with attachments base64'd inside
 * `message` (`eve/dist/src/client/session.js` sets `content-type` and
 * `JSON.stringify`s), so there is no multipart path to miss.
 *
 * A body that will not parse is passed through rather than refused: eve answers
 * that with its own 400, and reporting it as 403 here would mislabel a bug in a
 * client as an access decision.
 */
export const refuseStudioBody = async (
  request: Request,
): Promise<StudioSessionRefusal | undefined> => {
  if (request.method !== "POST" || !request.headers.get("content-type")?.includes("json")) {
    return undefined;
  }

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const sent = FORBIDDEN_BODY_FIELDS.filter((field) => Object.hasOwn(body, field));
  if (sent.length === 0) {
    return undefined;
  }
  return {
    code: "session_field_forbidden",
    message: `The Studio agent does not accept '${sent.join("', '")}' from a public caller.`,
  };
};

/**
 * The two principals eve records against a durable session, narrowed to the one
 * field this policy reads.
 *
 * Structural rather than eve's own `SessionAuth`, because that type reaches the
 * public surface only through `ctx.session.auth` inside a run — importing it
 * would pull the runtime into a module that Next also bundles.
 */
export interface StudioSessionAuth {
  readonly current?: { readonly principalId: string } | null;
  readonly initiator?: { readonly principalId: string } | null;
}

/**
 * The reason to refuse this turn, or `undefined` to let it run.
 *
 * Called from `agent/agent.ts`, not from this file's other rules, and the
 * distance is the point: route auth is settled before any turn exists, so a
 * check that needs `auth.initiator` cannot live beside them. The seam is the
 * agent's dynamic `model` resolver, which is the one authored callback eve runs
 * before a turn does model-dependent work; that file carries the trace through
 * `dispatchDynamicModelEvent` and `failModelSelection` that shows a refusal
 * costs no provider call.
 *
 * **The rule is deliberately one-directional.** A session whose initiator is the
 * unbound `anonymous` principal was never bound to anybody, so refusing a
 * token-bearing caller there would punish the only caller who brought a
 * credential — and would break every session opened before the client shipped
 * the header. Only a session that *was* opened with a token refuses a caller who
 * does not present the same one.
 *
 * What this closes is the expensive half: continuing someone else's session
 * costs one refused workflow turn and no model call, against roughly the $0.45
 * and four minutes `agent/channels/eve.ts` prices the worst turn at. What it
 * leaves open is the read: `GET /eve/v1/session/:id/stream` is answered without
 * starting a turn, so no resolver runs and an id holder still replays the whole
 * transcript.
 */
export const refuseForeignSessionTurn = (
  auth: StudioSessionAuth,
): StudioSessionRefusal | undefined => {
  const initiator = auth.initiator?.principalId;
  if (!initiator || initiator === ANONYMOUS_PRINCIPAL_ID) {
    return undefined;
  }
  if (auth.current?.principalId === initiator) {
    return undefined;
  }
  return {
    code: "session_not_owner",
    message: "This Studio session belongs to another browser. Start a new one.",
  };
};
