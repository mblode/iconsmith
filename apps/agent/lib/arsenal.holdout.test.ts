import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const HOUSE = "blode-icons/";
const BENCH = path.join(
  import.meta.dirname,
  "../../../packages/iconsmith/bench/reconstruction.json",
);

/**
 * The holdout under test is a concept closure, so the fixture is the committed
 * closure rather than a list written out by hand here. A hand-written list is
 * the very mistake `pipeline/bench.ts` exists to prevent — the first draft of
 * this test named `robot-2` and `robot-3`, missed `robot-head-slop`, and would
 * have passed a hook that leaked it.
 */
const closureOf = (slug: string): string[] => {
  const bench = JSON.parse(readFileSync(BENCH, "utf-8")) as {
    entries: { closure: string[]; slug: string }[];
  };
  const entry = bench.entries.find((row) => row.slug === slug);
  if (!entry) {
    throw new Error(`${slug} is not in the committed benchmark`);
  }
  return entry.closure.filter((id) => id.startsWith(HOUSE)).map((id) => id.slice(HOUSE.length));
};

const holdoutFileFor = (slug: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-holdout-"));
  const file = path.join(dir, "holdout.json");
  writeFileSync(file, JSON.stringify({ [slug]: closureOf(slug) }));
  return file;
};

/**
 * `ICONSMITH_EVAL_HOLDOUT` is read once at module load, the same way
 * `ICONSMITH_LOCAL_HARNESS` is, because the server reads it at boot and a
 * per-call re-read would let one request change what the next one is shown.
 * So each case runs in its own process: setting `process.env` after the import
 * would test nothing, and would pass whatever the code did.
 */
const arsenalNames = (concept: string, holdoutFile?: string): string[] => {
  const script = `
    const { loadStudioArsenal } = await import(${JSON.stringify(
      path.join(import.meta.dirname, "arsenal.ts"),
    )});
    const arsenal = await loadStudioArsenal({ name: ${JSON.stringify(concept)} });
    console.log(JSON.stringify(arsenal.references.map((r) => r.name)));
  `;
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    {
      encoding: "utf-8",
      env: holdoutFile
        ? { ...process.env, ICONSMITH_EVAL_HOLDOUT: holdoutFile }
        : { ...process.env, ICONSMITH_EVAL_HOLDOUT: undefined },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(out.trim().split("\n").at(-1) ?? "[]") as string[];
};

describe("ICONSMITH_EVAL_HOLDOUT", () => {
  it("changes nothing when unset, so the as-shipped arm is the shipped thing", () => {
    const names = arsenalNames("robot");
    assert.ok(names.includes("robot-2"), "robot-2 is shown by default");
    assert.ok(names.includes("robot-3"), "robot-3 is shown by default");
  });

  it("withholds the named closure members from the drawer", () => {
    const names = arsenalNames("robot", holdoutFileFor("robot"));
    for (const slug of closureOf("robot")) {
      assert.ok(!names.includes(slug), `${slug} must be withheld`);
    }
    // The style anchors are not part of any concept's closure, so a holdout
    // must not cost the drawer the house voice it still needs to match.
    for (const anchor of ["folder-1", "clock", "arrow-up-right", "calendar-1"]) {
      assert.ok(names.includes(anchor), `${anchor} must survive a holdout`);
    }
  });

  it("closes the library-arm channel, not only the reference channel", () => {
    // `libraryCandidates` promotes a reference whose slug extends the concept
    // and which has both paints present. Withholding the reference is what
    // stops the arm existing, so this asserts the pairing is gone rather than
    // just thinned.
    const names = new Set(arsenalNames("robot", holdoutFileFor("robot")));
    const arms = [...names].filter(
      (name) =>
        name.startsWith("robot-") && !name.endsWith("-filled") && names.has(`${name}-filled`),
    );
    assert.deepEqual(arms, [], `no library arm may survive, saw ${arms.join(", ")}`);
  });
});
