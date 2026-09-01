# @iconsmith/contract

What the Studio client and the Eve agent must agree on. Three files.

```
types.ts          the request and response shapes, as zod schemas
session-owner.ts  who owns a session: the browser mints a token, the agent checks it
svg.ts            what SVG is safe to render
```

## The rule for putting something here

Both sides must need it. Not "both sides could use it" and not "it felt shared".

This package was `@iconsmith/studio` and held nine modules. Six of them
(`campaign`, `fault`, `finish`, `overview`, `store`, `threads`) had **zero**
agent consumers -- they were client code that happened to live in a package,
and their presence let the client import the drawing pipeline. They are back in
`apps/web/lib/studio/`. Three had real consumers on both sides, and those are
what is left.

If you are about to add a fourth file, count the importers on each side first.
The measurement is one `grep -rl` per module and it has been wrong twice.

## Gotchas

- **It must declare `zod` itself.** A bare `zod` resolves to whatever is hoisted,
  and `packages/iconsmith` pins zod 3 while `types.ts` uses the zod 4 API. The
  explicit `^4.4.3` is what keeps this compiling. Do not remove it to
  "deduplicate".
- **It ships TypeScript source, not a build.** No `dist/`. `apps/web` lists it in
  `transpilePackages`, and `exports` maps `./*` to `./src/*.ts`.
- **It depends on nothing but zod.** That is the point: a contract that imports
  the engine is not a contract, it is a re-export. If you find yourself adding
  `iconsmith` as a dependency here, what you are adding belongs on one side.
- **No React, and nothing that reads a file.** The one hook that lived here had
  to import the web app's `site-url`, which is how the boundary was found.
- **Tests use explicit `.ts` extensions; source must not.**
  `node --experimental-strip-types` requires them and `tsc` rejects them, so
  `tsconfig.json` excludes `**/*.test.ts`. Same split as every workspace here.
