import { headers } from "next/headers";

/**
 * Shared abuse guards for the public server actions (contact, newsletter).
 * Both entry points are unauthenticated POSTs reachable without going through
 * the UI, so each one runs these before doing any work.
 */

// Simple in-memory rate limiting (use Redis/Upstash for production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const WINDOW_MS = 60 * 60 * 1000;

export const clientIp = async (): Promise<string> => {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-for")?.split(",")[0] || headersList.get("x-real-ip") || "unknown"
  );
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
