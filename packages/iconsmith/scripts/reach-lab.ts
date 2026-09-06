/**
 * The reach set, drawn by the arms that draw it, and checked before it is
 * written.
 *
 * The set the dashboard showed was assembled once by hand and never
 * reproducible, which is why nobody noticed that four of its filled halves were
 * a comment, that one carried a recorded `severity: "error"` under a green
 * "clean", and that the compass was warned four times about a diagonal its own
 * program had declared. So this writes the directory and asserts the invariants
 * on the way past, refusing rather than staging a set that fails one: a staging
 * directory nobody can trust is worse than none, because the viewer shows it
 * anyway and the plausible cards carry the rest.
 *
 * **It does not choose the arm.** The revision before this one drew all ten on
 * the host, and a set of host programs reporting `0 error(s)` says the house can
 * draw ten icons — which is not the question anyone asks of a generator. It also
 * made the set unable to fail, and a regression test that cannot fail has
 * stopped being one. Each icon here names the arm the dashboard credited it to,
 * that arm is asked for by name, and when it cannot run the icon is **recorded
 * as skipped with the reason** rather than quietly drawn by something else. A
 * disclosed gap is a fact; a silent substitution is a false report.
 *
 * Findings are allowed and expected. `warn` is the tier the house rules use for
 * "confirm this was deliberate", the 10 marks carry 14 standing keyline warns by
 * design, and an arm that trips one is telling the truth about its drawing. Only
 * an `error` stops a run.
 *
 * Four invariants, one per class of bug the audit found:
 *
 * 1. Both paints are a program with ops — not a note about why there is no
 *    program.
 * 2. Neither paint has a lint error.
 * 3. The two paints occupy the same visual extent, the checkable half of "one
 *    skeleton, two paints".
 * 4. Where the outline enclosed canvas the fill knocks it out: a `hole` is a
 *    removal of ink, not a shape painted over.
 *
 *   npx tsx scripts/reach-lab.ts [outdir] [--arm <agent|analog|glyph|harness|program>]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { gatewayToken, openrouterToken } from "../src/pipeline/gateway.js";
import type { Unkeyed } from "../src/pipeline/generate.js";
import { classifyReach, reach } from "../src/pipeline/reach.js";
import { thinking } from "../src/pipeline/thinking.js";
import type { Thinking } from "../src/pipeline/thinking.js";
import { run as runDsl } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { adaptProgram, twinPairIssues } from "../src/tools/twin.js";
import type { Finish } from "../src/types.js";

const OUT = path.join(".staging", "reach-10");

/**
 * The set, each with the arm the dashboard credited it to.
 *
 * `compile` is keyed to a house file, so it needs corpus path data handed in;
 * `agent` needs a gateway or OpenRouter credential and `harness` a coding-agent
 * CLI. None of the three is available by default, which is the point of
 * recording what a run could not do.
 */
export const REACH_SET: readonly { arm: Unkeyed; name: string }[] = [
  { arm: "agent", name: "briefcase" },
  { arm: "harness", name: "cake" },
  { arm: "agent", name: "compass" },
  { arm: "harness", name: "cookie" },
  { arm: "agent", name: "database" },
  { arm: "agent", name: "fingerprint" },
  { arm: "agent", name: "microscope" },
  { arm: "agent", name: "strikethrough" },
  { arm: "agent", name: "umbrella" },
  { arm: "harness", name: "wifi" },
];

/** Why an arm cannot run here, or null when it can. Checked before drawing so
 *  the reason names the missing thing rather than a stack from inside a model
 *  client. */
export const unavailable = (arm: Unkeyed): string | null => {
  if (arm === "agent") {
    return gatewayToken() === undefined && openrouterToken() === undefined
      ? "the agent arm needs a gateway credential (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN) or OPENROUTER_API_KEY"
      : null;
  }
  if (arm === "program") {
    return gatewayToken() === undefined && openrouterToken() === undefined
      ? "the program arm needs a gateway credential (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN) or OPENROUTER_API_KEY"
      : null;
  }
  if (arm === "harness") {
    const cli = process.env.ICONSMITH_HARNESS ?? "claude";
    return (process.env.PATH ?? "")
      .split(path.delimiter)
      .some((dir) => dir !== "" && existsSync(path.join(dir, cli)))
      ? null
      : `the harness arm needs the \`${cli}\` CLI on PATH`;
  }
  return null;
};

const opsOf = (program: string): string[] =>
  program
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

/** One icon's outcome. A skip is a first-class result, not an exception: the
 *  run is still a valid report of what this machine could draw. */
export interface Staged {
  arm: Unkeyed;
  name: string;
  /** Present when it drew. Two records, outlined then filled. */
  records?: Thinking[];
  /** Present when it did not. */
  skipped?: string;
}

const slugFor = (name: string, finish: Finish): string =>
  finish === "filled" ? `${name}-filled` : name;

const alpha = (source: string) =>
  sharp(Buffer.from(source))
    .resize(240, 240)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();

/** Verify actual ink removal, independently of the SVG fill-rule spelling. */
export const punches = async (
  program: string,
  svg: string
): Promise<boolean> => {
  if (!opsOf(program).some((line) => line.startsWith("hole "))) {
    return true;
  }
  const uncut = runDsl(program, []).canvas;
  uncut.elements = uncut.elements.filter(
    (element) => element.op !== "knockout"
  );

  const [before, after] = await Promise.all([alpha(uncut.toSVG()), alpha(svg)]);
  let removed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (after[i] > before[i] + 8) {
      return false;
    }
    removed += Math.max(0, before[i] - after[i]);
  }
  return removed > 255;
};

const judge = async (
  name: string,
  program: string,
  finish: Finish,
  policy: string,
  brief: string
): Promise<{ record: Thinking; svg: string }> => {
  const ran = runDsl(program, []);
  if (ran.errors.length > 0) {
    throw new Error(`${name} ${finish}: ${ran.errors.join("; ")}`);
  }
  if (opsOf(program).length < 2) {
    throw new Error(
      `${name} ${finish}: the arm returned no program with ops. A comment is not a program.`
    );
  }
  const issues = lint(ran.canvas, { keyline: ran.keyline });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `${name} ${finish}: ${errors.map((e) => `${e.rule}: ${e.message}`).join("; ")}`
    );
  }
  const svg = ran.canvas.toSVG();
  if (finish === "filled" && !(await punches(program, svg))) {
    throw new Error(`${name}: a filled hole is painted over rather than cut.`);
  }
  return {
    record: thinking({ brief, finish, issues, policy, program }),
    svg,
  };
};

const write = (
  dir: string,
  slug: string,
  staged: { record: Thinking; svg: string }
): void => {
  writeFileSync(path.join(dir, `${slug}.svg`), staged.svg);
  writeFileSync(path.join(dir, `${slug}.icon`), staged.record.program);
  writeFileSync(path.join(dir, `${slug}.brief.md`), `${staged.record.brief}\n`);
  writeFileSync(
    path.join(dir, `${slug}.json`),
    `${JSON.stringify(staged.record, null, 2)}\n`
  );
};

/**
 * Draw one icon in both paints through the arm it asks for.
 *
 * The outlined half is whatever the arm drew. The filled half is *derived* from
 * it rather than asked for separately, which is the invariant rather than a
 * shortcut: two paints of one skeleton have to be reachable from each other, and
 * a pair of independently authored programs cannot be checked against anything.
 */
const drawOne = async (
  entry: { arm: Unkeyed; name: string },
  dir: string
): Promise<Staged> => {
  const why = unavailable(entry.arm);
  if (why !== null) {
    return { arm: entry.arm, name: entry.name, skipped: why };
  }
  const drawn = await reach({ name: entry.name }, { unkeyed: entry.arm });
  const outlined = drawn.program;
  if (outlined === undefined) {
    return {
      arm: entry.arm,
      name: entry.name,
      skipped: `the ${entry.arm} arm returned no program`,
    };
  }
  // The arm that actually drew it, read from the same classifier `reach` routed
  // on rather than from the brief's first word — which is the finish, and read
  // as a policy would put `outlined×10` in the summary where the arm belongs.
  // A request answered by a different arm is then visible on the card.
  const policy = classifyReach(
    entry.name,
    () => false,
    false,
    undefined,
    entry.arm
  ).kind;
  const paints = {
    filled: await judge(
      entry.name,
      adaptProgram(outlined, "filled"),
      "filled",
      policy,
      `filled ${drawn.brief ?? entry.name}`
    ),
    outlined: await judge(
      entry.name,
      outlined,
      "outlined",
      policy,
      drawn.brief ?? entry.name
    ),
  };
  const twinErrors = twinPairIssues(
    runDsl(paints.outlined.record.program, []).canvas,
    runDsl(paints.filled.record.program, []).canvas
  ).filter((issue) => issue.severity === "error");
  if (twinErrors.length > 0) {
    throw new Error(
      `${entry.name}: ${twinErrors.map((issue) => issue.message).join("; ")}`
    );
  }
  mkdirSync(dir, { recursive: true });
  const records: Thinking[] = [];
  for (const finish of ["outlined", "filled"] as const) {
    write(dir, slugFor(entry.name, finish), paints[finish]);
    records.push(paints[finish].record);
  }
  return { arm: entry.arm, name: entry.name, records };
};

export const runReachLab = async (
  out: string = OUT,
  set: readonly { arm: Unkeyed; name: string }[] = REACH_SET
): Promise<Staged[]> => {
  rmSync(out, { force: true, recursive: true });
  mkdirSync(out, { recursive: true });
  const staged: Staged[] = [];
  for (const entry of set) {
    // Sequential on purpose: a failure has to name the icon it happened on, and
    // a directory half-written by a rejected Promise.all looks complete.
    // oxlint-disable-next-line no-await-in-loop
    staged.push(await drawOne(entry, path.join(out, entry.name)));
  }
  writeFileSync(
    path.join(out, "reach.json"),
    `${JSON.stringify(staged, null, 2)}\n`
  );
  return staged;
};

if (process.argv[1]?.endsWith("reach-lab.ts")) {
  const args = process.argv.slice(2);
  const armAt = args.indexOf("--arm");
  const arm = armAt === -1 ? null : (args[armAt + 1] as Unkeyed);
  const out = args.find((a) => !a.startsWith("--") && a !== arm) ?? OUT;
  const set = arm === null ? REACH_SET : REACH_SET.map((e) => ({ ...e, arm }));
  const staged = await runReachLab(out, set);
  const drawn = staged.filter((s) => s.records !== undefined);
  const warns = drawn.reduce(
    (n, s) => n + (s.records ?? []).reduce((m, r) => m + r.issues.length, 0),
    0
  );
  const byPolicy = new Map<string, number>();
  for (const s of drawn) {
    const policy = s.records?.[0].policy ?? "?";
    byPolicy.set(policy, (byPolicy.get(policy) ?? 0) + 1);
  }
  process.stderr.write(
    `staged ${drawn.length} of ${staged.length} icons in ${out} — ` +
      `${warns} warning(s), 0 errors; drawn by ${
        [...byPolicy].map(([p, n]) => `${p}×${n}`).join(", ") || "nothing"
      }\n`
  );
  for (const s of staged.filter((x) => x.skipped !== undefined)) {
    process.stderr.write(`  skipped ${s.name} (${s.arm}): ${s.skipped}\n`);
  }
  process.stdout.write(`${JSON.stringify(staged, null, 2)}\n`);
}
