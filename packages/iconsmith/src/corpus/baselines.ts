/**
 * The seven third-party packs, for the two things they are allowed to be used
 * for: concept-coverage analysis, and eval baselines.
 *
 * 23,731 icons across seven packs — phosphor 9,072, tabler 6,146, remix 3,228,
 * lucide 1,994, iconoir 1,671, heroicons 1,288, radix 332 — all laid out the
 * same way, `<pack>/<style>/<icon>.svg`, so one walk reads all of them.
 *
 * **These icons may not condition a generation.** Not as a style reference, not
 * as a few-shot example, not as a neighbour a draft is compared against. Five
 * of the seven are MIT and that is not the point: a generated icon ships in
 * blode-icons as one MIT work with no per-icon notice, and cannot carry a
 * second set's attribution. See `pipeline/licence.ts` for the whole argument.
 *
 * That rule is enforced structurally rather than by this comment:
 *
 * 1. `BaselineIcon` has no `name` and no `svg` field, so it is not
 *    structurally a `ReferenceIcon` and cannot be passed to `asReference`.
 * 2. It carries no `Provenance`, so there is no origin for `asReference` to
 *    accept even if it could be.
 * 3. `scripts/check-boundaries.ts` fails the build if any file under
 *    `pipeline/` imports this module.
 *
 * Rule 3 is why eval baselines are loaded in `commands/` and handed to
 * `pipeline/eval.ts` as data. Injection is the seam; there is no import edge.
 *
 * `lucide-static` is the same drawings as the `lucide` pack here (1,994 icons,
 * ISC) and is permitted on the same terms; it is not vendored because a
 * directory of SVGs needs no dependency to read.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** One pack, with the licence file that governs it. The path is kept on every
 *  icon rather than looked up later: a baseline that has travelled into a
 *  report should still say, in the report, what governs it. */
export interface BaselinePack {
  /** Directory holding the style subdirectories, relative to the root. */
  dir: string;
  /** SPDX id where one applies. Remix ships its own terms, so this is the
   *  document's own title — naming it "Apache-2.0" would be a paraphrase. */
  licence: string;
  /** The LICENSE file, relative to the root. */
  licenceFile: string;
  name: string;
}

/**
 * The packs, as they sit in the react-components repo. Phosphor is the odd one:
 * it predates the `packs/` directory, so its drawings live in `assets/` and its
 * licence is `PHOSPHOR-LICENSE` a level up.
 */
export const BASELINE_PACKS: readonly BaselinePack[] = [
  {
    dir: "packs/heroicons",
    licence: "MIT",
    licenceFile: "packs/heroicons/LICENSE",
    name: "heroicons",
  },
  {
    dir: "packs/iconoir",
    licence: "MIT",
    licenceFile: "packs/iconoir/LICENSE",
    name: "iconoir",
  },
  {
    dir: "packs/lucide",
    licence: "ISC",
    licenceFile: "packs/lucide/LICENSE",
    name: "lucide",
  },
  {
    dir: "packs/radix",
    licence: "MIT",
    licenceFile: "packs/radix/LICENSE",
    name: "radix",
  },
  {
    dir: "packs/remix",
    licence: "Remix Icon License v1.0",
    licenceFile: "packs/remix/LICENSE",
    name: "remix",
  },
  {
    dir: "packs/tabler",
    licence: "MIT",
    licenceFile: "packs/tabler/LICENSE",
    name: "tabler",
  },
  {
    dir: "assets",
    licence: "MIT",
    licenceFile: "PHOSPHOR-LICENSE",
    name: "phosphor",
  },
];

/** One drawing in the index. Names its pack and style, and nothing else: no
 *  source text until asked for, because 23,731 files is more than any caller
 *  wants at once. */
export interface BaselineEntry {
  icon: string;
  pack: string;
  style: string;
}

/**
 * A loaded baseline drawing.
 *
 * The field names are load-bearing. `icon`/`source`, not `name`/`svg`, so this
 * is not structurally a `pipeline/licence.ts` `ReferenceIcon` and a leak is a
 * type error rather than a review catch. Renaming either field to match would
 * silently reopen the hole `licence.test-d.ts` exists to keep shut.
 */
export interface BaselineIcon extends BaselineEntry {
  licence: string;
  /** Absolute path to the LICENSE governing this drawing. */
  licenceFile: string;
  source: string;
}

export interface Baselines {
  /** Every drawing, pack-major then style then icon. Names only. */
  entries: BaselineEntry[];
  load: (entry: BaselineEntry) => Promise<BaselineIcon>;
  packs: readonly BaselinePack[];
  root: string;
}

const SVG = ".svg";

const pack = (name: string): BaselinePack => {
  const found = BASELINE_PACKS.find((p) => p.name === name);
  if (!found) {
    throw new Error(
      `Unknown baseline pack "${name}". Known: ${BASELINE_PACKS.map((p) => p.name).join(", ")}.`
    );
  }
  return found;
};

/**
 * Index the packs by pack × style × icon. Directory listings only — 30-odd of
 * them against a fixed pack count, so they run together — and no icon file is
 * opened until `load` asks for one, the same shape as `loadCorpus`.
 *
 * `root` has no default. The packs live in another repository and the only
 * honest default would be one machine's absolute path; a caller that cannot say
 * where they are has no business reading them.
 */
export const loadBaselines = async (root: string): Promise<Baselines> => {
  const listings = await Promise.all(
    BASELINE_PACKS.map(async (p) => {
      const dir = path.join(root, p.dir);
      const entries = await readdir(dir, { withFileTypes: true });
      const styles = entries.filter((e) => e.isDirectory());
      return await Promise.all(
        styles.map(async (s) => ({
          files: await readdir(path.join(dir, s.name)),
          pack: p.name,
          style: s.name,
        }))
      );
    })
  );

  const entries: BaselineEntry[] = [];
  for (const listing of listings.flat()) {
    for (const file of listing.files) {
      if (file.endsWith(SVG)) {
        entries.push({
          icon: file.slice(0, -SVG.length),
          pack: listing.pack,
          style: listing.style,
        });
      }
    }
  }

  return {
    entries,
    load: async (entry) => {
      const p = pack(entry.pack);
      const file = path.join(root, p.dir, entry.style, `${entry.icon}${SVG}`);
      return {
        ...entry,
        licence: p.licence,
        licenceFile: path.resolve(root, p.licenceFile),
        source: await readFile(file, "utf-8"),
      };
    },
    packs: BASELINE_PACKS,
    root,
  };
};
