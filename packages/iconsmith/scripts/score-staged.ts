/**
 * Score staged SVGs without spawning an agent.
 *
 * Used when a demo run wrote drawings and died before `demo.json`. This is
 * cosine and the panel only — `partsFound` lived in the process and is gone.
 * Do not feed the result to `research.ts` as a decision set.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { inspect, measureIcon } from "../src/eval/blindspot.js";
import { cosine, inkVector } from "../src/tools/render.js";

const args = process.argv.slice(2);
const [dir] = args;
if (!dir) {
  process.stderr.write(
    "usage: npx tsx scripts/score-staged.ts <concept-dir>\n"
  );
  process.exit(2);
}

const housePath = readdirSync(dir).find((n) => n.endsWith(".house.svg"));
const house = housePath
  ? readFileSync(path.join(dir, housePath), "utf-8")
  : null;
const houseInk = house ? await inkVector(house) : null;

const files = readdirSync(dir)
  .toSorted()
  .filter((n) => n.endsWith(".svg") && !n.endsWith(".house.svg"));
const rows = await Promise.all(
  files.map(async (name) => {
    const svg = readFileSync(path.join(dir, name), "utf-8");
    const measurement = await measureIcon(svg);
    const verdict = inspect(name.replace(/\.svg$/u, ""), measurement);
    const ink = houseInk ? await inkVector(svg) : null;
    return {
      cosine: ink && houseInk ? cosine(ink, houseInk) : null,
      file: name,
      structural: verdict.failed,
    };
  })
);
process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
