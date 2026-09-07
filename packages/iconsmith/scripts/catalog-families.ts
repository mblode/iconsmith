/** Canonical catalog grouping from the house's stated metadata, never name prefixes. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { assignRoles } from "../src/corpus/concepts.js";
import { cohortOf } from "../src/tools/cohort.js";

export const loadCatalogFamilies = (
  library: string,
  set: string,
  names: readonly string[]
) => {
  const directory = path.join(path.dirname(library), "icons-data");
  const cohortFile = path.join(directory, "_cohorts.json");
  const conceptFile = path.join(directory, "_concepts.json");
  if (
    set !== "blode-icons" ||
    !existsSync(cohortFile) ||
    !existsSync(conceptFile)
  ) {
    return {
      identity: null,
      roles: [],
      status: "metadata-unavailable" as const,
    };
  }
  const cohortBytes = readFileSync(cohortFile, "utf-8");
  const conceptBytes = readFileSync(conceptFile, "utf-8");
  const cohorts = z.record(z.array(z.string())).parse(JSON.parse(cohortBytes));
  const { concepts } = z
    .object({ concepts: z.record(z.string()) })
    .parse(JSON.parse(conceptBytes));
  const unique = [...new Set(names)].toSorted();
  const bySlug = new Map<string, string[]>();
  for (const [concept, slug] of Object.entries(concepts)) {
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), concept]);
  }
  const roles = assignRoles(
    unique.map((slug) => ({
      cohort: cohortOf(slug, cohorts),
      concepts: bySlug.get(slug) ?? [],
      set,
      slug,
      tags: [],
    })),
    cohorts
  );
  return {
    identity: createHash("sha256")
      .update(JSON.stringify({ cohortBytes, conceptBytes, names: unique }))
      .digest("hex"),
    roles,
    status: "catalog-metadata" as const,
  };
};
