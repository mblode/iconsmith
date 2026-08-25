import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { totalUsd } from "iconsmith";
import type { ApiCost } from "iconsmith";

import { studioBudgetSchema, studioRequestSchema } from "@iconsmith/contract/types";

/**
 * `generate.ts` imports its siblings extensionlessly (`"./arsenal"`), which
 * eve's bundler resolves and the node test runner does not — importing it
 * plainly fails with `ERR_MODULE_NOT_FOUND: Cannot find module
 * '.../lib/studio/arsenal'`. The hook appends `.ts` to extensionless relative
 * specifiers whose importer is itself a `.ts` file; without that second
 * condition it also rewrites CommonJS requires inside `node_modules`.
 *
 * Resolution only — the code under test is what eve bundles. Writing those
 * imports with their extensions (which eve also resolves) retires this block.
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
  clampIconBudget,
  DEFAULT_ICON_BUDGET,
  PAIR_TOURNAMENT_RESERVE_CALLS,
  PAIR_TOURNAMENT_RESERVE_USD,
  PROPOSAL_RESERVE_CALLS,
  PROPOSAL_RESERVE_USD,
} = await import("./generate.ts");

describe("clampIconBudget", () => {
  /**
   * The one path anyone can reach without credentials had no ceiling at all.
   * `request.budget` is optional, the Studio composer never sets it, and
   * `runPairTournament` reads `if (!budget) { return true; }` — so every arm
   * was granted unconditionally, and a turn could spend until it ran out of
   * arms rather than out of money.
   *
   * The clamp is the fix, and its direction is the whole point: the request is
   * copied out of a chat message by the orchestrator model, so a hallucinated
   * `maxUsd` must never be able to raise the ceiling. Each of these four cases
   * is a separate way to get that wrong.
   */
  it("falls back to the server default when the caller names no budget", () => {
    // The reachable path. If this returned `undefined` or an empty object,
    // `runPairTournament` would be back to granting every arm.
    assert.deepEqual(clampIconBudget(), {
      maxCalls: DEFAULT_ICON_BUDGET.maxCalls,
      maxUsd: DEFAULT_ICON_BUDGET.maxUsd,
    });
    // And through the real call shape: `clampIconBudget(request.budget)` on a
    // request that named none, which is every request the composer sends.
    const bare = studioRequestSchema.parse({ text: "a compass rose" });
    assert.deepEqual(clampIconBudget(bare.budget), {
      maxCalls: DEFAULT_ICON_BUDGET.maxCalls,
      maxUsd: DEFAULT_ICON_BUDGET.maxUsd,
    });
  });

  it("clamps a request that asks for more than the default, in both fields", () => {
    // `studioBudgetSchema` accepts maxCalls up to 200 and maxUsd up to 100, so
    // this is a request the system will really see. Neither field may pass
    // through: a clamp on one of the two is a ceiling on neither, since an arm
    // is refused only when it fails BOTH reserve checks.
    const clamped = clampIconBudget({ maxCalls: 200, maxUsd: 100 });
    assert.equal(clamped.maxUsd, DEFAULT_ICON_BUDGET.maxUsd);
    assert.equal(clamped.maxCalls, DEFAULT_ICON_BUDGET.maxCalls);
  });

  it("honours a request for less, in both fields", () => {
    // The other half of "a request for restraint". `backlog.mjs` legitimately
    // wants a smaller per-icon cap for a batch run, so a clamp that always
    // returned the default would silently overspend against what the batch
    // driver asked for — and would make the field dead weight.
    const restrained = clampIconBudget({ maxCalls: 30, maxUsd: 0.5 });
    assert.equal(restrained.maxUsd, 0.5);
    assert.equal(restrained.maxCalls, 30);
  });

  it("clamps per field when a request is over on one and under on the other", () => {
    /**
     * The case a single shared `Math.min` on one field, or an all-or-nothing
     * `requested.maxUsd > default ? default : requested`, both get wrong. A
     * mixed request is not exotic: a batch driver asking for a tight dollar cap
     * and a generous call cap produces exactly this shape.
     */
    assert.deepEqual(clampIconBudget({ maxCalls: 200, maxUsd: 0.5 }), {
      maxCalls: DEFAULT_ICON_BUDGET.maxCalls,
      maxUsd: 0.5,
    });
    assert.deepEqual(clampIconBudget({ maxCalls: 30, maxUsd: 100 }), {
      maxCalls: 30,
      maxUsd: DEFAULT_ICON_BUDGET.maxUsd,
    });
  });
});

describe("the default per-icon ceiling", () => {
  /**
   * A budget below the field's own reservations does not make a run cheaper. A
   * reservation is checked before an arm may start, so an under-sized ceiling
   * silently deletes the arms that draw and then reports the result as though
   * they had competed.
   *
   * That is not hypothetical. `gateway-agent` reserved $1.50 and
   * `claude-harness` $1.00 — figures sized for `claude-opus-5` — against a
   * $0.25 per-icon default. Only `host-analog` ($0.055) and `image-agent`
   * ($0.195) could ever be admitted, and they sum to exactly $0.25. Every
   * attempt after that guardrail landed was a two-arm race no matter what was
   * asked for, and nothing said so.
   *
   * So the invariant is a relation, not a number: whatever the reserves and
   * whatever the default, the default must seat the whole field.
   *
   * This paragraph used to record that the constant under-reported the field by
   * one `PROPOSAL_RESERVE_USD`, because the arm table charged that stage to
   * BOTH arms that can trigger it while the constant counted it once. The table
   * was the thing that was wrong: the stage is memoised, `reserve()` seats arms
   * strictly in order and breaks on the first it cannot afford, so
   * `claude-harness` runs only if `image-agent` already ran and already paid.
   * The whole charge now sits on `image-agent`, `HARNESS_PAIR_RESERVE_USD`
   * carries only that arm's own draw, and the constant and the table agree at
   * $1.30 and 67 calls.
   *
   * The correctness of that rests on `image-agent` preceding `claude-harness`
   * in the candidates array. Reordering it would silently under-reserve; the
   * test below is what mechanically enforces the order.
   */
  it("can seat every arm the tournament reserves", () => {
    assert.ok(
      PAIR_TOURNAMENT_RESERVE_USD <= DEFAULT_ICON_BUDGET.maxUsd,
      `the field reserves $${PAIR_TOURNAMENT_RESERVE_USD} but the default ceiling is $${DEFAULT_ICON_BUDGET.maxUsd} — the arms over the line can never start`,
    );
    assert.ok(
      PAIR_TOURNAMENT_RESERVE_CALLS <= DEFAULT_ICON_BUDGET.maxCalls,
      `the field reserves ${PAIR_TOURNAMENT_RESERVE_CALLS} calls but the default ceiling is ${DEFAULT_ICON_BUDGET.maxCalls}`,
    );
  });

  it("is still a ceiling, not merely a large number", () => {
    // The other half of the same relation, and the direction the test above
    // cannot see: it is equally satisfied by a default of $50, which bounds
    // nothing a runaway turn would ever reach. The multiple is loose on purpose
    // so ordinary tuning of a reserve does not trip it; it catches a default
    // that has drifted an order of magnitude away from the field it pays for.
    assert.ok(
      DEFAULT_ICON_BUDGET.maxUsd <= PAIR_TOURNAMENT_RESERVE_USD * 5,
      `a $${DEFAULT_ICON_BUDGET.maxUsd} default against $${PAIR_TOURNAMENT_RESERVE_USD} of reservations is not a ceiling on anything`,
    );
  });
});

describe("the request budget", () => {
  it("is optional, so the server-owned default is the only ceiling on the reachable path", () => {
    /**
     * The whole reason a default had to exist: `runPairTournament` reads
     * `if (!budget) { return true; }` and grants every arm unconditionally, the
     * Studio composer sets no budget, and this field is the thing that would
     * have supplied one. If it ever becomes required, the default ceiling stops
     * being load-bearing and this test is the place that says so.
     */
    const parsed = studioRequestSchema.parse({ text: "a compass rose" });
    assert.equal(parsed.budget, undefined);
  });

  it("validates far above the default, which is exactly why the clamp exists", () => {
    /**
     * Schema validation is not the ceiling and must not be mistaken for one.
     * The caps here are deliberately generous — the field is copied out of a
     * chat message by the orchestrator model, so a hallucinated `maxUsd: 100`
     * parses cleanly. What stops it is `clampIconBudget`, not this schema.
     *
     * Both halves bite: if the caps were tightened to the default, the clamp
     * would look redundant and could be removed; if they were removed
     * altogether, an unbounded number would reach it.
     */
    const extravagant = studioBudgetSchema.parse({ maxCalls: 200, maxUsd: 100 });
    assert.ok(
      extravagant.maxUsd > DEFAULT_ICON_BUDGET.maxUsd,
      "a budget the schema accepts must be able to exceed the default, or the clamp is dead code",
    );
    assert.ok(extravagant.maxCalls > DEFAULT_ICON_BUDGET.maxCalls);
    assert.throws(() => studioBudgetSchema.parse({ maxCalls: 20, maxUsd: 1000 }));
    assert.throws(() => studioBudgetSchema.parse({ maxCalls: 20, maxUsd: 0 }));
  });
});

describe("an unpriced ranking call", () => {
  const unpriced: ApiCost = {
    calls: 1,
    generationIds: [],
    model: "gemini-3.7-flash",
    operation: "rank",
    source: "unpriced",
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 100,
      outputTokens: 10,
      reasoningTokens: 0,
    },
    usd: null,
  };

  it("makes the total unknown rather than free", () => {
    /**
     * This is the premise the tournament budget is computed on. `generate.ts`
     * subtracts the ranking spend from the clamped ceiling as
     * `ceiling.maxUsd - (rankingUsd ?? 0)`, and the `?? 0` is only correct
     * because `totalUsd` answers "unknown" with `null`.
     *
     * It used to read `?? request.budget.maxUsd`, which subtracted the entire
     * budget from itself the moment one ranker call came back unpriced: maxUsd
     * 0, every arm refused for want of a reserve, and the run reported that it
     * had rejected every candidate. An unknown cost is not the whole budget.
     * Failing closed on it is the reserve check's job, and it still does that.
     */
    assert.equal(totalUsd([unpriced]), null);
    assert.equal(totalUsd([{ ...unpriced, source: "gateway", usd: 0.01 }, unpriced]), null);
  });

  it("does not hide a priced total", () => {
    // The other direction, so the assertion above cannot be satisfied by a
    // `totalUsd` that simply always returns null — which would send the
    // subtraction down the `?? 0` path every time and hand the tournament the
    // full ceiling no matter what ranking cost.
    assert.equal(totalUsd([{ ...unpriced, source: "gateway", usd: 0.012 }]), 0.012);
    assert.equal(totalUsd([]), 0);
  });
});

/**
 * The one invariant in this file that is not a relation between constants.
 *
 * `PROPOSAL_RESERVE_USD` sits on `image-agent` alone, and `claude-harness`
 * reserves nothing for it, on the argument that `reserve()` breaks on the first
 * arm it cannot afford — so arms seat strictly in order and `claude-harness`
 * runs only if `image-agent` was already seated and already paid. That argument
 * is true of the array as written and false of the same array reordered, and a
 * reorder is a plausible edit: the arms read as a list of peers.
 *
 * Asserted against the source text because the candidates array is built inside
 * `generateStudioResponse` from that turn's concept and budget, so there is no
 * value to import. That is a real limitation and worth stating: this pins the
 * order of two literals, not the behaviour of `reserve()`. It fails on the edit
 * that would actually cause the under-reserve, which is what it is for.
 */
describe("the arm order the proposal charge depends on", () => {
  const SOURCE = readFileSync(path.join(import.meta.dirname, "generate.ts"), "utf-8");

  it("seats image-agent before claude-harness", () => {
    const image = SOURCE.indexOf('id: "image-agent"');
    const harness = SOURCE.indexOf('id: "claude-harness"');

    assert.ok(image > 0, "image-agent is no longer an arm; move the proposal charge");
    assert.ok(harness > 0, "claude-harness is no longer an arm; move the proposal charge");
    assert.ok(
      image < harness,
      "claude-harness now precedes image-agent, so it can be seated without the " +
        "proposal having been paid for. Move `proposalReserveUsd`/`proposalReserveCalls` " +
        "onto whichever arm is now first, or the turn under-reserves by " +
        `$${PROPOSAL_RESERVE_USD} and ${PROPOSAL_RESERVE_CALLS} calls.`,
    );
  });

  it("keeps the proposal charge on exactly one arm", () => {
    // Matched on the arm-table field rather than the identifier, which also
    // appears in a declaration and in prose. Two arms carrying it is the
    // original defect: $0.30 and 5 calls of dead ceiling held on every run,
    // which refused claude-harness from 8 library arms up instead of 12.
    const carriers = SOURCE.match(/reserveUsd:[^\n]*proposalReserveUsd/gu) ?? [];

    assert.equal(
      carriers.length,
      1,
      `${carriers.length} arms reserve the proposal. It runs at most once per ` +
        "turn (`proposalPromise ??=`), so a second reservation is dead ceiling, " +
        "not safety — that is the double charge coming back.",
    );
  });
});
