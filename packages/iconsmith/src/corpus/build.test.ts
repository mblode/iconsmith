import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { buildCorpus, checkCorpus, corpusStats } from "./build.js";
import type { IconRecord } from "./record.js";
import type { Source, SourceFile } from "./sources.js";

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none"><path d="${d}" stroke="#000" stroke-width="2"/></svg>`;

const SVG = ".svg";

/** A two-variant tree, so a record has more than one rendering to sort. */
const fixture = async (files: Record<string, string>) => {
  const root = await mkdtemp(path.join(tmpdir(), "forge-build-"));
  await Promise.all(
    Object.entries(files).map(async ([rel, body]) => {
      await mkdir(path.join(root, path.dirname(rel)), { recursive: true });
      await writeFile(path.join(root, rel), body);
    })
  );
  const out = await mkdtemp(path.join(tmpdir(), "forge-store-"));
  const source: Source = {
    canonicalVariant: "outline",
    homepage: "test",
    id: "fixture",
    licence: "MIT",
    licenceFile: null,
    list: async (r: string): Promise<SourceFile[]> => {
      const dirs = await readdir(r);
      const listings = await Promise.all(
        dirs.toSorted().map(async (variant) => {
          const found = await readdir(path.join(r, variant));
          return { found: found.toSorted(), variant };
        })
      );
      return listings.flatMap(({ found, variant }) =>
        found.map((f) => ({
          abs: path.join(r, variant, f),
          rel: path.join(variant, f),
          slug: f.slice(0, -SVG.length),
          variant,
        }))
      );
    },
    root,
    usage: "analysis-only",
    versionFile: null,
  };
  return { out, root, sources: [source] };
};

const readRecords = async (out: string): Promise<IconRecord[]> => {
  const text = await readFile(path.join(out, "icons.jsonl"), "utf-8");
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as IconRecord);
};

describe("one record per drawn identity", () => {
  test("two variants of one slug are one record with two renderings", async () => {
    const { out, sources } = await fixture({
      "filled/star.svg": icon("M4 4H20"),
      "outline/star.svg": icon("M4 4H20V20"),
    });
    await buildCorpus({ out, sources });
    const records = await readRecords(out);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.id).toBe("fixture/star");
    expect(record.renderings.map((r) => r.variant)).toEqual([
      "filled",
      "outline",
    ]);
  });

  test("only the canonical rendering gets fingerprint rows", async () => {
    const { out, sources } = await fixture({
      "filled/star.svg": icon("M4 4H20"),
      "outline/star.svg": icon("M4 4H20V20"),
    });
    const report = await buildCorpus({ out, sources });
    const [record] = await readRecords(out);
    const byVariant = Object.fromEntries(
      record.renderings.map((r) => [r.variant, r.fingerprints])
    );
    expect(byVariant.filled).toBeNull();
    expect(byVariant.outline).toEqual({
      count: 1,
      file: "fingerprints.f32",
      row: 0,
    });
    expect(report.manifest.sidecars["fingerprints.f32"].rows).toBe(1);
  });

  test("records come out sorted by id", async () => {
    const { out, sources } = await fixture({
      "outline/alpha.svg": icon("M4 4H20"),
      "outline/beta.svg": icon("M4 4H20"),
      "outline/gamma.svg": icon("M4 4H20"),
    });
    await buildCorpus({ out, sources });
    const records = await readRecords(out);
    const ids = records.map((r) => r.id);
    expect(ids).toEqual([...ids].toSorted());
  });
});

describe("float vectors go to the sidecar, addressed by row", () => {
  test("the jsonl holds an address, and the sidecar holds dim × rows floats", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M4 4H20V20"),
    });
    const report = await buildCorpus({ out, sources });
    const info = report.manifest.sidecars["fingerprints.f32"];
    const sidecar = await readFile(path.join(out, "fingerprints.f32"));
    expect(sidecar.length).toBe(info.rows * info.dim * 4);

    const records = await readRecords(out);
    const rows = records.map(
      (r) => (r.renderings[0].fingerprints as { row: number }).row
    );
    expect(rows).toEqual([0, 1]);

    const text = await readFile(path.join(out, "icons.jsonl"), "utf-8");
    const [line] = text.split("\n");
    expect(line.length).toBeLessThan(4000);
  });
});

describe("determinism", () => {
  test("two builds of an unchanged tree are byte-identical", async () => {
    const { out, sources } = await fixture({
      "filled/a.svg": icon("M4 4H20"),
      "outline/a.svg": icon("M4.123456 4H19.987654"),
    });
    await buildCorpus({ full: true, out, sources });
    const first = await readFile(path.join(out, "icons.jsonl"));
    const firstFp = await readFile(path.join(out, "fingerprints.f32"));
    await buildCorpus({ full: true, out, sources });
    await expect(readFile(path.join(out, "icons.jsonl"))).resolves.toEqual(
      first
    );
    await expect(readFile(path.join(out, "fingerprints.f32"))).resolves.toEqual(
      firstFp
    );
  });

  test("an incremental build produces the same bytes as a full one", async () => {
    // The copy-forward path has to reproduce the sidecar rows as well as the
    // record, or "incremental" quietly means "different".
    const { out, sources } = await fixture({
      "filled/a.svg": icon("M4 4H20"),
      "outline/a.svg": icon("M4 4H20V20"),
      "outline/b.svg": icon("M2 2L12 8"),
    });
    await buildCorpus({ full: true, out, sources });
    const full = await readFile(path.join(out, "icons.jsonl"));
    const fullFp = await readFile(path.join(out, "fingerprints.f32"));

    const report = await buildCorpus({ out, sources });
    expect(report.manifest.sources[0].reused).toBe(3);
    await expect(readFile(path.join(out, "icons.jsonl"))).resolves.toEqual(
      full
    );
    await expect(readFile(path.join(out, "fingerprints.f32"))).resolves.toEqual(
      fullFp
    );
  });

  test("an edited file is re-measured while its neighbours are not", async () => {
    const { out, root, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M4 4H20"),
    });
    await buildCorpus({ full: true, out, sources });
    await writeFile(path.join(root, "outline/a.svg"), icon("M2 2L12 8"));
    const report = await buildCorpus({ out, sources });
    expect(report.manifest.sources[0].reused).toBe(1);
    const records = await readRecords(out);
    const changed = records.find((r) => r.slug === "a");
    expect(changed?.renderings[0].angles.offAxis).toBe(1);
  });
});

describe("check", () => {
  test("passes on the tree the store was built from", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
    });
    await buildCorpus({ out, sources });
    const report = await checkCorpus({ out, sources });
    expect(report.ok).toBe(true);
  });

  test("fails when a file is edited", async () => {
    const { out, root, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
    });
    await buildCorpus({ out, sources });
    await writeFile(path.join(root, "outline/a.svg"), icon("M4 4H21"));
    const report = await checkCorpus({ out, sources });
    expect(report.ok).toBe(false);
    const [issue] = report.issues;
    expect(issue.kind).toBe("tree-hash");
  });

  test("fails when a file is added, which a per-file check would miss", async () => {
    const { out, root, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
    });
    await buildCorpus({ out, sources });
    await writeFile(path.join(root, "outline/b.svg"), icon("M4 4H20"));
    const report = await checkCorpus({ out, sources });
    expect(report.ok).toBe(false);
  });

  test("fails, rather than throwing, when there is no store", async () => {
    const out = path.join(tmpdir(), "forge-store-absent");
    await rm(out, { force: true, recursive: true });
    const report = await checkCorpus({ out, sources: [] });
    expect(report.ok).toBe(false);
    const [issue] = report.issues;
    expect(issue.kind).toBe("no-store");
  });
});

describe("stats", () => {
  test("counts usage from the records rather than the registry", async () => {
    const { out, sources } = await fixture({
      "filled/a.svg": icon("M4 4H20"),
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M4 4H20"),
    });
    await buildCorpus({ out, sources });
    const stats = await corpusStats({ out });
    expect(stats.records).toBe(2);
    expect(stats.renderings).toBe(3);
    expect(stats.usage["analysis-only"]).toBe(2);
    expect(stats.vectors).toBe(false);
  });
});

describe("one question, one answer", () => {
  test("check fails when a concept names two icons", async () => {
    // `_concepts.json`'s own shape makes this unrepresentable in the file, so
    // the only way it reaches a store is a merge or a hand-edit. That is
    // exactly when the build has to stop: the whole value of the concept table
    // is that "which icon for X?" has one answer.
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M4 4H19"),
    });
    await buildCorpus({ out, sources });
    const store = path.join(out, "icons.jsonl");
    const records = await readRecords(out);
    await writeFile(
      store,
      `${records
        .map((r) => JSON.stringify({ ...r, concepts: ["thing"] }))
        .join("\n")}\n`
    );
    const report = await checkCorpus({ out, sources });
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.kind)).toContain("duplicate-concept");
    expect(report.issues.at(-1)?.detail).toContain("fixture/a");
  });

  test("a store with no house records reports no canonical icons rather than a wrong ratio", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
    });
    await buildCorpus({ out, sources });
    const stats = await corpusStats({ out, sources });
    expect(stats.concepts.canonical).toBe(0);
    expect(stats.concepts.coverage).toBe(1);
  });
});

/** A source that dies after the first one has already been measured and
 *  written out, which is the state the store used to be left in: half the
 *  records, sidecars that no longer match them, and a manifest describing
 *  neither. Sorts after "fixture", which is what puts it second. */
const broken = (like: Source): Source => ({
  ...like,
  id: "zz-broken",
  list: () => Promise.reject(new Error("source went away mid-build")),
});

const STORE = ["icons.jsonl", "fingerprints.f32", "ink.f32", "manifest.json"];

const storeBytes = async (out: string): Promise<Buffer[]> =>
  await Promise.all(STORE.map(async (f) => await readFile(path.join(out, f))));

describe("an interrupted build", () => {
  test("leaves the previous store byte-for-byte intact", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M2 2L12 8"),
    });
    await buildCorpus({ out, sources });
    const before = await storeBytes(out);

    await expect(
      buildCorpus({ out, sources: [...sources, broken(sources[0])] })
    ).rejects.toThrow("went away");

    await expect(storeBytes(out)).resolves.toEqual(before);
    // And nothing half-written left behind to be mistaken for an output, or
    // inherited by the next run.
    const left = await readdir(out);
    expect(left.filter((f) => f.endsWith(".building"))).toEqual([]);
  });

  test("survives a source file that vanishes mid-walk, and names it", async () => {
    // The realistic per-file failure in a walk over 112,947 files: a file the
    // source listed is gone by the time it is read. It must abort loudly — a
    // record silently missing from the store is worse than a failed build —
    // and it must abort without taking the previous store with it.
    const { out, root, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M2 2L12 8"),
    });
    await buildCorpus({ out, sources });
    const before = await storeBytes(out);

    const gone = path.join(root, "outline/b.svg");
    const listed = await sources[0].list(root);
    await rm(gone);
    const stale: Source = {
      ...sources[0],
      list: () => Promise.resolve(listed),
    };

    const failure = await buildCorpus({ out, sources: [stale] }).catch(
      (error: unknown) => error as Error
    );
    expect(failure.message).toContain("b.svg");
    await expect(storeBytes(out)).resolves.toEqual(before);
  });

  test("writes no store at all when there was none to begin with", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
    });
    await expect(
      buildCorpus({ out, sources: [...sources, broken(sources[0])] })
    ).rejects.toThrow("went away");
    await expect(readdir(out)).resolves.toEqual([]);
  });

  test("never publishes a record addressing a sidecar row that did not land", async () => {
    // The property every reader depends on: whatever `icons.jsonl` says, the
    // rows its `{file, row}` addresses are in the sidecar. A store that is
    // half old records and half new sidecar breaks it silently.
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M2 2L12 8"),
    });
    await buildCorpus({ out, sources });
    await expect(
      buildCorpus({ out, sources: [...sources, broken(sources[0])] })
    ).rejects.toThrow();

    const records = await readRecords(out);
    const sidecar = await readFile(path.join(out, "fingerprints.f32"));
    const rows = sidecar.length / 4 / 128;
    const refs = records.flatMap((r) =>
      r.renderings.flatMap((g) => (g.fingerprints ? [g.fingerprints] : []))
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.row + ref.count).toBeLessThanOrEqual(rows);
    }
  });
});

/** Chop the tail off the last record, which is what a build killed mid-write
 *  used to leave behind. */
const truncate = async (out: string): Promise<void> => {
  const store = path.join(out, "icons.jsonl");
  const text = await readFile(store, "utf-8");
  await writeFile(store, text.slice(0, -20));
};

describe("a store left corrupted by an older build", () => {
  test("a truncated final line names the file, the line and the way out", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M2 2L12 8"),
    });
    await buildCorpus({ out, sources });
    await truncate(out);

    const failure = await buildCorpus({ out, sources }).catch(
      (error: unknown) => error as Error & { code?: string }
    );
    expect(failure.code).toBe("CORRUPT_STORE");
    expect(failure.message).toContain("icons.jsonl");
    expect(failure.message).toContain("line 2");
    expect(failure.message).toContain("corpus build --full");
    // Not `SyntaxError: Unexpected end of JSON input`, which names neither the
    // file it came from nor anything to do about it.
    expect(failure.name).not.toBe("SyntaxError");
  });

  test("--full is the way out it advertises", async () => {
    const { out, sources } = await fixture({
      "outline/a.svg": icon("M4 4H20"),
      "outline/b.svg": icon("M2 2L12 8"),
    });
    await buildCorpus({ out, sources });
    await truncate(out);
    const report = await buildCorpus({ full: true, out, sources });
    expect(report.manifest.records).toBe(2);
    await expect(readRecords(out)).resolves.toHaveLength(2);
  });
});
