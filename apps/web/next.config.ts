import path from "node:path";

import { withEve } from "eve/next";
import type { NextConfig } from "next";

import { applyEvePublicRoutePrefix } from "./lib/eve-vercel-routes";
import { BASE_PATH, REPO_URL } from "./lib/site-url";

// Vercel Root Directory is apps/web, but the lockfile and workspace live at
// the repo root. Tracing from this file keeps Next from treating the zone as
// a standalone app and missing files outside the Root Directory.
const repoRoot = path.join(import.meta.dirname, "../..");

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
  "frame-ancestors 'none'",
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
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/**
 * RFC 8615 defines `/.well-known/` as origin-rooted, and this zone does not own
 * blode.co's origin: that belongs to the host app. So these routes live under
 * `/iconsmith/.well-known/*`, which is not a well-known URI and which no agent
 * will ever guess.
 *
 * This header is the bridge. `rel`-based discovery replaces path-based
 * discovery, and it is the only reason the three routes above are reachable.
 *
 * The prefix is applied by hand: Next prefixes header *sources* with basePath
 * but never touches header *values*. That is the third convention in this
 * codebase, after `proxy.ts`, where `nextUrl.pathname` arrives already
 * stripped.
 */
const linkHeader = [
  `<${BASE_PATH}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
  `<${BASE_PATH}/.well-known/agent-skills/index.json>; rel="https://agentskills.io/rel/index"; type="application/json"`,
  `<${REPO_URL}>; rel="service-doc"`,
  `<${REPO_URL}/releases>; rel="service-desc"`,
].join(", ");

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
      {
        // The catch-all sets `same-origin`, which would stop X and Slack
        // fetching the share card. Later rules win per header key, so this
        // must stay below it.
        headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
        source: "/opengraph-image",
      },
      { headers: [{ key: "Link", value: linkHeader }], source: "/" },
    ]);
  },
  outputFileTracingRoot: repoRoot,
  reactCompiler: true,
  // The CLI package is Node-only (sharp, gateway). Route handlers import it;
  // the browser bundle must never see it.
  serverExternalPackages: ["ai", "@ai-sdk/gateway", "iconsmith", "sharp"],
  // `@iconsmith/contract` ships TypeScript source rather than a build, so Next
  // compiles it here. It holds only what this app and the agent must agree on:
  // the request and response shapes, session ownership, and the SVG sanitiser.
  transpilePackages: ["@iconsmith/contract"],
};

/**
 * The agent is a sibling workspace, not a folder in this app.
 *
 * `withEve` mounts whatever `eveRoot` points at, so the orchestrator does not
 * have to live inside the Next client that happens to build it. `apps/agent`
 * owns `agent.ts`, `tools/` and `channels/`; this app owns the routes and the
 * React. Resolved from `import.meta.dirname` rather than `process.cwd()`,
 * which is the repo root under turbo and this directory under Vercel.
 */
const withEveConfig = withEve(nextConfig, {
  eveRoot: path.resolve(import.meta.dirname, "../agent"),
});

/**
 * `withEve()` mounts `/eve/v1/*` on Vercel and does not honour `basePath`.
 * The client talks to `/iconsmith/eve/v1/*` (see `useEveAgent({ host })`), so
 * those unprefixed service routes never match and Studio gets a Next 404.
 * Prefix immediately after withEve writes the Build Output config; the build
 * script prefixes again in case `next build` rewrites the file afterwards.
 */
export default async function eveNextConfig(phase: string, context: { defaultConfig: NextConfig }) {
  const resolved = await withEveConfig(phase, context);
  await applyEvePublicRoutePrefix({
    nextRoot: process.cwd(),
    prefix: BASE_PATH,
  });
  return resolved;
}
