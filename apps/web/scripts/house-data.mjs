/**
 * Regenerate `lib/studio/house-icons.json`, the licensed house drawings Studio
 * reads as reference.
 *
 * arsenal.ts used to readdir `node_modules/blode-icons-react/dist` from
 * `process.cwd()`. That works in `next dev` and dies on the Eve Vercel
 * service, whose cwd is the function root and which never sees that package
 * directory. The same contract as `vocabulary.json`: a committed projection
 * inside `apps/web`, not a path into node_modules.
 *
 *   node scripts/house-data.mjs
 *
 * Re-run after bumping `blode-icons-react`. Native Node cannot import the
 * package's extensionless ESM, so this parses the generated component source
 * the same way arsenal.ts used to at request time.
 */
/* oxlint-disable prefer-named-capture-group -- positional groups match the
   parser arsenal.ts used to run at request time; named groups would be a
   second, untested dialect of the same source. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.dirname(fileURLToPath(import.meta.resolve("blode-icons-react")));
const SKIP = new Set(["all-icons", "create-lucide-icon", "dynamic", "dynamicIconImports", "index"]);

const elementPattern =
  /React\.createElement\("(path|circle|ellipse|rect|line|polyline|polygon)", \{ ([^}]*) \}\)/gu;
const attributePattern = /([A-Za-z][A-Za-z0-9]*): (?:("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?))/gu;

const xmlName = (name) => name.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

const xmlAttributes = (source) => {
  attributePattern.lastIndex = 0;
  return [...source.matchAll(attributePattern)]
    .map((match) => {
      const [, name, quoted, number] = match;
      const value = quoted ? JSON.parse(quoted) : number;
      if (!(name && value !== undefined)) {
        return null;
      }
      return `${xmlName(name)}="${String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`;
    })
    .filter((attribute) => attribute !== null)
    .join(" ");
};

const svgFromModule = (source) => {
  elementPattern.lastIndex = 0;
  const elements = [...source.matchAll(elementPattern)].map((match) => {
    const [, tag, rawAttributes] = match;
    const attributes = xmlAttributes(rawAttributes ?? "");
    return tag ? `<${tag}${attributes ? ` ${attributes}` : ""}/>` : "";
  });
  if (elements.length === 0) {
    return null;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" color="#000">${elements.join("")}</svg>`;
};

const icons = {};
for (const file of readdirSync(dist)) {
  if (!file.endsWith(".js")) {
    continue;
  }
  const slug = file.slice(0, -3);
  if (SKIP.has(slug)) {
    continue;
  }
  const svg = svgFromModule(readFileSync(path.join(dist, file), "utf-8"));
  if (svg) {
    icons[slug] = svg;
  }
}

const slugs = Object.keys(icons).toSorted();
const out = path.resolve(import.meta.dirname, "../lib/studio/house-icons.json");
const sorted = Object.fromEntries(slugs.map((slug) => [slug, icons[slug]]));
writeFileSync(out, `${JSON.stringify(sorted)}\n`);
process.stdout.write(`wrote ${slugs.length} icons from ${dist} to ${out}\n`);
