/**
 * Agent twins vs house files, plus net-new names with no house file.
 *
 * Compile reconstruction is the bar (`scripts/twin-eval.ts`, ~0.999/1.000).
 * This asks the tool-calling loop — OpenRouter or gateway — for both paints
 * and scores them the same way. Analog is the host fallback, recorded beside
 * the agent so a run can say whether the model beat replay.
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/agent-twin-eval.ts \
 *     --house /tmp/eval-20/house \
 *     --model thinkingmachines/inkling \
 *     --out /tmp/inkling-eval
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { parseIconSvg } from "../src/corpus/load.js";
import { analogArm } from "../src/pipeline/analog.js";
import { generate } from "../src/pipeline/generate.js";
import type { GenerateResult } from "../src/pipeline/generate.js";
import { OPENROUTER_INKLING } from "../src/pipeline/openrouter.js";
import { compilePaint } from "../src/pipeline/reconstruct.js";
import { Canvas } from "../src/tools/canvas.js";
import { run as runDsl } from "../src/tools/dsl.js";
import { cosine, inkVector, sheet } from "../src/tools/render.js";
import { twinPairIssues } from "../src/tools/twin.js";
import type { Finish, IconDoc } from "../src/types.js";

const HOUSE_SUBSET = [
  "heart",
  "star",
  "home",
  "bell",
  "check",
  "lock",
  "clock",
  "plus-large",
  "shield",
  "zap",
] as const;

const NET_NEW = ["quokka", "lantern", "otter", "paper-plane"] as const;

const emptySvg = (svg: string): boolean => !/<path\b/u.test(svg);

const pathsOf = (file: string): string[] =>
  parseIconSvg(readFileSync(file, "utf-8")).map((s) => s.d);

const scorePair = async (a: string, b: string): Promise<number> =>
  cosine(await inkVector(a), await inkVector(b));

const flag = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const list = (
  raw: string | undefined,
  fallback: readonly string[]
): string[] =>
  raw === undefined
    ? [...fallback]
    : raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

interface PaintRow {
  clean: boolean;
  cosine: number | null;
  dsl: boolean;
  empty: boolean;
  finish: Finish;
  issues: string[];
  ops: string[];
  outcome: string | null;
  program: string | null;
  steps: number;
  toolCalls: Record<string, number>;
  trace: string[];
}

interface AgentTwinRow {
  analog: { filled: PaintRow; outlined: PaintRow };
  compile: { filled: PaintRow | null; outlined: PaintRow | null };
  house: boolean;
  inkling: { filled: PaintRow; outlined: PaintRow };
  name: string;
  twinPair: string[];
}

const opsOf = (program: string | null, doc?: IconDoc): string[] => {
  if (program !== null && program.trim() !== "") {
    return program
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(/\s+/u)[0] ?? "");
  }
  return (doc?.draw ?? []).map((op) => op.op);
};

const paintOf = (
  result: GenerateResult,
  finish: Finish,
  cosineScore: number | null
): PaintRow => ({
  clean: result.clean,
  cosine: cosineScore,
  dsl: result.issues.some((i) => i.rule === "dsl"),
  empty: emptySvg(result.svg) || result.issues.some((i) => i.rule === "empty"),
  finish,
  issues: result.issues.map((i) => `${i.severity}:${i.rule}`),
  ops: opsOf(result.program ?? null, result.doc),
  outcome: result.cost?.outcome ?? null,
  program: result.program ?? null,
  steps: result.steps,
  toolCalls: result.cost?.toolCalls ?? {},
  trace: result.trace,
});

const compileRow = (
  name: string,
  file: string | null,
  finish: Finish
): PaintRow | null => {
  if (file === null || !existsSync(file)) {
    return null;
  }
  const compiled = compilePaint(name, pathsOf(file), finish);
  const svg = compiled.program.canvas.toSVG();
  return {
    clean: compiled.program.errors.length === 0,
    cosine: null,
    dsl: compiled.program.errors.length > 0,
    empty: emptySvg(svg),
    finish,
    issues: compiled.program.errors.map((message) => `error:dsl:${message}`),
    ops: opsOf(compiled.source),
    outcome: "compile",
    program: compiled.source,
    steps: 0,
    toolCalls: {},
    trace: opsOf(compiled.source),
  };
};

const writePaint = (
  dir: string,
  stem: string,
  svg: string,
  program: string | null
): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${stem}.svg`), svg);
  if (program !== null) {
    writeFileSync(path.join(dir, `${stem}.icon`), program);
  }
};

const scoreCompile = async (
  row: PaintRow | null,
  house: string | null
): Promise<void> => {
  if (row === null || house === null || row.program === null) {
    return;
  }
  row.cosine = await scorePair(runDsl(row.program, []).canvas.toSVG(), house);
};

const maybeScore = (
  drawn: string,
  house: string | null
): Promise<number | null> =>
  house === null ? Promise.resolve(null) : scorePair(drawn, house);

const evalOne = async (
  name: string,
  options: {
    house: string;
    maxSteps?: number;
    model: string;
    out: string;
  }
): Promise<{ row: AgentTwinRow; tiles: string[] }> => {
  const analog = analogArm();
  const outlinedHouse = path.join(options.house, "outlined", `${name}.svg`);
  const filledHouse = path.join(options.house, "filled", `${name}.svg`);
  const hasHouse = existsSync(outlinedHouse);
  const houseOut = hasHouse ? readFileSync(outlinedHouse, "utf-8") : null;
  const houseFill = existsSync(filledHouse)
    ? readFileSync(filledHouse, "utf-8")
    : null;
  const outlined = await generate(
    { name },
    { finish: "outlined", maxSteps: options.maxSteps, model: options.model }
  );
  const filled = await generate(
    { name },
    { finish: "filled", maxSteps: options.maxSteps, model: options.model }
  );
  const analogOut = await analog({ name }, { finish: "outlined" });
  const analogFill = await analog({ name }, { finish: "filled" });
  const compileOutlined = compileRow(
    name,
    hasHouse ? outlinedHouse : null,
    "outlined"
  );
  const compileFilled = compileRow(
    `${name}-filled`,
    houseFill === null ? null : filledHouse,
    "filled"
  );
  const [outCos, fillCos, analogOutCos, analogFillCos] = await Promise.all([
    maybeScore(outlined.svg, houseOut),
    maybeScore(filled.svg, houseFill),
    maybeScore(analogOut.svg, houseOut),
    maybeScore(analogFill.svg, houseFill),
  ]);
  await scoreCompile(compileOutlined, houseOut);
  await scoreCompile(compileFilled, houseFill);
  const pair = twinPairIssues(
    Canvas.fromJSON(outlined.doc),
    Canvas.fromJSON(filled.doc)
  ).map((issue) => `${issue.severity}:${issue.rule}`);
  const dir = path.join(options.out, name);
  writePaint(dir, name, outlined.svg, outlined.program ?? null);
  writePaint(dir, `${name}-filled`, filled.svg, filled.program ?? null);
  writePaint(dir, `${name}.analog`, analogOut.svg, analogOut.program ?? null);
  writePaint(
    dir,
    `${name}-filled.analog`,
    analogFill.svg,
    analogFill.program ?? null
  );
  if (houseOut !== null) {
    writeFileSync(path.join(dir, `${name}.house.svg`), houseOut);
  }
  if (houseFill !== null) {
    writeFileSync(path.join(dir, `${name}-filled.house.svg`), houseFill);
  }
  const row: AgentTwinRow = {
    analog: {
      filled: paintOf(analogFill, "filled", analogFillCos),
      outlined: paintOf(analogOut, "outlined", analogOutCos),
    },
    compile: { filled: compileFilled, outlined: compileOutlined },
    house: hasHouse,
    inkling: {
      filled: paintOf(filled, "filled", fillCos),
      outlined: paintOf(outlined, "outlined", outCos),
    },
    name,
    twinPair: pair,
  };
  writeFileSync(
    path.join(dir, `${name}.json`),
    `${JSON.stringify(row, null, 2)}\n`
  );
  process.stderr.write(
    `${name.padEnd(16)} house=${hasHouse ? "y" : "n"} ` +
      `agent ${outCos?.toFixed(3) ?? "n/a"}/${fillCos?.toFixed(3) ?? "n/a"} ` +
      `clean ${outlined.clean}/${filled.clean} ` +
      `empty ${row.inkling.outlined.empty}/${row.inkling.filled.empty} ` +
      `tools ${outlined.trace.join(",") || "none"}\n`
  );
  return {
    row,
    tiles: [
      outlined.svg,
      houseOut ?? outlined.svg,
      filled.svg,
      houseFill ?? filled.svg,
    ],
  };
};

const evaluateAgentTwins = async (options: {
  house: string;
  maxSteps?: number;
  model: string;
  names: readonly string[];
  netNew: readonly string[];
  out: string;
}): Promise<AgentTwinRow[]> => {
  mkdirSync(options.out, { recursive: true });
  const rows: AgentTwinRow[] = [];
  const tiles: string[] = [];
  const names = [...options.names, ...options.netNew];
  const walk = async (i: number): Promise<void> => {
    if (i >= names.length) {
      return;
    }
    const cached = path.join(options.out, names[i], `${names[i]}.json`);
    if (existsSync(cached)) {
      const row = JSON.parse(readFileSync(cached, "utf-8")) as AgentTwinRow;
      rows.push(row);
      const dir = path.join(options.out, names[i]);
      tiles.push(
        readFileSync(path.join(dir, `${names[i]}.svg`), "utf-8"),
        existsSync(path.join(dir, `${names[i]}.house.svg`))
          ? readFileSync(path.join(dir, `${names[i]}.house.svg`), "utf-8")
          : readFileSync(path.join(dir, `${names[i]}.svg`), "utf-8"),
        readFileSync(path.join(dir, `${names[i]}-filled.svg`), "utf-8"),
        existsSync(path.join(dir, `${names[i]}-filled.house.svg`))
          ? readFileSync(
              path.join(dir, `${names[i]}-filled.house.svg`),
              "utf-8"
            )
          : readFileSync(path.join(dir, `${names[i]}-filled.svg`), "utf-8")
      );
      process.stderr.write(`${names[i].padEnd(16)} resume\n`);
      await walk(i + 1);
      return;
    }
    const one = await evalOne(names[i], options);
    rows.push(one.row);
    tiles.push(...one.tiles);
    await walk(i + 1);
  };
  await walk(0);
  writeFileSync(
    path.join(options.out, "eval.json"),
    `${JSON.stringify({ model: options.model, rows }, null, 2)}\n`
  );
  writeFileSync(
    path.join(options.out, "contact.png"),
    await sheet(tiles, { cols: 4 })
  );
  return rows;
};

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

if (process.argv[1]?.endsWith("agent-twin-eval.ts")) {
  const args = process.argv.slice(2);
  const house = flag(args, "--house") ?? "/tmp/eval-20/house";
  const out = flag(args, "--out") ?? path.join(".staging", "agent-twin-eval");
  const model = flag(args, "--model") ?? OPENROUTER_INKLING;
  const maxSteps = Number(flag(args, "--max-steps") ?? 20);
  if (!existsSync(house)) {
    process.stderr.write(`house directory not found: ${house}\n`);
    process.exit(2);
  }
  const available = new Set(
    readdirSync(path.join(house, "outlined"))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4))
  );
  const names = list(flag(args, "--names"), HOUSE_SUBSET).filter((n) =>
    available.has(n)
  );
  const netNew = list(flag(args, "--new"), NET_NEW).filter(
    (n) => !available.has(n)
  );
  const rows = await evaluateAgentTwins({
    house,
    maxSteps,
    model,
    names,
    netNew,
    out,
  });
  const houseRows = rows.filter((r) => r.house);
  const agentOut = houseRows
    .map((r) => r.inkling.outlined.cosine)
    .filter((n): n is number => n !== null);
  const agentFill = houseRows
    .map((r) => r.inkling.filled.cosine)
    .filter((n): n is number => n !== null);
  const compileOut = houseRows
    .map((r) => r.compile.outlined?.cosine)
    .filter((n): n is number => n !== null);
  const analogOut = houseRows
    .map((r) => r.analog.outlined.cosine)
    .filter((n): n is number => n !== null);
  const empty = rows.filter(
    (r) => r.inkling.outlined.empty || r.inkling.filled.empty
  );
  const dirty = rows.filter(
    (r) => !r.inkling.outlined.clean || !r.inkling.filled.clean
  );
  process.stderr.write(
    `\n${rows.length} names · agent out ${mean(agentOut).toFixed(3)} ` +
      `fill ${mean(agentFill).toFixed(3)} · analog out ${mean(analogOut).toFixed(3)} ` +
      `· compile out ${mean(compileOut).toFixed(3)} · empty ${empty.length} ` +
      `· dirty ${dirty.length} · wrote ${out}\n`
  );
}
