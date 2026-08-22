/**
 * Sparse expert gate, no agent, no credits.
 *
 * Prints the class and cheap-expert drawing for each name. Pack consensus is
 * a fixture of slugs — Lucide / Tabler / Heroicons / Remix *names*, not
 * drawings. `xyzzy` stays unknown.
 *
 *   npx tsx scripts/mixture-lab.ts
 *   npx tsx scripts/mixture-lab.ts home database xyzzy plus
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  evidenceOf,
  gate,
  mixtureArm,
  packIndexFromSlugs,
} from "../src/pipeline/mixture.js";

const OUT = path.join(".staging", "mixture", "lab.json");

const DEMO_PACKS = packIndexFromSlugs([
  { pack: "heroicons", slug: "database" },
  { pack: "lucide", slug: "database" },
  { pack: "remix", slug: "database" },
  { pack: "tabler", slug: "database" },
  { pack: "heroicons", slug: "wifi" },
  { pack: "lucide", slug: "wifi" },
  { pack: "phosphor", slug: "wifi" },
  { pack: "tabler", slug: "wifi" },
]);

const DEFAULT_NAMES = ["plus", "home", "database", "xyzzy"] as const;

export const labNames = (argv: readonly string[]): string[] => {
  const extra = argv.slice(2).filter((a) => !a.startsWith("-"));
  return extra.length > 0 ? extra : [...DEFAULT_NAMES];
};

const main = async (): Promise<void> => {
  const names = labNames(process.argv);
  const arm = mixtureArm({
    experts: {
      agent: () => {
        throw new Error("mixture-lab does not hire the agent");
      },
    },
    inventory: DEMO_PACKS,
  });
  const rows = await Promise.all(
    names.map(async (name) => {
      const decision = gate(
        evidenceOf({ name }, {}, { inventory: DEMO_PACKS })
      );
      const cheap = decision.candidates.filter((id) => id !== "agent");
      if (cheap.length === 0) {
        return {
          candidates: [...decision.candidates],
          class: decision.class,
          name,
          skipped: "gate lists only the agent",
        };
      }
      const drawn = await arm({ name }, {});
      return {
        brief: drawn.brief ?? null,
        candidates: [...decision.candidates],
        class: decision.class,
        clean: drawn.clean,
        name,
        reason: decision.reason,
      };
    })
  );
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
};

const isMain =
  import.meta.url === new URL(process.argv[1] ?? "", "file:").href ||
  process.argv[1]?.endsWith("mixture-lab.ts") === true;

if (isMain) {
  await main();
}
