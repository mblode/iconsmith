/** Offline, sealed AI-review controls made only from the actual house library. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import sharp from "sharp";

import { assignRoles } from "../src/corpus/concepts.js";
import type { ConceptIcon } from "../src/corpus/concepts.js";
import { parseIconSvg } from "../src/corpus/load.js";
import { opticalProof } from "../src/tools/proof.js";
import { corpusTreeHash } from "./local-campaign.js";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

interface CorruptionProbe {
  afterComponents?: number;
  afterInk: number;
  beforeComponents?: number;
  beforeInk: number;
  changedPixels: number;
  verifiedCounterPixels?: number;
  objective:
    | "counter-collapse"
    | "severed-connections"
    | "severely-clipped-contour";
}

interface SourceCandidate {
  aliases: string[];
  family: string;
  filledSvg: string;
  head: string;
  outlinedSvg: string;
  slug: string;
}

const innerSvg = (svg: string) =>
  svg.replace(/^.*?<svg[^>]*>/su, "").replace(/<\/svg>.*$/su, "");
const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" color="black">${inner}</svg>`;

const validSourceSvg = (svg: string) => {
  const plain =
    /viewBox=["']0 0 24 24["']/u.test(svg) &&
    !/<(?:image|style|script|text)\b/iu.test(svg);
  const shapes = plain ? parseIconSvg(svg) : [];
  const black = !/(?:#[0-9a-f]{3,8}|rgb\(|hsl\()/iu.test(
    svg.replaceAll(/#000(?:000)?/giu, "")
  );
  return plain && black && shapes.length > 0;
};

const alpha = async (svg: string, size = 96) => {
  const { data } = await sharp(Buffer.from(svg))
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [...data].filter((_, index) => index % 4 === 3);
};

const componentCount = (pixels: readonly number[], ink: boolean) => {
  const size = Math.sqrt(pixels.length);
  const seen = new Set<number>();
  let count = 0;
  for (let start = 0; start < pixels.length; start += 1) {
    const matches = ink ? pixels[start] > 127 : pixels[start] <= 127;
    if (!matches || seen.has(start)) {
      continue;
    }
    count += 1;
    const pending = [start];
    seen.add(start);
    while (pending.length) {
      const current = pending.pop() as number;
      const x = current % size;
      for (const next of [
        current - 1,
        current + 1,
        current - size,
        current + size,
      ]) {
        if (next < 0 || next >= pixels.length || seen.has(next)) {
          continue;
        }
        if (
          (next === current - 1 && x === 0) ||
          (next === current + 1 && x === size - 1)
        ) {
          continue;
        }
        if (ink ? pixels[next] > 127 : pixels[next] <= 127) {
          seen.add(next);
          pending.push(next);
        }
      }
    }
  }
  return count;
};

const enclosedTransparency = (pixels: readonly number[]) => {
  const size = Math.sqrt(pixels.length);
  const outside = new Set<number>();
  const pending = pixels.flatMap((value, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    return value <= 127 &&
      (x === 0 || y === 0 || x === size - 1 || y === size - 1)
      ? [index]
      : [];
  });
  for (const index of pending) {
    outside.add(index);
  }
  while (pending.length) {
    const current = pending.pop() as number;
    const x = current % size;
    for (const next of [
      current - 1,
      current + 1,
      current - size,
      current + size,
    ]) {
      if (
        next < 0 ||
        next >= pixels.length ||
        outside.has(next) ||
        pixels[next] > 127
      ) {
        continue;
      }
      if (
        (next === current - 1 && x === 0) ||
        (next === current + 1 && x === size - 1)
      ) {
        continue;
      }
      outside.add(next);
      pending.push(next);
    }
  }
  return new Set(
    pixels.flatMap((value, index) =>
      value <= 127 && !outside.has(index) ? [index] : []
    )
  );
};

const probe = async (
  before: string,
  after: string,
  objective: CorruptionProbe["objective"]
): Promise<CorruptionProbe | null> => {
  const [a, b] = await Promise.all([alpha(before), alpha(after)]);
  const beforeInk = a.filter((value) => value > 127).length;
  const afterInk = b.filter((value) => value > 127).length;
  const changedPixels = a.filter(
    (value, index) => Math.abs(value - b[index]) > 127
  ).length;
  if (changedPixels < 80 || beforeInk < 100 || afterInk < 100) {
    return null;
  }
  if (objective === "counter-collapse") {
    const enclosed = enclosedTransparency(a);
    const verifiedCounterPixels = [...enclosed].filter(
      (index) => b[index] > 127
    ).length;
    if (verifiedCounterPixels < 80) {
      return null;
    }
    return {
      afterInk,
      beforeInk,
      changedPixels,
      objective,
      verifiedCounterPixels,
    };
  }
  if (objective === "severed-connections") {
    const beforeComponents = componentCount(a, true);
    const afterComponents = componentCount(b, true);
    if (afterComponents <= beforeComponents) {
      return null;
    }
    return {
      afterComponents,
      afterInk,
      beforeComponents,
      beforeInk,
      changedPixels,
      objective,
    };
  }
  return { afterInk, beforeInk, changedPixels, objective };
};

export const corruptControlSvg = async (
  svg: string,
  ordinal: number
): Promise<{ probe: CorruptionProbe; svg: string }> => {
  const inner = innerSvg(svg);
  const choices: { objective: CorruptionProbe["objective"]; svg: string }[] = [
    {
      objective: "severely-clipped-contour",
      svg: wrap(
        `<g clip-path="url(#clip)">${inner}</g><defs><clipPath id="clip"><rect width="13" height="24"/></clipPath></defs>`
      ),
    },
    {
      objective: "counter-collapse",
      svg: wrap(
        `${inner}<circle cx="12" cy="12" r="3.5" fill="currentColor"/>`
      ),
    },
    {
      objective: "severed-connections",
      svg: wrap(
        `<defs><mask id="sever"><rect width="24" height="24" fill="white"/><rect x="11" width="2" height="24" fill="black"/></mask></defs><g mask="url(#sever)">${inner}</g>`
      ),
    },
  ];
  for (let offset = 0; offset < choices.length; offset += 1) {
    const choice = choices[(ordinal + offset) % choices.length];
    // eslint-disable-next-line no-await-in-loop
    const measured = await probe(svg, choice.svg, choice.objective);
    if (!measured) {
      continue;
    }
    const ratio = measured.afterInk / measured.beforeInk;
    if (
      (choice.objective === "severely-clipped-contour" && ratio < 0.8) ||
      (choice.objective === "counter-collapse" && ratio > 1.08) ||
      (choice.objective === "severed-connections" && ratio < 0.94)
    ) {
      return { probe: measured, svg: choice.svg };
    }
  }
  throw new Error("Source did not support an objectively verified corruption");
};

const sourceInventory = (
  library: string,
  conceptsFile: string,
  cohortsFile: string,
  excludedFamilies: ReadonlySet<string>
): SourceCandidate[] => {
  const files = readdirSync(library)
    .filter((name) => name.endsWith(".svg") && !name.endsWith("-filled.svg"))
    .toSorted();
  const conceptData = JSON.parse(readFileSync(conceptsFile, "utf-8")) as {
    concepts: Record<string, string>;
  };
  const cohorts = JSON.parse(readFileSync(cohortsFile, "utf-8")) as Record<
    string,
    string[]
  >;
  const aliases = new Map<string, string[]>();
  for (const [word, slug] of Object.entries(conceptData.concepts)) {
    aliases.set(slug, [...(aliases.get(slug) ?? []), word]);
  }
  const cohortBySlug = new Map<string, string>();
  for (const [cohort, members] of Object.entries(cohorts)) {
    for (const member of members.filter((name) => !name.endsWith("-filled"))) {
      cohortBySlug.set(member, cohort.replace(/#filled$/u, ""));
    }
  }
  const icons: ConceptIcon[] = files.map((name) => {
    const slug = name.slice(0, -4);
    return {
      cohort: cohortBySlug.get(slug) ?? null,
      concepts: aliases.get(slug) ?? [],
      set: "blode-icons",
      slug,
      tags: [],
    };
  });
  const roles = assignRoles(icons, cohorts);
  return roles
    .filter(({ role }) => role === "canonical")
    .filter(
      ({ family, head }) =>
        !excludedFamilies.has(family) && !excludedFamilies.has(head)
    )
    .flatMap(({ family, head, slug }) => {
      const outlinedSvg = readFileSync(
        path.join(library, `${slug}.svg`),
        "utf-8"
      );
      const filledPath = path.join(library, `${slug}-filled.svg`);
      let filledSvg: string;
      try {
        filledSvg = readFileSync(filledPath, "utf-8");
      } catch {
        return [];
      }
      return validSourceSvg(outlinedSvg) && validSourceSvg(filledSvg)
        ? [
            {
              aliases: aliases.get(slug)?.toSorted() ?? [],
              family,
              filledSvg,
              head,
              outlinedSvg,
              slug,
            },
          ]
        : [];
    });
};

const saveProof = async (
  directory: string,
  id: string,
  svg: string,
  nativeSize: number
) => {
  const proof = await opticalProof(svg, nativeSize);
  const vector = await sharp(Buffer.from(svg))
    .resize(nativeSize * 8, nativeSize * 8)
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = {
    "1x-light.png": proof.native,
    "2x-light.png": proof.retina,
    "enlarged-light.png": vector,
  };
  const dark = await Promise.all(
    Object.entries(files).map(
      async ([name, value]) =>
        [
          name.replace("light", "dark"),
          await sharp(value).negate({ alpha: false }).png().toBuffer(),
        ] as const
    )
  );
  for (const [name, value] of dark) {
    files[name] = value;
  }
  const hashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(files)) {
    const relative = path.join("images", id, name);
    const absolute = path.join(directory, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, value, { flag: "wx" });
    hashes[relative] = sha256(value);
  }
  return hashes;
};

// eslint-disable-next-line complexity -- generation validates every sealed qualification invariant inline
export const generateAiControlPacket = async (input: {
  cohortsFile: string;
  conceptsFile: string;
  developmentManifest: string;
  excludedFamilies?: readonly string[];
  exclusionKey?: string;
  exclusionKeys?: readonly string[];
  library: string;
  out: string;
  qualification?: boolean;
  qualificationVersion?: "v2" | "v3";
  sourceCount?: number;
}) => {
  mkdirSync(input.out, { recursive: false });
  const development = JSON.parse(
    readFileSync(input.developmentManifest, "utf-8")
  );
  const excluded = new Set<string>(
    development.manifest.concepts.map((row: { family: string }) => row.family)
  );
  for (const family of input.excludedFamilies ?? []) {
    excluded.add(family);
  }
  const candidates = sourceInventory(
    input.library,
    input.conceptsFile,
    input.cohortsFile,
    excluded
  )
    .map((source) => ({ ...source, order: sha256(source.slug) }))
    .toSorted((a, b) => a.order.localeCompare(b.order));
  const qualification = input.qualification ?? false;
  const qualificationVersion = input.qualificationVersion ?? "v2";
  const wanted = input.sourceCount ?? (qualification ? 100 : 50);
  if (qualification && wanted % 4 !== 0) {
    throw new Error(
      "Qualification source count must divide evenly into four strata"
    );
  }
  const selected: (SourceCandidate & {
    finish: "filled" | "outlined";
    nativeSize: 16 | 24;
    negative: Awaited<ReturnType<typeof corruptControlSvg>> | null;
    sourceSvg: string;
  })[] = [];
  for (const candidate of candidates) {
    const stratum = selected.length % 4;
    const finish = stratum < 2 ? "outlined" : "filled";
    const sourceSvg =
      finish === "outlined" ? candidate.outlinedSvg : candidate.filledSvg;
    const needsNegative = !qualification || selected.length >= wanted / 2;
    try {
      let negative = null;
      if (needsNegative) {
        // eslint-disable-next-line no-await-in-loop -- deterministic bounded offline probe
        negative = await corruptControlSvg(sourceSvg, selected.length);
      }
      selected.push({
        ...candidate,
        finish,
        nativeSize: stratum % 2 === 0 ? 16 : 24,
        negative,
        sourceSvg,
      });
    } catch {
      // Unsuitable sources remain excluded rather than weakening the probe.
    }
    if (selected.length === wanted) {
      break;
    }
  }
  if (selected.length !== wanted) {
    throw new Error(
      `Only ${selected.length}/${wanted} canonical sources supported controls`
    );
  }
  if (new Set(selected.map(({ family }) => family)).size !== selected.length) {
    throw new Error(
      "Control sources must come from independent semantic families"
    );
  }
  const sealed: Record<string, unknown>[] = [];
  const blinded: Record<string, unknown>[] = [];
  const arranged = qualification
    ? selected.slice(0, wanted / 2).flatMap((positive, index) => {
        const negative = selected[index + wanted / 2];
        if (!negative.negative) {
          throw new Error("Negative source has no verified corruption");
        }
        return [
          {
            kind: "positive" as const,
            source: positive,
            svg: positive.sourceSvg,
          },
          {
            kind: "negative" as const,
            source: negative,
            svg: negative.negative.svg,
          },
        ];
      })
    : Array.from({ length: selected.length / 5 }, (_, packetIndex) => {
        const positives = selected
          .slice(packetIndex * 5, packetIndex * 5 + 5)
          .map((source) => ({
            kind: "positive" as const,
            source,
            svg: source.sourceSvg,
          }));
        const negativeStart =
          (packetIndex * 5 + selected.length / 2) % selected.length;
        const negatives = Array.from(
          { length: 5 },
          (_unused, offset) =>
            selected[(negativeStart + offset) % selected.length]
        ).map((source) => ({
          kind: "negative" as const,
          source,
          svg: source.negative?.svg ?? source.sourceSvg,
        }));
        return positives.flatMap((positive, index) => [
          positive,
          negatives[index],
        ]);
      }).flat();
  for (const [index, { kind, source, svg }] of arranged.entries()) {
    const { nativeSize } = source;
    const stimulus = index + 1;
    const id = `S${String(stimulus).padStart(3, "0")}`;
    const svgHash = sha256(svg);
    const recognitionChoices = [
      source.slug,
      ...[1, 2, 3].map(
        (offset) =>
          arranged[(index + offset * 17) % arranged.length].source.slug
      ),
    ].filter(
      (value, choiceIndex, values) => values.indexOf(value) === choiceIndex
    );
    if (qualificationVersion === "v3" && recognitionChoices.length < 3) {
      throw new Error(
        "Recognition controls require three distinct alternatives"
      );
    }
    // eslint-disable-next-line no-await-in-loop
    const evidenceHashes = await saveProof(input.out, id, svg, nativeSize);
    const canonicalArtifactHash = sha256(json({ evidenceHashes, id, svgHash }));
    blinded.push({
      canonicalArtifactHash,
      evidenceHashes,
      id,
      nativeSize,
      opticalMasterClaim: false,
      qualified: false,
      ...(qualificationVersion === "v3" ? { recognitionChoices } : {}),
    });
    sealed.push({
      aliases: source.aliases,
      family: source.family,
      finish: source.finish,
      head: source.head,
      id,
      kind,
      ...(qualificationVersion === "v3"
        ? {
            canonicalArtifactHash,
            control:
              kind === "negative" ? "objective-corruption" : "source-baseline",
            hostInjected: true,
            recognitionAnswer: source.slug,
            recognitionChoices,
          }
        : {}),
      nativeSize,
      objectiveProbe: kind === "negative" ? source.negative?.probe : null,
      sourceSlug: source.slug,
      sourceSvgSha256: sha256(source.sourceSvg),
      svgSha256: svgHash,
    });
  }
  let controls: Record<string, unknown>[] = [
    { first: "S001", id: "C-identical", second: "S001", type: "identical" },
    {
      first: "S001",
      id: "C-reversed",
      second: "S002",
      type: "reversed-presentation",
    },
  ];
  const packets: Record<string, unknown>[] = Array.from(
    { length: 10 },
    (_, packetIndex) => ({
      controls: packetIndex === 0 ? controls : [],
      images: blinded.slice(packetIndex * 10, packetIndex * 10 + 10),
      independentSourceFamilies: selected.length,
      instrumentQualified: false,
      packetId: `P${String(packetIndex + 1).padStart(2, "0")}`,
    })
  );
  if (qualification && qualificationVersion === "v3") {
    const presentationRows = [];
    for (const [controlIndex, originalIndex] of [0, 1].entries()) {
      const original = sealed[originalIndex];
      const source = arranged[originalIndex];
      const id = `C${String(controlIndex + 1).padStart(3, "0")}`;
      // eslint-disable-next-line no-await-in-loop -- two immutable presentation controls
      const evidenceHashes = await saveProof(
        input.out,
        id,
        source.svg,
        source.source.nativeSize
      );
      const canonicalArtifactHash = sha256(
        json({ evidenceHashes, id, svgHash: original.svgSha256 })
      );
      const presentationOrder = controlIndex === 0 ? "identical" : "reversed";
      presentationRows.push({
        canonicalArtifactHash,
        evidenceHashes,
        id,
        nativeSize: source.source.nativeSize,
        opticalMasterClaim: false,
        presentationOf: original.canonicalArtifactHash,
        presentationOrder,
        qualified: false,
        recognitionChoices: original.recognitionChoices,
      });
      sealed.push({
        ...original,
        canonicalArtifactHash,
        id,
        presentationOf: original.canonicalArtifactHash,
        presentationOrder,
        presentationSvgSha256: original.svgSha256,
      });
    }
    controls = [
      {
        canonicalOrder: ["S001", "S002"],
        presentationOrder: ["C001", "C002"],
        type: "identical",
      },
      {
        canonicalOrder: ["S001", "S002"],
        presentationOrder: ["C002", "C001"],
        type: "reversed",
      },
    ];
    packets[0].controls = [];
    packets.push({
      controls,
      images: presentationRows,
      independentSourceFamilies: selected.length,
      instrumentQualified: false,
      packetId: "P-presentation-controls",
      scored: false,
    });
  }
  mkdirSync(path.join(input.out, "packets"));
  for (const packet of packets) {
    writeFileSync(
      path.join(input.out, "packets", `${String(packet.packetId)}.json`),
      json(packet),
      { flag: "wx" }
    );
  }
  const manifestBody = {
    controlsOutsideScoredCount: controls.length,
    excludedDevelopmentFamilies: [...excluded].toSorted(),
    independentSourceFamilies: new Set(selected.map(({ family }) => family))
      .size,
    inputs: {
      cohortsSha256: sha256(readFileSync(input.cohortsFile)),
      conceptsSha256: sha256(readFileSync(input.conceptsFile)),
      developmentManifestSha256: sha256(
        readFileSync(input.developmentManifest)
      ),
      generatorSha256: sha256(readFileSync(import.meta.filename)),
      libraryTreeHash: corpusTreeHash(input.library),
      ...(input.exclusionKey
        ? { exclusionKeySha256: sha256(readFileSync(input.exclusionKey)) }
        : {}),
      ...(input.exclusionKeys?.length
        ? {
            exclusionKeySha256s: input.exclusionKeys
              .map((key) => sha256(readFileSync(key)))
              .toSorted(),
          }
        : {}),
    },
    instrumentQualified: false,
    kind: qualification
      ? `ai-control-qualification-${qualificationVersion}`
      : "ai-control-calibration",
    packets: packets.map(({ images, packetId, scored }) => ({
      count: (images as unknown[]).length,
      packetId,
      scored: scored !== false,
    })),
    presentationControls:
      qualificationVersion === "v3" ? sealed.length - blinded.length : 0,
    qualificationEligible:
      qualification &&
      blinded.length === 100 &&
      new Set(selected.map(({ family }) => family)).size === 100 &&
      arranged.filter(({ kind }) => kind === "positive").length === 50 &&
      arranged.filter(({ kind }) => kind === "negative").length === 50 &&
      (qualificationVersion !== "v3" ||
        (sealed.length === 102 &&
          sealed
            .slice(0, 100)
            .every(
              ({ recognitionAnswer, recognitionChoices }) =>
                Array.isArray(recognitionChoices) &&
                recognitionChoices.length >= 3 &&
                recognitionChoices.includes(recognitionAnswer)
            ))),
    qualificationScope: qualification
      ? "objective host-corruption control distribution only"
      : "development calibration only",
    scoredStimuli: blinded.length,
    sourceNegatives: arranged.filter(({ kind }) => kind === "negative").length,
    sourcePositives: arranged.filter(({ kind }) => kind === "positive").length,
    strata: Object.fromEntries(
      ["outlined-16", "outlined-24", "filled-16", "filled-24"].map(
        (stratum) => [
          stratum,
          sealed.filter((row) => {
            if (row.presentationOf) {
              return false;
            }
            const item = row as { finish: string; nativeSize: number };
            return `${item.finish}-${item.nativeSize}` === stratum;
          }).length,
        ]
      )
    ),
  };
  const manifest = { hash: sha256(json(manifestBody)), manifest: manifestBody };
  writeFileSync(path.join(input.out, "manifest.json"), json(manifest), {
    flag: "wx",
  });
  writeFileSync(
    path.join(input.out, "sealed-key.json"),
    json({ controls, stimuli: sealed }),
    { flag: "wx" }
  );
  return { manifest, packet: packets[0], sealed };
};

if (process.argv[1]?.endsWith("ai-control-packet.ts")) {
  const { values } = parseArgs({
    options: {
      cohorts: { type: "string" },
      concepts: { type: "string" },
      development: { type: "string" },
      "exclude-key": { multiple: true, type: "string" },
      library: { type: "string" },
      out: { type: "string" },
      qualification: { type: "boolean" },
      "qualification-v3": { type: "boolean" },
    },
  });
  if (
    !values.cohorts ||
    !values.concepts ||
    !values.development ||
    !values.library ||
    !values.out
  ) {
    throw new Error("Use --library --concepts --cohorts --development --out");
  }
  await generateAiControlPacket({
    cohortsFile: path.resolve(values.cohorts),
    conceptsFile: path.resolve(values.concepts),
    developmentManifest: path.resolve(values.development),
    excludedFamilies: values["exclude-key"]
      ? values["exclude-key"].flatMap((key) =>
          (
            JSON.parse(readFileSync(path.resolve(key), "utf-8")) as {
              stimuli: { family: string }[];
            }
          ).stimuli.map(({ family }) => family)
        )
      : [],
    exclusionKey:
      values["exclude-key"]?.length === 1
        ? path.resolve(values["exclude-key"][0])
        : undefined,
    exclusionKeys: values["exclude-key"]?.map((key) => path.resolve(key)),
    library: path.resolve(values.library),
    out: path.resolve(values.out),
    qualification: values.qualification || values["qualification-v3"],
    qualificationVersion: values["qualification-v3"] ? "v3" : "v2",
  });
}
