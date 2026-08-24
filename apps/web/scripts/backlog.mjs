/* oxlint-disable no-await-in-loop -- cost-gated icon runs and their artifact ledgers are deliberately sequential */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "eve/client";

const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, "../../..");
const defaultRoot = path.join(repoRoot, "packages/iconsmith/workbench/central-gaps-v1");
const checkpointRoot = path.join(scriptDir, "../.eve/backlog-checkpoints");
const states = [
  "todo",
  "exploring",
  "review",
  "revision",
  "approved",
  "published",
  "blocked",
  "wont-do",
];
const validStates = new Set(states);

/** The acceptance floor, mirrored into every campaign's `quality` block.
 *  `TOURNAMENT_MINIMUM` in the package is the same number; this script cannot
 *  import it, so the two are kept in step by name rather than by build. */
const MINIMUM_PQ = 8;
const MINIMUM_SC = 8;

/**
 * What one icon may reserve, sized so a complete tournament can start.
 *
 * `PAIR_TOURNAMENT_RESERVE_USD` in `lib/studio/generate.ts` is $1.60 — the
 * four arms' reservations plus the shared proposal stage. The old $0.25
 * default admitted only the cheapest two, `host-analog` and `image-agent`,
 * which summed to exactly $0.25, so the two arms that actually draw were
 * refused before every run and the ledger recorded it as `stoppedEarly`. The
 * remainder is headroom for the library arms, which are prepended one per
 * existing house twin.
 *
 * This is a ceiling, not a spend: `exceedsCostBudget` still fails a run whose
 * real ledger overruns, and a per-call soft cutoff still stops the loop.
 */
const DEFAULT_ICON_SPEND_USD = 2;
const DEFAULT_ICON_CALLS = 90;

const parseArgs = (argv) => {
  const command = argv[0] ?? "status";
  const options = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }
    const key = token.slice(2);
    if (key === "include-review") {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
};

const readJson = async (file) => JSON.parse(await readFile(file, "utf-8"));

const writeJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};

const createCampaign = async (root) => {
  const inventoryFile = path.join(root, "inventory.json");
  const inventoryText = await readFile(inventoryFile, "utf-8");
  const inventory = JSON.parse(inventoryText);
  if (
    inventory?.schema !== 1 ||
    inventory?.target !== "central" ||
    !Array.isArray(inventory.icons) ||
    inventory.icons.length !== 200
  ) {
    throw new Error("inventory.json must contain exactly 200 Central gap icons.");
  }
  return {
    createdAt: inventory.generatedAt,
    id: "central-gaps-v1",
    items: inventory.icons.map((icon) => ({
      attemptCount: 0,
      confidence: icon.confidence,
      costs: [],
      id: `central-${String(icon.id).padStart(3, "0")}`,
      lastError: null,
      lastSessionId: null,
      rank: icon.id,
      risk: icon.risk ?? null,
      selectedAttempt: null,
      slug: icon.name,
      sources: icon.sources,
      status: "todo",
    })),
    quality: {
      minimum: { pq: MINIMUM_PQ, sc: MINIMUM_SC },
      pairRequired: true,
      stopScore: 9.75,
      visualFindingsAllowed: 0,
    },
    schema: 1,
    sourceAudit: {
      highConfidence: inventory.highConfidence,
      hugeicons: "4.2.1",
      requestedSources: inventory.requestedSources,
      review: inventory.review,
      sha256: createHash("sha256").update(inventoryText).digest("hex"),
    },
    target: "central",
    targetSnapshot: {
      centralRecords: 2085,
      comparedAt: inventory.generatedAt,
    },
    updatedAt: new Date().toISOString(),
  };
};

const validateCampaign = (campaign) => {
  if (
    campaign?.schema !== 1 ||
    !Array.isArray(campaign.items) ||
    campaign.items.some(
      (item) =>
        typeof item.slug !== "string" ||
        !validStates.has(item.status) ||
        !Array.isArray(item.sources),
    )
  ) {
    throw new Error("campaign.json is not a valid Central gaps campaign.");
  }
  if (new Set(campaign.items.map((item) => item.slug)).size !== 200) {
    throw new Error("campaign.json must contain 200 unique slugs.");
  }
  if (
    campaign.retired !== undefined &&
    (!Array.isArray(campaign.retired) ||
      campaign.retired.some(
        (item) =>
          typeof item.slug !== "string" ||
          item.status !== "wont-do" ||
          !Array.isArray(item.sources),
      ))
  ) {
    throw new Error("campaign.json retired entries must be wont-do campaign items.");
  }
  return campaign;
};

const loadCampaign = async (root) => {
  try {
    return validateCampaign(await readJson(path.join(root, "campaign.json")));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return createCampaign(root);
  }
};

const progressMarkdown = (campaign) => {
  const count = (state) => campaign.items.filter((item) => item.status === state).length;
  const lines = [
    "# Central gaps progress",
    "",
    "> Generated from campaign.json. Do not edit by hand.",
    "",
    `- Approved: ${count("approved")}/200`,
    `- In review: ${count("review")}`,
    `- Needs revision: ${count("revision")}`,
    `- Exploring: ${count("exploring")}`,
    `- Blocked: ${count("blocked")}`,
    `- Todo: ${count("todo")}`,
    `- Superseded: ${campaign.retired?.length ?? 0}`,
    "",
  ];
  for (const state of states) {
    const items = campaign.items.filter((item) => item.status === state);
    if (items.length === 0) {
      continue;
    }
    lines.push(`## ${state}`, "");
    for (const item of items) {
      const checked = ["approved", "published"].includes(state) ? "x" : " ";
      const review = item.confidence === "review" ? " · semantic review required" : "";
      lines.push(
        `- [${checked}] ${item.slug} · ${item.sources.join("/")} · ${item.attemptCount} attempt(s)${
          review
        }`,
      );
    }
    lines.push("");
  }
  if (campaign.retired?.length) {
    lines.push("## superseded", "");
    for (const item of campaign.retired) {
      lines.push(
        `- [ ] ${item.slug} · ${item.sources.join("/")} · ${item.attemptCount} attempt(s) · ${item.lastError}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const syncCampaign = async (root, campaign) => {
  campaign.updatedAt = new Date().toISOString();
  await writeJson(path.join(root, "campaign.json"), campaign);
  await writeFile(path.join(root, "PROGRESS.md"), progressMarkdown(campaign));
};

const costSummary = (campaign) => {
  const costs = [...campaign.items, ...(campaign.retired ?? [])].flatMap(
    (item) => item.costs ?? [],
  );
  return {
    knownTournamentUsd: costs.reduce((sum, cost) => sum + (cost.totalUsd ?? 0), 0),
    note: "Eve orchestration turns are not priced in the Studio tool result; the complete campaign total is unknown.",
    totalUsd: null,
    tournamentCalls: costs.reduce((sum, cost) => sum + cost.calls, 0),
    tournamentHasUnpricedCalls: costs.some((cost) => cost.totalUsd === null),
  };
};

const statusOf = (campaign) => ({
  campaign: campaign.id,
  costs: costSummary(campaign),
  counts: Object.fromEntries(
    states.map((state) => [state, campaign.items.filter((item) => item.status === state).length]),
  ),
  next: campaign.items
    .filter((item) => item.status === "todo" && item.confidence === "high")
    .slice(0, 10)
    .map((item) => item.slug),
  retired: campaign.retired?.length ?? 0,
  total: campaign.items.length,
});

const toolOutputOf = (result) => {
  const event = result.events.findLast(
    (candidate) =>
      candidate.type === "action.result" &&
      candidate.data.result.kind === "tool-result" &&
      candidate.data.result.toolName === "generate_icon_pair",
  );
  if (!event || event.type !== "action.result" || event.data.result.kind !== "tool-result") {
    throw new Error("Eve completed without a generate_icon_pair result.");
  }
  return event.data.result.output;
};

const compactEvents = (events) =>
  events.flatMap((event) => {
    const base = {
      at: event.meta?.at ?? null,
      eventId: event.meta?.id ?? null,
      type: event.type,
    };
    if (event.type === "actions.requested") {
      return [
        {
          ...base,
          tools: event.data.actions
            .filter((action) => action.kind === "tool-call")
            .map((action) => action.toolName),
        },
      ];
    }
    if (event.type === "action.result") {
      return [
        {
          ...base,
          resultKind: event.data.result.kind,
          tool: event.data.result.kind === "tool-result" ? event.data.result.toolName : null,
        },
      ];
    }
    if (
      event.type === "message.received" ||
      event.type === "reasoning.appended" ||
      event.type === "reasoning.completed" ||
      event.type === "message.appended" ||
      event.type === "message.completed"
    ) {
      return [];
    }
    return [base];
  });

const safeName = (value) => value.toLowerCase().replaceAll(/[^a-z0-9-]/gu, "-");

const withoutBodies = (candidate) => ({
  ...candidate,
  paints: candidate.paints.map(({ document, program, svg: _svg, ...paint }) => ({
    ...paint,
    hasDocument: Boolean(document),
    hasProgram: Boolean(program),
  })),
});

const persistPaint = async (root, paint) => {
  await writeFile(path.join(root, `${paint.finish}.svg`), `${paint.svg}\n`);
  if (paint.document) {
    await writeJson(path.join(root, `${paint.finish}.icon.json`), paint.document);
  }
  if (paint.program) {
    const suffix = paint.programComplete ? ".icon" : ".icon.partial";
    await writeFile(path.join(root, `${paint.finish}${suffix}`), `${paint.program.trim()}\n`);
  }
};

// oxlint-disable-next-line eslint/complexity -- one persistence transaction owns candidates, selection, evidence, and state
/**
 * What the attempt actually cleared, rather than two fixed shapes.
 *
 * The previous version wrote `lint/pair/visual: "passed"` for any drawn
 * output, which is how a pair whose filled program did not round-trip was
 * recorded as clean, cost $1.45, and had to be caught by a person reading the
 * files. Every gate here is read off the delivered versions.
 */
/**
 * Which role each billed operation belongs to.
 *
 * `model-policy.json` names the model every role should run on, and until now
 * nothing read it — so the campaign silently moved icon generation from
 * `claude-opus-5` to a Flash model between attempts and the policy still
 * claimed otherwise. Rather than have library code read a campaign artifact,
 * the campaign checks itself against the policy it publishes.
 */
const POLICY_ROLES = {
  "candidate-ranking": ["pairCandidateRanking"],
  "claude-harness": ["codingHarnessEscalation"],
  "icon-generation": ["iconDslGeneration"],
  // Two roles, one operation: the proposal stage draws cheap sketches and one
  // stronger one, then chooses between them. Both are billed as
  // `proposal-image`, and both are the policy.
  "proposal-image": ["proposalImage", "proposalQualityImage"],
  "proposal-reading": ["compositionReader"],
  "proposal-selection": ["compositionCritique"],
  "visual-audit": ["visualAcceptance"],
};

/** Every model this attempt actually billed, by operation. */
const modelsUsed = (output) => {
  const seen = new Map();
  for (const record of output.tournament?.cost?.records ?? []) {
    const models = seen.get(record.operation) ?? new Set();
    models.add(record.model);
    seen.set(record.operation, models);
  }
  return Object.fromEntries(
    [...seen].map(([operation, models]) => [operation, [...models].toSorted()]),
  );
};

/** Where the run and the published policy disagree. */
const policyDrift = (policy, used) => {
  const roles = policy?.roles ?? null;
  if (!roles) {
    return [];
  }
  return Object.entries(used)
    .flatMap(([operation, models]) => {
      const named = POLICY_ROLES[operation] ?? [];
      const allowed = named.map((role) => roles[role]).filter(Boolean);
      if (allowed.length === 0) {
        return [];
      }
      const stray = models.filter((model) => !allowed.includes(model));
      if (stray.length === 0) {
        return [];
      }
      return [{ expected: allowed, observed: stray, operation, role: named }];
    })
    .toSorted((a, b) => a.operation.localeCompare(b.operation));
};

/**
 * What the destination set already draws, as words rather than filenames.
 *
 * `AGENTS.md` says it: the gap backlog compares against the house *vocabulary*,
 * not house slugs. blode draws a bin, a calendar and a camera as `trash-1`,
 * `calendar-1` and `camera-1`, so a raw `${slug}.svg` test reports all three as
 * missing. The set is read once and reduced to slugs, their unnumbered stems,
 * and their singular/plural forms — every transform that is safe to apply
 * automatically.
 */
const destinationVocabulary = async (dir) => {
  const words = new Set();
  const add = (word) => {
    if (word.length === 0) {
      return;
    }
    words.add(word);
    words.add(word.endsWith("s") ? word.slice(0, -1) : `${word}s`);
  };
  const files = await readdir(dir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(".svg")) {
      continue;
    }
    const slug = file.slice(0, -4).replace(/-filled$/u, "");
    add(slug);
    add(slug.replace(/-\d+$/u, ""));
  }
  return words;
};

/**
 * A name the destination already answers to under a different spelling.
 *
 * Reported, never acted on. `droplet` against blode's `drop` is a real
 * duplicate and cost a full tournament to discover; `forklift` against `fork`,
 * `headset` against `head` and `parking-meter` against `park` are false
 * friends, and no rule separates them. So the run says what it noticed and
 * leaves the call to a person — the same discipline `concepts propose` keeps
 * by writing a proposal rather than applying one.
 */
const lexicalNeighbours = (slug, words) => {
  const hits = [];
  for (const word of words) {
    if (word.length < 4 || word === slug) {
      continue;
    }
    const nested =
      (slug.startsWith(word) && !slug.startsWith(`${word}-`)) ||
      (word.startsWith(slug) && !word.startsWith(`${slug}-`));
    if (nested) {
      hits.push(word);
    }
  }
  return hits.toSorted();
};

/** Every arm's pair, whether or not it won. A failed arm is evidence. */
const persistCandidates = async (attemptRoot, output) => {
  for (const candidate of output.tournament?.candidates ?? []) {
    const candidateRoot = path.join(attemptRoot, "candidates", safeName(candidate.id));
    await mkdir(candidateRoot, { recursive: true });
    for (const paint of candidate.paints) {
      await persistPaint(candidateRoot, paint);
    }
    await writeJson(path.join(candidateRoot, "candidate.json"), withoutBodies(candidate));
  }
};

/** The delivered pair and the review that accepted it. */
const persistVersions = async (attemptRoot, output) => {
  if (output.kind !== "drawn") {
    return;
  }
  for (const version of output.versions) {
    await persistPaint(attemptRoot, version);
    await writeJson(path.join(attemptRoot, `${version.finish}.audit.json`), {
      agent: version.agent,
      clean: version.clean,
      issues: version.issues,
      steps: version.steps,
      trace: version.trace,
    });
  }
};

/**
 * The sketches the proposal stage drew, and which one it chose.
 *
 * They cost $0.03-$0.15 each and were being discarded, so a weak pair could
 * not be attributed to a bad reference rather than a bad draw — the first
 * question worth asking about one. The chosen sketch is named so the record
 * shows what the drawing was actually working from.
 */
const persistProposal = async (attemptRoot, proposal) => {
  if (!proposal) {
    return;
  }
  const root = path.join(attemptRoot, "proposal");
  await mkdir(root, { recursive: true });
  await Promise.all(
    (proposal.previews ?? []).map((preview, index) => {
      const model = safeName(proposal.models[index] ?? "sketch");
      const chosen = index === proposal.chosen ? ".chosen" : "";
      const name = `${String(index).padStart(2, "0")}-${model}${chosen}.png`;
      return writeFile(path.join(root, name), Buffer.from(preview, "base64"));
    }),
  );
  await writeJson(path.join(root, "proposal.json"), {
    chosen: proposal.chosen,
    cost: proposal.cost,
    models: proposal.models,
    reason: proposal.reason,
    references: proposal.references,
  });
};

const pass = (ok) => (ok ? "passed" : "failed");

const gatesOf = (output) => {
  if (output.kind !== "drawn") {
    return {
      approval: "pending",
      integrity: "failed",
      lint: "failed",
      overview: "pending",
      pair: "failed",
      publish: "pending",
      semantic: "failed",
      visual: "failed",
    };
  }
  const versions = output.versions ?? [];
  const every = (predicate) => versions.length > 0 && versions.every(predicate);
  return {
    approval: "pending",
    integrity: pass(every((version) => version.programComplete)),
    lint: pass(every((version) => version.clean)),
    overview: "pending",
    pair: pass(versions.length === 2),
    publish: "pending",
    semantic: pass(every((version) => (version.agent?.sc ?? 0) >= MINIMUM_SC)),
    visual: pass(every((version) => (version.agent?.pq ?? 0) >= MINIMUM_PQ)),
  };
};

const persistAttempt = async (root, item, output, result) => {
  const number = item.attemptCount + 1;
  const selected = output.tournament?.selected ?? "none";
  const attemptId = `${String(number).padStart(3, "0")}-${safeName(selected)}`;
  const attemptRoot = path.join(root, "explorations", item.slug, "attempts", attemptId);
  await mkdir(attemptRoot, { recursive: true });

  await persistCandidates(attemptRoot, output);
  await persistVersions(attemptRoot, output);

  const policy = await readJson(path.join(root, "model-policy.json")).catch(() => null);
  const used = modelsUsed(output);
  const drift = policyDrift(policy, used);
  const proposal = output.tournament?.proposal ?? null;
  await persistProposal(attemptRoot, proposal);

  await writeJson(path.join(attemptRoot, "decision.json"), {
    accepted: output.kind === "drawn",
    cost: output.tournament?.cost ?? null,
    kind: output.kind,
    minimum: output.tournament?.minimum ?? null,
    models: used,
    policyDrift: drift,
    proposal: proposal
      ? {
          chosen: proposal.chosen,
          models: proposal.models,
          reason: proposal.reason,
        }
      : null,
    selected,
    strategy: output.tournament?.strategy ?? null,
    text: output.text,
  });
  await writeFile(
    path.join(attemptRoot, "events.jsonl"),
    `${compactEvents(result.events)
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`,
  );

  item.attemptCount = number;
  item.costs = [...(item.costs ?? []), ...(output.tournament ? [output.tournament.cost] : [])];
  item.lastSessionId = result.sessionId;
  item.selectedAttempt = output.kind === "drawn" ? `attempts/${attemptId}` : null;
  item.status = output.kind === "drawn" ? "review" : "revision";
  item.lastError = output.kind === "drawn" ? null : output.text;
  item.gates = gatesOf(output);
  await writeJson(path.join(root, "explorations", item.slug, "task.json"), item);
  return { models: used, policyDrift: drift };
};

// oxlint-disable-next-line eslint/complexity -- one command validates budgets, destination drift, durable Eve sessions, and terminal persistence
const generate = async (root, campaign, options) => {
  const limit = Number(options.limit ?? "1");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("--limit must be an integer from 1 to 200.");
  }
  const maxSpend = options["max-spend"] === undefined ? null : Number(options["max-spend"]);
  if (maxSpend !== null && (!(maxSpend >= 0) || !Number.isFinite(maxSpend))) {
    throw new Error("--max-spend must be a non-negative dollar amount.");
  }
  const maxIconSpend = Number(options["max-icon-spend"] ?? String(DEFAULT_ICON_SPEND_USD));
  if (!(maxIconSpend > 0) || !Number.isFinite(maxIconSpend)) {
    throw new Error("--max-icon-spend must be a positive dollar amount.");
  }
  const maxCalls = Number(options["max-calls"] ?? String(DEFAULT_ICON_CALLS));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 400) {
    throw new Error("--max-calls must be an integer from 1 to 400.");
  }
  const selected = campaign.items
    .filter(
      (item) =>
        (["revision", "todo"].includes(item.status) ||
          (Boolean(options.slug) && ["blocked", "exploring"].includes(item.status))) &&
        (options["include-review"] || item.confidence === "high") &&
        (!options.slug || item.slug === options.slug),
    )
    .slice(0, limit);
  if (selected.length === 0) {
    throw new Error(
      "No matching icons. Automatic batches use todo/revision; --slug can also resume blocked/exploring work.",
    );
  }

  const host = options.host ?? process.env.ICONSMITH_EVE_URL ?? "http://127.0.0.1:3210/iconsmith";
  const client = new Client({ host });
  await client.health();
  const destination = path.resolve(
    options.destination ??
      process.env.ICONSMITH_DESTINATION_ICONS ??
      path.join(repoRoot, "../blode-icons/packages/blode-icons-react/icons-svg"),
  );
  const drawnAlready = await destinationVocabulary(destination);
  const startingSpend = costSummary(campaign).knownTournamentUsd;
  const outcomes = [];

  for (const item of selected) {
    const batchSpend = costSummary(campaign).knownTournamentUsd - startingSpend;
    if (maxSpend !== null && batchSpend >= maxSpend) {
      break;
    }
    if (drawnAlready.has(item.slug)) {
      item.lastError = `Skipped: ${item.slug} already exists in the destination library.`;
      item.status = "wont-do";
      outcomes.push({ reason: item.lastError, slug: item.slug, status: item.status });
      await syncCampaign(root, campaign);
      continue;
    }
    const remainingSpend = maxSpend === null ? maxIconSpend : maxSpend - batchSpend;
    if (!(remainingSpend > 0)) {
      break;
    }
    item.status = "exploring";
    item.lastError = null;
    item.startedAt = new Date().toISOString();
    try {
      const request = {
        attachments: [],
        budget: {
          maxCalls,
          maxUsd: Math.min(maxIconSpend, remainingSpend),
        },
        finish: "outlined",
        text: item.slug,
      };
      const created = await client.sessions.create({
        message: `STUDIO_REQUEST\n${JSON.stringify(request)}`,
      });
      item.lastSessionId = created.response.sessionId;
      await writeJson(path.join(checkpointRoot, `${safeName(item.slug)}.json`), {
        campaign: campaign.id,
        sessionId: item.lastSessionId,
        slug: item.slug,
        startedAt: item.startedAt,
        status: "exploring",
      });
      const result = await created.response.result();
      const output = toolOutputOf(result);
      const record = await persistAttempt(root, item, output, result);
      await writeJson(path.join(checkpointRoot, `${safeName(item.slug)}.json`), {
        campaign: campaign.id,
        finishedAt: new Date().toISOString(),
        sessionId: result.sessionId,
        slug: item.slug,
        status: item.status,
      });
      outcomes.push({
        cost: output.tournament?.cost ?? null,
        kind: output.kind,
        // Both belong in the operator's view, not only on disk: one says the
        // run was not allowed to try everything, the other that it did not
        // run on the models the campaign says it runs on.
        // Reported, not acted on: `droplet` against blode's `drop` is a real
        // duplicate that cost a full tournament to find, and `forklift`
        // against `fork` is not. No rule separates them, so a person does.
        nearDestination: lexicalNeighbours(item.slug, drawnAlready),
        policyDrift: record.policyDrift,
        sessionId: result.sessionId,
        slug: item.slug,
        status: item.status,
        unaffordable: output.tournament?.strategy?.unaffordable ?? [],
      });
    } catch (error) {
      item.lastError = error instanceof Error ? error.message : String(error);
      item.status = "blocked";
      await writeJson(path.join(checkpointRoot, `${safeName(item.slug)}.json`), {
        campaign: campaign.id,
        error: item.lastError,
        finishedAt: new Date().toISOString(),
        sessionId: item.lastSessionId,
        slug: item.slug,
        status: item.status,
      });
      outcomes.push({
        error: item.lastError,
        sessionId: item.lastSessionId,
        slug: item.slug,
        status: item.status,
      });
    } finally {
      item.finishedAt = new Date().toISOString();
      await syncCampaign(root, campaign);
    }
  }
  return { campaign: statusOf(campaign), outcomes };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root ?? defaultRoot);
  const campaign = await loadCampaign(root);
  if (options.command === "sync") {
    await syncCampaign(root, campaign);
    return statusOf(campaign);
  }
  if (options.command === "status") {
    return statusOf(campaign);
  }
  if (options.command === "generate") {
    return generate(root, campaign, options);
  }
  throw new Error(`Unknown command "${options.command}". Use status, sync, or generate.`);
};

try {
  const output = await main();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
