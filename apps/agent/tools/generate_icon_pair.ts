/* oxlint-disable unicorn/filename-case -- Eve derives the public tool name from this snake_case filename. */
/* oxlint-disable eslint/no-await-in-loop, promise/avoid-new, promise/prefer-await-to-then --
   `execute` bridges a push callback to a pull generator. The loop exists in
   order to await the next push, and the deferred below is the only way to wait
   for a callback that has not been called yet. The lone `.catch` attaches a
   handler without awaiting, because awaiting it would block the very drain it
   protects. Satisfying any of the three would mean polling. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { defineTool } from "eve/tools";

import {
  MAX_TURN_ATTEMPTS,
  turnFailurePath,
  turnRecordDirectory,
  turnRecordPath,
} from "../lib/turn-record";

import { generateStudioResponse } from "../lib/generate";
import type {
  StudioActivity,
  StudioProgress,
  StudioResponse,
  StudioToolOutput,
} from "@iconsmith/contract/types";
import { studioRequestSchema, studioToolOutputSchema } from "@iconsmith/contract/types";

const activeTurns = new Map<string, ReturnType<typeof generateStudioResponse>>();

/**
 * Where a finished turn is recorded, so a replay returns it instead of drawing
 * it again.
 *
 * `activeTurns` above coalesces a duplicate delivery *within one process*, and
 * that is the only case it can cover. eve's own tool contract says the durable
 * runtime "can retry a step and replay", and a rebuild takes the process — and
 * the map — with it. So a redelivered message found nothing in flight and ran
 * the whole tournament a second time: two identical assistant turns in the
 * transcript, and two identical bills. One observed `dna` turn rendered twice
 * at $1.2141.
 *
 * The trigger is not exotic. The dev watcher rebuilds on any authored source
 * change, so editing a file while a run is in flight is enough. A 719 MB
 * `uv venv` landing in `packages/iconsmith/.scratch` — which `scripts/embed.py`
 * documents creating — is the same event, several thousand times over.
 *
 * `.eve/` is on the watcher's own hardcoded ignore list, which is why the
 * workbench already writes its in-flight checkpoints there: a record written
 * during a turn must not trigger the rebuild that ends it.
 *
 * The address itself lives in `lib/studio/turn-record.ts`, with the reasoning
 * for it, because nothing in this file is importable by the node test runner —
 * its sibling imports are extensionless and only eve's bundler resolves them.
 * The old address was wrong for six recorded generations exactly because no
 * test could name it.
 */
const recordedTurn = async (
  operationId: string,
): Promise<Awaited<ReturnType<typeof generateStudioResponse>> | null> => {
  try {
    const raw = await readFile(turnRecordPath(operationId), "utf-8");
    return JSON.parse(raw) as Awaited<ReturnType<typeof generateStudioResponse>>;
  } catch (error) {
    /**
     * Only "no such file" means the turn has not been delivered.
     *
     * This used to swallow everything and call it undelivered, which is a false
     * inference stated as fact: an unreadable record is evidence the turn WAS
     * delivered, because something wrote a file for it. EACCES, EMFILE, EIO and
     * a truncated JSON all collapsed into "redraw and bill again" — and EMFILE
     * is reachable exactly when it hurts, since eight arms hold sockets and
     * temp files at once. Anything but ENOENT is now a reason to stop.
     */
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw new Error(
      `A record for ${operationId} exists but could not be read, so this turn ` +
        `was not redrawn: redrawing it might bill a tournament twice (${String(error)})`,
      { cause: error },
    );
  }
};

/** How many times this operation has already thrown after spending money. */
const failureCount = async (operationId: string): Promise<number> => {
  try {
    const raw = await readFile(turnFailurePath(operationId), "utf-8");
    const parsed = JSON.parse(raw) as { attempts?: number };
    return typeof parsed.attempts === "number" ? parsed.attempts : 0;
  } catch {
    // A missing or unreadable counter must not itself stop a turn: the worst
    // case is one extra attempt, which is what the counter is bounding anyway.
    return 0;
  }
};

const recordFailure = async (
  operationId: string,
  attempts: number,
  message: string,
): Promise<void> => {
  try {
    await mkdir(turnRecordDirectory, { recursive: true });
    const target = turnFailurePath(operationId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ attempts, message })}\n`);
    await rename(temporary, target);
  } catch {
    // Best effort, like the result record. Losing the counter costs at most an
    // extra attempt; failing the turn here would throw away a real answer.
  }
};

const recordTurn = async (
  operationId: string,
  output: Awaited<ReturnType<typeof generateStudioResponse>>,
): Promise<boolean> => {
  try {
    await mkdir(turnRecordDirectory, { recursive: true });
    // Written then renamed, so a reader never sees half a record.
    const target = turnRecordPath(operationId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(output)}\n`);
    await rename(temporary, target);
    return true;
  } catch (error) {
    // A turn that cannot be recorded is still a turn that was drawn. Failing
    // the tool here would throw away work that already succeeded and was
    // already paid for, so the write stays best-effort.
    //
    // But it must not stay SILENT. The cost is not "a possible re-run": an
    // operation with no record is permanently un-deduped, so every later
    // redelivery redraws in full — and when the cause is environmental, a
    // read-only filesystem or a bad path, that is true of every turn on the
    // host, forever. Swallowing it without a word is why the old address
    // survived six generations of records with nobody noticing.
    process.emitWarning(
      `iconsmith: could not record turn ${operationId} at ${turnRecordDirectory}; ` +
        `it is now un-deduped and any redelivery will redraw and bill again (${String(error)})`,
    );
    return false;
  }
};

const clearFailedTurn = async (
  operationId: string,
  run: ReturnType<typeof generateStudioResponse>,
): Promise<void> => {
  try {
    await run;
  } catch {
    if (activeTurns.get(operationId) === run) {
      activeTurns.delete(operationId);
    }
  }
};

/**
 * A promise resolved from outside itself.
 *
 * Lives at module scope on purpose: declared inside the wait loop it would be a
 * closure over a loop variable, which is both a lint finding and the real
 * hazard the rule is about.
 */
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  // Assigned synchronously by the executor, which is why the non-null
  // assertion is sound: `new Promise` runs its executor before it returns.
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, resolve: open };
};

const generateOnce = (
  request: Parameters<typeof generateStudioResponse>[0],
  operationId: string,
  abortSignal: AbortSignal,
  onActivity?: (activities: readonly StudioActivity[]) => void,
): ReturnType<typeof generateStudioResponse> => {
  const active = activeTurns.get(operationId);
  if (active) {
    // A second delivery in this process joins the run already in flight. It
    // gets the same result and forfeits the progress stream, which is the
    // right trade: the work must not be started twice.
    return active;
  }

  const run = generateStudioResponse(request, { abortSignal, onActivity, operationId });
  activeTurns.set(operationId, run);
  void clearFailedTurn(operationId, run);
  return run;
};

export default defineTool({
  /**
   * Reading a user's image as composition is a consent decision, so it parks
   * the durable session rather than riding back as a tool return value. The
   * old in-band `kind: "approval"` completed the turn immediately, which meant
   * a refresh lost the pending consent and no approval ever reached Agent Runs.
   *
   * Only visual references need consent: text and library-name attachments
   * carry meaning, not geometry.
   */
  approval: ({ toolInput }) =>
    toolInput?.attachments?.some((file) => file.kind === "image" || file.kind === "svg")
      ? "user-approval"
      : "not-applicable",
  description:
    "Run one exact Iconsmith Studio request through clarification handling, paired outlined/filled generation, linting, rendering, and AI visual review. Reading an attached image or SVG as composition requires the user's approval.",
  /**
   * A generator, so the minutes inside one tool call stop being silent.
   *
   * eve publishes every non-final `yield` as an `action.partial` stream event —
   * visible to clients, never entering model history or `toModelOutput`, where
   * only the final yield lands. That is the whole reason this is a generator:
   * the tournament runs up to eight arms, painting and auditing each, and the
   * transcript used to show four coarse rows and then nothing for ten minutes.
   *
   * The bridge is the interesting part. `onActivity` pushes; a generator pulls.
   * So each snapshot is queued and a single-use promise is resolved to wake the
   * loop, which drains whatever is queued and waits again. No polling, and no
   * lost final snapshot: the loop only exits once the run has settled *and* the
   * queue is empty, so a snapshot published in the same tick as the result is
   * still yielded before it.
   *
   * @yields {StudioProgress} One snapshot for each published update.
   */
  async *execute(request, ctx) {
    /**
     * The tool call, not just the turn.
     *
     * Keyed on the turn alone, two calls in one turn shared one slot and
     * `generateOnce` joined the second to the first WITHOUT comparing the
     * request — so "draw me a dog and a cat" returned the dog twice, the second
     * one labelled as the cat. `instructions.md` asks for a second call by name
     * on the declined-approval path, and a flash model emitting two in parallel
     * is ordinary. `callId` is stable for a given call across redeliveries, so
     * adding it fixes the collision without weakening the replay guard.
     */
    const operationId = `${ctx.session.id}-${ctx.session.turn.id}-${ctx.callId}`;
    const recorded = await recordedTurn(operationId);
    if (recorded) {
      // A replay must not redraw. This is the guard that stopped a rebuild
      // mid-run from billing the same tournament twice.
      //
      // Yielded, not returned: eve takes the *final yield* as the result — its
      // own example ends `yield { phase: "complete", report }` with no return —
      // so returning here would hand the model and the client nothing.
      yield recorded;
      return;
    }

    /**
     * A turn that has already thrown twice is not tried a third time.
     *
     * The result record is written only on success, but money is spent on every
     * path: `generateStudioResponse` can throw AFTER the tournament has drawn
     * and audited every arm. eve then redelivers, the result record was never
     * written and `clearFailedTurn` has dropped the in-process guard, so the
     * whole tournament runs again — and again, deterministically, because the
     * failure is usually deterministic. `request.budget` does not bound it:
     * it is per-call and resets on every delivery.
     */
    const attempts = await failureCount(operationId);
    if (attempts >= MAX_TURN_ATTEMPTS) {
      yield {
        kind: "error",
        text:
          `I stopped drawing “${request.text}” after ${attempts} attempts that ` +
          "each failed part-way through and each cost money. Something in the " +
          "pipeline is failing the same way every time, so trying again would " +
          "spend more without producing an icon.",
      } satisfies StudioResponse;
      return;
    }

    const queue: StudioProgress[] = [];
    let gate = deferred();
    let settled = false;
    const nudge = (): void => {
      const opened = gate;
      gate = deferred();
      opened.resolve();
    };

    const run = generateOnce(request, operationId, ctx.abortSignal, (activities) => {
      queue.push({ activities, kind: "progress" });
      nudge();
    });

    /**
     * The record is written here, not after the loop.
     *
     * A generator only runs its tail if the consumer keeps pulling. Recording
     * after the loop meant an abandoned iteration — a cancelled turn, a
     * consumer that breaks early — skipped the record entirely, and the next
     * delivery would redraw a tournament that had already been paid for. That
     * is the exact failure the record exists to prevent, so it cannot depend on
     * whether anyone is still listening.
     *
     * `finally` rather than a `.then` chain, so a rejection still wakes the
     * loop and still propagates when the result is awaited below.
     */
    const finished = (async () => {
      try {
        const output = await run;
        const stored = await recordTurn(operationId, output);
        // Once the atomic record is durable, it is the replay authority and
        // retaining the settled promise forever only leaks one entry per turn.
        // If persistence failed, keep the promise as the process-local guard:
        // dropping both protections could bill the same operation again.
        if (stored && activeTurns.get(operationId) === run) {
          activeTurns.delete(operationId);
        }
        return output;
      } catch (error) {
        // Counted here rather than in `clearFailedTurn`, which only tidies the
        // in-process map. A failure that already drew and audited eight arms is
        // an expenditure, and the record has to mark expenditure rather than
        // only completion — otherwise nothing bounds the retries.
        await recordFailure(operationId, attempts + 1, String(error));
        throw error;
      } finally {
        settled = true;
        nudge();
      }
    })();
    // If the consumer abandons this generator, nothing below ever awaits
    // `finished`. Attaching a handler now keeps that from surfacing as an
    // unhandled rejection; the `await` further down still sees the failure
    // whenever iteration does continue.
    void finished.catch(() => {
      // Reported through the await below, or deliberately dropped when the
      // consumer walked away.
    });

    while (true) {
      while (queue.length > 0) {
        const snapshot = queue.shift();
        if (snapshot) {
          yield snapshot;
        }
      }
      // Checked after draining, so a snapshot pushed in the same tick as the
      // result is yielded rather than stranded.
      if (settled) {
        break;
      }
      await gate.promise;
    }

    // The final yield is the result. Anything after it is not read.
    yield await finished;
  },
  inputSchema: studioRequestSchema,
  outputSchema: studioToolOutputSchema,
  toModelOutput(output: StudioToolOutput) {
    /**
     * Only the final yield reaches the model — eve's contract is explicit that
     * partial snapshots never enter model history or this function. But the
     * generator's yield and return types union together in the signature, so
     * the narrowing happens here rather than by widening what the tool claims
     * to output. If this branch ever runs, the contract changed.
     */
    if (output.kind === "progress") {
      return { type: "text", value: "The Studio is still drawing this pair." };
    }
    if (output.kind === "drawn") {
      const [lead] = output.versions;
      return {
        type: "text",
        value: `Generated ${output.versions.length} reviewed paints for ${lead?.name ?? "the icon"}. The Studio has the exact renders and audit data.`,
      };
    }
    if (output.kind === "questions") {
      return { type: "text", value: "The Studio is showing the required clarification questions." };
    }
    return { type: "text", value: output.text };
  },
});
