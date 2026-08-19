"use server";

import { clientIp, rateLimit, verifyTurnstile } from "@/lib/request-guards";
import { getResend } from "@/lib/resend";
import { newsletterFormSchema } from "@/lib/validations/newsletter";

const MAX_SIGNUPS_PER_HOUR = 3;

/**
 * Single opt-in: the address goes straight into the segment.
 *
 * There is no confirmation step, so nothing here proves the submitter owns the
 * address they typed. Turnstile and the per-IP hourly limit are the only things
 * standing between this and an open write to the audience, which makes them
 * load-bearing rather than decorative: `verifyTurnstile` already fails closed
 * on a missing secret, and it must stay that way.
 *
 * The tradeoff is deliberate and was asked for. The cost lands on the sending
 * domain, which is shared with every other blode.co send: an address typed
 * wrong, or typed by someone else, is now a real contact that can bounce or
 * mark spam.
 */
export const subscribeToNewsletter = async (formData: FormData) => {
  const ip = await clientIp();

  if (!rateLimit(`newsletter:${ip}`, MAX_SIGNUPS_PER_HOUR, Date.now())) {
    return { error: "Too many requests. Please try again later." };
  }

  if (!(await verifyTurnstile(formData.get("cf-turnstile-response"), ip))) {
    return { error: "Verification failed. Please try again." };
  }

  const validated = newsletterFormSchema.safeParse({
    email: formData.get("email"),
  });

  if (!validated.success) {
    return { error: "Please enter a valid email address." };
  }

  const segmentId = process.env.RESEND_SEGMENT_ID;

  if (!segmentId) {
    console.error("RESEND_SEGMENT_ID is not set");
    return { error: "An unexpected error occurred. Please try again later." };
  }

  try {
    // Safe to repeat: creating a contact that is already in the segment is a
    // no-op from the subscriber's point of view, so a double submit reads as
    // success rather than an error.
    const { error } = await getResend().contacts.create({
      email: validated.data.email,
      segments: [{ id: segmentId }],
      unsubscribed: false,
    });

    if (error) {
      console.error("Resend error:", error);
      return { error: "Could not add you to the list. Try again." };
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected error:", error);
    return { error: "An unexpected error occurred. Please try again later." };
  }
};
