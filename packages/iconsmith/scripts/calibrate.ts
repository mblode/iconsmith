/**
 * Measure the metric panel's floors, baselines and ceilings, and write them to
 * `bench/calibration.v1.json` with the procedure and the date.
 *
 * **A metric without a measured floor is unreadable.** 0.62 is excellent
 * against a floor of 0.15 and a failure against a floor of 0.61, and no amount
 * of care about the treatment number recovers that. So the calibration is a
 * committed artifact with its own provenance, not four constants in a source
 * file where they would drift from the corpus that justified them without
 * anybody noticing.
 *
 * Two stages, because the middle one needs a runtime this package deliberately
 * does not depend on:
 *
 *     npx tsx scripts/calibrate.ts manifest     # what to embed
 *     ...run scripts/embed.py three times...    # the sidecars
 *     npx tsx scripts/calibrate.ts measure      # bench/calibration.v1.json
 *
 * `manifest` and `measure` are pure reads of the store and the sidecars. Only
 * `measure` writes, and only to `bench/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { IconRecord } from "../src/corpus/record.js";
import {
  calibrateConformance,
  PACK_VARIANTS,
} from "../src/eval/conformance.js";
import type { ConformanceRecord } from "../src/eval/conformance.js";
import { median } from "../src/eval/panel.js";
import {
  answerableSlugs,
  CONCEPT_PROMPT,
  rankAt1,
  semanticRank,
} from "../src/eval/semantic.js";
import type { ConceptBank, SemanticResult } from "../src/eval/semantic.js";
import { separation } from "../src/eval/separation.js";
import { styleAgainstHouse, styleCeiling } from "../src/eval/style.js";
import { loadEmbeddings } from "../src/eval/vectors.js";
import { conceptClosure, loadRecords } from "../src/pipeline/bench.js";

const STORE = ".corpus";
const RECORDS = path.join(STORE, "icons.jsonl");
const MANIFEST = path.join(STORE, "manifest.json");
const OUT = "bench/calibration.v1.json";
const HOUSE = "blode-icons";

/** The set roots, as `corpus build` recorded them. Read rather than configured:
 *  a hardcoded path here would silently embed a different machine's icons. */
const roots = (): Map<string, string> => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as {
    sources: { id: string; root: string }[];
  };
  return new Map(manifest.sources.map((s) => [s.id, s.root]));
};

/** Deterministic PRNG, same shape as the one in `pipeline/eval.ts`: a
 *  calibration that samples differently on every run is not a calibration. */
const rng = (seed: number): (() => number) => {
  let s = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
};

const shuffled = <T>(xs: readonly T[], seed: number): T[] => {
  const out = [...xs];
  const random = rng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

interface ManifestEntry {
  id: string;
  path: string;
}

/** The one rendering of a record that the calibration reads. */
const strokeRendering = (record: IconRecord): string | null => {
  const pack = PACK_VARIANTS[record.provenance.set];
  if (!pack) {
    return null;
  }
  return (
    record.renderings.find((r) => r.variant === pack.variant)?.path ?? null
  );
};

/**
 * How many third-party icons go into the style floor.
 *
 * Matched to the number of same-slug icons available, so the floor and the
 * baseline are estimated over samples of the same size. An unbalanced pair
 * makes the wider one look tighter for a reason that has nothing to do with
 * style.
 */
const buildManifests = (): void => {
  const records = loadRecords(RECORDS);
  const root = roots();
  const houseSlugs = new Set(
    records.filter((r) => r.provenance.set === HOUSE).map((r) => r.slug)
  );

  const entry = (record: IconRecord): ManifestEntry | null => {
    const rel = strokeRendering(record);
    const base = root.get(record.provenance.set);
    if (!(rel && base)) {
      return null;
    }
    return { id: record.id, path: path.join(base, rel) };
  };

  const house = records
    .filter((r) => r.provenance.set === HOUSE)
    .map(entry)
    .filter((e): e is ManifestEntry => e !== null);

  // Stroke packs only, and never the house set or Central — Central is the
  // corpus blode-icons is derived from, so a "third-party" baseline drawn from
  // it would be the house set wearing a different name.
  const outsiders = records.filter(
    (r) =>
      PACK_VARIANTS[r.provenance.set]?.stroke === true &&
      r.provenance.set !== HOUSE &&
      r.provenance.set !== "central"
  );
  const sameConcept = outsiders.filter((r) => houseSlugs.has(r.slug));
  const unrelated = shuffled(
    outsiders.filter((r) => !houseSlugs.has(r.slug)),
    11
  ).slice(0, sameConcept.length);

  const outsiderEntries = [...sameConcept, ...unrelated]
    .map(entry)
    .filter((e): e is ManifestEntry => e !== null);

  mkdirSync(STORE, { recursive: true });
  writeFileSync(
    path.join(STORE, "embed-house.json"),
    `${JSON.stringify(house, null, 2)}\n`
  );
  writeFileSync(
    path.join(STORE, "embed-outsiders.json"),
    `${JSON.stringify(outsiderEntries, null, 2)}\n`
  );
  writeFileSync(
    path.join(STORE, "embed-roles.json"),
    `${JSON.stringify(
      {
        sameConcept: sameConcept.map((r) => r.id),
        unrelated: unrelated.map((r) => r.id),
      },
      null,
      2
    )}\n`
  );
  process.stdout.write(
    `${house.length} house · ${sameConcept.length} same-concept third-party · ` +
      `${unrelated.length} unrelated third-party → ${STORE}/embed-*.json\n`
  );
};

const conceptBank = (): ConceptBank => {
  const file = path.join(
    roots().get(HOUSE) ?? "",
    "icons-data",
    "_concepts.json"
  );
  return (JSON.parse(readFileSync(file, "utf-8")) as { concepts: ConceptBank })
    .concepts;
};

const scores = (xs: readonly { score: number }[]): number[] =>
  xs.map((x) => x.score);

/** rank@1 is a Bernoulli outcome per icon, so the separation gate reads it as
 *  1/0 rather than as a cosine. */
const hits = (xs: readonly SemanticResult[]): number[] =>
  xs.map((r) => (r.rank === 1 ? 1 : 0));

/** How many icons each embedding-backed calibration is measured over. Enough
 *  that a median is stable; small enough that a full DINO pass over the house
 *  set per sample is minutes rather than hours. */
const SAMPLE = 300;

/** Written into the artifact, so the numbers can be re-derived rather than
 *  merely re-read. */
const PROCEDURE = {
  conformance:
    "Per-set pass rates over one stroke rendering per icon from the record store. " +
    "`gate` = no error-severity lint issue; `strict` = no issue of any severity. " +
    "Ceiling = blode-icons' own rate. Floor = third-party stroke packs pooled by " +
    "icon, so a 324-icon pack does not outweigh a 5,093-icon one. Baseline = the " +
    "best single third-party stroke pack. Phosphor, Radix and Remix are excluded: " +
    "they report 0 straight edges across 3,533 icons, so the off-axis rule is " +
    "structurally silent for them and their rate measures a rendering choice. " +
    "lucide-static is excluded as a duplicate of lucide.",
  semantic:
    "SigLIP base-patch16-224. Each icon's image embedding is ranked against the " +
    "whole concept bank embedded through `a simple black line icon of {}`. " +
    "rank@1 = share of icons whose top-scoring concept maps to their own slug; " +
    "margin = cosine to the best correct concept minus cosine to the best wrong " +
    "one. Ceiling = the real shipped icon's own rank@1 — not 100%, because the " +
    "bank holds near-synonyms. Floor = a different house icon asked the same " +
    "question.",
  separation:
    "Every metric with a floor sample and a baseline sample is scored by the AUC " +
    "— P(a random baseline observation beats a random floor one), 0.5 being " +
    "chance. Below 0.65 the column is discarded rather than discounted, on the " +
    "same argument the judge gate makes: an instrument that cannot answer the " +
    "easy question is noise, and a reach computed against a scale narrower than " +
    "its own sampling error is noise with a decimal point. Conformance is exempt: " +
    "it is a gate, never a headline, so it is never read as a reach.",
  style:
    "DINO ViT-B/8 CLS, 224px on white, currentColor pinned to #000. Score = median " +
    "cosine to the k=10 nearest house icons with the icon's whole concept closure " +
    "(`pipeline/bench.ts`) excluded from the neighbourhood — without that " +
    "exclusion the nearest neighbours are the answer and this is reconstruction " +
    "again. Ceiling = held-out house icons against the rest of the house set. " +
    "Baseline = third-party icons whose slug matches a house slug. Floor = " +
    "third-party icons with no house counterpart, sampled to the same n. " +
    "RESULT: the metric does not work on this corpus and is discarded by the " +
    "separation gate. All three numbers land within 0.007 of each other and the " +
    "floor sits ABOVE the baseline (AUC 0.476). Alternatives measured and " +
    "rejected before concluding this: k = 1, 3, 10 and 25 (AUC 0.515-0.580), and " +
    "mean-centring the embeddings over the house set, which widens the span from " +
    "0.007 to 0.009 and leaves AUC unchanged. The reading is that DINO CLS on " +
    "24px black-on-white line art encodes the medium, not the house: Lucide, " +
    "Tabler, Iconoir and Heroicons are stroke sets at the same weight on the same " +
    "canvas, and at that description they are the same set. A style metric for " +
    'this corpus needs a representation that is not dominated by "small line ' +
    'drawing on white" — the geometry the store already measures is a better ' +
    "candidate than a general-purpose vision embedding.",
};

const measure = (): void => {
  const records = loadRecords(RECORDS);
  const conformance = calibrateConformance(
    records as unknown as ConformanceRecord[]
  );

  const houseRecords = records.filter((r) => r.provenance.set === HOUSE);
  const houseIds = houseRecords.map((r) => r.id);
  const bySlug = new Map(records.map((r) => [r.id, r.slug]));

  const dinoHouse = loadEmbeddings(STORE, "dino-house");
  const dinoOutsiders = loadEmbeddings(STORE, "dino-outsiders");
  const siglipHouse = loadEmbeddings(STORE, "siglip-house");
  const siglipText = loadEmbeddings(STORE, "siglip-text");

  // The closure, memoised: `conceptClosure` walks all 18,658 records per call,
  // and the ceiling sample calls it 300 times.
  const closures = new Map<string, Set<string>>();
  const closureOf = (id: string): Set<string> => {
    const slug = bySlug.get(id) ?? id;
    let hit = closures.get(slug);
    if (!hit) {
      hit = conceptClosure(records, slug);
      closures.set(slug, hit);
    }
    return hit;
  };

  const sample = shuffled(houseIds, 3).slice(0, SAMPLE);

  let style: unknown = {
    note: "no DINO sidecars on disk; run scripts/embed.py --model dino",
  };
  if (dinoHouse && dinoOutsiders) {
    const roles = JSON.parse(
      readFileSync(path.join(STORE, "embed-roles.json"), "utf-8")
    ) as { sameConcept: string[]; unrelated: string[] };
    const input = { house: dinoHouse, houseIds };
    const ceiling = styleCeiling(input, sample, closureOf);
    const withClosure = (ids: string[]) =>
      shuffled(ids, 5)
        .slice(0, SAMPLE)
        .map((id) => ({ closure: closureOf(id), id }));
    const baseline = styleAgainstHouse(
      input,
      withClosure(roles.sameConcept),
      dinoOutsiders
    );
    const floor = styleAgainstHouse(
      input,
      withClosure(roles.unrelated),
      dinoOutsiders
    );
    style = {
      baseline: median(scores(baseline)),
      baselineN: baseline.length,
      ceiling: median(scores(ceiling)),
      ceilingN: ceiling.length,
      floor: median(scores(floor)),
      floorN: floor.length,
      k: 10,
      model: dinoHouse.model,
      separation: separation("style", scores(baseline), scores(floor)),
    };
  }

  let semantic: unknown = {
    note: "no SigLIP sidecars on disk; run scripts/embed.py --model siglip-image and --model siglip-text",
  };
  const siglipOutsiders = loadEmbeddings(STORE, "siglip-outsiders");
  if (siglipHouse && siglipText && siglipOutsiders) {
    const bank = conceptBank();
    const answerable = answerableSlugs(bank);
    const houseBySlug = new Map(houseRecords.map((r) => [r.slug, r.id]));
    const roles = JSON.parse(
      readFileSync(path.join(STORE, "embed-roles.json"), "utf-8")
    ) as { sameConcept: string[] };

    // **Ceiling, baseline and floor are measured over the same slugs.** The
    // first version of this sampled the ceiling from 300 random house icons and
    // the baseline from whatever third-party icons happened to share a slug,
    // and reported a baseline *above* the ceiling — because the shared slugs
    // are common words (`home`, `search`, `settings`) that SigLIP knows well
    // and a random house slug is often `bubble-5`. Two samples of different
    // questions are not a scale.
    const seen = new Set<string>();
    const pairs: { outsider: string; slug: string }[] = [];
    for (const id of roles.sameConcept) {
      const slug = bySlug.get(id) ?? "";
      if (
        seen.has(slug) ||
        !(
          answerable.has(slug) &&
          houseBySlug.has(slug) &&
          siglipOutsiders.has(id)
        )
      ) {
        continue;
      }
      seen.add(slug);
      pairs.push({ outsider: id, slug });
    }

    const rank = (
      id: string,
      slug: string,
      from = siglipHouse
    ): SemanticResult | null => {
      const vector = from.get(id);
      return vector ? semanticRank(vector, slug, bank, siglipText) : null;
    };
    const random = rng(17);
    const ceilingResults: SemanticResult[] = [];
    const baselineResults: SemanticResult[] = [];
    const floorResults: SemanticResult[] = [];
    for (const { outsider, slug } of pairs) {
      const real = rank(houseBySlug.get(slug) as string, slug);
      const other = rank(outsider, slug, siglipOutsiders);
      // The floor: a *different* house icon asked the same question. Every icon
      // here is a competent line drawing, so this is what "no information about
      // this concept" scores rather than what a bad drawing scores.
      const decoy = rank(
        houseIds[Math.floor(random() * houseIds.length)],
        slug
      );
      if (real && other && decoy) {
        ceilingResults.push(real);
        baselineResults.push(other);
        floorResults.push(decoy);
      }
    }
    semantic = {
      bank: Object.keys(bank).length,
      baseline: rankAt1(baselineResults),
      baselineMargin: median(baselineResults.map((r) => r.margin)),
      baselineN: baselineResults.length,
      ceiling: rankAt1(ceilingResults),
      ceilingMargin: median(ceilingResults.map((r) => r.margin)),
      ceilingN: ceilingResults.length,
      floor: rankAt1(floorResults),
      floorMargin: median(floorResults.map((r) => r.margin)),
      floorN: floorResults.length,
      model: siglipHouse.model,
      prompt: CONCEPT_PROMPT,
      separation: separation(
        "semantic",
        hits(baselineResults),
        hits(floorResults)
      ),
    };
  }

  // The judge block is written by `scripts/judge-gate.ts`, which costs money to
  // run. Carrying it forward means re-measuring the free metrics does not throw
  // away the paid one.
  const previous = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, "utf-8")) as { judge?: unknown })
    : {};
  const out = {
    builtAt: new Date().toISOString(),
    conformance,
    judge: previous.judge ?? {
      note: "not measured; run `npx tsx scripts/judge-gate.ts`",
    },
    procedure: PROCEDURE,
    records: records.length,
    sample: SAMPLE,
    semantic,
    style,
  };
  mkdirSync("bench", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${OUT} written\n`);
};

const mode = process.argv.at(2);
if (mode === "manifest") {
  buildManifests();
} else if (mode === "measure") {
  measure();
} else {
  process.stderr.write(
    "usage: tsx scripts/calibrate.ts <manifest|measure>\n" +
      "  manifest  write .corpus/embed-*.json for scripts/embed.py\n" +
      "  measure   read the sidecars and write bench/calibration.v1.json\n"
  );
  process.exit(1);
}
