import { createHash } from "node:crypto";

import { REPO_URL, SITE_NAME, SITE_URL } from "./site-url";

/**
 * Skills served over HTTP for an agent to fetch, per the Agent Skills
 * Discovery RFC.
 *
 * They are string constants rather than files so every URL and status claim
 * interpolates from `site-url.ts` and cannot drift from what the site says
 * elsewhere. The index publishes a `sha256` of the exact same constant it
 * links to, so index and body are structurally incapable of disagreeing.
 *
 * This module imports `node:crypto`, so it may only ever be imported by
 * `force-static` route handlers. Keep it out of anything a client component or
 * `proxy.ts` can reach.
 */
export const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf-8").digest("hex");

/**
 * Deliberately not a `download-iconsmith` skill telling an agent to
 * `npm i iconsmith`. The name is unpublished, so an agent would run it and get
 * a 404. The pre-release status is stated in the first line of each skill
 * instead.
 */
export const dslSkill = [
  `# ${SITE_NAME} DSL`,
  "",
  `${SITE_NAME} is pre-release and not on npm yet. Source: ${REPO_URL}`,
  "",
  "## What it is",
  "",
  "A constrained language for drawing an icon that matches an existing set.",
  "The program never names a coordinate the model chose: every node quantises",
  "to a 0.25 grid, every corner radius comes from a measured tier, and every",
  "part lands on a named quarter turn. Off-spec geometry is unrepresentable",
  "rather than discouraged.",
  "",
  "## Operations",
  "",
  "```",
  "icon <name>                  name the icon",
  "keyline <circle|square|wide|tall|landscape|portrait>",
  "part <name> [fill] [turn cw|half|ccw] [flip]",
  "rect <x>,<y> <w>x<h> [r<n>]  n comes from the radius tiers: 0.5, 1, 2, 3",
  "circle <x>,<y> <r>",
  "line <x>,<y> <x>,<y> ...     [off-axis] to allow a segment off 0/45/90",
  "dot <x>,<y> <terminal|more|floating|node>",
  "center                       centre the content in the keyline",
  "fit                          scale the content to the keyline",
  "cohort <name>                align against a family of related icons",
  "```",
  "",
  "`fill`, `center` and `fit` exist so you never do spatial arithmetic. Keyline",
  "scaling and centring are pure functions of the content, so the library does",
  "them exactly.",
  "",
  "There are two escapes and both are asked for by name: `raw` takes path data",
  "verbatim, and `off-axis` allows one segment more than 6 degrees from an",
  "axis. Both land in the document and are visible in review.",
  "",
  "## Example",
  "",
  "```",
  "icon square-check",
  "keyline square",
  "rect 4,4 16x16 r3",
  "line 8,12 11,15 16,10",
  "fit",
  "```",
  "",
  `The named parts vocabulary is listed at ${SITE_URL}`,
  "",
].join("\n");

export const drawSkill = [
  `# Draw an icon with ${SITE_NAME}`,
  "",
  `${SITE_NAME} is pre-release and not on npm yet. Clone ${REPO_URL}, run`,
  "`npm install && npm run build`, then use `packages/iconsmith/dist/cli.js`.",
  "",
  "## Steps",
  "",
  "1. Write a program in the DSL. Fetch the `iconsmith-dsl` skill first if you",
  "   have not read it.",
  "2. Pipe it to the CLI:",
  "",
  "```bash",
  "printf 'icon square-check\\nkeyline square\\nrect 4,4 16x16 r3\\nline 8,12 11,15 16,10\\nfit\\n' \\",
  "  | node packages/iconsmith/dist/cli.js draw -",
  "```",
  "",
  "3. Check the output. You should get an SVG with a 24x24 viewBox and two",
  '   paths, both `stroke-width="2"` and `currentColor`.',
  "",
  "## Verifying you got it right",
  "",
  "A refusal is not a failure. Feeding a segment that runs off 0/45/90 without",
  "asking for it prints, on stderr:",
  "",
  "```",
  "line segment 2 (11,15.75 -> 14.5,10.5) runs at 123.69 degrees, 11.31 off",
  "the nearest axis (135). Off-axis edges are legitimate ... but they are asked",
  "for, not arrived at: pass `offAxis: true` (`off-axis` in the DSL) if that is",
  "the shape, or move an endpoint onto the axis.",
  "```",
  "",
  "That is the tool working. Either add `off-axis` because the shape genuinely",
  "wants it, or move an endpoint onto the grid. Do not work around it by",
  "reaching for `raw`.",
  "",
  "If instead you get an empty `<svg>` with no paths, the program produced no",
  "geometry: check that every op parsed, and that `fit` came last.",
  "",
  `4. Lint what you drew: \`node packages/iconsmith/dist/cli.js lint <file.svg>\`.`,
  "   Pass `--output json` for machine-readable results.",
  "",
].join("\n");

export const skills = [
  {
    body: dslSkill,
    description: `The ${SITE_NAME} icon DSL: operations, the two named escapes, and an example.`,
    name: "iconsmith-dsl",
  },
  {
    body: drawSkill,
    description: `Draw an icon with ${SITE_NAME} and verify the result, including what a refusal means.`,
    name: "draw-an-icon",
  },
] as const;
