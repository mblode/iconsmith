"use client";

import Script from "next/script";
import { useId, useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";

import { subscribeToNewsletter } from "@/app/actions/subscribe";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resetTurnstile, useTurnstileErrorCallback } from "@/hooks/use-turnstile-error-callback";
import { newsletterResolver } from "@/lib/validations/newsletter";
import type { NewsletterFormData } from "@/lib/validations/newsletter";

// Public by design: the site key ships in the client bundle. The matching
// secret stays server-side as TURNSTILE_SECRET.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// oxlint-disable-next-line no-empty-function -- useSyncExternalStore requires an unsubscribe callback.
const subscribeNoop = () => () => {};
const getClientTrue = () => true;
const getServerFalse = () => false;

/**
 * Capture only. There is deliberately no cadence promise here: the list is for
 * occasional notes, not a weekly digest.
 */
export const NewsletterForm = () => {
  const turnstileErrorCallback = useTurnstileErrorCallback();
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  // Mount Turnstile only on the client so its DOM mutations can't cause #418.
  const turnstileReady = useSyncExternalStore(subscribeNoop, getClientTrue, getServerFalse);

  const emailId = useId();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<NewsletterFormData>({
    resolver: newsletterResolver,
  });

  const onSubmit = async (data: NewsletterFormData, event?: React.BaseSyntheticEvent) => {
    setStatus(null);

    const formData = event ? new FormData(event.target as HTMLFormElement) : new FormData();
    formData.set("email", data.email);

    const result = await subscribeToNewsletter(formData);

    if (result.error) {
      // Turnstile tokens are single use, so hand back a fresh challenge for
      // the retry.
      resetTurnstile();
      setStatus({ message: result.error, type: "error" });
      return;
    }

    setStatus({
      message: "Almost there. Check your inbox for the confirmation link.",
      type: "success",
    });
    reset();
  };

  return (
    <div>
      <form className="max-w-lg" onSubmit={handleSubmit(onSubmit)}>
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />

        <Field data-invalid={!!errors.email}>
          <FieldLabel className="sr-only" htmlFor={emailId}>
            Email address
          </FieldLabel>
          {/*
           * One pill, button nested inside the field rather than butted against
           * it: a shared border between the two reads as a seam at this radius.
           * The ring lives on the wrapper so focusing the input lights the whole
           * control, which is why the input drops its own border and ring.
           */}
          <div className="flex items-center gap-2 rounded-full bg-surface p-1.5 ring-1 ring-border transition-shadow duration-200 ease-out focus-within:ring-[3px] focus-within:ring-ring/50 group-data-[invalid=true]/field:ring-destructive/50">
            <Input
              aria-describedby={errors.email ? `${emailId}-error` : undefined}
              aria-invalid={!!errors.email}
              autoComplete="email"
              // `max-sm:px-3` buys back the 8px that keeps the placeholder
              // from clipping inside the pill on a 320px screen.
              className="h-10 min-w-0 flex-1 rounded-full border-0 bg-transparent max-sm:px-3 aria-invalid:ring-0 focus-visible:border-0 focus-visible:ring-0"
              disabled={isSubmitting}
              id={emailId}
              placeholder="you@example.com"
              type="email"
              {...register("email")}
            />
            <Button
              className="h-10 shrink-0 cursor-pointer rounded-full px-5 max-sm:px-4"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Sending…" : "Notify me"}
            </Button>
          </div>
          <FieldError className="pl-4" id={`${emailId}-error`}>
            {errors.email?.message}
          </FieldError>
        </Field>

        {turnstileReady ? (
          <div
            className="cf-turnstile mt-4"
            data-action="newsletter"
            data-error-callback={turnstileErrorCallback}
            data-sitekey={TURNSTILE_SITE_KEY}
          />
        ) : null}

        <output aria-atomic="true" aria-live="polite" className="block">
          {status && (
            <div
              className={`mt-4 rounded-2xl p-4 font-medium text-sm ${
                status.type === "success"
                  ? "border border-green-200 bg-green-100 text-green-800 dark:border-green-900/60 dark:bg-green-950/50 dark:text-green-200"
                  : "border border-red-200 bg-red-100 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
              }`}
            >
              {status.message}
            </div>
          )}
        </output>
      </form>

      <p className="mt-3 pl-4 text-muted-foreground text-sm">
        One email, when it ships. Nothing else.
      </p>
    </div>
  );
};
