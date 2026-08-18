// Public client-side token, safe to ship. Hardcoded rather than an env var so
// every zone app reports into one project without 30 separate Vercel settings.
export const posthogKey = "phc_yYatHXysbRxjTyfmyCKSUyMSQpgepJPuxegz2HtpfX35";

// Set per Vercel project to our own reverse proxy, so ad blockers and tracker
// lists that block *.posthog.com do not drop analytics. Unset falls back to
// posthog-js's own default ingestion host.
//
// It is also read at build time by next.config.ts to build the CSP, so it has
// to be bound in Preview as well as Production or previews ship a policy that
// silently blocks analytics.
export const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
