# iconsmith-web

The teaser page at [blode.co/iconsmith](https://blode.co/iconsmith) and the
studio at [blode.co/iconsmith/studio](https://blode.co/iconsmith/studio). The
root still collects launch-list addresses. `/studio` is the chat drawer:
shadcn message UI, attachments, human-in-the-loop questions, and every
version's program.

## Commands

```bash
npm run dev        # port 3210
npm run build
npm run typecheck
npm run check
```

## This is a multi-zone child, not a standalone site

blode.co rewrites `/iconsmith/*` to this app's own deployment, and this app sets a
matching `basePath`. Read `blode-co/apps/web/.claude/knowledge/zone-conventions.md`
before touching the layout, metadata, footer, breadcrumb, or OG image: it is a twelve
rule contract, and `npm run check-zones` in that repo enforces it against the deployed
site.

To see the real thing locally you need both halves. This app alone will not catch a
prefix bug:

```bash
npm run dev                                    # here, port 3210
# then in blode-co/apps/web/.env.local:
ZONE_ORIGIN_ICONSMITH=http://localhost:3210
# and load http://localhost:3000/iconsmith
```

## Gotchas

- **Vercel Root Directory is `apps/web`.** The lockfile lives at the repo root, so
  `installCommand` runs `npm ci` from there when that file is visible, and
  `npm install` only if this folder is copied out alone. `ignoreCommand` must
  not skip `main` (exit 0 on preview only); skipping `main` is what GitHub
  reports as the red Vercel check. A dashboard Ignore Build Step or a Root
  Directory of `.` still wins over this file.
- **Verify metadata against a build, never `next dev`.** Dev rewrites `metadataBase`
  to the dev origin and reports the opposite of production on exactly the questions
  that matter. `npm run build && npm start`, then check that `og:image` contains
  `/iconsmith/opengraph-image` once and never `/iconsmith/iconsmith/`.
- **`headers()` sources are basePath-prefixed.** Use `source: "/:path*"`. `/(.*)`
  compiles to `/iconsmith/(.*)`, which cannot match the bare `/iconsmith` that the
  zone rewrite actually requests, so the root would serve no security headers while
  every inner route served the full set.
- **Eve ignores `basePath`.** `withEve()` mounts `/eve/v1/*` on Vercel. Studio
  calls `/iconsmith/eve/v1/*` (`useEveAgent({ host: BASE_PATH })`).
  `lib/eve-vercel-routes.ts` prefixes the generated Build Output routes; without
  that, the zone 404s and the banner dumps the Next HTML document.
- **The OG image must stay a generated route.** A static `opengraph-image.png` plus a
  zone `metadataBase` produces `/iconsmith/iconsmith/...` and breaks the share card
  silently. Satori also parses neither `oklch` nor CSS variables, so its palette is
  hand-synced sRGB literals, and it renders an SVG `<title>` as visible text rather
  than metadata.
- **`og:site_name` is `Matthew Blode`, never `Iconsmith`** (rule 9), and the layout
  deliberately sets no `openGraph.url` (rule 10): a child that declares it replaces
  the whole object and loses `og:site_name` and `og:image` with it.
- **The list is single opt-in, by request.** `app/actions/subscribe.ts` writes straight
  to the Resend segment; there is no confirmation email and no token. Nothing proves a
  submitter owns the address they typed, so Turnstile and the per-IP hourly limit are
  the only guards on a public write to the audience. `verifyTurnstile` fails closed on
  a missing secret and must stay that way.
- **This app is on zod 4; the CLI workspace is on zod 3.** They share no lockfile
  entry and must not be aligned. `@hookform/resolvers` is deliberately not installed:
  it hoists to the repo root, where a bare `zod` import resolves to version 3 and
  disagrees about the shape of a schema. `newsletterResolver` in
  `lib/validations/newsletter.ts` replaces it.
- **`lib/vocabulary.json` is generated.** Re-run `node scripts/vocabulary-data.mjs`
  after the parts vocabulary changes. It is committed here rather than imported across
  the workspace because Next cannot serve assets from outside the app directory.
- The two code samples on the page are real CLI output. Regenerate them with the
  commands in `components/square-check-icon.tsx` and `app/page.tsx` rather than
  editing them by hand.

## Env

`RESEND_API_KEY`, `RESEND_SEGMENT_ID` (its own segment, not blode.co's),
`TURNSTILE_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.

Turnstile needs no new keypair: the widget is scoped by browser hostname, and this
form is served at `blode.co`. `NEXT_PUBLIC_POSTHOG_HOST` is read at build time by
`next.config.ts` to build the CSP, so it must be bound in Preview too.
