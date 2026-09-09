import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
  STYLE_COMPILER,
  styleHash,
} from "../src/pipeline/style.js";
import type { StyleArtifact } from "../src/pipeline/style.js";
import { createFamilySourceExactResolver } from "./family-parts.js";
import type { FamilySource } from "./family-parts.js";

const sha256 = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

const provenance = z
  .object({
    date: z.string().min(1),
    icon: z.string().optional(),
    licenses: z.array(z.string()).optional(),
    origin: z.enum(["central", "derived", "literal", "original"]),
    set: z.string().optional(),
    version: z.string().optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    compiler: z.literal(STYLE_COMPILER),
    finish: z.enum(["outlined", "filled"]),
    master: z.string().min(1),
    representation: z.literal("indexed"),
    requestSha256: hash,
    revisionPath: z.string().min(1),
    revisionSha256: hash,
    schema: z.literal("iconsmith-source-exact-host-v1"),
    sourceName: z.string().min(1),
    sourcePath: z.string().min(1),
    sourceProvenance: provenance,
    sourceSha256: hash,
  })
  .strict();

const artifactSchema = z
  .object({
    compiler: z.string().min(1),
    finish: z.enum(["outlined", "filled"]),
    master: z.string().min(1),
    program: z.string().min(1),
    sourceExactRegistryHash: hash,
    style: hash,
    svg: z.string().min(1),
    svgHash: hash,
  })
  .strict();

const bundleSchema = z
  .object({
    artifact: artifactSchema,
    manifestPath: z.string().min(1),
    manifestSha256: hash,
    requestSha256: hash,
    revision: z.unknown(),
    revisionHash: hash,
    schema: z.literal("iconsmith-source-exact-bundle-v1"),
  })
  .strict();

/** Pins exact bytes at a caller-frozen reconstruction boundary. The terminal
 * entry must be a regular non-symlink file. This does not establish exclusive
 * ownership, reject symlinked parent directories or hard links, or make an
 * unfrozen directory race-free; the host must freeze that outer boundary. */
const pinnedText = (file: string, expected: string, what: string): string => {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${what} must be a regular non-symlink file`);
  }
  const bytes = readFileSync(file);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${what} sha256 mismatch`);
  }
  return bytes.toString("utf-8");
};

const manifestFile = (file: string): string => path.resolve(file);
const relativeToManifest = (manifest: string, file: string): string =>
  path.resolve(path.dirname(manifest), file);

export interface SourceExactHostContext {
  readonly bindingId: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly master: string;
  readonly requestSha256: string;
  readonly resolver: Awaited<
    ReturnType<typeof createFamilySourceExactResolver>
  >;
}

/** Rebuilds process-local source authority exclusively from a caller-frozen,
 * content-addressed host manifest, then repeats normal source admission. */
export const loadSourceExactHostContext = async (
  file: string,
  expectedManifestSha256: string
): Promise<SourceExactHostContext> => {
  if (!hash.safeParse(expectedManifestSha256).success) {
    throw new Error("host manifest sha256 is malformed");
  }
  const absoluteManifest = manifestFile(file);
  const manifestText = pinnedText(
    absoluteManifest,
    expectedManifestSha256,
    "host manifest"
  );
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  const sourceSvg = pinnedText(
    relativeToManifest(absoluteManifest, manifest.sourcePath),
    manifest.sourceSha256,
    "source SVG"
  );
  const revisionText = pinnedText(
    relativeToManifest(absoluteManifest, manifest.revisionPath),
    manifest.revisionSha256,
    "base revision"
  );
  const revision = createStyleRevision(JSON.parse(revisionText));
  const source: FamilySource = {
    finish: manifest.finish,
    name: manifest.sourceName,
    provenance: manifest.sourceProvenance,
    svg: sourceSvg,
  };
  const resolver = await createFamilySourceExactResolver({
    hostManifestPath: absoluteManifest,
    hostManifestSha256: expectedManifestSha256,
    master: manifest.master,
    representation: manifest.representation,
    requestSha256: manifest.requestSha256,
    revision,
    source,
  });
  return Object.freeze({
    bindingId: resolver.bindingId,
    manifestPath: absoluteManifest,
    manifestSha256: expectedManifestSha256,
    master: manifest.master,
    requestSha256: manifest.requestSha256,
    resolver,
  });
};

export const compileSourceExactBundle = async (input: {
  expectedManifestSha256: string;
  manifestPath: string;
  program: string;
}): Promise<z.infer<typeof bundleSchema>> => {
  const context = await loadSourceExactHostContext(
    input.manifestPath,
    input.expectedManifestSha256
  );
  const selection = selectStyle(context.resolver.revision, context.master);
  const artifact = artifactSchema.parse(
    compileStyle(selection, input.program, { sourceExact: context.resolver })
  );
  return Object.freeze({
    artifact,
    manifestPath: context.manifestPath,
    manifestSha256: context.manifestSha256,
    requestSha256: context.requestSha256,
    revision: context.resolver.revision.definition,
    revisionHash: context.resolver.revision.hash,
    schema: "iconsmith-source-exact-bundle-v1" as const,
  });
};

export const replaySourceExactBundle = async (input: {
  bundle: unknown;
  expectedManifestSha256: string;
  manifestPath: string;
}): Promise<string> => {
  const bundle = bundleSchema.parse(input.bundle);
  const context = await loadSourceExactHostContext(
    input.manifestPath,
    input.expectedManifestSha256
  );
  if (
    bundle.manifestPath !== context.manifestPath ||
    bundle.manifestSha256 !== context.manifestSha256 ||
    bundle.requestSha256 !== context.requestSha256 ||
    bundle.revisionHash !== context.resolver.revision.hash ||
    styleHash(bundle.revision) !== context.resolver.revision.hash
  ) {
    throw new Error("source-exact bundle identity differs from host authority");
  }
  return replayStyle(
    selectStyle(context.resolver.revision, context.master),
    bundle.artifact as StyleArtifact,
    { sourceExact: context.resolver }
  );
};

export const writeNewSourceExactFile = (file: string, body: string): void =>
  writeFileSync(file, body, { encoding: "utf-8", flag: "wx" });
