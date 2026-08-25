/* oxlint-disable eslint/no-await-in-loop, eslint/complexity --
   The awaits in loops are the design, not an oversight. Each worker must draw
   ONE icon at a time — a tournament runs up to eight arms and costs real money,
   so `Promise.all` over the queue would start every concept at once and blow
   both the rate limit and the budget ceiling. Concurrency is bounded by the
   worker count instead. `runOne` is one long function because it owns one
   linear transaction — request, await, persist, summarise — and splitting it
   would thread the same six values through four helpers. */
/**
 * Drive the Eve agent over a committed benchmark split and keep everything.
 *
 * The eval tree in `packages/iconsmith` scores `generate()` directly. Studio
 * ships the Eve orchestrator. `pipeline/harness.ts` already names that failure
 * one level down — "if the benchmark scores the built-in loop while people run
 * the skill, we measure the arm nobody uses and ship the arm nobody measures" —
 * and this script is the missing measurement one level up.
 *
 * Two arms, and the arm is a property of the SERVER, not of a request:
 * `ICONSMITH_EVAL_HOLDOUT` is read once at boot by `lib/studio/arsenal.ts`.
 * So a full pass is two passes against two servers:
 *
 *     # as-shipped
 *     npm run dev
 *     node scripts/eve-eval.mjs --split sealed --arm shipped
 *
 *     # closure-clean
 *     node scripts/eve-eval.mjs --split sealed --arm clean --emit-holdout /tmp/h.json
 *     ICONSMITH_EVAL_HOLDOUT=/tmp/h.json npm run dev
 *     node scripts/eve-eval.mjs --split sealed --arm clean
 *
 * Resumable by design: a concept whose `result.json` exists is skipped, so a
 * killed pass costs the icon it was drawing and nothing already paid for.
 */
import { Client } from "eve/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "../../..");
const BENCH = path.join(REPO, "packages/iconsmith/bench/reconstruction.json");
const HOUSE_PREFIX = "blode-icons/";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};
const flag = (name) => process.argv.includes(`--${name}`);

const split = arg("split", "sealed");
const arm = arg("arm", "shipped");
const limit = Number(arg("limit", "0"));
const workers = Number(arg("workers", "4"));
/**
 * The arms reserve, in order: library $0.055, host-analog $0.055,
 * image-agent $0.195 + $0.30 proposal, gateway-agent $0.35,
 * claude-harness $0.40 + $0.30. A reservation is checked BEFORE an arm may
 * start, so a budget under that sum does not make the run cheaper — it makes
 * the strongest arms unreachable and records the result as though they had
 * competed. `lib/studio/generate.ts:99-116` documents three campaign attempts
 * lost to exactly that. $2.00 is `backlog.mjs`'s own default and clears the sum.
 */
const maxUsd = Number(arg("max-icon-spend", "2.00"));
const maxCalls = Number(arg("max-calls", "90"));
const host = process.env.ICONSMITH_EVE_URL ?? "http://127.0.0.1:3210/iconsmith";
const outRoot = path.join(REPO, ".staging/eve-eval", arm);

if (!["clean", "shipped"].includes(arm)) {
  throw new Error(`--arm must be shipped or clean, got ${arm}`);
}

const bench = JSON.parse(await readFile(BENCH, "utf-8"));
let entries = bench.entries
  .filter((entry) => entry.split === split)
  .toSorted((a, b) => a.rank - b.rank);
if (limit > 0) {
  entries = entries.slice(0, limit);
}

const houseSlugs = (entry) =>
  entry.closure
    .filter((id) => id.startsWith(HOUSE_PREFIX))
    .map((id) => id.slice(HOUSE_PREFIX.length));

// `--emit-holdout` writes the map the clean server boots with, then exits.
// Written from the same benchmark the run scores against, so the thing
// withheld and the thing measured can never drift apart.
const emit = arg("emit-holdout", "");
if (emit) {
  const map = Object.fromEntries(entries.map((entry) => [entry.slug, houseSlugs(entry)]));
  await writeFile(emit, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`wrote holdout for ${entries.length} concepts -> ${emit}`);
  process.exit(0);
}

const client = new Client({ host });
await client.health();

const toolResultOf = (events) =>
  events.findLast(
    (event) =>
      event.type === "action.result" &&
      event.data.result.kind === "tool-result" &&
      event.data.result.toolName === "generate_icon_pair",
  );

const existing = async (file) => {
  try {
    await readFile(file, "utf-8");
    return true;
  } catch {
    return false;
  }
};

const runOne = async (entry) => {
  const dir = path.join(outRoot, entry.slug);
  const resultFile = path.join(dir, "result.json");
  if (!flag("force") && (await existing(resultFile))) {
    return { skipped: true, slug: entry.slug };
  }
  await mkdir(dir, { recursive: true });

  /**
   * `answers.object` rather than `text` alone, because `conceptOf` tokenises
   * `text` and drops every token under three characters. Over this split that
   * renames 13 of 60 concepts and lands 4 of them on a different icon the set
   * already ships — `write-2` becomes `write`, `bell-2-off` becomes `bell-off`,
   * `wifi-no-signal` becomes `wifi-signal` with the negation stripped. Scored
   * that way the run would compare a drawing of one concept against the answer
   * key of another, which is not a hard measurement, it is a wrong one.
   *
   * `conceptOf` reads `answers.object` verbatim, so this pins the concept to
   * the benchmark id. The tokeniser is recorded as finding EVE-4 and measured
   * separately; it is not what this arm is trying to measure.
   */
  const request = {
    answers: { object: entry.slug },
    attachments: [],
    budget: { maxCalls, maxUsd },
    finish: "outlined",
    text: entry.slug.replaceAll("-", " "),
  };
  const startedAt = Date.now();
  let response;
  try {
    const session = await client.sessions.create({
      message: `STUDIO_REQUEST\n${JSON.stringify(request)}`,
    });
    response = await session.response.result();
  } catch (error) {
    // A transport or session failure is data, not a reason to lose the pass.
    await writeFile(
      resultFile,
      `${JSON.stringify(
        { error: String(error), ms: Date.now() - startedAt, slug: entry.slug, stage: "session" },
        null,
        2,
      )}\n`,
    );
    return { error: String(error), slug: entry.slug };
  }
  const ms = Date.now() - startedAt;
  const tool = toolResultOf(response.events);
  const output = tool?.data?.result?.output ?? null;

  // Everything the scorer needs, and the transcript that explains it.
  await writeFile(
    path.join(dir, "events.jsonl"),
    `${response.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );

  const record = {
    arm,
    closure: houseSlugs(entry),
    concept: entry.slug,
    ms,
    request,
    sessionId: response.sessionId,
    status: response.status,
  };

  if (!output || output.kind !== "drawn") {
    record.kind = output?.kind ?? "missing";
    record.text = output?.text ?? null;
    record.tournament = output?.tournament ?? null;
    await writeFile(resultFile, `${JSON.stringify(record, null, 2)}\n`);
    // A refusal is the expensive outcome, not the cheap one — it runs every arm
    // to exhaustion. Reporting only the cost of delivered pairs made the running
    // total read $0.0000 across six refusals that had actually billed $4.25, and
    // the batch ceiling is checked against that total.
    return {
      kind: record.kind,
      slug: entry.slug,
      usd: output?.tournament?.cost?.totalUsd ?? null,
    };
  }

  for (const version of output.versions) {
    await writeFile(path.join(dir, `${version.finish}.svg`), `${version.svg}\n`);
    if (version.program) {
      // `programComplete` false means the program does not replay to the
      // delivered document, so the suffix records that the file is a lossy
      // account of the drawing rather than its source.
      const suffix = version.programComplete ? ".icon" : ".icon.partial";
      await writeFile(path.join(dir, `${version.finish}${suffix}`), `${version.program.trim()}\n`);
    }
  }

  const { tournament } = output;
  record.kind = "drawn";
  record.text = output.text;
  record.selected = tournament.selected;
  record.strategy = tournament.strategy;
  record.cost = tournament.cost;
  record.candidates = tournament.candidates.map((candidate) => ({
    accepted: candidate.accepted,
    failure: candidate.failure,
    id: candidate.id,
    label: candidate.label,
    paints: candidate.paints.map((paint) => ({
      accepted: paint.accepted,
      clean: paint.clean,
      findings: paint.findings,
      finish: paint.finish,
      pq: paint.pq,
      programComplete: paint.programComplete,
      reason: paint.reason,
      sc: paint.sc,
      scorable: paint.scorable,
    })),
    score: candidate.score,
  }));
  record.versions = output.versions.map((version) => ({
    agent: version.agent,
    finish: version.finish,
    programComplete: version.programComplete,
    trace: version.trace,
  }));
  await writeFile(resultFile, `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(path.join(dir, "tournament.json"), `${JSON.stringify(tournament, null, 2)}\n`);
  return {
    selected: record.selected,
    slug: entry.slug,
    usd: tournament.cost?.totalUsd ?? null,
  };
};

await mkdir(outRoot, { recursive: true });
console.log(`arm=${arm} split=${split} concepts=${entries.length} workers=${workers} host=${host}`);
if (arm === "clean" && !flag("i-started-the-server-with-the-holdout")) {
  console.log(
    "note: the clean arm requires the server to have booted with " +
      "ICONSMITH_EVAL_HOLDOUT set. This script cannot verify that from here.",
  );
}

const queue = [...entries];
let done = 0;
let spend = 0;
const summary = [];
const worker = async () => {
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) {
      return;
    }
    const row = await runOne(entry);
    done += 1;
    if (typeof row.usd === "number") {
      spend += row.usd;
    }
    summary.push(row);
    const note = row.skipped ? "skipped" : (row.error ?? row.kind ?? `won by ${row.selected}`);
    console.log(
      `[${String(done).padStart(3)}/${entries.length}] ${entry.slug.padEnd(28)} ${note}${typeof row.usd === "number" ? ` $${row.usd.toFixed(4)}` : ""}`,
    );
  }
};
await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));

await writeFile(
  path.join(outRoot, "run.json"),
  `${JSON.stringify({ arm, entries: summary, spendUsd: spend, split }, null, 2)}\n`,
);
console.log(`\ndone. measured spend $${spend.toFixed(4)} over ${summary.length} concepts.`);
