import { ForbiddenError, localDev, vercelOidc } from "eve/channels/auth";
import type { AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import {
  refuseStudioBody,
  refuseStudioSession,
  studioPrincipalId,
} from "@iconsmith/contract/session-owner";
import agent from "../agent";

/**
 * Read from the agent rather than restated, because the two numbers have to be
 * the same one: `session-owner.ts` refuses an id older than the session it
 * names can still run, and "can still run" is exactly `sessionTimeoutMs`.
 * Raising the agent's limit and leaving a copy here would refuse live sessions.
 *
 * The fallback is eve's own default for an unset or disabled timeout — 30 days,
 * per `docs/concepts/sessions-runs-and-streaming.md`. It is a worse bound than
 * the configured one, which is the argument for configuring one.
 */
const sessionTimeout = agent.limits?.sessionTimeoutMs;
const SESSION_LIFETIME_MS =
  typeof sessionTimeout === "number" ? sessionTimeout : 30 * 24 * 60 * 60 * 1000;

const WINDOW_MS = 60 * 60 * 1000;
/**
 * Requests, not dollars, and the two are not proportional here: a concept the
 * house already draws is answered by recompiling it for about $0.02, while a
 * concept it does not draw runs four arms to exhaustion for about $0.45 and
 * four minutes of compute. So this bounds the worst case, and the worst case is
 * what an unfriendly caller gets by asking for something the set has never
 * drawn. Cost-based limiting against a shared store is the real answer; see the
 * note on `requestCounts` below.
 */
const MAX_REQUESTS_PER_WINDOW = 80;

/**
 * Per-instance, and therefore not a limit so much as a speed bump.
 *
 * Two things to know before trusting it. It lives in one instance's memory, so
 * every cold start hands the caller a fresh allowance — and at roughly four
 * minutes per request, serving even one compliant caller at this ceiling needs
 * several concurrent instances, each with its own counter. And the key below is
 * only as good as the header it reads.
 *
 * The honest fix is a shared, durable, cost-denominated counter — Vercel KV or
 * Upstash, decrementing the run's measured `cost.totalUsd`, which
 * `generateStudioResponse` already computes. `lib/request-guards.ts` says the
 * same thing one line above its own Map.
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * The caller-controlled end of `x-forwarded-for` is the LEFT.
 *
 * The header is append-only: each proxy appends the address it saw, so the
 * rightmost entry is the one the last trusted hop observed and the leftmost is
 * whatever the client asserted. Keying a rate limit on the leftmost value means
 * `-H 'X-Forwarded-For: 1.2.3.<random>'` mints a fresh counter on every
 * request and the ceiling never fires. `x-real-ip` is set by the platform and
 * cannot be spoofed through it, so it is preferred outright.
 */
const clientKey = (request: Request): string => {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) {
    return "unknown";
  }
  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "unknown";
};

const publicDemo: AuthFn<Request> = async (request) => {
  /**
   * Before the rate limit, because these are the access decisions and a refused
   * caller should not also be spending an entry in the map below. The cheap
   * path check runs before the one that buffers a body.
   *
   * This is the only place a *read* can be decided at all: eve settles access at
   * the HTTP boundary and keeps no per-session ACL behind it, so a request that
   * gets past here reaches the whole transcript. That the Studio is a public
   * demo with no login is deliberate; that a session id is the entire
   * credential for reading one is not, and `session-owner.ts` records what is
   * still open.
   */
  const refusal =
    refuseStudioSession(request, { maxAgeMs: SESSION_LIFETIME_MS }) ??
    (await refuseStudioBody(request));
  if (refusal) {
    throw new ForbiddenError(refusal);
  }

  const now = Date.now();
  // Evicted here rather than on a timer: without it the map grows by one entry
  // per distinct key forever, and the keys are attacker-influenced.
  for (const [key, value] of requestCounts) {
    if (now > value.resetAt) {
      requestCounts.delete(key);
    }
  }

  /**
   * Every method, not just POST.
   *
   * `GET /eve/v1/session/:id/stream` replays a whole session and holds an
   * invocation open while it does; exempting it made the two most expensive
   * read paths free.
   */
  const key = clientKey(request);
  const current = requestCounts.get(key);
  if (!current || now > current.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new ForbiddenError({
      code: "rate_limited",
      message: "Too many Studio agent requests. Try again in an hour.",
    });
  } else {
    current.count += 1;
  }

  /**
   * A per-browser principal in place of `none()`.
   *
   * `none()` returns one module-level `ANONYMOUS_SESSION_AUTH_CONTEXT` to every
   * caller, so the `auth.current` eve records for a follow-up turn was the same
   * object as the `auth.initiator` it pinned at creation and the two could not
   * disagree. Deriving the id from a token the browser holds is what makes them
   * able to. `principalType` stays `anonymous`, because nothing here
   * authenticates anybody: the token is self-minted and this is a pseudonym, not
   * an identity. A caller that sends no token still lands on the `anonymous`
   * principal and is bound to nothing, which is how the Studio keeps working
   * before the client sends the header at all.
   *
   * `authenticator` is named rather than left as eve's `"none"` so a log can
   * tell an owner-bound anonymous turn from an unbound one.
   */
  return {
    attributes: {},
    authenticator: "studio-public",
    principalId: await studioPrincipalId(request),
    principalType: "anonymous",
  };
};

export default eveChannel({
  auth: [localDev(), vercelOidc(), publicDemo],
  /**
   * Without this the framework default governs the HTTP body — `*` media types
   * at 25 MB per part, with no cap on the number of parts — and
   * `studioAttachmentSchema` cannot help, because it validates the tool input
   * rather than the upload. The numbers here match what the composer will
   * actually accept: four files at the 2.1 MB the schema allows.
   */
  uploadPolicy: {
    allowedMediaTypes: ["image/jpeg", "image/png", "image/svg+xml", "image/webp"],
    maxBytes: 2_200_000,
  },
});
