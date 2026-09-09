/**
 * `iconsmith improve` — one A/B of two experts, scientific method.
 *
 * This command edits the routing table: which expert is asked first for a
 * concept class. Third-party packs enter as slugs (inventory / `--packs` /
 * baseline directory listings). No SVG crosses into the drawer.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { loadBaselines } from "../corpus/baselines.js";
import {
  applyVerdict,
  parseConceptClass,
  parseExpertId,
  runExperiment,
} from "../pipeline/experiment.js";
import type { ExperimentReport, Hypothesis } from "../pipeline/experiment.js";
import {
  DEFAULT_INVENTORY,
  assertNamesOnly,
  defaultExperts,
  evidenceOf,
  gate,
  mergePackIndex,
  packIndexFromSlugs,
  parseMixturePolicy,
} from "../pipeline/mixture.js";
import type { ConceptClass, ExpertId, PackIndex } from "../pipeline/mixture.js";
import { houseAt } from "./new.js";
import { readJson } from "./read.js";

const DEFAULT_POLICY = path.join(
  import.meta.dirname,
  "../pipeline/mixture.default.json"
);

interface ImproveOptions {
  apply?: boolean;
  claim?: string;
  class?: string;
  concepts?: string[];
  control: string;
  corpus?: string;
  dryRun?: boolean;
  feedback?: string[];
  inventory?: string;
  out?: string;
  packs?: string;
  packsRoot?: string;
  policy?: string;
  selection?: string[];
  treatment: string;
}

/** Overlay listings onto the committed names-only table. An empty overlay
 *  is the table itself — a missing `--packs` must not hide `database`. */
export const startingInventory = (overlay: PackIndex = new Map()): PackIndex =>
  overlay.size > 0
    ? mergePackIndex(DEFAULT_INVENTORY, overlay)
    : DEFAULT_INVENTORY;

const rowsFromUnknown = (raw: unknown, label: string): PackIndex => {
  assertNamesOnly(raw, label);
  if (!Array.isArray(raw)) {
    throw new TypeError(`${label} must be an array of { pack, slug }.`);
  }
  return packIndexFromSlugs(raw as { pack: string; slug: string }[]);
};

export const conceptNames = (
  requested: readonly string[],
  listed: readonly string[],
  inventory: PackIndex
): string[] => {
  if (requested.length > 0) {
    return [...requested];
  }
  if (listed.length > 0) {
    return [...listed];
  }
  return [...inventory.keys()].toSorted((a, b) => a.localeCompare(b));
};

export const splitConcepts = (
  names: readonly string[],
  feedback?: readonly string[],
  selection?: readonly string[]
): { feedback: string[]; selection: string[] } => {
  if (feedback !== undefined || selection !== undefined) {
    return {
      feedback: [...(feedback ?? [])],
      selection: [...(selection ?? [])],
    };
  }
  if (names.length < 2) {
    return { feedback: [...names], selection: [] };
  }
  const cut = Math.floor(names.length / 2);
  return {
    feedback: names.slice(0, cut),
    selection: names.slice(cut),
  };
};

export const inventoryNames = (
  raw: unknown
): { names: string[]; packs: PackIndex } => {
  assertNamesOnly(raw, "gap inventory");
  if (!Array.isArray(raw)) {
    throw new TypeError("inventory must be a JSON array of { name, sets }.");
  }
  const rows: { pack: string; slug: string }[] = [];
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      names.push(entry);
      continue;
    }
    if (entry === null || typeof entry !== "object") {
      throw new Error("inventory entries must be strings or { name, sets }.");
    }
    const rec = entry as { name?: unknown; sets?: unknown };
    if (typeof rec.name !== "string") {
      throw new TypeError("inventory entry is missing name.");
    }
    names.push(rec.name);
    if (Array.isArray(rec.sets)) {
      for (const set of rec.sets) {
        if (typeof set === "string") {
          rows.push({ pack: set, slug: rec.name });
        }
      }
    }
  }
  return { names, packs: packIndexFromSlugs(rows) };
};

const overlayOf = async (
  opts: ImproveOptions
): Promise<{
  listed: string[];
  overlay: PackIndex;
}> => {
  const fromFile = opts.inventory
    ? inventoryNames(
        readJson<unknown>(opts.inventory, "a gap inventory JSON file")
      )
    : { names: [] as string[], packs: new Map() as PackIndex };
  let overlay: PackIndex = fromFile.packs;
  if (opts.packs) {
    overlay = mergePackIndex(
      overlay,
      rowsFromUnknown(
        readJson<unknown>(opts.packs, "a pack slug index JSON file"),
        "pack slug index"
      )
    );
  }
  if (opts.packsRoot !== undefined && existsSync(opts.packsRoot)) {
    const baselines = await loadBaselines(opts.packsRoot);
    overlay = mergePackIndex(
      overlay,
      packIndexFromSlugs(
        baselines.entries.map((e) => ({ pack: e.pack, slug: e.icon }))
      )
    );
  }
  return { listed: fromFile.names, overlay };
};

const namesInClass = (
  names: readonly string[],
  klass: ConceptClass,
  inventory: PackIndex,
  house: ReturnType<typeof houseAt> | undefined,
  policy: ReturnType<typeof parseMixturePolicy>
): string[] =>
  names.filter(
    (name) =>
      gate(evidenceOf({ name }, {}, { house, inventory }), policy).class ===
      klass
  );

const loadPolicy = (file: string) =>
  parseMixturePolicy(readJson<unknown>(file, "a mixture policy JSON file"));

const writePolicy = (
  file: string,
  weights: Readonly<Record<ConceptClass, readonly ExpertId[]>>,
  base: ReturnType<typeof parseMixturePolicy>
): void => {
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        packInventoryFloor: base.packInventoryFloor,
        stopOnCleanCheap: base.stopOnCleanCheap,
        weights,
      },
      null,
      2
    )}\n`
  );
};

const reportImprove = (report: ExperimentReport, json: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const { hypothesis, screen, decision, status, reasons } = report;
  process.stdout.write(
    `${hypothesis.id}: ${hypothesis.control} vs ${hypothesis.treatment} ` +
      `on ${hypothesis.class} → ${status}\n`
  );
  process.stdout.write(
    `  screen ${screen.treatmentWins}w/${screen.ties}t/${screen.controlWins}l\n`
  );
  if (decision) {
    process.stdout.write(
      `  selection ${decision.treatmentWins}w/${decision.ties}t/${decision.controlWins}l\n`
    );
  }
  for (const reason of reasons) {
    process.stdout.write(`  ${reason}\n`);
  }
};

export const registerImproveCommand = (program: Command): void => {
  program
    .command("improve")
    .description(
      "A/B two experts on a concept class; keep updates the routing table"
    )
    .requiredOption("--control <expert>", "incumbent expert")
    .requiredOption("--treatment <expert>", "challenger expert")
    .option("--class <id>", "concept class this A/B is about", "pack-inventory")
    .option("--claim <text>", "one-line hypothesis for the ledger")
    .option("--concepts <name...>", "names to split into screen / selection")
    .option("--feedback <name...>", "screen names; not evidence")
    .option("--selection <name...>", "hold-out names; the decision")
    .option(
      "--inventory <file>",
      "gap JSON from `concepts` (names + which packs name them)"
    )
    .option(
      "--packs <file>",
      "JSON array of { pack, slug } — names only, no SVG"
    )
    .option(
      "--packs-root <dir>",
      "baseline pack tree; listings only, files are not opened"
    )
    .option("--policy <file>", "mixture policy JSON", DEFAULT_POLICY)
    .option("--corpus <dir>", "house corpus for keyed evidence", "corpus")
    .option("--out <file>", "append a ledger JSONL row")
    .option("--apply", "write the policy if the verdict is keep")
    .option("--dry-run", "print the verdict; write nothing")
    .action(async (opts: ImproveOptions) => {
      const control = parseExpertId(opts.control);
      const treatment = parseExpertId(opts.treatment);
      const klass = parseConceptClass(opts.class ?? "pack-inventory");
      const policy = loadPolicy(opts.policy ?? DEFAULT_POLICY);
      const { listed, overlay } = await overlayOf(opts);
      const inventory = startingInventory(overlay);
      const house = existsSync(opts.corpus ?? "corpus")
        ? houseAt(opts.corpus ?? "corpus")
        : undefined;
      const matched = namesInClass(
        conceptNames(opts.concepts ?? [], listed, inventory),
        klass,
        inventory,
        house,
        policy
      );
      if (matched.length === 0) {
        throw new Error(
          `no concepts classified as ${klass}. Pass --concepts or --inventory.`
        );
      }
      const split = splitConcepts(matched, opts.feedback, opts.selection);
      const hypothesis: Hypothesis = {
        claim: opts.claim ?? `${treatment} beats ${control} on ${klass}`,
        class: klass,
        control,
        id: `${klass}-${control}-vs-${treatment}`,
        treatment,
      };
      const experts = defaultExperts(house);
      const report = await runExperiment({
        draw: (expert, concept) => experts[expert](concept, {}),
        feedback: split.feedback,
        hypothesis,
        selection: split.selection,
      });

      const json = program.opts().output === "json";
      reportImprove(report, json);
      if (opts.dryRun) {
        return;
      }
      if (opts.out) {
        mkdirSync(path.dirname(opts.out), { recursive: true });
        appendFileSync(opts.out, `${JSON.stringify(report)}\n`);
      }
      if (opts.apply && report.status === "keep") {
        writePolicy(
          opts.policy ?? DEFAULT_POLICY,
          applyVerdict(policy.weights, hypothesis, report.status),
          policy
        );
      }
    });
};
