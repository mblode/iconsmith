/**
 * Every icon corpus on this machine, and what each one is allowed to be used
 * for.
 *
 * The registry is the single place where a tree of SVGs becomes a *set* with a
 * licence and a usage. Two things follow from putting it here rather than
 * spreading it through the build:
 *
 * - **Usage is declared, never inferred.** `conditioning` is the house set and
 *   Central; the generator may learn from them. `analysis-only` is everything
 *   under someone else's licence — it may be measured, compared and reported
 *   on, and it may not reach the drawer. No amount of looking at the geometry
 *   tells you which is which, so the answer is written down next to the root.
 *
 * - **Layout is an adapter, not a convention.** The five trees disagree about
 *   where the variant lives. Central puts it in the directory name; blode-icons
 *   puts style in a `-filled` suffix; Phosphor puts weight in *both* a
 *   directory and a filename suffix (`assets/bold/acorn-bold.svg`) except for
 *   `regular`, which has neither. One adapter per shape, each returning the
 *   same `(slug, variant, path)` triple, and the rest of the pipeline never
 *   learns that these differences exist.
 *
 * Roots are absolute paths to sibling checkouts, overridable per source. A
 * source whose root is missing is skipped and named in the manifest rather than
 * failing the build: these are not this repo's files and they are not all
 * present on every machine.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { Usage } from "./record.js";

/** One file, resolved to the identity it draws and the finish it draws it in. */
export interface SourceFile {
  /** Absolute path, for reading. */
  abs: string;
  /** Path relative to the source root, for recording. */
  rel: string;
  /** The drawn identity within the set. */
  slug: string;
  variant: string;
}

export interface Source {
  id: string;
  /** SPDX identifier where one exists, else the licence's own name. Copied
   *  from the LICENSE file shipped beside the icons, not from memory. */
  licence: string;
  /** Path to that LICENSE file, relative to `root`. Null when the set carries
   *  no file of its own — the house set states MIT in its package.json. */
  licenceFile: string | null;
  /** Which rendering stands for the identity: the one that gets fingerprinted
   *  and, under `--vectors`, an ink vector. */
  canonicalVariant: string;
  list: (root: string) => Promise<SourceFile[]>;
  homepage: string;
  root: string;
  usage: Usage;
  /** A `package.json` to read `version` out of, relative to `root`. Null for a
   *  set that ships no manifest — Central is a directory of files, and the
   *  house set's version is the monorepo's, not the icons'. */
  versionFile: string | null;
}

const SVG = ".svg";

const svgsIn = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith(SVG)).toSorted();
};

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

/** A flat directory of SVGs, all one variant. */
const flat =
  (sub: string, variant: string) =>
  async (root: string): Promise<SourceFile[]> => {
    const dir = path.join(root, sub);
    const files = await svgsIn(dir);
    return files.map((f) => ({
      abs: path.join(dir, f),
      rel: path.join(sub, f),
      slug: f.slice(0, -SVG.length),
      variant,
    }));
  };

/**
 * One directory per variant, flat inside. Central's layout, and the shape most
 * of the third-party packs use as well.
 *
 * `suffixed` strips a repeat of the directory name off the filename: Phosphor
 * writes `assets/bold/acorn-bold.svg` but `assets/regular/acorn.svg`, so the
 * suffix is present for five of its six weights and absent for the sixth. Left
 * in place, `acorn` would become six separate identities named after weights.
 */
const variantDirs =
  (sub: string, { suffixed = false } = {}) =>
  async (root: string): Promise<SourceFile[]> => {
    const base = sub ? path.join(root, sub) : root;
    const entries = await readdir(base, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted();
    // One listing per variant directory — 30 of them for Central, a count set
    // by the shape of the set rather than its size — so these run together.
    const listings = await Promise.all(
      dirs.map(async (variant) => ({
        files: await svgsIn(path.join(base, variant)),
        variant,
      }))
    );
    return listings.flatMap(({ files, variant }) => {
      const suffix = `-${variant}`;
      return files.map((f) => {
        const stem = f.slice(0, -SVG.length);
        return {
          abs: path.join(base, variant, f),
          rel: path.join(sub, variant, f),
          slug:
            suffixed && stem.endsWith(suffix)
              ? stem.slice(0, -suffix.length)
              : stem,
          variant,
        };
      });
    });
  };

const FILLED = "-filled";

/**
 * blode-icons: one flat directory, style carried in a `-filled` suffix.
 *
 * Stripping the suffix is what makes `folder-open` one record with two
 * renderings rather than two records that never mention each other — the same
 * decision Central expresses by putting `filled` in a directory name.
 */
const blodeIcons = async (root: string): Promise<SourceFile[]> => {
  const sub = "icons-svg";
  const dir = path.join(root, sub);
  const files = await svgsIn(dir);
  return files.map((f) => {
    const stem = f.slice(0, -SVG.length);
    const filled = stem.endsWith(FILLED);
    return {
      abs: path.join(dir, f),
      rel: path.join(sub, f),
      slug: filled ? stem.slice(0, -FILLED.length) : stem,
      variant: filled ? "filled" : "outlined",
    };
  });
};

/** Sibling checkouts this registry expects to find beside icon-forge. */
const HOME = process.env.HOME ?? "";
const BLODE_REPO = path.join(HOME, "Code/mblode/blode-icons");
const BLODE = path.join(BLODE_REPO, "packages/blode-icons-react");
const PACKS = path.join(HOME, "Code/mblode/react-components/src/icons");

/**
 * The registry.
 *
 * Central and blode-icons are `conditioning`; the other eight are
 * `analysis-only`. That split is the whole reason this file has a `usage`
 * column: the seven packs plus lucide-static are 25,768 files of somebody
 * else's drawing, useful for asking how other sets solve a concept and not
 * usable as training material for ours.
 */
export const SOURCES: Source[] = [
  {
    canonicalVariant: "round-outlined-radius-3-stroke-2",
    homepage: "https://centralicons.com",
    id: "central",
    // Proprietary, and `usage: "conditioning"` anyway — the one source where
    // those two are not in tension by mistake. `.central-provenance.json`
    // records `licenseKeyPresent: false` because the scraper never had a key to
    // record; the owner holds a Central licence out of band and confirmed it on
    // 2026-08-19. Written down because the record otherwise reads as an
    // MIT-shipping generator conditioning on a proprietary corpus, which is the
    // first thing a reviewer would stop on, and because the licence gate admits
    // this set by name while refusing MIT-licensed Tabler.
    licence: "proprietary",
    licenceFile: null,
    list: variantDirs(""),
    root: "corpus",
    usage: "conditioning",
    versionFile: null,
  },
  {
    canonicalVariant: "outlined",
    homepage: "https://github.com/mblode/blode-icons",
    // `blode-icons`, not `blode`: the id is the set's real name, and
    // `pipeline/licence.ts` allowlists house sets by that name. A record whose
    // `provenance.set` reads `blode` would be refused as a style reference by
    // the one gate that exists to let it through.
    id: "blode-icons",
    licence: "MIT",
    licenceFile: null,
    list: blodeIcons,
    root: BLODE,
    usage: "conditioning",
    versionFile: "package.json",
  },
  {
    canonicalVariant: "regular",
    homepage: "https://phosphoricons.com",
    id: "phosphor",
    licence: "MIT",
    licenceFile: "PHOSPHOR-LICENSE",
    list: variantDirs("assets", { suffixed: true }),
    root: PACKS,
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "outline",
    homepage: "https://heroicons.com",
    id: "heroicons",
    licence: "MIT",
    licenceFile: "LICENSE",
    list: variantDirs(""),
    root: path.join(PACKS, "packs/heroicons"),
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "regular",
    homepage: "https://iconoir.com",
    id: "iconoir",
    licence: "MIT",
    licenceFile: "LICENSE",
    list: variantDirs(""),
    root: path.join(PACKS, "packs/iconoir"),
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "regular",
    homepage: "https://lucide.dev",
    id: "lucide",
    licence: "ISC",
    licenceFile: "LICENSE",
    list: variantDirs(""),
    root: path.join(PACKS, "packs/lucide"),
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "regular",
    homepage: "https://www.radix-ui.com/icons",
    id: "radix",
    licence: "MIT",
    licenceFile: "LICENSE",
    list: variantDirs(""),
    root: path.join(PACKS, "packs/radix"),
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "line",
    homepage: "https://remixicon.com",
    id: "remix",
    licence: "Remix Icon License v1.0",
    licenceFile: "LICENSE",
    list: variantDirs(""),
    root: path.join(PACKS, "packs/remix"),
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "outline",
    homepage: "https://tabler.io/icons",
    id: "tabler",
    licence: "MIT",
    licenceFile: "LICENSE",
    list: variantDirs(""),
    root: path.join(PACKS, "packs/tabler"),
    usage: "analysis-only",
    versionFile: null,
  },
  {
    canonicalVariant: "regular",
    homepage: "lucide-static (npm)",
    id: "lucide-static",
    licence: "ISC",
    licenceFile: "LICENSE",
    // A second, independently-versioned copy of Lucide, vendored into
    // blode-icons rather than react-components. Kept as its own source because
    // the two are not the same release, and merging them would silently pick
    // one drawing of every icon.
    list: flat("icons", "regular"),
    // The workspace hoists it to the repo root, not into the package.
    root: path.join(BLODE_REPO, "node_modules/lucide-static"),
    usage: "analysis-only",
    versionFile: "package.json",
  },
];

/** Sources whose root is present, in registry order. `root` is resolved against
 *  `cwd` so Central's cwd-relative `corpus` default keeps working. */
export const availableSources = async (
  sources: readonly Source[] = SOURCES
): Promise<{ missing: Source[]; present: Source[] }> => {
  const found = await Promise.all(
    sources.map(async (s) => await exists(path.resolve(s.root)))
  );
  return {
    missing: sources.filter((_, i) => !found[i]),
    present: sources.filter((_, i) => found[i]),
  };
};
