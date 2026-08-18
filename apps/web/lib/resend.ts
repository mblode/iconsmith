import { Resend } from "resend";

let client: Resend | undefined;

/**
 * Constructed on first send rather than at module scope. The SDK throws when
 * `RESEND_API_KEY` is absent, and Next evaluates route handler modules while
 * collecting page data at build time, where the key is not necessarily set.
 * Module-scope construction turns a missing key into a failed build instead of
 * a failed request.
 */
export const getResend = (): Resend => {
  client ??= new Resend(process.env.RESEND_API_KEY);
  return client;
};
