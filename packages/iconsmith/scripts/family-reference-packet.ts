/** Immutable family-level source choice, applied independently to each master. */
import { createHash } from "node:crypto";

import { z } from "zod";

import type { RoleAssignment } from "../src/corpus/concepts.js";
import { createStyleRevision, styleHash } from "../src/pipeline/style.js";
import type { StyleRevision } from "../src/pipeline/style.js";
import {
  describeFamilyMorphology,
  FAMILY_CLASSES,
} from "./family-morphology.js";
import { admitFamilyParts } from "./family-parts.js";
import type { FamilySource } from "./family-parts.js";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const provenanceSchema = z
  .object({
    date: z.string().min(1),
    icon: z.string().optional(),
    licenses: z.array(z.string()).optional(),
    origin: z.enum(["central", "derived", "literal", "original"]),
    set: z.string().optional(),
    version: z.string().optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    admissionRequested: z.boolean(),
    finish: z.enum(["outlined", "filled"]),
    intent: z
      .object({
        evidence: z.string(),
        polarity: z.enum(["body", "modifier", "construction"]),
        treatment: z.string(),
      })
      .strict(),
    name: z.string().regex(/^[a-z][a-z0-9-]*$/u),
    provenance: provenanceSchema,
    sha256: z.string().length(64),
    svg: z.string().min(1),
  })
  .strict();
const packetSchema = z
  .object({
    aliases: z.array(z.string()),
    concept: z.string().min(1),
    excludedFamilies: z.array(z.string()),
    excludedSourceHashes: z.array(z.string().length(64)),
    librarySet: z.string().min(1),
    librarySourceHash: z.string().length(64),
    morphology: z
      .object({
        family: z
          .object({
            head: z.string(),
            key: z.string(),
            role: z.enum([
              "canonical",
              "direction",
              "filled",
              "state",
              "variant",
              "unknown",
            ]),
            source: z.enum(["catalog", "numbered", "unknown"]),
          })
          .strict(),
        familyClass: z.enum(FAMILY_CLASSES),
        guidance: z
          .object({
            "16": z.array(z.string().min(1)),
            "24": z.array(z.string().min(1)),
          })
          .strict(),
        sources: z.array(
          z
            .object({
              closedContours: z.number().int().nonnegative(),
              finish: z.enum(["outlined", "filled"]),
              name: z.string(),
              openContours: z.number().int().nonnegative(),
              paintedAspect: z.enum(["landscape", "portrait", "square"]),
              paintedShapes: z.number().int().nonnegative(),
              roundCaps: z.boolean(),
              squareCaps: z.boolean(),
            })
            .strict()
        ),
        warnings: z.array(z.string()),
      })
      .strict(),
    packetHash: z.string().length(64),
    qualification: z.literal(
      "development; exclusions do not prove semantic holdout isolation"
    ),
    sources: z.array(sourceSchema).min(1),
    version: z.literal(2),
  })
  .strict();

export type FamilyReferencePacket = z.infer<typeof packetSchema>;
export type FamilyReferenceIntent =
  FamilyReferencePacket["sources"][number]["intent"];

const packetIdentity = (packet: Omit<FamilyReferencePacket, "packetHash">) =>
  styleHash(packet);

export const parseFamilyReferencePacket = (
  value: unknown
): FamilyReferencePacket => {
  const packet = packetSchema.parse(value);
  const { packetHash, ...body } = packet;
  if (packetIdentity(body) !== packetHash) {
    throw new Error("Family reference packet hash mismatch");
  }
  for (const source of packet.sources) {
    if (sha256(source.svg) !== source.sha256) {
      throw new Error(`Family reference source hash mismatch: ${source.name}`);
    }
    if (packet.excludedSourceHashes.includes(source.sha256)) {
      throw new Error(
        `Excluded source leaked into family packet: ${source.name}`
      );
    }
  }
  return packet;
};

export const createFamilyReferencePacket = (input: {
  aliases?: readonly string[];
  catalogRoles?: readonly RoleAssignment[];
  concept: string;
  excludedFamilies: readonly string[];
  excludedSourceHashes: readonly string[];
  librarySet: string;
  librarySourceHash: string;
  sources: readonly {
    admissionRequested: boolean;
    intent: FamilyReferenceIntent;
    source: FamilySource;
  }[];
}): FamilyReferencePacket => {
  const body = {
    aliases: [...(input.aliases ?? [])],
    concept: input.concept,
    excludedFamilies: [...input.excludedFamilies],
    excludedSourceHashes: [...input.excludedSourceHashes].toSorted(),
    librarySet: input.librarySet,
    librarySourceHash: input.librarySourceHash,
    morphology: describeFamilyMorphology({
      aliases: input.aliases,
      catalogRoles: input.catalogRoles,
      concept: input.concept,
      sources: input.sources.map(({ source }) => source),
    }),
    qualification:
      "development; exclusions do not prove semantic holdout isolation" as const,
    sources: input.sources.map(({ admissionRequested, intent, source }) => ({
      admissionRequested,
      finish: source.finish,
      intent,
      name: source.name,
      provenance: source.provenance,
      sha256: sha256(source.svg),
      svg: source.svg,
    })),
    version: 2 as const,
  };
  return parseFamilyReferencePacket({
    ...body,
    packetHash: packetIdentity(body),
  });
};

export const verifyFamilyPacketInventory = (
  packet: FamilyReferencePacket,
  sources: readonly FamilySource[],
  librarySourceHash: string,
  librarySet: string,
  currentExcludedFamilies: readonly string[],
  currentExcludedSourceHashes: ReadonlySet<string>,
  catalogRoles: readonly RoleAssignment[] = [],
  currentAliases: readonly string[] = []
) => {
  if (
    packet.librarySet !== librarySet ||
    packet.librarySourceHash !== librarySourceHash
  ) {
    throw new Error("Family reference packet library identity mismatch");
  }
  if (
    styleHash(packet.excludedFamilies.toSorted()) !==
    styleHash([...currentExcludedFamilies].toSorted())
  ) {
    throw new Error("Family reference packet exclusion identity mismatch");
  }
  const inventory = new Map(
    sources.map((source) => [`${source.name}:${source.finish}`, source])
  );
  for (const source of packet.sources) {
    if (currentExcludedSourceHashes.has(source.sha256)) {
      throw new Error(
        `Currently excluded donor leaked into packet: ${source.name}`
      );
    }
    const current = inventory.get(`${source.name}:${source.finish}`);
    if (!current || sha256(current.svg) !== source.sha256) {
      throw new Error(`Family reference source switched: ${source.name}`);
    }
    if (
      current.provenance.set !== source.provenance.set ||
      current.provenance.icon !== source.provenance.icon ||
      current.provenance.origin !== source.provenance.origin
    ) {
      throw new Error(`Family reference provenance mismatch: ${source.name}`);
    }
  }
  const described = describeFamilyMorphology({
    aliases: currentAliases,
    catalogRoles,
    concept: packet.concept,
    sources: packet.sources.map(
      (source) =>
        inventory.get(`${source.name}:${source.finish}`) as FamilySource
    ),
  });
  if (
    styleHash([...currentAliases]) !== styleHash(packet.aliases) ||
    styleHash(described) !== styleHash(packet.morphology)
  ) {
    throw new Error("Family reference packet morphology mismatch");
  }
};

export const applyFamilyReferencePacket = async (
  revision: StyleRevision,
  master: string,
  packetValue: unknown
) => {
  const packet = parseFamilyReferencePacket(packetValue);
  if (!Object.hasOwn(revision.definition.masters, master)) {
    throw new Error(`Unavailable style master: ${master}`);
  }
  const masterSpecHash = styleHash(revision.definition.masters[master]);
  const applicationHash = styleHash({
    master,
    masterSpecHash,
    packetHash: packet.packetHash,
    sourceHashes: packet.sources.map((source) => source.sha256),
  });
  let result = createStyleRevision({
    ...revision.definition,
    parts: revision.definition.parts.filter((entry) => entry.master !== master),
    references: revision.definition.references.filter(
      (entry) => entry.master !== master
    ),
  });
  const admissions = [];
  for (const selected of packet.sources) {
    const source: FamilySource = {
      finish: selected.finish,
      name: selected.name,
      provenance: selected.provenance,
      svg: selected.svg,
    };
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
    let admission = "not-requested";
    if (selected.admissionRequested) {
      try {
        // Admission is deliberately repeated under the target master spec.
        // eslint-disable-next-line no-await-in-loop
        result = await admitFamilyParts(result, master, [source]);
        admission = "admitted";
      } catch (error) {
        admission = String(error);
      }
    }
    admissions.push({
      admission,
      familyClass: packet.morphology.familyClass,
      finish: source.finish,
      guidance: packet.morphology.guidance[master === "16" ? "16" : "24"],
      intent: selected.intent,
      name: source.name,
      sha256: selected.sha256,
    });
  }
  return {
    admissions,
    applicationHash,
    masterSpecHash,
    packet,
    revision: result,
  };
};
