import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confirmed opt-in without a database.
 *
 * An unconfirmed address is never stored anywhere: the signed token in the
 * confirmation link *is* the pending state. If the recipient never clicks, the
 * address simply ceases to exist, and only confirmed addresses ever reach the
 * Resend audience. That is what keeps a public form from being usable to inject
 * arbitrary addresses into the list, which would otherwise put spam traps on
 * the same sending domain the contact form depends on.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface TokenPayload {
  email: string;
  iat: number;
}

const secret = (): string => {
  const value = process.env.NEWSLETTER_TOKEN_SECRET;
  // Fails closed, matching the Turnstile handling in `sendContactEmail`. An
  // unsigned confirmation link would let anyone confirm any address.
  if (!value) {
    throw new Error("NEWSLETTER_TOKEN_SECRET is not set");
  }
  return value;
};

const sign = (data: string): string =>
  createHmac("sha256", secret()).update(data).digest("base64url");

export const createSubscriptionToken = (email: string, now: number): string => {
  const payload: TokenPayload = { email, iat: now };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
};

/**
 * Returns the email a token vouches for, or null if the token is malformed,
 * forged, or expired. Callers must treat null as "do not subscribe" rather than
 * falling back to any address supplied alongside it.
 */
export const readSubscriptionToken = (token: string, now: number): string | null => {
  const [data, signature] = token.split(".");
  if (!(data && signature)) {
    return null;
  }

  const expected = Buffer.from(sign(data));
  const received = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch, so that is checked first rather
  // than caught.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8")) as TokenPayload;

    if (
      typeof payload.email !== "string" ||
      typeof payload.iat !== "number" ||
      now - payload.iat > TOKEN_TTL_MS
    ) {
      return null;
    }

    return payload.email;
  } catch {
    return null;
  }
};
