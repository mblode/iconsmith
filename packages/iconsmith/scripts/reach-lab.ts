/**
 * The reach set, staged for the viewer and checked before it is written.
 *
 * The set the dashboard showed was assembled once by hand and never
 * reproducible, which is why nobody noticed that four of its filled halves
 * were a comment, that one carried a recorded `severity: "error"` under a
 * green "clean", and that the compass was warned four times about a diagonal
 * its own program had declared. A dashboard reads whatever is on disk; the
 * things that were wrong were wrong before the page saw them.
 *
 * So this writes the directory and asserts the invariants on the way past. It
 * refuses rather than staging a set that fails one, because a staging
 * directory nobody can trust is worse than no staging directory: the viewer
 * would show it, and the plausible parts would carry the rest.
 *
 * Five invariants, one per class of bug the audit found:
 *
 * 1. Both paints run, and each is a program with ops — not a note about why
 *    there is no program.
 * 2. Neither paint has a lint error, and any warning is recorded.
 * 3. The two paints occupy the same visual extent, which is the checkable half
 *    of "one skeleton, two paints".
 * 4. Where the outline enclosed canvas the fill knocks it out: a `hole` is a
 *    second subpath in one `<path>` under `evenodd`, not a shape painted over.
 * 5. Every record has every field, and `clean` agrees with `issues`.
 *
 *   npx tsx scripts/reach-lab.ts [outdir]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { GLYPH_NAMES } from "../src/pipeline/glyphs.js";
import { reach } from "../src/pipeline/reach.js";
import { thinking } from "../src/pipeline/thinking.js";
import type { Thinking } from "../src/pipeline/thinking.js";
import { run as runDsl } from "../src/tools/dsl.js";
import { lintReport } from "../src/tools/lint.js";
import { adaptProgram, sameExtent } from "../src/tools/twin.js";
import type { Finish } from "../src/types.js";

const OUT = path.join(".staging", "reach-10");
const FINISHES: Finish[] = ["outlined", "filled"];

/** The slug the viewer groups a filled twin under. `plus/plus-filled.svg` is
 *  the same concept in the other paint, and `counterpartSlug` reads it back. */
const slugFor = (name: string, finish: Finish): string =>
  finish === "filled" ? `${name}-filled` : name;

const opsOf = (program: string): string[] =>
  program
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

interface Staged {
  record: Thinking;
  svg: string;
}

/** One paint, drawn through the arm the pipeline would pick, then judged. */
const stage = async (name: string, finish: Finish): Promise<Staged> => {
  const slug = slugFor(name, finish);
  const drawn = await reach({ name: slug });
  const { program } = drawn;
  if (program === undefined || opsOf(program).length < 2) {
    throw new Error(
      `${slug}: the arm returned no program with ops. A comment is not a program.`
    );
  }
  const ran = runDsl(program, []);
  if (ran.errors.length > 0) {
    throw new Error(`${slug}: ${ran.errors.join("; ")}`);
  }
  const { issues, suppressed } = lintReport(ran.canvas, {
    keyline: ran.keyline,
  });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `${slug}: ${errors.map((e) => `${e.rule}: ${e.message}`).join("; ")}`
    );
  }
  return {
    record: thinking({
      brief: drawn.brief ?? `draw ${slug}`,
      finish,
      issues,
      policy: "glyph",
      program,
      suppressed,
    }),
    svg: ran.canvas.toSVG(),
  };
};

/** A knockout has to be a hole, not a shape painted over the solid. One
 *  `<path>` per element carrying both subpaths under `evenodd` is what does
 *  it; two paths would paint the knockout as ink. */
const punches = (program: string, svg: string): boolean =>
  !opsOf(program).some((line) => line.startsWith("hole ")) ||
  svg.includes('fill-rule="evenodd"');

const check = (name: string, staged: Record<Finish, Staged>): void => {
  const outlined = runDsl(staged.outlined.record.program, []).canvas;
  const filled = runDsl(staged.filled.record.program, []).canvas;
  if (!sameExtent(outlined, filled)) {
    throw new Error(`${name}: the two paints occupy different visual extents.`);
  }
  const { program } = staged.filled.record;
  if (!punches(program, staged.filled.svg)) {
    throw new Error(`${name}: a filled hole is painted over rather than cut.`);
  }
  // The derivation has to be able to reach the other paint from this one, even
  // where a host construction wrote both: a glyph that only exists as a pair of
  // hand-written programs cannot be checked against anything.
  const derived = runDsl(
    adaptProgram(staged.outlined.record.program, "filled")
  );
  if (derived.errors.length > 0) {
    throw new Error(`${name}: the derived fill does not run.`);
  }
  for (const finish of FINISHES) {
    const { record } = staged[finish];
    const errors = record.issues.filter((i) => i.severity === "error");
    if (record.clean !== (errors.length === 0)) {
      throw new Error(`${name} ${finish}: clean disagrees with issues.`);
    }
  }
};

const write = (dir: string, slug: string, staged: Staged): void => {
  writeFileSync(path.join(dir, `${slug}.svg`), staged.svg);
  writeFileSync(path.join(dir, `${slug}.icon`), staged.record.program);
  writeFileSync(path.join(dir, `${slug}.brief.md`), `${staged.record.brief}\n`);
  writeFileSync(
    path.join(dir, `${slug}.json`),
    `${JSON.stringify(staged.record, null, 2)}\n`
  );
};

export const runReachLab = async (out: string = OUT): Promise<Thinking[]> => {
  rmSync(out, { force: true, recursive: true });
  mkdirSync(out, { recursive: true });
  const records: Thinking[] = [];
  for (const name of GLYPH_NAMES) {
    const dir = path.join(out, name);
    mkdirSync(dir, { recursive: true });
    // Sequential on purpose: a failure has to name the icon it happened on,
    // and a staged directory half-written by a rejected Promise.all is a set
    // that looks complete.
    const staged = {} as Record<Finish, Staged>;
    for (const finish of FINISHES) {
      // oxlint-disable-next-line no-await-in-loop
      staged[finish] = await stage(name, finish);
    }
    check(name, staged);
    for (const finish of FINISHES) {
      write(dir, slugFor(name, finish), staged[finish]);
      records.push(staged[finish].record);
    }
  }
  writeFileSync(
    path.join(out, "reach.json"),
    `${JSON.stringify(records, null, 2)}\n`
  );
  return records;
};

if (process.argv[1]?.endsWith("reach-lab.ts")) {
  const out = process.argv[2] ?? OUT;
  const records = await runReachLab(out);
  const warnings = records.reduce((n, r) => n + r.issues.length, 0);
  const waived = records.reduce((n, r) => n + r.suppressed.length, 0);
  process.stderr.write(
    `staged ${records.length} paints of ${GLYPH_NAMES.length} icons in ${out} — ` +
      `${warnings} warning(s), ${waived} waiver(s), 0 errors\n`
  );
  process.stdout.write(
    `${JSON.stringify(
      records.map((r) => ({
        clean: r.clean,
        finish: r.finish,
        issues: r.issues.length,
        ops: r.steps,
        policy: r.policy,
      })),
      null,
      2
    )}\n`
  );
}
