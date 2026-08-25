import { applyEvePublicRoutePrefix } from "../lib/eve-vercel-routes.ts";
import { BASE_PATH } from "../lib/site-url.ts";

/**
 * `next build` can rewrite `.vercel/output/config.json` after `next.config.ts`
 * has already run, so the prefix has to land again on the file Vercel actually
 * ships. A missing file is only a fault on Vercel: a local `next build` has
 * nothing to prefix because withEve does not write Build Output there.
 */
const result = await applyEvePublicRoutePrefix({
  nextRoot: process.cwd(),
  prefix: BASE_PATH,
});

if (result.status === "missing") {
  if (process.env.VERCEL) {
    throw new Error(
      "withEve did not write .vercel/output/config.json, so Eve cannot be mounted under /iconsmith.",
    );
  }
  process.stdout.write("No Vercel Build Output config; skipped Eve route prefix.\n");
} else {
  process.stdout.write(`${result.status} Eve routes in ${result.path}\n`);
}
