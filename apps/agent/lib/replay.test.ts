import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

/**
 * Lives here rather than beside the module it tests, because eve treats every
 * file under `agent/tools/` as a TOOL DEFINITION and discovery refuses the
 * name outright: `Tool filename "replay.test" is not a legal tool name`. Placed
 * there first it looked fine — tests green, typecheck clean — and the dev
 * server would not boot at all. A test that cannot sit beside its subject is
 * worth a line saying why.
 *
 * Nothing in `generate_icon_pair.ts` was reachable from a test, and that is why
 * the replay guard shipped broken: it imports its siblings extensionlessly
 * (`"../lib/turn-record"`), which eve's bundler resolves and the node
 * test runner does not. Verified directly — importing the module under
 * `node --experimental-strip-types` fails with
 * `ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/studio/turn-record'`.
 *
 * So the resolution gap is closed here rather than left as a reason not to
 * test the most expensive file in the app. The hook appends `.ts` to
 * extensionless *relative* specifiers, and only when the importer is itself a
 * `.ts` file — without that guard it also rewrites CommonJS requires inside
 * `node_modules` (`detect-libc` fails first) and the import never completes.
 *
 * This changes resolution only; the code under test is byte-identical to what
 * eve bundles. The real fix is to write those imports with their extensions,
 * which eve's bundler also resolves, and then this block can go.
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

/**
 * Every test here drives the real `execute`, so a regression in the guard it
 * pins means the tournament actually runs. Two independent brakes:
 *
 * 1. `ctx.abortSignal` is already aborted, and `generateStudioResponse` opens
 *    with `options.abortSignal?.throwIfAborted()` — the first statement in the
 *    function, before any provider is touched.
 * 2. The provider credentials are removed from this process, so a call cannot
 *    be billed even if that line moves. `node --test` forks a process per file,
 *    so this touches nothing else.
 *
 * A test that reaches generation therefore fails loudly and free, which is the
 * only honest way to assert "it did not draw".
 */
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.VERCEL_OIDC_TOKEN;

// `turnRecordDirectory` is resolved once at module load, so the override has to
// be bound before anything imports it.
const recordDirectory = await mkdtemp(path.join(tmpdir(), "iconsmith-replay-test-"));
process.env.ICONSMITH_TURN_RECORD_DIR = recordDirectory;

const { MAX_TURN_ATTEMPTS, turnFailurePath, turnRecordPath } = await import("./turn-record.ts");
const toolModule = await import("../../../apps/agent/tools/generate_icon_pair.ts");
const tool = toolModule.default;
type ToolContext = Parameters<typeof tool.execute>[1];

after(async () => {
  await rm(recordDirectory, { force: true, recursive: true });
});

/**
 * The operation id the tool builds is `session.id-turn.id-callId`. Composing it
 * here rather than passing it in is deliberate: a test that wrote the record at
 * an id of its own choosing would pass even if the tool stopped keying on
 * `callId`, which is the field that was added to stop "draw a dog and a cat"
 * returning the dog twice.
 */
const context = (ids: {
  callId: string;
  sessionId: string;
  turnId: string;
}): { ctx: ToolContext; operationId: string } => ({
  ctx: {
    abortSignal: AbortSignal.abort(),
    callId: ids.callId,
    session: { id: ids.sessionId, turn: { id: ids.turnId } },
  } as unknown as ToolContext,
  operationId: `${ids.sessionId}-${ids.turnId}-${ids.callId}`,
});

const drain = async (ctx: ToolContext, text = "a compass rose"): Promise<unknown[]> => {
  const yielded: unknown[] = [];
  for await (const value of tool.execute({ text }, ctx)) {
    yielded.push(value);
  }
  return yielded;
};

describe("the replay guard", () => {
  it("returns the recorded turn instead of drawing it a second time", async () => {
    /**
     * One observed `dna` turn rendered twice at $1.2141 because a rebuild took
     * the in-process `activeTurns` map with it and the redelivery found nothing
     * in flight. This is the assertion that would have failed: a record on disk
     * must short-circuit `execute` before it reaches `generateStudioResponse`.
     *
     * The aborted signal is what makes it bite. If the guard is removed the run
     * throws instead of yielding, so "it replayed" cannot be faked by an
     * implementation that draws and happens to return the same shape.
     */
    const { ctx, operationId } = context({
      callId: "call_replay",
      sessionId: "sess_01REPLAY",
      turnId: "turn_0",
    });
    const recorded = {
      items: [],
      kind: "questions",
      text: "recorded-turn-marker",
    };
    await writeFile(turnRecordPath(operationId), `${JSON.stringify(recorded)}\n`);

    const yielded = await drain(ctx);
    assert.deepEqual(yielded, [recorded]);
  });

  it("keys the record on the call, not only the turn", async () => {
    /**
     * Two tool calls in one turn shared a slot when the id was
     * `session-turn` alone, and the second call was answered with the first
     * call's result. A record written for one `callId` must therefore be
     * invisible to another.
     *
     * "Invisible" is observable here as reaching generation, which the aborted
     * signal turns into a rejection rather than a bill.
     */
    const first = context({
      callId: "call_a",
      sessionId: "sess_01COLLIDE",
      turnId: "turn_0",
    });
    await writeFile(
      turnRecordPath(first.operationId),
      `${JSON.stringify({ items: [], kind: "questions", text: "first-call" })}\n`,
    );

    const second = context({
      callId: "call_b",
      sessionId: "sess_01COLLIDE",
      turnId: "turn_0",
    });
    await assert.rejects(
      () => drain(second.ctx),
      (error: unknown) => /abort/iu.test(String(error)),
      "a different call id must not replay another call's record",
    );
  });

  it("refuses the turn when its record exists but cannot be read", async () => {
    /**
     * This used to swallow every read error and call the turn undelivered,
     * which is a false inference stated as fact: a file exists, so something
     * delivered this turn. EACCES, EIO and a truncated record all collapsed
     * into "redraw and bill again", and a truncated record is the reachable
     * one — the write is `writeFile` then `rename`, but a half-written record
     * from an older non-atomic write, or a full disk, still reads back as
     * invalid JSON.
     *
     * The correct behaviour is to stop, and to say why. Asserting the message
     * matters as much as the throw: an unexplained failure here is
     * indistinguishable from the pipeline being broken.
     */
    const { ctx, operationId } = context({
      callId: "call_corrupt",
      sessionId: "sess_01CORRUPT",
      turnId: "turn_0",
    });
    await writeFile(turnRecordPath(operationId), '{"kind":"questi');

    await assert.rejects(
      () => drain(ctx),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("could not be read") &&
        error.message.includes(operationId),
      "an unreadable record must stop the turn, naming the operation",
    );
  });
});

describe("the failed-attempt ceiling", () => {
  it("stops re-spending once a turn has failed MAX_TURN_ATTEMPTS times", async () => {
    /**
     * The result record is written only on success, but money is spent on every
     * path: `generateStudioResponse` can throw after the tournament has drawn
     * and audited every arm. eve redelivers, the result record was never
     * written, and the whole field runs again — deterministically, because a
     * deterministic failure fails the same way every time. `request.budget` is
     * no backstop; it is per-call and resets on every delivery, so N retries
     * cost N budgets.
     *
     * So the counter must be read *before* the run, and must end the turn.
     */
    const { ctx, operationId } = context({
      callId: "call_spent",
      sessionId: "sess_01SPENT",
      turnId: "turn_0",
    });
    await writeFile(
      turnFailurePath(operationId),
      `${JSON.stringify({ attempts: MAX_TURN_ATTEMPTS, message: "boom" })}\n`,
    );

    const yielded = await drain(ctx, "a spent compass");
    assert.equal(yielded.length, 1);
    const [only] = yielded as [{ kind: string; text: string }];
    assert.equal(only.kind, "error");
    // The user is told this is terminal and why, not handed a bare failure —
    // "try again" is exactly the wrong prompt when every attempt bills.
    assert.match(only.text, /a spent compass/u);
    assert.match(only.text, new RegExp(`${MAX_TURN_ATTEMPTS} attempts`, "u"));
  });

  it("still runs at one attempt below the ceiling, and counts the new failure", async () => {
    /**
     * Without this, a guard that refused *every* turn would pass the test
     * above. The ceiling has to be a ceiling rather than a wall, and the count
     * has to advance — a counter that never increments bounds nothing.
     */
    const { ctx, operationId } = context({
      callId: "call_one_left",
      sessionId: "sess_01ONELEFT",
      turnId: "turn_0",
    });
    await writeFile(
      turnFailurePath(operationId),
      `${JSON.stringify({ attempts: MAX_TURN_ATTEMPTS - 1, message: "boom" })}\n`,
    );

    await assert.rejects(
      () => drain(ctx),
      (error: unknown) => /abort/iu.test(String(error)),
      "an attempt below the ceiling must still be tried",
    );

    const counter = JSON.parse(await readFile(turnFailurePath(operationId), "utf-8")) as {
      attempts: number;
    };
    assert.equal(counter.attempts, MAX_TURN_ATTEMPTS);
  });

  it("is a small positive integer, because its whole job is bounding re-spend", () => {
    // A fractional or zero value disables the comparison; a large one restores
    // the unbounded retry loop it exists to close. One retry is the documented
    // intent: a first failure may be transient, a second is evidence it is not.
    assert.ok(Number.isInteger(MAX_TURN_ATTEMPTS), `${MAX_TURN_ATTEMPTS} is not an integer`);
    assert.ok(MAX_TURN_ATTEMPTS >= 1, "a turn must be allowed at least one attempt");
    assert.ok(MAX_TURN_ATTEMPTS <= 3, `${MAX_TURN_ATTEMPTS} attempts is not a bound on re-spend`);
  });
});

describe("turnFailurePath", () => {
  it("never addresses the same file as the result record", () => {
    // They answer different questions — "what did this produce" and "how much
    // has this already cost without producing anything" — and the ceiling above
    // reads one while the replay guard reads the other. Collapse them and a
    // successful record reads back as a failure count of zero, or worse.
    for (const id of ["wrun_01ABC-turn_0-call_0", "s-t-c", "a b c"]) {
      assert.notEqual(turnRecordPath(id), turnFailurePath(id));
    }
  });

  it("cannot be steered out of the record directory by a separator", () => {
    // The operation id is assembled from runtime-supplied session, turn and
    // call ids. `turnRecordPath` is already pinned for this in
    // `lib/studio/turn-record.test.ts`; the failure counter shares the same
    // exposure and had no assertion at all.
    assert.equal(path.dirname(turnFailurePath("a/../../b")), recordDirectory);
    assert.equal(path.dirname(turnFailurePath("../../etc/passwd")), recordDirectory);
  });
});
