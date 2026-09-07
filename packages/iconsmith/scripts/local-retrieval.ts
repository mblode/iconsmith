/** Host-owned library discovery, visual selection, and source admission. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadAliases } from "../src/corpus/aliases.js";
import { asReference } from "../src/pipeline/licence.js";
import { createStyleRevision, selectStyle } from "../src/pipeline/style.js";
import type { StyleRevision } from "../src/pipeline/style.js";
import { opticalProof } from "../src/tools/proof.js";
import { sheet } from "../src/tools/render.js";
import { admitFamilyParts } from "./family-parts.js";
import type { FamilySource } from "./family-parts.js";
import { reviewImages } from "./local-review.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

export const libraryCandidates = (
  sources: readonly FamilySource[],
  concept: string,
  aliases: ReadonlyMap<string, readonly string[]>,
  exclusions: readonly string[] = []
) => {
  const blocked = new Set([concept, ...exclusions].map(normalize));
  const matches = (source: FamilySource) =>
    [source.name, ...(aliases.get(source.name) ?? [])].some((term) =>
      blocked.has(normalize(term))
    );
  const blockedHashes = new Set(
    sources.filter(matches).map((source) => hash(source.svg))
  );
  return sources.filter(
    (source) => !matches(source) && !blockedHashes.has(hash(source.svg))
  );
};

export const retrieveLocalStyle = async (options: {
  revision: StyleRevision;
  master: string;
  concept: string;
  library: string;
  set: string;
  out: string;
  deadlineAt?: number;
  exclusions?: readonly string[];
  review?: typeof reviewImages;
}) => {
  const assertTime = () => {
    if (Date.now() >= (options.deadlineAt ?? Infinity)) {
      throw new Error("Run deadline exhausted during retrieval");
    }
  };
  assertTime();
  const { revision, master, concept, out } = options;
  const style = selectStyle(revision, master);
  // Validate policy before either model sees library names or pixels.
  const provenance = {
    date: new Date().toISOString(),
    origin: "literal" as const,
    set: options.set,
  };
  asReference({ name: "library-policy-check", svg: "<svg/>" }, provenance);
  mkdirSync(out, { recursive: false });
  const save = (name: string, value: unknown) =>
    writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
  const sources: FamilySource[] = readdirSync(options.library)
    .filter((file) => /^[a-z][a-z0-9-]*\.svg$/u.test(file))
    .toSorted()
    .map((file) => ({
      finish: file.endsWith("-filled.svg") ? "filled" : "outlined",
      name: file.replace(/(?:-filled)?\.svg$/u, ""),
      provenance: { ...provenance, icon: file },
      svg: readFileSync(path.join(options.library, file), "utf-8"),
    }));
  if (!sources.length) {
    throw new Error("Retrieval library contains no supported SVG filenames");
  }
  const { aliases, from } = await loadAliases();
  const candidates = libraryCandidates(
    sources,
    concept,
    aliases,
    options.exclusions
  );
  const excludedHashes = new Set(
    sources
      .filter((source) => !candidates.includes(source))
      .map((source) => hash(source.svg))
  );
  const anchors = style.references.filter(
    (reference) =>
      !excludedHashes.has(hash(reference.svg)) &&
      ![concept, ...(options.exclusions ?? [])]
        .map(normalize)
        .includes(
          normalize(reference.name.replace(/-(?:outlined|filled)$/u, ""))
        )
  );
  const names = [...new Set(candidates.map((source) => source.name))];
  if (!names.length) {
    throw new Error("No library candidates remain after exclusions");
  }
  save("inventory.json", {
    aliasSources: from,
    candidateCount: candidates.length,
    concept,
    exclusions: options.exclusions ?? [],
    names,
    sourceCount: sources.length,
    sourceHash: hash(
      JSON.stringify(
        sources.map(({ name, finish, svg }) => ({ finish, name, svg }))
      )
    ),
  });
  if (!anchors.length) {
    throw new Error(
      "Automatic retrieval needs pinned style references as its visual style anchor"
    );
  }
  const review = options.review ?? reviewImages;
  const roles = ["body", "modifier", "construction"];
  assertTime();
  const discovery = await review({
    deadlineAt: options.deadlineAt,
    images: {
      "style.png": await sheet(
        anchors.map((r) => r.svg),
        { cols: 4, size: 64 }
      ),
    },
    out: path.join(out, "discovery"),
    questions: roles.map((role) => ({
      choices: [...names, "none"],
      compactChoices: true,
      id: role,
      prompt: `Retrieve a useful ${role} family for a NEW ${concept} icon. The images establish the target style only. Choose a library NAME by semantic relation, component utility or analogous construction. Its appearance is not yet verified. Prefer a different useful family for each role; none is valid. Do not infer unseen geometry.`,
    })),
  });
  assertTime();
  const discoveryAnswers = discovery.answers;
  if (!discoveryAnswers) {
    throw new Error("Semantic retrieval failed; inspect discovery receipt");
  }
  const selectedNames = new Set(
    roles
      .map((role) => discoveryAnswers[role].choice)
      .filter((name) => name !== "none")
  );
  const shortlisted = candidates.filter((source) =>
    selectedNames.has(source.name)
  );
  if (!shortlisted.length) {
    throw new Error("Semantic retrieval found no useful families");
  }
  const images = Object.fromEntries(
    await Promise.all(
      shortlisted.map(async (source, index) => {
        const proof = await opticalProof(source.svg, style.spec.size);
        return [`candidate-${index}.png`, proof.proof];
      })
    )
  );
  assertTime();
  const visual = await review({
    deadlineAt: options.deadlineAt,
    images: {
      ...images,
      "style.png": await sheet(
        anchors.map((r) => r.svg),
        { cols: 4, size: 64 }
      ),
    },
    out: path.join(out, "selection"),
    questions: shortlisted.map((source, index) => ({
      choices: ["reference-and-parts", "reference-only", "reject"],
      id: `candidate-${index}`,
      prompt: `Inspect the native ${style.spec.size}px light/dark proof and enlarged context in candidate-${index}.png (${source.name}, ${source.finish}) against style.png for creating ${concept}. Choose reference-and-parts if visible components could help, reference-only if useful for visual grammar alone, otherwise reject. Identify the useful contour or construction and its intended role; similarity of names alone is insufficient. Host fidelity checks will separately decide component admission.`,
    })),
  });
  assertTime();
  const visualAnswers = visual.answers;
  if (!visualAnswers) {
    throw new Error("Visual retrieval failed; inspect selection receipt");
  }
  // Retrieved dependencies replace this master's manually selected packet.
  let result = createStyleRevision({
    ...revision.definition,
    parts: revision.definition.parts.filter((p) => p.master !== master),
    references: revision.definition.references.filter(
      (r) => r.master !== master
    ),
  });
  const rows = [];
  for (const [index, source] of shortlisted.entries()) {
    const decision = visualAnswers[`candidate-${index}`];
    let admission = "not-requested";
    if (decision.choice !== "reject") {
      result = createStyleRevision({
        ...result.definition,
        references: [
          ...result.definition.references,
          {
            master,
            name: `${source.name}-${source.finish}`,
            provenance: source.provenance,
            svg: source.svg,
          },
        ],
      });
      if (decision.choice === "reference-and-parts") {
        try {
          // eslint-disable-next-line no-await-in-loop
          result = await admitFamilyParts(result, master, [source]);
          admission = "admitted";
        } catch (error) {
          admission = String(error);
        }
      }
    }
    rows.push({
      ...decision,
      admission,
      finish: source.finish,
      name: source.name,
      sha256: hash(source.svg),
    });
  }
  save("selection.json", {
    concept,
    qualification:
      "development; exclusions do not prove semantic holdout isolation",
    revisionHash: result.hash,
    rows,
    status: result.definition.references.some((r) => r.master === master)
      ? "selected"
      : "empty",
  });
  if (!result.definition.references.some((r) => r.master === master)) {
    throw new Error("Visual retrieval rejected every candidate");
  }
  writeFileSync(
    path.join(out, "selected.png"),
    await sheet(
      selectStyle(result, master).references.map((r) => r.svg),
      { cols: 4, size: 96 }
    )
  );
  assertTime();
  save("revision.json", result.definition);
  return result;
};
