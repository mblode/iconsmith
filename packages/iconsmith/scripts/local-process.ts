import { spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as sleep } from "node:timers/promises";

/* oxlint-disable promise/avoid-new, promise/no-multiple-resolved, promise/no-promise-in-callback, promise/param-names, promise/prefer-await-to-callbacks, promise/prefer-await-to-then, eslint/no-loop-func, eslint/no-void, eslint/prefer-const -- event APIs require a promise bridge and timeout is referenced by the exit handler. */

export interface ProcessResult {
  code: number | string | null;
  killed: boolean;
  /** Host observation that the process group and tracked descendants are gone. */
  quiescent?: boolean;
  /** The strongest ownership scope portable host inspection can establish. */
  quiescenceScope?: "process-group-and-observed-descendants";
  stdout: string;
  stderr: string;
}

interface OwnedProcessOptions {
  args: readonly string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  /** Diagnostic-only complete stdout records. Exceptions become process failure. */
  onStdoutLine?: (line: string, signal: AbortSignal) => Promise<void> | void;
  pollMs?: number;
  termGraceMs?: number;
  timeoutMs: number;
}

const processRows = (timeoutMs = 500) => {
  const listed = spawnSync(
    "ps",
    ["-axo", "pid=,ppid=,pgid=,uid=,lstart=,stat="],
    {
      encoding: "utf-8",
      timeout: Math.max(1, timeoutMs),
    }
  );
  if (listed.error || listed.status !== 0) {
    throw new Error(
      `Could not inspect owned processes: ${listed.error ?? listed.stderr}`
    );
  }
  return listed.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter((row) => row.length === 10)
    .map(([pid, ppid, pgid, uid, ...identity]) => ({
      pgid: Number(pgid),
      pid: Number(pid),
      ppid: Number(ppid),
      startToken: identity.slice(0, 5).join(" "),
      state: identity[5] ?? "",
      uid: Number(uid),
    }))
    .filter(({ pgid, pid, ppid, uid }) =>
      [pid, ppid, pgid, uid].every(Number.isFinite)
    );
};

type ProcessRows = ReturnType<typeof processRows>;
type ProcessIdentity = Pick<ProcessRows[number], "pid" | "startToken" | "uid">;
interface ObservedProcess {
  identity: ProcessIdentity;
  retired: boolean;
}
type ObservedProcesses = Map<string, ObservedProcess>;

const identityKey = ({ pid, startToken, uid }: ProcessIdentity) =>
  `${pid}:${uid}:${startToken}`;

const identityMatches = (row: ProcessRows[number], identity: ProcessIdentity) =>
  row.pid === identity.pid &&
  row.uid === identity.uid &&
  row.startToken === identity.startToken &&
  !row.state.startsWith("Z");

const refreshObserved = (observed: ObservedProcesses, rows: ProcessRows) => {
  for (const entry of observed.values()) {
    if (
      !entry.retired &&
      !rows.some((row) => identityMatches(row, entry.identity))
    ) {
      entry.retired = true;
    }
  }
};

const activeObserved = (observed: ObservedProcesses, rows: ProcessRows) =>
  [...observed.values()].filter(
    ({ identity, retired }) =>
      !retired && rows.some((row) => identityMatches(row, identity))
  );

const activeRows = (observed: ObservedProcesses, rows: ProcessRows) => {
  const active = activeObserved(observed, rows);
  return rows.filter((row) =>
    active.some(({ identity }) => identityMatches(row, identity))
  );
};

const observeDescendants = (
  root: number,
  observed: ObservedProcesses,
  rows = processRows(),
  allowRootSeed = false
) => {
  if (allowRootSeed) {
    const rootRow = rows.find(
      (row) =>
        row.pid === root && row.pgid === root && !row.state.startsWith("Z")
    );
    if (rootRow && !observed.has(identityKey(rootRow))) {
      observed.set(identityKey(rootRow), {
        identity: {
          pid: rootRow.pid,
          startToken: rootRow.startToken,
          uid: rootRow.uid,
        },
        retired: false,
      });
    }
  }
  refreshObserved(observed, rows);
  if (activeRows(observed, rows).some(({ pgid }) => pgid === root)) {
    for (const row of rows) {
      if (
        row.pgid === root &&
        !row.state.startsWith("Z") &&
        !observed.has(identityKey(row))
      ) {
        observed.set(identityKey(row), {
          identity: {
            pid: row.pid,
            startToken: row.startToken,
            uid: row.uid,
          },
          retired: false,
        });
      }
    }
  }
  const ownedPids = new Set(
    activeObserved(observed, rows).map(({ identity }) => identity.pid)
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const { pid, ppid, state } = row;
      if (state.startsWith("Z")) {
        continue;
      }
      const key = identityKey(row);
      if (ownedPids.has(ppid) && !observed.has(key)) {
        observed.set(key, {
          identity: {
            pid,
            startToken: row.startToken,
            uid: row.uid,
          },
          retired: false,
        });
        ownedPids.add(pid);
        changed = true;
      }
    }
  }
};

export const ownedSignalTargetsForTest = (
  observed: readonly ProcessIdentity[],
  rows: ProcessRows
) =>
  observed
    .filter((identity) => rows.some((row) => identityMatches(row, identity)))
    .map(({ pid }) => pid);

export const ownedSignalTargetsAfterSnapshotsForTest = (
  identity: ProcessIdentity,
  snapshots: readonly ProcessRows[]
) => {
  const observed: ObservedProcesses = new Map([
    [identityKey(identity), { identity, retired: false }],
  ]);
  for (const rows of snapshots) {
    refreshObserved(observed, rows);
  }
  return activeObserved(observed, snapshots.at(-1) ?? []).map(
    ({ identity: active }) => active.pid
  );
};

export const ownedSignalTargetsAfterObservationForTest = (
  root: number,
  identities: readonly ProcessIdentity[],
  rows: ProcessRows,
  allowRootSeed = false
) => {
  const observed: ObservedProcesses = new Map(
    identities.map((identity) => [
      identityKey(identity),
      { identity, retired: false },
    ])
  );
  observeDescendants(root, observed, rows, allowRootSeed);
  return activeObserved(observed, rows).map(({ identity }) => identity.pid);
};

const signalPid = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(pid, signal);
  } catch (error) {
    // The process can exit after it was observed and before the signal lands.
    // ESRCH proves that this specific PID is already absent; other failures do
    // not establish quiescence and must remain fail-closed.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
};

const signalIdentity = (
  identity: ProcessIdentity,
  signal: NodeJS.Signals,
  inspectionTimeoutMs = 500
) => {
  const rows = processRows(inspectionTimeoutMs);
  if (rows.some((row) => identityMatches(row, identity))) {
    signalPid(identity.pid, signal);
  }
};

const signalGroup = (
  pid: number,
  signal: NodeJS.Signals,
  _inspectionTimeoutMs = 500
) => {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ESRCH") {
      return;
    }
    throw error;
  }
};

/** Stop the owner group, then iteratively freeze descendants still connected by
 * observable parentage. Already reparented double-forks remain outside what a
 * portable process-table observer can prove. */
const freezeOwnedTopology = (
  root: number,
  observed: ObservedProcesses,
  deadlineAt: number
) => {
  const initialRows = processRows(Math.max(1, deadlineAt - Date.now()));
  refreshObserved(observed, initialRows);
  const groupAnchored = activeRows(observed, initialRows).some(
    ({ pgid }) => pgid === root
  );
  if (groupAnchored) {
    signalGroup(root, "SIGSTOP", Math.max(1, deadlineAt - Date.now()));
  }
  let previousSize = -1;
  while (Date.now() < deadlineAt) {
    const rows = processRows(deadlineAt - Date.now());
    previousSize = observed.size;
    observeDescendants(root, observed, rows);
    for (const { identity } of activeObserved(observed, rows)) {
      signalIdentity(identity, "SIGSTOP", deadlineAt - Date.now());
    }
    if (previousSize === observed.size) {
      return true;
    }
  }
  return false;
};

const topologyAbsent = (observed: ObservedProcesses, rows: ProcessRows) => {
  refreshObserved(observed, rows);
  return activeObserved(observed, rows).length === 0;
};

const awaitAbsent = async (
  observed: ObservedProcesses,
  deadlineAt: number,
  pollMs: number
) => {
  while (Date.now() < deadlineAt) {
    if (topologyAbsent(observed, processRows(deadlineAt - Date.now()))) {
      return true;
    }
    // Polls are intentionally sequential observations of one process group.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await sleep(Math.min(pollMs, Math.max(1, deadlineAt - Date.now())));
  }
  return false;
};

const remainingInspectionMs = (deadlineAt: number) =>
  Math.max(1, deadlineAt - Date.now());

const bestEffortKill = (
  root: number,
  observed: ObservedProcesses,
  deadlineAt: number,
  recordFailure: (error: unknown) => void
) => {
  let rows: ProcessRows = [];
  try {
    rows = processRows(remainingInspectionMs(deadlineAt));
    refreshObserved(observed, rows);
    if (activeRows(observed, rows).some(({ pgid }) => pgid === root)) {
      signalGroup(root, "SIGKILL", remainingInspectionMs(deadlineAt));
    }
  } catch (error) {
    recordFailure(error);
  }
  for (const { identity } of activeObserved(observed, rows)) {
    try {
      signalIdentity(identity, "SIGKILL", remainingInspectionMs(deadlineAt));
    } catch (error) {
      recordFailure(error);
    }
  }
};

const killChildHandleIfRunning = (
  child: ReturnType<typeof spawn>,
  recordFailure: (error: unknown) => void
) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch (error) {
    recordFailure(error);
  }
};

const settlesBefore = async (promise: Promise<unknown>, deadlineAt: number) => {
  let timer: NodeJS.Timeout | undefined;
  const completed = await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolveDeadline) => {
      timer = setTimeout(
        () => resolveDeadline(false),
        Math.max(0, deadlineAt - Date.now())
      );
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  return completed;
};

/** Run one provider CLI in its own process group and prove that group is gone. */
export const runOwnedProcess = ({
  args,
  command,
  cwd,
  env,
  maxBuffer,
  onStdoutLine,
  pollMs = 20,
  termGraceMs = 1000,
  timeoutMs,
}: OwnedProcessOptions): Promise<ProcessResult> =>
  // The child-process event API has no promise-native equivalent.
  // oxlint-disable-next-line promise/avoid-new
  new Promise((resolve) => {
    const deadlineAt = Date.now() + timeoutMs;
    const cleanupGraceMs = Math.min(
      termGraceMs,
      Math.max(1, Math.floor(timeoutMs / 3))
    );
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let processInspectionFailed = false;
    let stdoutObserverFailed = false;
    let stdoutObserverQuiescent = true;
    let pendingStdoutLine = "";
    let pendingObserverBytes = 0;
    let observerChain = Promise.resolve();
    const observerAbort = new AbortController();
    const stdoutDecoder = new StringDecoder("utf-8");
    let resolveStdoutDrained: (() => void) | undefined;
    const stdoutDrained = new Promise<void>((resolveDrain) => {
      resolveStdoutDrained = resolveDrain;
    });
    let timeout: NodeJS.Timeout;
    const observedDescendants: ObservedProcesses = new Map();
    const tracker = setInterval(() => {
      if (child.pid !== undefined) {
        try {
          observeDescendants(
            child.pid,
            observedDescendants,
            processRows(remainingInspectionMs(deadlineAt)),
            child.exitCode === null && child.signalCode === null
          );
        } catch (error) {
          processInspectionFailed = true;
          stderr = `${stderr}${error}`;
        }
      }
    }, pollMs);
    const append = (current: string, chunk: string) =>
      (current + chunk).slice(-maxBuffer);
    const failStdoutObserver = (reason: string) => {
      stdoutObserverFailed = true;
      observerAbort.abort();
      stderr = `${stderr}${reason}`;
    };
    const queueStdoutRecord = (record: string) => {
      if (
        !onStdoutLine ||
        stdoutObserverFailed ||
        observerAbort.signal.aborted
      ) {
        return;
      }
      const recordBytes = Buffer.byteLength(record) + 1;
      if (
        recordBytes > maxBuffer ||
        pendingObserverBytes + recordBytes > maxBuffer
      ) {
        failStdoutObserver(
          "Diagnostic stdout observer queue exceeded maxBuffer"
        );
        return;
      }
      pendingObserverBytes += recordBytes;
      observerChain = observerChain
        .then(async () => {
          if (!stdoutObserverFailed && !observerAbort.signal.aborted) {
            await onStdoutLine(record, observerAbort.signal);
          }
        })
        .catch((error: unknown) => {
          failStdoutObserver(String(error));
        })
        .finally(() => {
          pendingObserverBytes -= recordBytes;
        });
    };
    const observeStdout = (text: string, ended = false) => {
      if (
        !onStdoutLine ||
        stdoutObserverFailed ||
        observerAbort.signal.aborted
      ) {
        return;
      }
      pendingStdoutLine += text;
      const records = pendingStdoutLine.split("\n");
      pendingStdoutLine = records.pop() ?? "";
      if (Buffer.byteLength(pendingStdoutLine) > maxBuffer) {
        failStdoutObserver("Diagnostic stdout record exceeded maxBuffer");
        return;
      }
      for (const record of records) {
        queueStdoutRecord(record);
      }
      if (ended && pendingStdoutLine) {
        queueStdoutRecord(pendingStdoutLine);
        pendingStdoutLine = "";
      }
    };
    // Cleanup and all fail-closed result branches share the captured process.
    // oxlint-disable-next-line eslint/complexity
    const finish = async (
      code: number | string | null,
      signal: string | null,
      drainStdout: boolean
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearInterval(tracker);
      if (drainStdout) {
        const drained = await settlesBefore(
          stdoutDrained,
          deadlineAt - cleanupGraceMs
        );
        if (!drained) {
          stdoutObserverQuiescent = false;
          failStdoutObserver(
            "Diagnostic stdout stream did not drain before cleanup reserve"
          );
        }
      } else {
        observerAbort.abort();
      }
      const frozenObserverChain = observerChain;
      const observerCompleted = await settlesBefore(
        frozenObserverChain,
        deadlineAt - cleanupGraceMs
      );
      if (!observerCompleted) {
        stdoutObserverQuiescent = false;
        failStdoutObserver(
          "Diagnostic stdout observer did not quiesce before cleanup reserve"
        );
      }
      if (child.pid === undefined) {
        resolve({
          code: code ?? "spawn-error",
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: stdoutObserverQuiescent,
          stderr,
          stdout,
        });
        return;
      }
      const recordCleanupFailure = (error: unknown) => {
        processInspectionFailed = true;
        stderr = `${stderr}${error}`;
      };
      try {
        const freezeDeadline = Math.min(
          deadlineAt,
          Date.now() + cleanupGraceMs
        );
        if (
          !freezeOwnedTopology(child.pid, observedDescendants, freezeDeadline)
        ) {
          processInspectionFailed = true;
          stderr = `${stderr}Could not freeze owned process topology before cleanup deadline`;
        }
        let rows = processRows(remainingInspectionMs(deadlineAt));
        refreshObserved(observedDescendants, rows);
        if (
          activeRows(observedDescendants, rows).some(
            ({ pgid }) => pgid === child.pid
          )
        ) {
          signalGroup(child.pid, "SIGTERM", remainingInspectionMs(deadlineAt));
        }
        for (const { identity } of activeObserved(observedDescendants, rows)) {
          signalIdentity(identity, "SIGTERM");
        }
        // A stopped owner cannot consume TERM without being resumed, which
        // would reopen the fork race. Escalate immediately while it is frozen.
        rows = processRows(remainingInspectionMs(deadlineAt));
        refreshObserved(observedDescendants, rows);
        if (
          activeRows(observedDescendants, rows).some(
            ({ pgid }) => pgid === child.pid
          )
        ) {
          signalGroup(child.pid, "SIGKILL", remainingInspectionMs(deadlineAt));
        }
        for (const { identity } of activeObserved(observedDescendants, rows)) {
          signalIdentity(identity, "SIGKILL");
        }
        const absent = await awaitAbsent(
          observedDescendants,
          deadlineAt,
          pollMs
        );
        let resultCode: number | string | null =
          processInspectionFailed || !stdoutObserverQuiescent
            ? "quiescence-unproven"
            : "process-group-live";
        if (absent && !processInspectionFailed && stdoutObserverQuiescent) {
          if (stdoutObserverFailed) {
            resultCode = "stdout-observer-failed";
          } else if (timedOut) {
            resultCode = null;
          } else {
            resultCode = code ?? signal;
          }
        }
        resolve({
          code: resultCode,
          killed:
            timedOut ||
            signal !== null ||
            !absent ||
            processInspectionFailed ||
            stdoutObserverFailed,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent:
            absent && !processInspectionFailed && stdoutObserverQuiescent,
          stderr,
          stdout,
        });
      } catch (error) {
        recordCleanupFailure(error);
        killChildHandleIfRunning(child, recordCleanupFailure);
        bestEffortKill(
          child.pid,
          observedDescendants,
          deadlineAt,
          recordCleanupFailure
        );
        resolve({
          code: "quiescence-unproven",
          killed: true,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: false,
          stderr,
          stdout,
        });
      }
    };
    const executionMs = Math.max(1, timeoutMs - cleanupGraceMs * 2);
    timeout = setTimeout(() => {
      timedOut = true;
      void finish(null, null, false);
    }, executionMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      stdout = append(stdout, text);
      observeStdout(text);
    });
    child.stdout.on("end", () => {
      const text = stdoutDecoder.end();
      stdout = append(stdout, text);
      observeStdout(text, true);
      resolveStdoutDrained?.();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk.toString());
    });
    child.on("error", (error) => {
      stderr = `${stderr}${error}`;
      void finish("spawn-error", null, false);
    });
    // `exit` observes the owner independently from inherited pipe closure.
    child.on("exit", (code, signal) => {
      void finish(code, signal, true);
    });
    child.stdin.end();
  });
