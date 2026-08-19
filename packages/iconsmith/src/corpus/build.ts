/**
 * The writer: every icon on this machine, measured once, into `.corpus/`.
 *
 * This is the only module in the project that writes the record store, and it
 * is deliberately the only one — `record.ts` is pure so the schema can be
 * tested against a string, `sources.ts` is a table, and everything that touches
 * a disk is here where it can be read in one sitting.
 *
 * ## What comes out
 *
 * ```
 * .corpus/icons.jsonl        one record per drawn identity, sorted by id
 * .corpus/fingerprints.f32   64×2 floats per subpath of each canonical rendering
 * .corpus/ink.f32            48×48 floats per canonical rendering (--vectors)
 * .corpus/manifest.json      schema, sources, tree hashes, sidecar dimensions
 * ```
 *
 * `.corpus/` is derived and gitignored. Nothing in it is a source of truth; it
 * is rebuilt from the trees `sources.ts` names.
 *
 * ## Three properties that had to be designed in, not added later
 *
 * **Float vectors are never inlined.** A fingerprint is 128 floats and an ink
 * vector is 2,304. At 4 decimal places, inlining both would take `icons.jsonl`
 * from ~20 MB to several hundred, and a file you cannot `grep` is a file that
 * needs an index, which is the database this format exists to avoid. Vectors go
 * to fixed-width `.f32` sidecars and the record carries a `{file, row}`.
 *
 * **Determinism.** Sources are walked in id order and records emitted in slug
 * order, so the global sort by `id` falls out of the walk rather than needing
 * the whole store in memory. Keys are sorted at every depth by
 * `stableStringify`, floats are rounded to 4 dp, and no timestamp appears in a
 * record — the build date lives in the manifest. Two builds of an unchanged
 * tree produce byte-identical JSONL, which is the only thing that makes
 * "diffable" a claim rather than a hope.
 *
 * **Incrementality by content.** Every file is hashed on every build; that is
 * the cost of the guarantee, and reading 78 MB is not the slow part. What is
 * skipped on a match is the *measuring*, and its fingerprint rows are copied
 * across from the previous sidecar rather than recomputed.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import type { CohortManifest } from "../tools/cohort.js";
import { cohortOf } from "../tools/cohort.js";
import { inkVector } from "../tools/render.js";
import type { IconRecord, Rendering, VectorRef } from "./record.js";
import {
  buildRecord,
  measureRendering,
  RECORD_SCHEMA_VERSION,
  stableStringify,
} from "./record.js";
import type { Source, SourceFile } from "./sources.js";
import { availableSources, SOURCES } from "./sources.js";

const RECORDS = "icons.jsonl";
const MANIFEST = "manifest.json";
const FINGERPRINTS = "fingerprints.f32";
const INK = "ink.f32";

/** 64 resampled points, x and y. Set by `SAMPLES` in `parts/shape.ts`. */
const FP_DIM = 128;
/** 48×48 greyscale. Set by `SIZE` in `tools/render.ts`. */
const INK_DIM = 2304;

export interface SidecarInfo {
  dim: number;
  rows: number;
}

export interface SourceReport {
  files: number;
  id: string;
  licence: string;
  /** Records whose measurements were copied forward from the previous build. */
  reused: number;
  homepage: string;
  records: number;
  renderings: number;
  root: string;
  /** sha256 over every `rel\0sha256` line, sorted. This is what `check`
   *  recomputes: it changes if a file is added, removed, moved or edited. */
  treeHash: string;
  usage: string;
  version: string | null;
}

export interface Manifest {
  builtAt: string;
  /** Sources named in the registry whose root is not on this machine. */
  missing: string[];
  records: number;
  renderings: number;
  schema: number;
  sidecars: Record<string, SidecarInfo>;
  sources: SourceReport[];
  /** Whether the `--vectors` stage ran. A store built without it has `ink:
   *  null` on every rendering, and that is a stage that has not run rather
   *  than an icon with no ink. */
  vectors: boolean;
}

export interface BuildOptions {
  /** Re-measure everything, ignoring any previous store. */
  full?: boolean;
  /** Files read and measured at once. */
  concurrency?: number;
  out?: string;
  sources?: readonly Source[];
  /** Also render each canonical icon and write its ink vector. Off by default:
   *  `sharp` is ~7 ms per icon against ~0.25 ms for every geometric measure
   *  put together, so it is a stage, not a step. */
  vectors?: boolean;
}

export interface BuildReport {
  manifest: Manifest;
  ms: number;
  out: string;
}

const DEFAULT_CONCURRENCY = 16;

/** Bounded-concurrency map that keeps input order. */
const pool = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const out = Array.from({ length: items.length }) as R[];
  let next = 0;
  const take = () => {
    const i = next;
    next += 1;
    return i;
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (let i = take(); i < items.length; i = take()) {
        // Sequential inside a worker is the point: `limit` workers running
        // concurrently is what bounds the open file handles at 62,550 files.
        // oxlint-disable-next-line no-await-in-loop
        out[i] = await fn(items[i], i);
      }
    })()
  );
  await Promise.all(workers);
  return out;
};

const sha256 = (buf: Buffer | string): string =>
  createHash("sha256").update(buf).digest("hex");

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
};

/**
 * A sidecar under construction: fixed-width Float32 rows, appended in the order
 * records are emitted, so a `{file, row}` is a seek and nothing more.
 */
class Sidecar {
  readonly dim: number;
  /** The basename a `VectorRef` points at, so a record addresses the sidecar by
   *  the name it has inside the store rather than by its path on this machine. */
  readonly name: string;
  private readonly chunks: Buffer[] = [];
  private readonly file: string;
  private handle: FileHandle | null = null;
  private pending = 0;
  rows = 0;

  constructor(dir: string, name: string, dim: number) {
    this.dim = dim;
    this.file = path.join(dir, name);
    this.name = name;
  }

  async append(values: Iterable<number>): Promise<number> {
    const row = this.rows;
    const f32 = new Float32Array(this.dim);
    f32.set([...values].slice(0, this.dim));
    this.chunks.push(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength));
    this.rows += 1;
    this.pending += f32.byteLength;
    // 8 MB of rows between writes: enough that the syscall cost disappears,
    // small enough that a 62,550-file build never holds the sidecar in memory.
    if (this.pending >= 8 * 1024 * 1024) {
      await this.flush();
    }
    return row;
  }

  async flush(): Promise<void> {
    if (this.chunks.length === 0) {
      return;
    }
    this.handle ??= await open(this.file, "w");
    const buf = Buffer.concat(this.chunks.splice(0));
    this.pending = 0;
    await this.handle.write(buf);
  }

  async close(): Promise<SidecarInfo> {
    await this.flush();
    // An empty sidecar is still created, so a reader never has to distinguish
    // "no such file" from "no rows".
    this.handle ??= await open(this.file, "w");
    await this.handle.close();
    return { dim: this.dim, rows: this.rows };
  }
}

/** Read `count` rows from a previous sidecar, for copy-forward. */
const readRows = async (
  handle: FileHandle | null,
  dim: number,
  row: number,
  count: number
): Promise<Float32Array[]> => {
  if (!handle || count === 0) {
    return [];
  }
  const bytes = dim * 4;
  const buf = Buffer.alloc(bytes * count);
  await handle.read(buf, 0, buf.length, row * bytes);
  return Array.from(
    { length: count },
    (_, i) =>
      new Float32Array(
        buf.buffer.slice(
          buf.byteOffset + i * bytes,
          buf.byteOffset + (i + 1) * bytes
        )
      )
  );
};

export interface SourceMetadata {
  category?: string | null;
  cohort?: string | null;
  concepts?: string[];
  tags?: string[];
}

/**
 * blode-icons' own metadata, which is the only set here that has any.
 *
 * Central ships 2,085 slugs that are all already among blode's 2,221, so it
 * adds no concept — it is a finish-variation corpus, and its records carry the
 * geometry and no editorial fields. Giving it blode's categories would assert
 * that Central's editors agreed with blode's, which nobody has checked.
 *
 * Cohorts are the one field that would be wrong to infer here. `cohortOf` falls
 * back to a name prefix, and a prefix is not a swap graph — `play` and `pause`
 * share none and must align. Only blode has a written manifest, so only blode
 * gets a manifest-derived cohort; the rest get the inferred prefix, which is
 * marked as such by there being no manifest in the source.
 */
const blodeMetadata = async (
  root: string
): Promise<(slug: string) => SourceMetadata> => {
  const dir = path.join(root, "icons-data");
  const entries = await readdir(dir);
  const files = entries
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .toSorted();

  const conceptFile = await readJson<{ concepts: Record<string, string> }>(
    path.join(dir, "_concepts.json")
  );
  const concepts = conceptFile?.concepts ?? {};
  const bySlug = new Map<string, string[]>();
  for (const [concept, slug] of Object.entries(concepts)) {
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), concept]);
  }

  const manifest =
    (await readJson<CohortManifest>(path.join(dir, "_cohorts.json"))) ??
    undefined;

  const records = await pool(
    files,
    DEFAULT_CONCURRENCY,
    async (f) =>
      await readJson<{ category?: string; icon: string; tags?: string[] }>(
        path.join(dir, f)
      )
  );
  const byIcon = new Map<string, { category: string | null; tags: string[] }>();
  for (const r of records) {
    if (r) {
      byIcon.set(r.icon, { category: r.category ?? null, tags: r.tags ?? [] });
    }
  }

  // 2,221 icons against 2,224 metadata files, and the gap runs the other way
  // too: the working tree carries icons with no record yet. An icon without one
  // still gets a cohort and an empty tag list rather than being dropped.
  return (slug: string) => {
    const hit = byIcon.get(slug);
    return {
      category: hit?.category ?? null,
      cohort: cohortOf(slug, manifest),
      concepts: bySlug.get(slug) ?? [],
      tags: hit?.tags ?? [],
    };
  };
};

/** Editorial fields for a source, by slug. Only blode-icons has any; every
 *  other set gets the inferred cohort and nothing else. */
const metadataFor = async (
  source: Source,
  root: string
): Promise<(slug: string) => SourceMetadata> =>
  source.id === "blode-icons"
    ? await blodeMetadata(root)
    : (slug: string) => ({ cohort: cohortOf(slug) });

const versionOf = async (
  source: Source,
  root: string
): Promise<string | null> => {
  if (!source.versionFile) {
    return null;
  }
  const pkg = await readJson<{ version?: string }>(
    path.join(root, source.versionFile)
  );
  return pkg?.version ?? null;
};

/** Previous records indexed by id, for copy-forward. */
const previousRecords = async (
  file: string
): Promise<Map<string, IconRecord>> => {
  const out = new Map<string, IconRecord>();
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const rec = JSON.parse(line) as IconRecord;
    if (rec.schema === RECORD_SCHEMA_VERSION) {
      out.set(rec.id, rec);
    }
  }
  return out;
};

interface Stage {
  fingerprints: Sidecar;
  ink: Sidecar;
  prevFp: FileHandle | null;
  prevInk: FileHandle | null;
  previous: Map<string, IconRecord>;
  vectors: boolean;
}

/**
 * Append a run of rows and return the address of the run.
 *
 * Serial by necessity: the row index a caller records is the position the row
 * lands at, so two icons appending concurrently would interleave and every
 * address after the first would be wrong.
 */
const appendRows = async (
  sidecar: Sidecar,
  rows: readonly Iterable<number>[]
): Promise<(VectorRef & { count: number }) | null> => {
  if (rows.length === 0) {
    return null;
  }
  // oxlint-disable-next-line no-await-in-loop -- see above: order is the address
  const row = await sidecar.append(rows[0]);
  for (const values of rows.slice(1)) {
    // oxlint-disable-next-line no-await-in-loop
    await sidecar.append(values);
  }
  return { count: rows.length, file: sidecar.name, row };
};

/** Measure one file, or copy its measurements forward when the bytes match. */
const renderingFor = async (
  file: SourceFile,
  canonical: boolean,
  buf: Buffer,
  prev: Rendering | undefined,
  stage: Stage
): Promise<Rendering> => {
  const hash = sha256(buf);
  const svg = buf.toString("utf-8");

  if (prev?.sha256 === hash) {
    const fpRows = await readRows(
      stage.prevFp,
      FP_DIM,
      prev.fingerprints?.row ?? 0,
      prev.fingerprints?.count ?? 0
    );
    const fingerprints = await appendRows(stage.fingerprints, fpRows);
    // An ink vector is only carried forward when this build also wants one;
    // otherwise `--vectors` off would leave a dangling reference into a
    // sidecar this build is not writing.
    let ink: VectorRef | null = null;
    if (stage.vectors) {
      const rows = prev.ink
        ? await readRows(stage.prevInk, INK_DIM, prev.ink.row, 1)
        : [];
      const vec = rows[0] ?? new Float32Array(await inkVector(svg));
      const row = await stage.ink.append(vec);
      ink = { file: stage.ink.name, row };
    }
    return { ...prev, fingerprints, ink };
  }

  const { fingerprints, rendering } = measureRendering({
    bytes: buf.byteLength,
    canonical,
    path: file.rel,
    sha256: hash,
    svg,
    variant: file.variant,
  });

  rendering.fingerprints = await appendRows(
    stage.fingerprints,
    fingerprints.map((fp) => fp.norm.flat())
  );
  if (stage.vectors && canonical) {
    const vec = await inkVector(svg);
    const row = await stage.ink.append(vec);
    rendering.ink = { file: stage.ink.name, row };
  }
  return rendering;
};

interface SourceResult {
  lines: string[];
  report: SourceReport;
}

const buildSource = async (
  source: Source,
  stage: Stage,
  concurrency: number
): Promise<SourceResult> => {
  const root = path.resolve(source.root);
  const files = await source.list(root);
  const metadata = await metadataFor(source, root);
  const version = await versionOf(source, root);
  const provenance = {
    homepage: source.homepage,
    licence: source.licence,
    set: source.id,
    usage: source.usage,
    version,
  };

  const bySlug = new Map<string, SourceFile[]>();
  for (const f of files) {
    bySlug.set(f.slug, [...(bySlug.get(f.slug) ?? []), f]);
  }
  const slugs = [...bySlug.keys()].toSorted();

  // Hashing is what the whole store's integrity rests on, so every file is read
  // on every build. This is the parallel part; measuring is serial per record
  // because the sidecar rows have to land in a defined order.
  const contents = new Map<string, Buffer>();
  await pool(files, concurrency, async (f) => {
    contents.set(f.rel, await readFile(f.abs));
  });

  const lines: string[] = [];
  const hashLines: string[] = [];
  let renderings = 0;
  let reused = 0;

  for (const slug of slugs) {
    const id = `${source.id}/${slug}`;
    const prev = stage.previous.get(id);
    const prevByPath = new Map(
      (prev?.renderings ?? []).map((r) => [r.path, r])
    );
    const group = (bySlug.get(slug) as SourceFile[]).toSorted((a, b) =>
      a.variant.localeCompare(b.variant)
    );

    const built: Rendering[] = [];
    for (const f of group) {
      const buf = contents.get(f.rel) as Buffer;
      const before = prevByPath.get(f.rel);
      // Serial: `renderingFor` appends sidecar rows, and their order is their
      // address. Reading the files was the parallel half, above.
      // oxlint-disable-next-line no-await-in-loop
      const rendering = await renderingFor(
        f,
        f.variant === source.canonicalVariant,
        buf,
        before,
        stage
      );
      if (before?.sha256 === rendering.sha256) {
        reused += 1;
      }
      built.push(rendering);
      hashLines.push(`${f.rel}\0${rendering.sha256}`);
      renderings += 1;
    }

    const meta = metadata(slug);
    lines.push(
      stableStringify(
        buildRecord({
          category: meta.category ?? null,
          cohort: meta.cohort ?? null,
          concepts: meta.concepts ?? [],
          provenance,
          renderings: built,
          set: source.id,
          slug,
          tags: meta.tags ?? [],
        })
      )
    );
  }

  return {
    lines,
    report: {
      files: files.length,
      homepage: source.homepage,
      id: source.id,
      licence: source.licence,
      records: slugs.length,
      renderings,
      reused,
      root: source.root,
      treeHash: sha256(hashLines.toSorted().join("\n")),
      usage: source.usage,
      version,
    },
  };
};

export const buildCorpus = async ({
  concurrency = DEFAULT_CONCURRENCY,
  full = false,
  out = ".corpus",
  sources = SOURCES,
  vectors = false,
}: BuildOptions = {}): Promise<BuildReport> => {
  const started = performance.now();
  const dir = path.resolve(out);
  await mkdir(dir, { recursive: true });

  const previous = full
    ? new Map<string, IconRecord>()
    : await previousRecords(path.join(dir, RECORDS));

  // The previous sidecars move aside before the new ones claim their names.
  // A rename rather than a copy, so this stays O(1) whatever they weigh — the
  // ink sidecar is 172 MB at full corpus.
  const stash = path.join(dir, ".previous");
  await rm(stash, { force: true, recursive: true });
  let prevFp: FileHandle | null = null;
  let prevInk: FileHandle | null = null;
  if (previous.size > 0) {
    await mkdir(stash, { recursive: true });
    await Promise.all(
      [FINGERPRINTS, INK].map(
        async (name) =>
          await rename(path.join(dir, name), path.join(stash, name)).catch(
            () => null
          )
      )
    );
    prevFp = await open(path.join(stash, FINGERPRINTS), "r").catch(() => null);
    prevInk = await open(path.join(stash, INK), "r").catch(() => null);
  }

  const stage: Stage = {
    fingerprints: new Sidecar(dir, FINGERPRINTS, FP_DIM),
    ink: new Sidecar(dir, INK, INK_DIM),
    prevFp,
    prevInk,
    previous,
    vectors,
  };

  const { missing, present } = await availableSources(sources);
  const ordered = [...present].toSorted((a, b) => a.id.localeCompare(b.id));

  const records = await open(path.join(dir, RECORDS), "w");
  const reports: SourceReport[] = [];
  let total = 0;
  let renderings = 0;
  try {
    for (const source of ordered) {
      // Serial across sources, because both the JSONL line order and the
      // sidecar row order are the store's sort. Inside a source, the file reads
      // run `concurrency` at a time.
      // oxlint-disable-next-line no-await-in-loop
      const result = await buildSource(source, stage, concurrency);
      // oxlint-disable-next-line no-await-in-loop
      await records.write(`${result.lines.join("\n")}\n`);
      reports.push(result.report);
      total += result.report.records;
      renderings += result.report.renderings;
    }
  } finally {
    await records.close();
    await prevFp?.close();
    await prevInk?.close();
  }

  const manifest: Manifest = {
    builtAt: new Date().toISOString(),
    missing: missing.map((s) => s.id),
    records: total,
    renderings,
    schema: RECORD_SCHEMA_VERSION,
    sidecars: {
      [FINGERPRINTS]: await stage.fingerprints.close(),
      [INK]: await stage.ink.close(),
    },
    sources: reports,
    vectors,
  };
  await writeFile(
    path.join(dir, MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await rm(stash, { force: true, recursive: true });

  return { manifest, ms: Math.round(performance.now() - started), out: dir };
};

export interface CheckIssue {
  detail: string;
  kind: "missing-source" | "no-store" | "schema" | "tree-hash";
  source: string | null;
}

export interface CheckReport {
  issues: CheckIssue[];
  ok: boolean;
  sources: { id: string; ok: boolean; treeHash: string }[];
}

/**
 * Re-walk every source and recompute its tree hash.
 *
 * This is the whole check: a hash over `rel\0sha256` for every file, which
 * moves if anything was added, removed, renamed or edited. It costs a full read
 * of ~78 MB, which is the price of the store meaning what it says.
 */
export const checkCorpus = async ({
  concurrency = DEFAULT_CONCURRENCY,
  out = ".corpus",
  sources = SOURCES,
}: Omit<BuildOptions, "full" | "vectors"> = {}): Promise<CheckReport> => {
  const dir = path.resolve(out);
  const manifest = await readJson<Manifest>(path.join(dir, MANIFEST));
  if (!manifest) {
    return {
      issues: [
        {
          detail: `No manifest at ${path.join(dir, MANIFEST)}. Run \`iconsmith corpus build\` first.`,
          kind: "no-store",
          source: null,
        },
      ],
      ok: false,
      sources: [],
    };
  }
  if (manifest.schema !== RECORD_SCHEMA_VERSION) {
    return {
      issues: [
        {
          detail: `Store is schema ${manifest.schema}; this build speaks ${RECORD_SCHEMA_VERSION}. Rebuild.`,
          kind: "schema",
          source: null,
        },
      ],
      ok: false,
      sources: [],
    };
  }

  const byId = new Map(sources.map((s) => [s.id, s]));
  const issues: CheckIssue[] = [];
  const results: { id: string; ok: boolean; treeHash: string }[] = [];

  for (const recorded of manifest.sources) {
    // One source tree at a time; `pool` parallelises the reads within each.
    const source = byId.get(recorded.id);
    if (!source) {
      issues.push({
        detail: `Manifest names "${recorded.id}", which the registry no longer has.`,
        kind: "missing-source",
        source: recorded.id,
      });
      continue;
    }
    const root = path.resolve(source.root);
    let files: SourceFile[];
    try {
      // oxlint-disable-next-line no-await-in-loop
      files = await source.list(root);
    } catch {
      issues.push({
        detail: `Source root ${root} is gone.`,
        kind: "missing-source",
        source: source.id,
      });
      results.push({ id: source.id, ok: false, treeHash: "" });
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop
    const hashes = await pool(
      files,
      concurrency,
      async (f) => `${f.rel}\0${sha256(await readFile(f.abs))}`
    );
    const treeHash = sha256(hashes.toSorted().join("\n"));
    const ok = treeHash === recorded.treeHash;
    if (!ok) {
      issues.push({
        detail: `"${source.id}" has changed since the store was built (${files.length} files now, ${recorded.files} then). Rebuild.`,
        kind: "tree-hash",
        source: source.id,
      });
    }
    results.push({ id: source.id, ok, treeHash });
  }

  return { issues, ok: issues.length === 0, sources: results };
};

export interface StatsReport {
  builtAt: string;
  bySet: {
    conformance: Record<string, number>;
    id: string;
    licence: string;
    /** Share of stroked edges more than the canvas tolerance off an axis,
     *  weighted by edge count across the set's canonical renderings. Null for
     *  a set with no stroked edges at all — Phosphor, Radix and Remix draw
     *  filled outlines, and reporting them as 0.0% would read as "perfectly
     *  axial" when it means "the rule does not apply". */
    offAxisShare: number | null;
    records: number;
    renderings: number;
    usage: string;
    withConcept: number;
  }[];
  records: number;
  renderings: number;
  /** Records the generator may learn from, and records it may not. */
  usage: Record<string, number>;
  vectors: boolean;
}

/** Read the store back and summarise it. Streams nothing: reading a 20 MB
 *  JSONL is cheaper than the machinery to avoid reading it. */
export const corpusStats = async ({
  out = ".corpus",
}: { out?: string } = {}): Promise<StatsReport> => {
  const dir = path.resolve(out);
  const manifest = await readJson<Manifest>(path.join(dir, MANIFEST));
  if (!manifest) {
    throw Object.assign(
      new Error(
        `No corpus store at ${dir}. Run \`iconsmith corpus build\` first.`
      ),
      { code: "NO_STORE" }
    );
  }
  const text = await readFile(path.join(dir, RECORDS), "utf-8");

  const sets = new Map<string, StatsReport["bySet"][number]>();
  const usage: Record<string, number> = {};
  const edges = new Map<string, { off: number; total: number }>();
  let records = 0;
  let renderings = 0;

  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const rec = JSON.parse(line) as IconRecord;
    records += 1;
    renderings += rec.renderings.length;
    usage[rec.provenance.usage] = (usage[rec.provenance.usage] ?? 0) + 1;

    let set = sets.get(rec.set);
    if (!set) {
      set = {
        conformance: {},
        id: rec.set,
        licence: rec.provenance.licence,
        offAxisShare: null,
        records: 0,
        renderings: 0,
        usage: rec.provenance.usage,
        withConcept: 0,
      };
      sets.set(rec.set, set);
      edges.set(rec.set, { off: 0, total: 0 });
    }
    set.records += 1;
    set.renderings += rec.renderings.length;
    if (rec.concepts.length > 0) {
      set.withConcept += 1;
    }
    // The canonical rendering stands for the identity; averaging conformance
    // over 30 finishes of one drawing would weight Central 30× and say more
    // about how many strokes it ships than about how it draws.
    const canonical = rec.renderings.find((r) => r.fingerprints !== null);
    if (canonical) {
      const c = canonical.keyline.conformance;
      set.conformance[c] = (set.conformance[c] ?? 0) + 1;
      const e = edges.get(rec.set) as { off: number; total: number };
      e.off += canonical.angles.offAxis;
      e.total += canonical.angles.edges;
    }
  }

  for (const [id, e] of edges) {
    const set = sets.get(id) as StatsReport["bySet"][number];
    set.offAxisShare =
      e.total === 0 ? null : Math.round((e.off / e.total) * 1e4) / 1e4;
  }

  return {
    builtAt: manifest.builtAt,
    bySet: [...sets.values()].toSorted((a, b) => a.id.localeCompare(b.id)),
    records,
    renderings,
    usage,
    vectors: manifest.vectors,
  };
};
