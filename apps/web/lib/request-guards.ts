import { headers } from "next/headers";

/**
 * Shared abuse guards for the public server actions (contact, newsletter).
 * Both entry points are unauthenticated POSTs reachable without going through
 * the UI, so each one runs these before doing any work.
 */

// Simple in-memory rate limiting (use Redis/Upstash for production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const WINDOW_MS = 60 * 60 * 1000;

/**
 * The caller-controlled end of `x-forwarded-for` is the LEFT.
 *
 * The header is append-only: each proxy appends the address it saw, so the
 * rightmost entry is the one the last trusted hop observed and the leftmost is
 * whatever the client asserted. This read the leftmost and used `x-real-ip`
 * only as a fallback, which is backwards on both counts: `-H 'X-Forwarded-For:
 * 1.2.3.<random>'` minted a fresh `rateLimit` bucket per request and the hourly
 * newsletter ceiling never fired. Turnstile sits in front of both callers, so
 * this was defence in depth rather than an open door.
 *
 * `agent/channels/eve.ts` decides the same question for the Studio's own
 * limiter and must stay in step with this. The two are deliberately not one
 * helper: that file runs on eve's Vercel service rather than in Next, and
 * importing this module would pull `next/headers` into its bundle for the sake
 * of eight lines.
 */
export const clientIp = async (): Promise<string> => {
  const headersList = await headers();
  const real = headersList.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  const hops = (headersList.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "unknown";
};

/**
 * `key` is namespaced per action by the caller so that sending a contact
 * message does not consume the newsletter budget or vice versa.
 */
export const rateLimit = (key: string, maxRequests: number, now: number): boolean => {
  // Evict expired records so the map does not grow unbounded across IPs.
  for (const [entryKey, value] of rateLimitMap) {
    if (now > value.resetTime) {
      rateLimitMap.delete(entryKey);
    }
  }

  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + WINDOW_MS });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
};

/**
 * Fails closed: a missing `TURNSTILE_SECRET` makes every submission fail
 * verification rather than leaving the form silently unprotected.
 */
export const verifyTurnstile = async (
  token: FormDataEntryValue | null,
  ip: string,
): Promise<boolean> => {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    body: new URLSearchParams({
      remoteip: ip,
      response: typeof token === "string" ? token : "",
      secret: process.env.TURNSTILE_SECRET ?? "",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const result = await response.json();

  return result.success === true;
};
