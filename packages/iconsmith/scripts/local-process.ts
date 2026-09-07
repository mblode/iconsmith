import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/* oxlint-disable promise/no-multiple-resolved, promise/no-promise-in-callback, promise/prefer-await-to-callbacks, promise/prefer-await-to-then, eslint/no-void, eslint/prefer-const -- event APIs require a promise bridge and timeout is referenced by the exit handler. */

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
  pollMs?: number;
  termGraceMs?: number;
  timeoutMs: number;
}

const processRows = (timeoutMs = 500) => {
  const listed = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat="], {
    encoding: "utf-8",
    timeout: Math.max(1, timeoutMs),
  });
  if (listed.error || listed.status !== 0) {
    throw new Error(
      `Could not inspect owned processes: ${listed.error ?? listed.stderr}`
    );
  }
  return listed.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter((row) => row.length === 4)
    .map(
      ([pid, ppid, pgid, state]) =>
        [Number(pid), Number(ppid), Number(pgid), state] as const
    )
    .filter((row) => row.slice(0, 3).every(Number.isFinite));
};

type ProcessRows = ReturnType<typeof processRows>;

const livePids = (rows: ProcessRows) =>
  new Set(rows.filter((row) => !row[3].startsWith("Z")).map(([pid]) => pid));

const groupMembers = (group: number, inspectionTimeoutMs = 500) =>
  processRows(inspectionTimeoutMs)
    .filter((row) => row[2] === group && !row[3].startsWith("Z"))
    .map(([member]) => member);

const observeDescendants = (
  root: number,
  observed: Set<number>,
  rows = processRows()
) => {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid, , state] of rows) {
      if (state.startsWith("Z")) {
        continue;
      }
      if ((ppid === root || observed.has(ppid)) && !observed.has(pid)) {
        observed.add(pid);
        changed = true;
      }
    }
  }
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

const signalGroup = (
  pid: number,
  signal: NodeJS.Signals,
  inspectionTimeoutMs = 500
) => {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ESRCH") {
      return;
    }
    if (code === "EPERM" && process.platform !== "win32") {
      for (const member of groupMembers(pid, inspectionTimeoutMs)) {
        signalPid(member, signal);
      }
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
  observed: Set<number>,
  deadlineAt: number
) => {
  signalGroup(root, "SIGSTOP", Math.max(1, deadlineAt - Date.now()));
  let previousSize = -1;
  while (Date.now() < deadlineAt) {
    const rows = processRows(deadlineAt - Date.now());
    const live = livePids(rows);
    previousSize = observed.size;
    observeDescendants(root, observed, rows);
    for (const descendant of observed) {
      if (live.has(descendant)) {
        signalPid(descendant, "SIGSTOP");
      }
    }
    if (previousSize === observed.size) {
      return true;
    }
  }
  return false;
};

const topologyAbsent = (
  group: number,
  observed: ReadonlySet<number>,
  rows: ProcessRows
) => {
  const live = livePids(rows);
  return (
    !rows.some((row) => row[2] === group && live.has(row[0])) &&
    ![...observed].some((pid) => live.has(pid))
  );
};

const awaitAbsent = async (
  pid: number,
  observed: ReadonlySet<number>,
  deadlineAt: number,
  pollMs: number
) => {
  while (Date.now() < deadlineAt) {
    if (topologyAbsent(pid, observed, processRows(deadlineAt - Date.now()))) {
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
  observed: ReadonlySet<number>,
  deadlineAt: number,
  recordFailure: (error: unknown) => void
) => {
  try {
    signalGroup(root, "SIGKILL", remainingInspectionMs(deadlineAt));
  } catch (error) {
    recordFailure(error);
  }
  try {
    signalPid(root, "SIGKILL");
  } catch (error) {
    recordFailure(error);
  }
  for (const descendant of observed) {
    try {
      signalPid(descendant, "SIGKILL");
    } catch (error) {
      recordFailure(error);
    }
  }
};

/** Run one provider CLI in its own process group and prove that group is gone. */
export const runOwnedProcess = ({
  args,
  command,
  cwd,
  env,
  maxBuffer,
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
    let timeout: NodeJS.Timeout;
    const observedDescendants = new Set<number>();
    const tracker = setInterval(() => {
      if (child.pid !== undefined) {
        try {
          observeDescendants(
            child.pid,
            observedDescendants,
            processRows(remainingInspectionMs(deadlineAt))
          );
        } catch (error) {
          processInspectionFailed = true;
          stderr = `${stderr}${error}`;
        }
      }
    }, pollMs);
    const append = (current: string, chunk: Buffer) =>
      (current + chunk.toString()).slice(-maxBuffer);
    const finish = async (
      code: number | string | null,
      signal: string | null
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearInterval(tracker);
      if (child.pid === undefined) {
        resolve({
          code: code ?? "spawn-error",
          killed: false,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: true,
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
        signalGroup(child.pid, "SIGTERM", remainingInspectionMs(deadlineAt));
        for (const descendant of observedDescendants) {
          signalPid(descendant, "SIGTERM");
        }
        // A stopped owner cannot consume TERM without being resumed, which
        // would reopen the fork race. Escalate immediately while it is frozen.
        signalGroup(child.pid, "SIGKILL", remainingInspectionMs(deadlineAt));
        const rows = processRows(remainingInspectionMs(deadlineAt));
        const live = livePids(rows);
        for (const descendant of observedDescendants) {
          if (live.has(descendant)) {
            signalPid(descendant, "SIGKILL");
          }
        }
        const absent = await awaitAbsent(
          child.pid,
          observedDescendants,
          deadlineAt,
          pollMs
        );
        let resultCode: number | string | null = processInspectionFailed
          ? "quiescence-unproven"
          : "process-group-live";
        if (absent && !processInspectionFailed) {
          resultCode = timedOut ? null : (code ?? signal);
        }
        resolve({
          code: resultCode,
          killed:
            timedOut || signal !== null || !absent || processInspectionFailed,
          quiescenceScope: "process-group-and-observed-descendants",
          quiescent: absent && !processInspectionFailed,
          stderr,
          stdout,
        });
      } catch (error) {
        recordCleanupFailure(error);
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
      void finish(null, null);
    }, executionMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      stderr = `${stderr}${error}`;
      void finish("spawn-error", null);
    });
    // `exit` observes the owner independently from inherited pipe closure.
    child.on("exit", (code, signal) => {
      void finish(code, signal);
    });
    child.stdin.end();
  });
