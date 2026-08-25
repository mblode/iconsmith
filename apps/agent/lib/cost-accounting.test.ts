import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import type { ApiCost, TournamentRun } from "iconsmith";

/**
 * The same resolver shim `generate.budget.test.ts` carries, and for the same
 * reason: `generate.ts` imports its siblings extensionlessly, which eve's
 * bundler resolves and the node test runner does not.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith(".") &&
      !/\.\w+$/u.test(specifier) &&
      context.parentURL?.endsWith(".ts")
    ) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});

const {
  candidateCosts,
  DEFAULT_ICON_BUDGET,
  PAIR_AUDIT_RESERVE_USD,
  PAIR_TOURNAMENT_RESERVE_CALLS,
  PAIR_TOURNAMENT_RESERVE_USD,
  PROPOSAL_RESERVE_CALLS,
  PROPOSAL_RESERVE_USD,
} = await import("./generate.ts");

const billed = (usd: number | null, calls: number): ApiCost => ({
  calls,
  generationIds: [],
  model: "google/gemini-3.7-flash",
  operation: "icon-generation",
  source: usd === null ? "unpriced" : "gateway",
  usage: {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 1000,
    outputTokens: 200,
    reasoningTokens: 0,
  },
  usd,
});

/** An arm that threw: `paints` is empty, and whatever it was billed for before
 *  it threw is on `partialCosts`. This is the only shape the tournament ever
 *  puts costs there in. */
const failedArm = (partialCosts: ApiCost[]): TournamentRun => ({
  accepted: false,
  failure: "the harness timed out after the outlined paint",
  id: "claude-harness",
  label: "Claude Gateway code harness + repair",
  paints: [],
  partialCosts,
  score: 0,
});

describe("the cost of an arm that failed", () => {
  /**
   * `candidateCosts` mapped only `candidate.paints`, and a failed arm has
   * `paints: []` — so an arm that made billed provider calls and then threw was
   * charged $0.00 to every ledger in this app. `partialCosts`, which
   * `runPairTournament` populates from exactly those calls, was read nowhere.
   *
   * The tournament's own `recordActual` has always summed both, so the two
   * ledgers disagreed: `measuredCost` under-counted, `completeBudget.actualUsd`
   * under-reported, `measuredBudgetOverrun` under-fired on the total it is
   * handed, `backlog.mjs`'s campaign spend under-counted (compounding the
   * unpriced-icon hole it also had), and the thinking card rendered
   * "Arm failed · 0 calls" for an arm that billed several.
   */
  it("is counted, not dropped", () => {
    const costs = candidateCosts(failedArm([billed(0.21, 4), billed(0.06, 1)]));
    assert.equal(costs.length, 2);
    assert.equal(
      costs.reduce((sum, cost) => sum + cost.calls, 0),
      5,
    );
    assert.equal(
      costs.reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
      0.27,
    );
  });

  it("is counted even when it is fully priced, which produced no signal at all", () => {
    // The worst case for a reader, because nothing else flags it: an arm whose
    // partial spend is entirely priced leaves `totalUsd` non-null, so the
    // "cost incomplete" wording never appears and the missing money is
    // invisible rather than merely unknown.
    const costs = candidateCosts(failedArm([billed(0.43, 9)]));
    assert.ok(costs.every((cost) => cost.usd !== null));
    assert.equal(costs[0]?.usd, 0.43);
  });

  it("adds nothing for an arm that was billed nothing before it threw", () => {
    // The other direction, so the assertion above cannot be satisfied by a
    // helper that invents a cost. A client-side timeout that drew nothing is
    // free, and must stay free — charging it would mark the whole run's ledger
    // unknown, which is the fault this repo already fixed once.
    assert.deepEqual(candidateCosts(failedArm([])), []);
    assert.deepEqual(candidateCosts({ ...failedArm([]), partialCosts: undefined }), []);
  });
});

describe("the memoised proposal stage", () => {
  /**
   * `ensureProposal` is `proposalPromise ??=`: the stage runs at most once per
   * turn, so at most one arm can pay for it. Both `image-agent` and
   * `claude-harness` reserved it, which held $0.30 and 5 calls of ceiling that
   * nothing could ever spend — and a reservation is checked before an arm may
   * start, so the arms it pushed over the line were the ones that draw.
   *
   * The library arms are prepended one per existing house twin at
   * `PAIR_AUDIT_RESERVE_USD` each, so the headroom left by the fixed field is
   * measured in library arms. That is the number this pins.
   */
  const libraryArmsThatFit = (fieldUsd: number): number =>
    Math.floor((DEFAULT_ICON_BUDGET.maxUsd - fieldUsd) / PAIR_AUDIT_RESERVE_USD);

  it("is reserved once, not once per arm that can trigger it", () => {
    const once = libraryArmsThatFit(PAIR_TOURNAMENT_RESERVE_USD);
    const twice = libraryArmsThatFit(PAIR_TOURNAMENT_RESERVE_USD + PROPOSAL_RESERVE_USD);
    assert.equal(
      twice,
      7,
      "the double charge refused the last arm from 8 library arms up; if this moved, the measured before-figure in generate.ts is stale",
    );
    assert.equal(
      once,
      12,
      "one charge should seat 12 library arms on dollars; if this moved, the measured after-figure in generate.ts is stale",
    );
  });

  it("leaves the call ceiling, not the dollar ceiling, as the binding constraint", () => {
    /**
     * Worth pinning because it is the half that is easy to get wrong when
     * reading only the dollar arithmetic: on dollars alone a single proposal
     * charge seats 12 library arms, but each one also costs 2 calls and the
     * call ceiling runs out at 11. Quoting 12 as the new cutoff would overstate
     * the fix by one arm.
     */
    const byCalls = Math.floor((DEFAULT_ICON_BUDGET.maxCalls - PAIR_TOURNAMENT_RESERVE_CALLS) / 2);
    assert.equal(byCalls, 11);
    assert.ok(
      byCalls < libraryArmsThatFit(PAIR_TOURNAMENT_RESERVE_USD),
      "calls bind before dollars, so the honest cutoff is the call figure",
    );
  });

  it("is counted exactly once in the field's own total", () => {
    // Guards the direction the headroom tests cannot see: a sum that dropped
    // the proposal altogether would seat MORE library arms and pass them both,
    // while under-provisioning `backlog.mjs`, which sizes its per-icon default
    // from this constant.
    assert.ok(PAIR_TOURNAMENT_RESERVE_USD > PROPOSAL_RESERVE_USD);
    assert.ok(PAIR_TOURNAMENT_RESERVE_CALLS > PROPOSAL_RESERVE_CALLS);
    assert.equal(PAIR_TOURNAMENT_RESERVE_USD, 1.3);
    assert.equal(PAIR_TOURNAMENT_RESERVE_CALLS, 67);
  });
});

/**
 * `backlog.mjs` runs `main()` on import, so its helpers cannot be imported.
 * `status` reads the campaign and prints the ledger without contacting Eve, so
 * the money arithmetic is exercised through the command the operator runs.
 */
const run = promisify(execFile);
/** `backlog.mjs` moved with the agent it drives; this is `apps/agent`. */
const agentRoot = path.resolve(import.meta.dirname, "../../../apps/agent");

const campaignFixture = (costs: { calls: number; totalUsd: number | null }[]) => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "central-gaps-v1",
  items: Array.from({ length: 200 }, (_, index) => ({
    attemptCount: costs[index] ? 1 : 0,
    confidence: "high",
    costs: costs[index] ? [costs[index]] : [],
    id: `central-${String(index).padStart(3, "0")}`,
    lastError: null,
    lastSessionId: null,
    rank: index,
    risk: null,
    selectedAttempt: null,
    slug: `fixture-${index}`,
    sources: ["fixture"],
    status: "todo",
  })),
  quality: {
    minimum: { pq: 8, sc: 8 },
    pairRequired: true,
    stopScore: 9.75,
    visualFindingsAllowed: 0,
  },
  schema: 1,
  target: "central",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const statusOf = async (costs: { calls: number; totalUsd: number | null }[]) => {
  const root = await mkdtemp(path.join(tmpdir(), "iconsmith-backlog-"));
  await writeFile(
    path.join(root, "campaign.json"),
    JSON.stringify(campaignFixture(costs), null, 2),
  );
  const { stdout } = await run("node", ["scripts/backlog.mjs", "status", "--root", root], {
    cwd: agentRoot,
  });
  return JSON.parse(stdout).costs;
};

describe("the campaign ledger", () => {
  /**
   * Studio's `measuredCost.totalUsd` is null whenever ANY call in the icon is
   * unpriced, so `sum + (cost.totalUsd ?? 0)` booked the WHOLE icon at $0.00.
   * With the batch spend pinned at zero, `remainingSpend` stayed at the full
   * cap on every iteration and the per-icon clamp degenerated to
   * `maxIconSpend`: `--limit 200 --max-spend 5` would bill up to 200 x $2 =
   * $400 against a $5 cap while the ledger printed $0.00.
   */
  it("bills an unpriced icon at the per-icon ceiling rather than at zero", async () => {
    const costs = await statusOf([
      { calls: 12, totalUsd: 0.42 },
      { calls: 7, totalUsd: null },
    ]);
    assert.equal(costs.knownTournamentUsd, 0.42);
    assert.equal(costs.unpricedIcons, 1);
    // $0.42 measured plus one icon bounded at the $2 default ceiling. The old
    // number here was $0.42, and the gate read it.
    assert.equal(costs.billedTournamentUsd, 2.42);
    assert.equal(costs.tournamentHasUnpricedCalls, true);
  });

  it("does not inflate a campaign whose every icon is priced", async () => {
    // The other direction: a fail-closed rule that always charged the ceiling
    // would stop batches that are well inside their cap, which is a different
    // way to make the gate useless.
    const costs = await statusOf([
      { calls: 12, totalUsd: 0.42 },
      { calls: 9, totalUsd: 0.31 },
    ]);
    assert.equal(costs.unpricedIcons, 0);
    assert.equal(costs.billedTournamentUsd, costs.knownTournamentUsd);
    assert.equal(costs.tournamentHasUnpricedCalls, false);
  });

  it("still reports the complete total as unknown", async () => {
    // The bound is not the total. Eve's own orchestration turns are not priced
    // in the Studio tool result at all, so `totalUsd` stays null and nothing
    // downstream may present the billed figure as what the campaign cost.
    const costs = await statusOf([
      { calls: 12, totalUsd: 0.42 },
      { calls: 7, totalUsd: null },
    ]);
    assert.equal(costs.totalUsd, null);
  });
});
