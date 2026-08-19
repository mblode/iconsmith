/**
 * One source of truth for the zone.
 *
 * Imported by `next.config.ts`, so every import inside `lib/` must stay
 * relative rather than using the `@/` alias: Next compiles the config without
 * tsconfig path resolution, and an aliased import there resolves against
 * `lib/` and goes looking for `lib/lib/...`.
 */

/**
 * This app is served at blode.co/iconsmith, proxied by the blode.co host app's
 * multi-zone rewrite. `next.config.ts` reads `BASE_PATH` so the prefix lives in
 * exactly one place.
 */
export const BASE_PATH = "/iconsmith";

export const SITE_URL = `https://blode.co${BASE_PATH}`;

/**
 * `basePath` covers `next/link`, route handlers, and `next/image`. It does NOT
 * cover a raw `<a href>`, a raw `<img src>`, manifest icon paths, or a `Link`
 * response header value, so those go through this helper.
 */
export const asset = (path: string) => `${BASE_PATH}${path}`;

export const SITE_NAME = "Iconsmith";
export const SITE_TAGLINE =
  "Icon generation that cannot drift, because the model never emits a coordinate";

export const REPO_URL = "https://github.com/mblode/iconsmith";

export const siteConfig = {
  author: { name: "Matthew Blode", url: "https://blode.co" },
  description: SITE_TAGLINE,
  links: {
    author: "https://blode.co",
    github: REPO_URL,
    license: `${REPO_URL}/blob/main/packages/iconsmith/LICENSE.md`,
    npm: "https://www.npmjs.com/package/iconsmith",
  },
  name: SITE_NAME,
  url: SITE_URL,
  /** Pre-release. Tracks packages/iconsmith, which is not on npm yet. */
  version: "0.0.1",
};
