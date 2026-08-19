/**
 * The baselines loader, against a fixture rather than the real packs: they live
 * in another repository and a test that only runs on one machine is a test that
 * does not run.
 *
 * The shape assertions here are the runtime shadow of `src/licence.test-d.ts`.
 * That file is what actually stops a baseline reaching a prompt; these say why
 * it works, so a rename that breaks it fails with an explanation attached.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { BASELINE_PACKS, loadBaselines } from "./baselines.js";

const root = await mkdtemp(path.join(tmpdir(), "baselines-"));
await writeFile(path.join(root, "PHOSPHOR-LICENSE"), "MIT License\n");
// Phosphor's licence sits a level above the directory being walked, so the
// fixture writes it once at the root and skips it per pack rather than writing
// one the loader would never find.
await Promise.all(
  BASELINE_PACKS.map(async (pack) => {
    const style = path.join(root, pack.dir, "regular");
    await mkdir(style, { recursive: true });
    await Promise.all([
      writeFile(path.join(style, `${pack.name}-mark.svg`), "<svg/>"),
      pack.name === "phosphor"
        ? Promise.resolve()
        : writeFile(path.join(root, pack.licenceFile), "a licence\n"),
    ]);
  })
);
// A second style directory and a non-SVG file, both of which the real packs
// have: heroicons ships four styles, and every pack ships its LICENSE inside
// the directory being walked.
await mkdir(path.join(root, "packs/tabler/filled"), { recursive: true });
await writeFile(
  path.join(root, "packs/tabler/filled/tabler-mark.svg"),
  "<svg/>"
);
await writeFile(path.join(root, "packs/tabler/outline.txt"), "not an icon");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(root, { force: true, recursive: true });
});

describe("loadBaselines", () => {
  it("indexes every pack without opening an icon", async () => {
    const baselines = await loadBaselines(root);
    expect(baselines.packs).toHaveLength(7);
    // Seven marks plus tabler's second style; the stray .txt is not an icon.
    expect(baselines.entries).toHaveLength(8);
    expect(baselines.entries.every((e) => "source" in e)).toBe(false);
  });

  it("finds phosphor, whose drawings sit outside packs/", async () => {
    const baselines = await loadBaselines(root);
    const phosphor = baselines.entries.find((e) => e.pack === "phosphor");
    expect(phosphor).toEqual({
      icon: "phosphor-mark",
      pack: "phosphor",
      style: "regular",
    });
  });

  it("carries the licence and its file on the loaded icon", async () => {
    const baselines = await loadBaselines(root);
    const entry = baselines.entries.find((e) => e.pack === "lucide");
    const icon = await baselines.load(entry as never);
    // Lucide is ISC, not MIT — the reason the licence travels per icon rather
    // than being assumed once at the top of a report.
    expect(icon.licence).toBe("ISC");
    expect(icon.licenceFile).toBe(path.resolve(root, "packs/lucide/LICENSE"));
    expect(icon.source).toBe("<svg/>");
  });

  it("names its fields so a baseline is not a reference icon", async () => {
    const baselines = await loadBaselines(root);
    const icon = await baselines.load(baselines.entries[0]);
    // `icon`/`source`, never `name`/`svg`. Renaming either makes BaselineIcon
    // structurally a ReferenceIcon and the compile-time gate stops holding.
    expect(icon).not.toHaveProperty("name");
    expect(icon).not.toHaveProperty("svg");
    expect(icon).not.toHaveProperty("provenance");
  });

  it("refuses an unknown pack by name rather than by missing file", async () => {
    const baselines = await loadBaselines(root);
    await expect(
      baselines.load({ icon: "x", pack: "feather", style: "regular" })
    ).rejects.toThrow(/Unknown baseline pack/u);
  });
});
