import vocabulary from "./vocabulary.json";
import { REPO_URL, SITE_NAME, SITE_TAGLINE, SITE_URL } from "./site-url";

/**
 * The Markdown mirror of the homepage, served by `proxy.ts` to anything sending
 * `Accept: text/markdown`. This is the llms.txt idea done as content
 * negotiation on the canonical URL, so there is no second URL to keep in sync.
 *
 * Keep this module free of `node:` imports. It is reached from `proxy.ts`,
 * which runs on the edge runtime. `lib/agent-skills.ts` is deliberately kept
 * separate for exactly this reason: it uses `node:crypto`.
 */
const names = vocabulary.map((part) => part.name);

const usePrompt = [
  "## Use",
  "",
  "The rest of this document is imperative. If you are an agent acting for",
  `someone who wants to draw an icon with ${SITE_NAME}, follow it directly.`,
  "",
  `1. ${SITE_NAME} is not on npm yet. Clone \`${REPO_URL}\`, then run`,
  "   `npm install && npm run build`. The binary is",
  "   `packages/iconsmith/dist/cli.js`.",
  "",
  "2. Write a program. Never write a coordinate you chose freely: the grid is",
  "   0.25, corner radii come from the tiers 0.5, 1, 2 and 3, and segments run",
  "   at 0, 45 or 90 unless you say `off-axis`.",
  "",
  "```",
  "icon square-check",
  "keyline square",
  "rect 4,4 16x16 r3",
  "line 8,12 11,15 16,10",
  "fit",
  "```",
  "",
  "3. Run it:",
  "",
  "```bash",
  "printf 'icon square-check\\nkeyline square\\nrect 4,4 16x16 r3\\nline 8,12 11,15 16,10\\nfit\\n' \\",
  "  | node packages/iconsmith/dist/cli.js draw -",
  "```",
  "",
  "4. Verify. You should get a 24x24 `<svg>` with two `<path>` elements, both",
  '   `stroke-width="2"` and `stroke="currentColor"`.',
  "",
  "   An empty `<svg>` with no paths means nothing drew: check every op parsed",
  "   and that `fit` came last.",
  "",
  "   A refusal on stderr naming an angle and an axis is the tool working, not",
  "   an error. Either add `off-axis` because the shape genuinely wants it, or",
  "   move an endpoint onto the grid. Do not reach for `raw` to get around it.",
  "",
  "5. Lint it: `node packages/iconsmith/dist/cli.js lint <file.svg>`. Add",
  "   `--output json` on any command for machine-readable output.",
  "",
].join("\n");

const homepageMarkdown = [
  `# ${SITE_NAME}`,
  "",
  SITE_TAGLINE,
  "",
  `- Site: ${SITE_URL}`,
  `- Source: ${REPO_URL}`,
  `- DSL reference: ${SITE_URL}/.well-known/agent-skills/iconsmith-dsl/SKILL.md`,
  `- Skills index: ${SITE_URL}/.well-known/agent-skills/index.json`,
  "- Status: pre-release, not published to npm",
  "",
  "## What it does",
  "",
  `${SITE_NAME} gives a model five primitives: \`rect\`, \`circle\`, \`line\`,`,
  "`dot` and `part`. Every node quantises to a 0.25 grid, every corner radius",
  "comes from a measured tier, and every part lands on a named quarter turn.",
  "Free path data is not something the model can express, so drift is not",
  "something it can write.",
  "",
  "The house spec is measured rather than asserted: derived from 2,085 icons.",
  "97.5% of stroked shapes use stroke 2, and the radius tiers match 78.4% of",
  "6,188 measured corners exactly, against 23.9% for the values it started",
  "from.",
  "",
  "## Parts vocabulary",
  "",
  `${names.length} named marks, clustered from 199 parts across 1,863 icons:`,
  "",
  names.join(", "),
  "",
  "## Evaluation",
  "",
  "Every eval prints four numbers, never one: floor (a random icon scored",
  "against the target), baseline 0.737 (the measured median between two mature",
  "icon sets drawing the same concept), treatment, and ceiling 1.0. A score",
  "above 0.95 is flagged SUSPECT, because at that point the harness is",
  "comparing something to itself.",
  "",
  usePrompt,
].join("\n");

export const markdownByPath: Record<string, string> = {
  "/": homepageMarkdown,
};
