import { getResend } from "@/lib/resend";
import { SITE_URL } from "@/lib/site-url";
import { readSubscriptionToken } from "@/lib/subscription-token";

// Reads the request URL and writes to the segment; never cache it.
export const dynamic = "force-dynamic";

/**
 * Absolute, and built from `SITE_URL` rather than the incoming request.
 *
 * `Response.redirect` is a Web API, so Next applies no `basePath` to it. This
 * works only because `SITE_URL` already carries `/iconsmith`. The tempting
 * refactor to `NextResponse.redirect(new URL("/subscribed", request.url))` is
 * wrong twice over: `request.url` is the private zone origin, not blode.co, and
 * the child would then prefix the path a second time.
 */
const redirectTo = (status: "confirmed" | "invalid"): Response =>
  Response.redirect(`${SITE_URL}/subscribed?status=${status}`, 303);

/**
 * Step two of confirmed opt-in. The signed token is the only evidence that the
 * recipient controls the address, so a bad token must never fall back to an
 * email supplied any other way.
 *
 * A GET that mutates, because a link in an email cannot POST. That makes it
 * safe to replay: `contacts.create` on an address already in the segment is a
 * no-op from the subscriber's point of view, so a prefetching mail client or a
 * second click confirms rather than errors.
 */
export const GET = async (request: Request): Promise<Response> => {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return redirectTo("invalid");
  }

  const email = readSubscriptionToken(token, Date.now());
  if (!email) {
    return redirectTo("invalid");
  }

  const segmentId = process.env.RESEND_SEGMENT_ID;
  if (!segmentId) {
    console.error("RESEND_SEGMENT_ID is not set");
    return redirectTo("invalid");
  }

  // `segments` rather than the deprecated `audienceId`: Resend has migrated
  // audiences to segments, and the legacy overload is on its way out.
  const { error } = await getResend().contacts.create({
    email,
    segments: [{ id: segmentId }],
    unsubscribed: false,
  });

  if (error) {
    console.error("Resend error:", error);
    return redirectTo("invalid");
  }

  return redirectTo("confirmed");
};
