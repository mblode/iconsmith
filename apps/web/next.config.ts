import type { NextConfig } from "next";

import { BASE_PATH } from "./lib/site-url";

const isDev = process.env.NODE_ENV === "development";

/**
 * PostHog is reverse-proxied through r.blode.co, and posthog-js lazy-loads its
 * extension bundles from `api_host`, so the origin belongs in `script-src` as
 * well as `connect-src`.
 *
 * The fallback is the deployed proxy rather than "": this file is evaluated at
 * build time, and an env var that is only bound on production would otherwise
 * ship previews a CSP that silently blocks analytics.
 */
const posthogOrigin = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://r.blode.co";

/**
 * Cloudflare Turnstile guards the newsletter form. It needs three directives,
 * not one: the challenge script, the XHR it makes to fetch a challenge, and
 * `frame-src` because the widget itself is an iframe. Most zones have no
 * `frame-src` at all and fall back to `default-src 'self'`, which would render
 * the widget as an empty box with nothing in the console to explain it.
 *
 * The siteverify call is server side and needs no directive.
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' is not optional: Next inlines the RSC flight payload as a
  // <script>. 'unsafe-eval' is dev-only, for the Turbopack HMR runtime.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${posthogOrigin} ${TURNSTILE_ORIGIN}`,
  `connect-src 'self' ${posthogOrigin} ${TURNSTILE_ORIGIN}`,
  `frame-src 'self' ${TURNSTILE_ORIGIN}`,
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  // The newsletter posts to a server action on this origin.
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * blode.co deliberately skips zone paths in its own `headers()`, because two
 * Content-Security-Policy headers on one response are intersected by the
 * browser rather than overridden. So this zone owns its response headers.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  assetPrefix: BASE_PATH,
  basePath: BASE_PATH,
  experimental: {
    // Runs the React Compiler inside Turbopack rather than Babel.
    turbopackRustReactCompiler: true,
  },
  headers() {
    // Every matching rule applies in array order and a later one wins per
    // header key, so a catch-all must come first or it overwrites the
    // per-path rules after it.
    //
    // `/:path*` rather than `/(.*)`: `headers` sources are basePath-prefixed,
    // and `/iconsmith/(.*)` does not match the bare `/iconsmith` the zone
    // rewrite actually requests. The `*` modifier makes the segment optional,
    // so `/iconsmith/:path*` covers the zone root as well as everything under
    // it. Measured on a sibling zone: with `/(.*)` the root served no headers
    // at all while every inner route served the full set.
    return Promise.resolve([
      {
        headers: securityHeaders,
        source: "/:path*",
      },
    ]);
  },
  reactCompiler: true,
};

export default nextConfig;
