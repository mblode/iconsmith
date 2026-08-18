"use server";

import { ConfirmSubscriptionEmail } from "@/emails/confirm-subscription";
import { clientIp, rateLimit, verifyTurnstile } from "@/lib/request-guards";
import { getResend } from "@/lib/resend";
import { SITE_URL } from "@/lib/site-url";
import { createSubscriptionToken } from "@/lib/subscription-token";
import { newsletterFormSchema } from "@/lib/validations/newsletter";

const MAX_SIGNUPS_PER_HOUR = 3;

/**
 * Step one of confirmed opt-in: verify the submitter is human, then email the
 * address a signed confirmation link. Nothing is written to the audience here.
 * `app/api/confirm` does that once the recipient proves they own the address.
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

  const { email } = validated.data;

  try {
    const token = createSubscriptionToken(email, Date.now());
    const confirmUrl = `${SITE_URL}/api/confirm?token=${encodeURIComponent(token)}`;

    const { error } = await getResend().emails.send({
      from: "Matthew Blode <hello@send.blode.co>",
      react: ConfirmSubscriptionEmail({ confirmUrl }),
      subject: "Confirm your subscription",
      to: [email],
    });

    if (error) {
      console.error("Resend error:", error);
      return { error: "Could not send the confirmation email. Try again." };
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected error:", error);
    return { error: "An unexpected error occurred. Please try again later." };
  }
};
