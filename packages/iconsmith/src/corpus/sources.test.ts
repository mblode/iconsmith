import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { Source } from "./sources.js";
import { availableSources, SOURCES } from "./sources.js";

const ICON = '<svg viewBox="0 0 24 24"><path d="M4 4H20" fill="#000"/></svg>';

const tree = async (files: Record<string, string>): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "forge-sources-"));
  await Promise.all(
    Object.entries(files).map(async ([rel, body]) => {
      await mkdir(path.join(root, path.dirname(rel)), { recursive: true });
      await writeFile(path.join(root, rel), body);
    })
  );
  return root;
};

const listOf = async (id: string, root: string) =>
  await (SOURCES.find((s) => s.id === id) as Source).list(root);

describe("layout adapters resolve the drawn identity", () => {
  test("blode-icons folds -filled into a variant of the same slug", async () => {
    const root = await tree({
      "icons-svg/folder-open-filled.svg": ICON,
      "icons-svg/folder-open.svg": ICON,
    });
    const files = await listOf("blode-icons", root);
    expect(files.map((f) => [f.slug, f.variant])).toEqual([
      ["folder-open", "filled"],
      ["folder-open", "outlined"],
    ]);
  });

  test("Phosphor's weight suffix is stripped, and regular has none", async () => {
    // `assets/bold/acorn-bold.svg` and `assets/regular/acorn.svg` are the same
    // drawing. Left suffixed, `acorn` becomes six identities named after
    // weights.
    const root = await tree({
      "assets/bold/acorn-bold.svg": ICON,
      "assets/regular/acorn.svg": ICON,
    });
    const files = await listOf("phosphor", root);
    expect(files.map((f) => [f.slug, f.variant])).toEqual([
      ["acorn", "bold"],
      ["acorn", "regular"],
    ]);
  });

  test("a variant-major tree keys on the directory name", async () => {
    const root = await tree({
      "filled/banana.svg": ICON,
      "outline/banana.svg": ICON,
    });
    const files = await listOf("tabler", root);
    expect(files.map((f) => f.variant)).toEqual(["filled", "outline"]);
    expect(new Set(files.map((f) => f.slug))).toEqual(new Set(["banana"]));
  });

  test("paths are recorded relative to the root, absolute only for reading", async () => {
    const root = await tree({ "regular/columns.svg": ICON });
    const [file] = await listOf("lucide", root);
    expect(file.rel).toBe(path.join("regular", "columns.svg"));
    expect(path.isAbsolute(file.abs)).toBe(true);
  });
});

describe("the registry states usage rather than inferring it", () => {
  test("only the house set and Central may condition the generator", () => {
    const conditioning = SOURCES.filter((s) => s.usage === "conditioning").map(
      (s) => s.id
    );
    expect(conditioning.toSorted()).toEqual(["blode-icons", "central"]);
  });

  test("every third-party source names a licence and an origin", () => {
    for (const s of SOURCES.filter((x) => x.usage === "analysis-only")) {
      expect(s.licence).not.toBe("");
      expect(s.homepage).not.toBe("");
    }
  });

  test("ids are unique, because a record id is set-qualified", () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });
});

describe("a source that is not on this machine", () => {
  test("is reported as missing rather than failing the walk", async () => {
    const absent: Source = {
      ...(SOURCES[0] as Source),
      id: "nowhere",
      root: path.join(tmpdir(), "forge-no-such-tree"),
    };
    const { missing, present } = await availableSources([absent]);
    expect(present).toHaveLength(0);
    expect(missing.map((s) => s.id)).toEqual(["nowhere"]);
  });
});
