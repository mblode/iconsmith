import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Command } from "commander";

import type {
  ConceptConflict,
  ConceptIcon,
  ConceptProposal,
  GapEntry,
  ProposalReport,
} from "../corpus/concepts.js";
import {
  duplicateConcepts,
  houseVocabulary,
  proposeConcepts,
  rankGaps,
} from "../corpus/concepts.js";
import type { IconRecord } from "../corpus/record.js";
import type { CohortManifest } from "../tools/cohort.js";

/**
 * `concepts report | propose | apply`.
 *
 * Reads the record store — the point of building it — and answers two
 * questions: which canonical icons still have no concept, and which concepts
 * mature sets draw that this one has no word for.
 *
 * **`propose` never writes `_concepts.json`.** It writes proposals, a
 * conflict queue and a ranked backlog to `-o`, plus a `_concepts.proposed.json`
 * shaped like the real file that a person copies across after reading it. The
 * one-answer contract is the whole value of that file; a model filling it in
 * silently would destroy exactly the property it exists to provide.
 */

const HOUSE_SET = "blode-icons";
/** The source whose `tags.json` supplies the synonym vocabulary. */
const LUCIDE_SET = "lucide-static";
/** The seven packs the backlog is ranked over.
 *
 *  `lucide-static` is deliberately absent: it is the same drawings as `lucide`
 *  at a different release, and counting both would give every Lucide name a
 *  free second vote and float 1,994 names up the ranking on no new evidence.
 *  `central` is absent too — it is `conditioning`, not a third-party take. */
const PACKS = new Set([
  "heroicons",
  "iconoir",
  "lucide",
  "phosphor",
  "radix",
  "remix",
  "tabler",
]);
/** Review batch size. Fifty is what fits in one sitting; the ticket's number. */
const BATCH = 50;

interface ReportOpts {
  minPacks: string;
  out: string;
  store: string;
}

interface ProposeOpts extends ReportOpts {
  dryRun?: boolean;
}

interface StoreInput {
  house: ConceptIcon[];
  lucideTags: Record<string, string[]>;
  manifest: CohortManifest;
  /** `{set, slug}` for every third-party record. Names only: this shape
   *  carries no path data, so the gap ranking cannot read geometry even by
   *  accident. */
  names: { set: string; slug: string }[];
}

const readJsonFile = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
};

/**
 * Everything the two passes need, from the store and from blode's own data.
 *
 * The store is read once and reduced to names on the way past. `icons.jsonl`
 * is 78 MB of measurements and holding 18,658 parsed records to pick two fields
 * off each is the difference between a command that runs in a second and one
 * that swells to a gigabyte.
 */
const loadInputs = async (store: string): Promise<StoreInput> => {
  const dir = path.resolve(store);
  const manifestFile = path.join(dir, "manifest.json");
  const built = await readJsonFile<{
    sources: { id: string; root: string }[];
  }>(manifestFile);
  if (!built) {
    throw Object.assign(
      new Error(
        `No corpus store at ${dir}. Run \`iconsmith corpus build\` first.`
      ),
      { code: "NO_STORE" }
    );
  }
  const houseRoot = built.sources.find((s) => s.id === HOUSE_SET)?.root ?? "";
  if (houseRoot === "") {
    throw Object.assign(
      new Error(
        `The store at ${dir} holds no "${HOUSE_SET}" records, so there is no house set to give concepts to.`
      ),
      { code: "NO_HOUSE_SET" }
    );
  }
  const data = path.join(path.resolve(houseRoot), "icons-data");

  const text = await readFile(path.join(dir, "icons.jsonl"), "utf-8");
  const house: ConceptIcon[] = [];
  const names: { set: string; slug: string }[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const rec = JSON.parse(line) as IconRecord;
    if (rec.set === HOUSE_SET) {
      house.push({
        cohort: rec.cohort,
        concepts: rec.concepts,
        set: rec.set,
        slug: rec.slug,
        tags: rec.tags,
      });
    } else if (PACKS.has(rec.set)) {
      names.push({ set: rec.set, slug: rec.slug });
    }
  }

  // Lucide's keyword file, and only its keyword file: 1,767 names carrying
  // 13,829 keywords over a vocabulary blode mostly does not share. The drawings
  // in the same directory are `analysis-only` and this command never opens one.
  // The root comes from the manifest rather than a second hard-coded path, so
  // the two agree about where the package is by construction.
  const lucideRoot = built.sources.find((s) => s.id === LUCIDE_SET)?.root;
  const lucideTags = lucideRoot
    ? ((await readJsonFile<Record<string, string[]>>(
        path.join(path.resolve(lucideRoot), "tags.json")
      )) ?? {})
    : {};

  return {
    house,
    lucideTags,
    manifest:
      (await readJsonFile<CohortManifest>(path.join(data, "_cohorts.json"))) ??
      {},
    names,
  };
};

export interface ConceptsReport {
  conflicts: ConceptConflict[];
  coverage: ProposalReport["coverage"];
  gaps: GapEntry[];
  /** Third-party names counted, and how many survived the vocabulary filter. */
  vocabulary: { names: number; words: number };
}

export interface ConceptsProposal extends ConceptsReport {
  bySource: ProposalReport["bySource"];
  dryRun: boolean;
  files: string[];
  proposals: ConceptProposal[];
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

const reportText = (r: ConceptsReport): string =>
  [
    `concept coverage  ${r.coverage.before.covered}/${r.coverage.before.canonical} canonical icons (${pct(r.coverage.before.coverage)})`,
    `  roles: ${Object.entries(r.coverage.before.roles)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v}`)
      .join("  ")}`,
    `  proposing would reach ${r.coverage.after.covered}/${r.coverage.after.canonical} (${pct(r.coverage.after.coverage)})`,
    `conflict queue    ${r.conflicts.length} word(s) naming two or more canonical icons`,
    `gap backlog       ${r.gaps.length} name(s) drawn by enough packs, from ${r.vocabulary.names.toLocaleString()} third-party names against ${r.vocabulary.words.toLocaleString()} house words`,
    ...r.gaps
      .slice(0, 20)
      .map((g) => `  ${String(g.packs).padStart(2)}  ${g.name}`),
  ].join("\n");

const proposalText = (r: ConceptsProposal): string =>
  [
    reportText(r),
    `proposals         ${r.proposals.length} (${Object.entries(r.bySource)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")})`,
    ...r.files.map((f) => `  ${r.dryRun ? "would write" : "wrote"} ${f}`),
  ].join("\n");

/** Batches of ~50, each a checklist. A reviewer blesses a batch by copying its
 *  lines into `_concepts.json`; nothing here does it for them. */
const proposalsMarkdown = (r: ConceptsProposal): string => {
  // Batched in trust order, not alphabetically. Sorted by concept the first
  // batch is `100`, `1080p`, `2g`, `3g` — the noisiest end of the tag and
  // keyword vocabularies — and a reviewer who reads one batch reads the worst
  // fifty. Trust order puts the 1,550 mechanical slug concepts first, where a
  // batch can be blessed at a glance.
  const rank: Record<string, number> = {
    inferred: 0,
    "lucide-derived": 2,
    "tag-derived": 1,
  };
  const unblessed = r.proposals
    .filter((p) => p.source !== "curated")
    .toSorted(
      (a, b) =>
        (rank[a.source] ?? 3) - (rank[b.source] ?? 3) ||
        a.concept.localeCompare(b.concept)
    );
  const lines = [
    "# Concept proposals",
    "",
    `${unblessed.length} proposed concepts, ${BATCH} to a batch. Nothing here is in`,
    "`_concepts.json` yet — tick a line to bless it, strike one to drop it.",
    "",
    `Coverage today: ${r.coverage.before.covered}/${r.coverage.before.canonical} (${pct(r.coverage.before.coverage)}).`,
    `With every line below: ${r.coverage.after.covered}/${r.coverage.after.canonical} (${pct(r.coverage.after.coverage)}).`,
    "",
  ];
  for (let i = 0; i < unblessed.length; i += BATCH) {
    const batch = unblessed.slice(i, i + BATCH);
    lines.push(
      `## Batch ${Math.floor(i / BATCH) + 1} — ${batch.length} concepts, ${[...new Set(batch.map((p) => p.source))].join(" + ")}`,
      "",
      "| | concept | icon | source | why |",
      "| - | - | - | - | - |",
      ...batch.map(
        (p) =>
          `| [ ] | \`${p.concept}\` | \`${p.slug}\` | ${p.source} | ${p.why} |`
      ),
      ""
    );
  }
  return lines.join("\n");
};

const conflictsMarkdown = (r: ConceptsReport): string =>
  [
    "# Conflict queue",
    "",
    `${r.conflicts.length} words name more than one canonical icon, so none of them`,
    "can become a concept until a person picks the answer. This queue is the",
    "deliverable, not a failure: a concept with two answers is exactly what",
    "`_concepts.json` exists to prevent.",
    "",
    "| word | from | candidates |",
    "| - | - | - |",
    ...r.conflicts.map(
      (c) =>
        `| \`${c.word}\` | ${c.kind} | ${c.candidates.map((s) => `\`${s}\``).join(", ")} |`
    ),
    "",
  ].join("\n");

const gapsMarkdown = (r: ConceptsReport): string =>
  [
    "# Generation backlog",
    "",
    `${r.gaps.length} names drawn by several of the seven third-party packs that the`,
    "house set has no word for — not a slug, not a concept, not a tag.",
    "",
    "Ranked by how many packs draw each. Derived from names only: no third-party",
    "drawing was read to build this list, and none may be read to answer it.",
    "",
    "| packs | name | sets |",
    "| - | - | - |",
    ...r.gaps.map(
      (g) => `| ${g.packs} | \`${g.name}\` | ${g.sets.join(", ")} |`
    ),
    "",
  ].join("\n");

/** The proposed map, in `_concepts.json`'s own shape so a reviewer diffs it
 *  against the real file rather than translating it. Written beside the
 *  proposals and never over the real one. */
const proposedConcepts = (r: ConceptsProposal): string => {
  const concepts: Record<string, string> = {};
  for (const p of r.proposals.toSorted((a, b) =>
    a.concept.localeCompare(b.concept)
  )) {
    concepts[p.concept] = p.slug;
  }
  return `${JSON.stringify(
    {
      concepts,
      description:
        "PROPOSED, NOT BLESSED. Generated by `iconsmith concepts --propose`. Every entry whose source is not `curated` is a guess; see proposals.md for the source of each and tick the ones that are right before merging any of this into _concepts.json.",
    },
    null,
    2
  )}\n`;
};

interface ApplyOpts {
  dryRun?: boolean;
  from: string;
  to: string;
}

interface ConceptsFile {
  concepts: Record<string, string>;
  description?: string;
}

export interface ApplyReport {
  added: number;
  /** Concepts the reviewed file points at a different icon than the live file.
   *  Reported and applied — a review that changed an answer meant to. */
  changed: { concept: string; from: string; to: string }[];
  dryRun: boolean;
  duplicates: { concept: string; slugs: string[] }[];
  /** Live entries the reviewed file does not mention. Kept: `apply` merges, so
   *  a reviewer can bless one batch at a time without the unblessed batches
   *  deleting what is already there. */
  kept: number;
  to: string;
  total: number;
}

/**
 * The bless step, and the only thing in this file that touches `_concepts.json`.
 *
 * It is a separate command, it names both files explicitly, and it merges a
 * file a person has read rather than a report a model just generated. That
 * separation is the whole point: `propose` is allowed to be wrong because
 * nothing downstream believes it, and this is allowed to be believed because a
 * person ran it.
 */
const applyConcepts = async ({
  dryRun,
  from,
  to,
}: ApplyOpts): Promise<ApplyReport> => {
  const reviewed = await readJsonFile<ConceptsFile>(path.resolve(from));
  if (!reviewed?.concepts) {
    throw Object.assign(
      new Error(`No concepts map at ${path.resolve(from)}.`),
      { code: "NO_PROPOSAL" }
    );
  }
  const target = path.resolve(to);
  const live = (await readJsonFile<ConceptsFile>(target)) ?? { concepts: {} };

  const changed: ApplyReport["changed"] = [];
  let added = 0;
  for (const [concept, slug] of Object.entries(reviewed.concepts)) {
    const was = live.concepts[concept];
    if (was === undefined) {
      added += 1;
    } else if (was !== slug) {
      changed.push({ concept, from: was, to: slug });
    }
  }
  const merged = { ...live.concepts, ...reviewed.concepts };
  const kept = Object.keys(live.concepts).filter(
    (c) => !(c in reviewed.concepts)
  ).length;

  // The one-answer contract, checked before the file is written rather than
  // after somebody hits the wrong icon.
  const duplicates = duplicateConcepts(
    Object.entries(merged).map(([concept, slug]) => ({ concept, slug }))
  );

  if (!(dryRun || duplicates.length > 0)) {
    const concepts: Record<string, string> = {};
    for (const key of Object.keys(merged).toSorted((a, b) =>
      a.localeCompare(b)
    )) {
      concepts[key] = merged[key];
    }
    await writeFile(
      target,
      `${JSON.stringify({ ...live, concepts }, null, 2)}\n`,
      "utf-8"
    );
  }

  return {
    added,
    changed,
    dryRun: Boolean(dryRun),
    duplicates,
    kept,
    to: target,
    total: Object.keys(merged).length,
  };
};

const applyText = (r: ApplyReport): string =>
  [
    `${r.dryRun ? "would merge" : "merged"} into ${r.to}`,
    `  ${r.added} added, ${r.changed.length} changed, ${r.kept} kept, ${r.total} concepts total`,
    ...r.changed.map((c) => `  ~ ${c.concept}: ${c.from} → ${c.to}`),
    ...r.duplicates.map(
      (d) =>
        `  ! "${d.concept}" would map to ${d.slugs.join(", ")} — nothing written`
    ),
  ].join("\n");

const analyse = (
  input: StoreInput,
  minPacks: number
): { proposal: ProposalReport; report: ConceptsReport } => {
  const proposal = proposeConcepts({
    icons: input.house,
    lucideTags: input.lucideTags,
    manifest: input.manifest,
  });
  const vocabulary = houseVocabulary(input.house);
  return {
    proposal,
    report: {
      conflicts: proposal.conflicts,
      coverage: proposal.coverage,
      gaps: rankGaps({ minPacks, names: input.names, vocabulary }),
      vocabulary: {
        names: new Set(input.names.map((n) => n.slug)).size,
        words: vocabulary.size,
      },
    },
  };
};

export const registerConceptsCommand = (program: Command): void => {
  const concepts = program
    .command("concepts")
    .description(
      "report concept coverage, propose the missing ones, and rank the generation backlog"
    );

  concepts
    .command("report", { isDefault: true })
    .description("coverage, the conflict queue and the ranked gap list")
    .option("-s, --store <dir>", "corpus store directory", ".corpus")
    .option("-o, --out <dir>", "where --propose writes", ".corpus/concepts")
    .option("-p, --min-packs <n>", "packs that must draw a gap name", "3")
    .action(async (opts: ReportOpts) => {
      const { report } = analyse(
        await loadInputs(opts.store),
        Number(opts.minPacks)
      );
      process.stdout.write(
        program.opts().output === "json"
          ? `${JSON.stringify(report)}\n`
          : `${reportText(report)}\n`
      );
    });

  concepts
    .command("propose")
    .description("write the proposals, conflict queue and backlog for review")
    .option("-s, --store <dir>", "corpus store directory", ".corpus")
    .option("-o, --out <dir>", "review artifacts directory", ".corpus/concepts")
    .option("-p, --min-packs <n>", "packs that must draw a gap name", "3")
    .option("--dry-run", "report what would be written, write nothing")
    .action(async (opts: ProposeOpts) => {
      const input = await loadInputs(opts.store);
      const { proposal, report } = analyse(input, Number(opts.minPacks));
      const dir = path.resolve(opts.out);
      const result: ConceptsProposal = {
        ...report,
        bySource: proposal.bySource,
        dryRun: Boolean(opts.dryRun),
        files: [
          "proposals.md",
          "proposals.json",
          "conflicts.md",
          "gaps.md",
          "_concepts.proposed.json",
        ].map((f) => path.join(dir, f)),
        proposals: proposal.proposals,
      };

      if (!opts.dryRun) {
        await mkdir(dir, { recursive: true });
        await Promise.all([
          writeFile(
            path.join(dir, "proposals.md"),
            proposalsMarkdown(result),
            "utf-8"
          ),
          writeFile(
            path.join(dir, "proposals.json"),
            `${JSON.stringify(
              { conflicts: report.conflicts, proposals: proposal.proposals },
              null,
              2
            )}\n`,
            "utf-8"
          ),
          writeFile(
            path.join(dir, "conflicts.md"),
            conflictsMarkdown(report),
            "utf-8"
          ),
          writeFile(path.join(dir, "gaps.md"), gapsMarkdown(report), "utf-8"),
          writeFile(
            path.join(dir, "_concepts.proposed.json"),
            proposedConcepts(result),
            "utf-8"
          ),
        ]);
      }

      process.stdout.write(
        program.opts().output === "json"
          ? `${JSON.stringify(result)}\n`
          : `${proposalText(result)}\n`
      );

      // A proposal set that already contradicts itself is not reviewable, and
      // shipping it would put the reviewer's time behind a bug of ours.
      if (proposal.duplicates.length > 0) {
        process.exitCode = 1;
      }
    });

  concepts
    .command("apply")
    .description(
      "merge a reviewed proposal file into _concepts.json (a person's step, after reading it)"
    )
    .requiredOption(
      "-f, --from <file>",
      "reviewed proposal file, in _concepts.json's shape"
    )
    .requiredOption("-t, --to <file>", "the _concepts.json to merge into")
    .option("--dry-run", "report the merge, write nothing")
    .action(async (opts: ApplyOpts) => {
      const report = await applyConcepts(opts);
      process.stdout.write(
        program.opts().output === "json"
          ? `${JSON.stringify(report)}\n`
          : `${applyText(report)}\n`
      );
      if (report.duplicates.length > 0) {
        process.exitCode = 1;
      }
    });
};
