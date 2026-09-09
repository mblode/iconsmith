/** Durable subscription-call accounting. A reservation is intent, never approval evidence. */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const NATIVE_CALL_MINIMUM_FREE_BYTES = 2 * 1024 * 1024 * 1024;

export interface NativeCallReservation {
  billing: "subscription";
  campaignStopFile?: string;
  deadlineAt: number;
  maxCalls: number;
  minimumCallReserveMs: number;
  reservationId: string;
  routeHash: string;
}
export interface NativeCallIntent {
  /** Present on intents issued after the F21 disk preflight was introduced. */
  availableDiskBytesAtReservation?: number;
  callId: string;
  deadlineAt: number;
  dispatchedAt: number;
  minimumRemainingMs: number;
  requestId: string;
  reservationHash: string;
  routeHash: string;
  stage: string;
}
const availableDiskBytes = (directory: string): number => {
  let bytes: bigint;
  try {
    const { bavail, bsize } = statfsSync(directory, { bigint: true });
    if (bavail < 0n || bsize <= 0n) {
      throw new Error("Invalid native disk observation");
    }
    bytes = bavail * bsize;
  } catch {
    throw new Error("Native call disk availability is unavailable");
  }
  if (
    bytes < BigInt(NATIVE_CALL_MINIMUM_FREE_BYTES) ||
    bytes > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(
      "Native call requires at least 2 GiB free on its evidence filesystem"
    );
  }
  return Number(bytes);
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeId = (value: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/u.test(value);
const regular = (file: string) => {
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    realpathSync(file) !== path.resolve(file)
  ) {
    throw new Error("Call boundary requires owned regular files");
  }
};
const read = (file: string) => {
  regular(file);
  return JSON.parse(readFileSync(file, "utf-8"));
};
const atomic = (file: string, value: unknown, replace = false) => {
  if (!replace && existsSync(file)) {
    throw new Error("Call evidence already exists");
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temp, file);
};
const assertDirectory = (directory: string) => {
  const metadata = lstatSync(directory);
  if (
    !path.isAbsolute(directory) ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    realpathSync(directory) !== path.resolve(directory)
  ) {
    throw new Error("Call boundary requires an absolute owned directory");
  }
};
const RESERVATION_KEYS = [
  "billing",
  "deadlineAt",
  "maxCalls",
  "minimumCallReserveMs",
  "reservationId",
  "routeHash",
];
// Reservation schema and bounds stay atomic so create and reopen cannot diverge.
// oxlint-disable-next-line eslint/complexity
const validateReservation = (value: unknown, allowExpired: boolean) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid bounded native reservation");
  }
  const reservation = value as NativeCallReservation;
  const expectedKeys = [
    ...RESERVATION_KEYS,
    ...(reservation.campaignStopFile === undefined ? [] : ["campaignStopFile"]),
  ].toSorted();
  if (
    JSON.stringify(Object.keys(reservation).toSorted()) !==
      JSON.stringify(expectedKeys) ||
    reservation.billing !== "subscription" ||
    typeof reservation.reservationId !== "string" ||
    !safeId(reservation.reservationId) ||
    typeof reservation.routeHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(reservation.routeHash) ||
    !Number.isSafeInteger(reservation.maxCalls) ||
    reservation.maxCalls < 1 ||
    !Number.isSafeInteger(reservation.minimumCallReserveMs) ||
    reservation.minimumCallReserveMs < 5000 ||
    !Number.isSafeInteger(reservation.deadlineAt) ||
    (!allowExpired && reservation.deadlineAt <= Date.now()) ||
    (reservation.campaignStopFile !== undefined &&
      (typeof reservation.campaignStopFile !== "string" ||
        !path.isAbsolute(reservation.campaignStopFile)))
  ) {
    throw new Error("Invalid bounded native reservation");
  }
  return reservation;
};
const withLock = <T>(directory: string, run: () => T): T => {
  assertDirectory(directory);
  const file = path.join(directory, "boundary.lock");
  const fd = openSync(file, "wx", 0o600);
  try {
    return run();
  } finally {
    closeSync(fd);
    unlinkSync(file);
  }
};
export const createNativeCallBoundary = (
  directory: string,
  reservation: NativeCallReservation
) => {
  if (!path.isAbsolute(directory)) {
    throw new Error("Invalid bounded native reservation");
  }
  validateReservation(reservation, false);
  assertDirectory(path.dirname(directory));
  mkdirSync(directory, { mode: 0o700, recursive: false });
  assertDirectory(directory);
  const reservationHash = hash(reservation);
  atomic(path.join(directory, "reservation.json"), {
    reservation,
    reservationHash,
  });
  atomic(path.join(directory, "dispatches.json"), {
    calls: [],
    reservationHash,
  });
  return reservationHash;
};
const verifyReservation = (directory: string, expectedHash: string) => {
  const stored = read(path.join(directory, "reservation.json")) as {
    reservation: NativeCallReservation;
    reservationHash: string;
  };
  const reservation = validateReservation(stored.reservation, true);
  if (
    !/^[a-f0-9]{64}$/u.test(expectedHash) ||
    stored.reservationHash !== expectedHash ||
    hash(reservation) !== expectedHash
  ) {
    throw new Error("Native reservation identity drift");
  }
  return reservation;
};
const latch = (directory: string, reason: string) => {
  const file = path.join(directory, "stopped.json");
  if (!existsSync(file)) {
    atomic(file, { observedAt: Date.now(), reason });
  }
};
const observeStop = (directory: string, reservation: NativeCallReservation) => {
  if (existsSync(path.join(directory, "STOP"))) {
    latch(directory, "stop-sentinel");
  }
  if (
    reservation.campaignStopFile &&
    existsSync(reservation.campaignStopFile)
  ) {
    latch(directory, "campaign-stop-sentinel");
  }
};
interface NativeCallRequest {
  directory: string;
  reservationHash: string;
  requestId: string;
  stage: string;
  deadlineAt: number;
  minimumRemainingMs: number;
}
interface NativeCallDispatch {
  callId: string;
  intentHash: string;
  startedHash?: string;
}
const validateStage = (
  options: NativeCallRequest,
  reservation: NativeCallReservation
) => {
  if (
    !safeId(options.requestId) ||
    !safeId(options.stage) ||
    !Number.isSafeInteger(options.deadlineAt) ||
    options.deadlineAt > reservation.deadlineAt ||
    !Number.isSafeInteger(options.minimumRemainingMs) ||
    options.minimumRemainingMs < reservation.minimumCallReserveMs
  ) {
    throw new Error("Invalid native stage reservation");
  }
};
const readDispatches = (
  directory: string,
  reservationHash: string,
  intents: string[]
) => {
  const dispatches = read(path.join(directory, "dispatches.json")) as {
    reservationHash: string;
    calls: NativeCallDispatch[];
  };
  if (
    dispatches.reservationHash !== reservationHash ||
    !Array.isArray(dispatches.calls) ||
    dispatches.calls.length !== intents.length ||
    new Set(dispatches.calls.map((call) => call.callId)).size !==
      intents.length ||
    dispatches.calls.some(
      (call) =>
        !safeId(call.callId) ||
        !/^[a-f0-9]{64}$/u.test(call.intentHash) ||
        (call.startedHash !== undefined &&
          !/^[a-f0-9]{64}$/u.test(call.startedHash))
    )
  ) {
    throw new Error("Native dispatch journal mismatch");
  }
  return dispatches;
};
const validateStarted = (
  directory: string,
  intent: NativeCallIntent,
  dispatch: NativeCallDispatch,
  required: boolean,
  settledAt: number
) => {
  const file = path.join(directory, `${intent.callId}.started.json`);
  if (!existsSync(file)) {
    if (required || dispatch.startedHash !== undefined) {
      throw new Error("Native start evidence missing");
    }
    return;
  }
  const started = read(file) as {
    availableDiskBytesAtStart?: number;
    intentHash: string;
    startedAt: number;
  };
  if (
    dispatch.startedHash === undefined ||
    hash(started) !== dispatch.startedHash ||
    started.intentHash !== hash(intent) ||
    !Number.isSafeInteger(started.startedAt) ||
    started.startedAt < intent.dispatchedAt ||
    started.startedAt >= intent.deadlineAt ||
    started.startedAt > settledAt ||
    (intent.availableDiskBytesAtReservation !== undefined &&
      (!Number.isSafeInteger(started.availableDiskBytesAtStart) ||
        (started.availableDiskBytesAtStart ?? 0) <
          NATIVE_CALL_MINIMUM_FREE_BYTES))
  ) {
    throw new Error("Native start evidence mismatch");
  }
};
interface NativeCallTerminal {
  accounting: string;
  containment: string;
  outcome: string;
  evidenceFile: string;
  evidenceHash: string;
  intentHash: string;
  settledAt: number;
  deadlineExceeded: boolean;
}
const validateTerminalIdentity = (
  terminal: NativeCallTerminal,
  intent: NativeCallIntent
) => {
  if (
    terminal.intentHash !== hash(intent) ||
    !["complete", "failed", "cancelled"].includes(terminal.outcome) ||
    !["settled", "unknown"].includes(terminal.accounting) ||
    !["container-absent", "unproven"].includes(terminal.containment) ||
    !Number.isSafeInteger(terminal.settledAt) ||
    terminal.settledAt < intent.dispatchedAt ||
    terminal.deadlineExceeded !== terminal.settledAt >= intent.deadlineAt ||
    typeof terminal.evidenceFile !== "string" ||
    !path.isAbsolute(terminal.evidenceFile) ||
    !/^[a-f0-9]{64}$/u.test(terminal.evidenceHash)
  ) {
    throw new Error("Invalid native terminal identity or accounting");
  }
};
// Terminal identity, containment and outcome must be checked as one evidence unit.
// oxlint-disable-next-line eslint/complexity
const validateTerminal = (
  terminal: NativeCallTerminal,
  intent: NativeCallIntent,
  requireSettled = true
) => {
  validateTerminalIdentity(terminal, intent);
  regular(terminal.evidenceFile);
  const bytes = readFileSync(terminal.evidenceFile);
  if (
    createHash("sha256").update(bytes).digest("hex") !== terminal.evidenceHash
  ) {
    throw new Error("Native settlement evidence drift");
  }
  const evidence = JSON.parse(bytes.toString("utf-8"));
  if (
    evidence.intentHash !== hash(intent) ||
    evidence.deadlineAt !== intent.deadlineAt
  ) {
    throw new Error("Native settlement evidence intent mismatch");
  }
  const { container } = evidence;
  if (!container) {
    throw new Error("Native process evidence missing");
  }
  if (
    terminal.containment === "container-absent" &&
    (container.containerAbsent !== true ||
      container.containmentScope !== "docker-private-pid-namespace" ||
      !/^[a-f0-9]{64}$/u.test(container.containerId))
  ) {
    throw new Error("Native containment evidence missing");
  }
  if (
    terminal.outcome === "complete" &&
    (!container.process ||
      container.status !== "complete" ||
      container.artifactEligible !== true ||
      container.process.code !== 0 ||
      container.process.killed !== false)
  ) {
    throw new Error("Native completion evidence missing");
  }
  if (
    terminal.outcome !== "complete" &&
    terminal.accounting === "settled" &&
    terminal.containment === "container-absent" &&
    (container.status !== "workload-failed" ||
      container.artifactEligible !== false ||
      (container.process !== null &&
        (!container.process ||
          container.process.quiescent !== true ||
          container.process.quiescenceScope !==
            "process-group-and-observed-descendants")) ||
      (terminal.outcome === "cancelled" &&
        container.process !== null &&
        container.process?.killed !== true))
  ) {
    throw new Error("Native failed settlement evidence missing");
  }
  if (
    requireSettled &&
    (terminal.accounting !== "settled" ||
      terminal.containment !== "container-absent")
  ) {
    throw new Error("Unsettled native accounting blocks dispatch");
  }
};
/** Call immediately before the actual provider workload starts, after async setup. */
export const assertNativeCallMayStart = (
  directory: string,
  intent: NativeCallIntent
) =>
  withLock(directory, () => {
    const reservation = verifyReservation(directory, intent.reservationHash);
    const intents = readdirSync(directory).filter((name) =>
      name.endsWith(".intent.json")
    );
    const dispatches = readDispatches(
      directory,
      intent.reservationHash,
      intents
    );
    const dispatch = dispatches.calls.find(
      (call) => call.callId === intent.callId
    );
    if (
      !safeId(intent.callId) ||
      intent.routeHash !== reservation.routeHash ||
      intent.deadlineAt > reservation.deadlineAt ||
      dispatches.calls.length > reservation.maxCalls ||
      dispatch?.intentHash !== hash(intent) ||
      dispatch?.startedHash !== undefined ||
      hash(read(path.join(directory, `${intent.callId}.intent.json`))) !==
        hash(intent)
    ) {
      throw new Error("Native start intent mismatch");
    }
    observeStop(directory, reservation);
    if (
      existsSync(path.join(directory, "stopped.json")) ||
      intent.deadlineAt - Date.now() < intent.minimumRemainingMs ||
      existsSync(path.join(directory, `${intent.callId}.terminal.json`))
    ) {
      throw new Error(
        "Native call cannot start after stop, settlement or deadline"
      );
    }
    const started = {
      availableDiskBytesAtStart: availableDiskBytes(directory),
      intentHash: hash(intent),
      startedAt: Date.now(),
    };
    atomic(path.join(directory, `${intent.callId}.started.json`), started);
    atomic(
      path.join(directory, "dispatches.json"),
      {
        ...dispatches,
        calls: dispatches.calls.map((call) =>
          call.callId === intent.callId
            ? { ...call, startedHash: hash(started) }
            : call
        ),
      },
      true
    );
  });
/** Observe and durably latch STOP for one identity-verified in-flight call. */
export const observeNativeCallStop = (
  directory: string,
  intent: NativeCallIntent
) =>
  withLock(directory, () => {
    const reservation = verifyReservation(directory, intent.reservationHash);
    const intents = readdirSync(directory).filter((name) =>
      name.endsWith(".intent.json")
    );
    const dispatches = readDispatches(
      directory,
      intent.reservationHash,
      intents
    );
    const dispatch = dispatches.calls.find(
      (call) => call.callId === intent.callId
    );
    if (
      !safeId(intent.callId) ||
      intent.routeHash !== reservation.routeHash ||
      dispatch?.intentHash !== hash(intent) ||
      hash(read(path.join(directory, `${intent.callId}.intent.json`))) !==
        hash(intent) ||
      existsSync(path.join(directory, `${intent.callId}.terminal.json`))
    ) {
      throw new Error("Native active STOP intent mismatch");
    }
    validateStage({ ...intent, directory }, reservation);
    validateStarted(directory, intent, dispatch, true, Date.now());
    observeStop(directory, reservation);
    return existsSync(path.join(directory, "stopped.json"));
  });
const validateSettledJournal = (
  directory: string,
  reservationHash: string,
  reservation: NativeCallReservation
) => {
  const intents = readdirSync(directory).filter((name) =>
    name.endsWith(".intent.json")
  );
  const dispatches = readDispatches(directory, reservationHash, intents);
  const knownIds = new Set(dispatches.calls.map((call) => call.callId));
  if (
    intents.length > reservation.maxCalls ||
    readdirSync(directory).some((name) => {
      const match = /^(?<callId>.*)\.(?:started|terminal)\.json$/u.exec(name);
      return match !== null && !knownIds.has(match.groups?.callId ?? "");
    })
  ) {
    throw new Error("Native orphan evidence or reservation overflow");
  }
  const calls: NativeCallIntent[] = [];
  const stages = new Set<string>();
  for (const name of intents) {
    const intent = read(path.join(directory, name)) as NativeCallIntent;

    if (
      dispatches.calls.find((call) => call.callId === intent.callId)
        ?.intentHash !== hash(intent) ||
      !safeId(intent.callId) ||
      intent.reservationHash !== reservationHash ||
      intent.routeHash !== reservation.routeHash ||
      name !== `${intent.callId}.intent.json`
    ) {
      throw new Error("Native call identity drift");
    }
    validateStage({ ...intent, directory }, reservation);
    if (
      !Number.isSafeInteger(intent.dispatchedAt) ||
      intent.dispatchedAt >= intent.deadlineAt
    ) {
      throw new Error("Invalid native dispatch timestamp");
    }
    const stageKey = JSON.stringify([intent.requestId, intent.stage]);
    if (stages.has(stageKey)) {
      throw new Error("Repeated native stage evidence");
    }
    stages.add(stageKey);
    calls.push(intent);
    const terminal = path.join(directory, `${intent.callId}.terminal.json`);
    if (!existsSync(terminal)) {
      throw new Error("Ambiguous in-flight native call blocks dispatch");
    }
    const result = read(terminal);
    const dispatch = dispatches.calls.find(
      (call) => call.callId === intent.callId
    );
    if (!dispatch) {
      throw new Error("Native dispatch journal mismatch");
    }
    validateTerminal(result, intent);
    validateStarted(
      directory,
      intent,
      dispatch,
      result.outcome === "complete",
      result.settledAt
    );
  }
  return { calls, dispatches, intents };
};
/** Reopen original accounting only after every recorded call has proven settlement. */
export const readNativeCallBoundary = (
  directory: string,
  expectedReservationHash: string
) =>
  withLock(directory, () => {
    const reservation = verifyReservation(directory, expectedReservationHash);
    observeStop(directory, reservation);
    const { calls } = validateSettledJournal(
      directory,
      expectedReservationHash,
      reservation
    );
    return {
      calls,
      reservation,
      reservationHash: expectedReservationHash,
      stopped: existsSync(path.join(directory, "stopped.json")),
    };
  });
export const reserveNativeCall = (
  options: NativeCallRequest
): NativeCallIntent =>
  withLock(options.directory, () => {
    const reservation = verifyReservation(
      options.directory,
      options.reservationHash
    );
    validateStage(options, reservation);
    observeStop(options.directory, reservation);
    if (existsSync(path.join(options.directory, "stopped.json"))) {
      throw new Error("Native calls stopped (latched)");
    }
    const { calls, dispatches, intents } = validateSettledJournal(
      options.directory,
      options.reservationHash,
      reservation
    );
    if (
      calls.some(
        (call) =>
          call.requestId === options.requestId && call.stage === options.stage
      )
    ) {
      throw new Error(
        "Native stage already dispatched; reuse its terminal receipt"
      );
    }
    if (intents.length >= reservation.maxCalls) {
      latch(options.directory, "call-reservation-exhausted");
      throw new Error("Native call reservation exhausted");
    }
    if (options.deadlineAt - Date.now() < options.minimumRemainingMs) {
      throw new Error("Native stage reserve exhausted");
    }
    const availableDiskBytesAtReservation = availableDiskBytes(
      options.directory
    );
    const intent: NativeCallIntent = {
      availableDiskBytesAtReservation,
      callId: randomUUID(),
      deadlineAt: options.deadlineAt,
      dispatchedAt: Date.now(),
      minimumRemainingMs: options.minimumRemainingMs,
      requestId: options.requestId,
      reservationHash: options.reservationHash,
      routeHash: reservation.routeHash,
      stage: options.stage,
    };
    atomic(
      path.join(options.directory, `${intent.callId}.intent.json`),
      intent
    );
    atomic(
      path.join(options.directory, "dispatches.json"),
      {
        ...dispatches,
        calls: [
          ...dispatches.calls,
          { callId: intent.callId, intentHash: hash(intent) },
        ],
      },
      true
    );
    return intent;
  });
export const settleNativeCall = (options: {
  directory: string;
  intent: NativeCallIntent;
  containment: "container-absent" | "unproven";
  accounting: "settled" | "unknown";
  outcome: "complete" | "failed" | "cancelled";
  evidenceHash: string;
  evidenceFile: string;
}) =>
  withLock(options.directory, () => {
    const reservation = verifyReservation(
      options.directory,
      options.intent.reservationHash
    );
    if (
      !safeId(options.intent.callId) ||
      !/^[a-f0-9]{64}$/u.test(options.evidenceHash)
    ) {
      throw new Error("Invalid native settlement evidence");
    }
    const recorded = read(
      path.join(options.directory, `${options.intent.callId}.intent.json`)
    );
    if (hash(recorded) !== hash(options.intent)) {
      throw new Error("Native settlement intent mismatch");
    }
    const intents = readdirSync(options.directory).filter((name) =>
      name.endsWith(".intent.json")
    );
    const dispatches = readDispatches(
      options.directory,
      options.intent.reservationHash,
      intents
    );
    const dispatch = dispatches.calls.find(
      (call) => call.callId === options.intent.callId
    );
    if (dispatch?.intentHash !== hash(options.intent)) {
      throw new Error("Native settlement dispatch mismatch");
    }
    observeStop(options.directory, reservation);
    const settledAt = Date.now();
    const terminal = {
      ...options,
      deadlineExceeded: settledAt >= options.intent.deadlineAt,
      directory: undefined,
      intent: undefined,
      intentHash: hash(options.intent),
      settledAt,
    };
    validateTerminal(terminal, options.intent, false);
    validateStarted(
      options.directory,
      options.intent,
      dispatch,
      options.outcome === "complete",
      terminal.settledAt
    );
    atomic(
      path.join(options.directory, `${options.intent.callId}.terminal.json`),
      terminal
    );
    if (
      options.containment !== "container-absent" ||
      options.accounting !== "settled"
    ) {
      latch(options.directory, "unproven-settlement");
    }
    return terminal;
  });
