import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Where a finished Studio turn is recorded, so a redelivery replays it instead
 * of drawing — and paying for — the tournament a second time.
 *
 * This lives here rather than beside its only caller so that a test can assert
 * it. `agent/tools/generate_icon_pair.ts` imports its siblings extensionlessly,
 * which eve's bundler resolves and the node test runner does not, so nothing in
 * that file is reachable from a test at all. That is not a detail: the address
 * below was wrong for six recorded generations precisely because no test could
 * name it.
 *
 * **The address it replaces.** It used to be
 * `path.join(import.meta.dirname, "../../.eve/studio-turns")`. eve compiles every
 * authored module into one bundle under
 * `<snapshot>/source/apps/web/.eve/compile/authored-modules/` and leaves
 * `import.meta.dirname` in it verbatim, so records landed in
 * `<snapshot>/source/apps/web/.eve/.eve/studio-turns` — the `.eve` doubled, and
 * the whole path inside the per-rebuild snapshot. Two consequences, both
 * observed:
 *
 * 1. A rebuild mints a new snapshot whose record directory is empty, so the
 *    redelivery that the rebuild itself causes finds nothing and redraws. The
 *    guard could not survive the one event it was written for.
 * 2. eve retires and then deletes old snapshots, taking their records with them.
 *    Six generations were seen holding one record each, every one from a
 *    distinct session — not a single replay had ever been served.
 *
 * **Why `tmpdir()`.** The record has to sit outside the snapshot tree, and it
 * has to be writable in both places this runs. The bundle directory is
 * read-only on Vercel, and `process.cwd()` is documented elsewhere in this app
 * as not being the Next app root under eve's service. `tmpdir()` is the only
 * root that satisfies both.
 *
 * **What this does not fix.** `tmpdir()` is per-instance and per-cold-start, so
 * two Vercel instances serving one redelivery still both draw, and a deploy
 * clears it. That is a far smaller hole than the old address — which amounted
 * to no durable guard at all — but it is not idempotency. A correct fix needs a
 * store shared across instances, and `ICONSMITH_TURN_RECORD_DIR` is the seam to
 * point at one.
 */
export const turnRecordDirectory =
  process.env.ICONSMITH_TURN_RECORD_DIR ?? path.join(tmpdir(), "iconsmith-studio-turns");

/** One record per operation, named for what it replays. */
export const turnRecordPath = (operationId: string): string =>
  path.join(turnRecordDirectory, `${operationId.replaceAll(/[^\w.-]+/gu, "_")}.json`);

/**
 * Where a failed attempt is counted.
 *
 * Separate from the result record because it answers a different question: not
 * "what did this turn produce" but "how many times has this turn already cost
 * money without producing anything".
 */
export const turnFailurePath = (operationId: string): string =>
  path.join(turnRecordDirectory, `${operationId.replaceAll(/[^\w.-]+/gu, "_")}.failures.json`);

/**
 * How many times a turn may throw before its failure is replayed instead of
 * re-run.
 *
 * The record is written only on success, but money is spent on every path — a
 * tournament that draws and audits eight arms and then throws has already been
 * billed. eve redelivers, both guards miss (the result record was never written
 * and `clearFailedTurn` drops the in-process one), and the whole tournament runs
 * again. `request.budget` is no backstop: it is per-call and resets on every
 * delivery, so N retries cost N budgets rather than one.
 *
 * One retry, because a first failure is as likely to be transient as not and
 * recovering from it is the reason the durable runtime retries at all. The
 * second is evidence the failure is deterministic, and repeating it only buys
 * another bill.
 */
export const MAX_TURN_ATTEMPTS = 2;
