import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { executeStage, runVerification, VerificationError } from "./verify.mjs";

const snapshot = (hash = "stable") => ({
  algorithm: "sha256",
  fileCount: 1,
  aggregateSha256: hash,
  files: [{ path: "source.ts", kind: "file", size: 1, sha256: hash }],
});

const repository = async () => await mkdtemp(path.join(tmpdir(), "iconsmith-verify-"));

const stages = [
  { id: "one", command: "stub", args: ["one"] },
  { id: "two", command: "stub", args: ["two"] },
  { id: "three", command: "stub", args: ["three"] },
];

const stableClock = () => {
  let value = Date.parse("2026-09-09T00:00:00.000Z");
  return () => (value += 10);
};

const successfulStage = async (stage, { logFile }) => {
  await writeFile(logFile, `ran ${stage.id}\n`, { flag: "wx" });
  return { exitCode: 0, signal: null };
};

const completeCorpus = async () => ({
  available: true,
  requirements: [],
  missing: [],
});

test("runs injected stages sequentially and records immutable evidence", async () => {
  const cwd = await repository();
  const calls = [];
  const receipt = await runVerification({
    cwd,
    out: "evidence",
    stages,
    clock: stableClock(),
    idFactory: () => "owner",
    takeSourceSnapshot: async () => snapshot(),
    checkCorpus: completeCorpus,
    runStage: async (stage, context) => {
      calls.push(stage.id);
      assert.deepEqual(
        calls,
        stages.slice(0, calls.length).map(({ id }) => id),
      );
      return await successfulStage(stage, context);
    },
  });

  assert.equal(receipt.status, "passed");
  assert.deepEqual(calls, ["one", "two", "three"]);
  assert.equal(receipt.stages.length, 3);
  assert.equal(receipt.stages[0].log.bytes, 8);
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, "evidence", "receipt.json"), "utf8")).status,
    "passed",
  );
  await assert.rejects(mkdir(path.join(cwd, "evidence")), { code: "EEXIST" });
});

test("refuses an overlapping run without stealing its lock", async () => {
  const cwd = await repository();
  const lock = path.join(cwd, ".staging", ".verify.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "owner.json"), '{"token":"other"}\n');

  await assert.rejects(
    runVerification({
      cwd,
      stages,
      takeSourceSnapshot: async () => snapshot(),
      checkCorpus: completeCorpus,
      runStage: successfulStage,
    }),
    (error) => error instanceof VerificationError && error.code === "verification-locked",
  );
  assert.equal(JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")).token, "other");
});

test("stops after a failed stage, records it, and releases its lock", async () => {
  const cwd = await repository();
  const calls = [];
  let failure;
  try {
    await runVerification({
      cwd,
      out: "failed",
      stages,
      takeSourceSnapshot: async () => snapshot(),
      checkCorpus: completeCorpus,
      runStage: async (stage, { logFile }) => {
        calls.push(stage.id);
        await writeFile(logFile, `${stage.id}\n`, { flag: "wx" });
        return { exitCode: stage.id === "two" ? 7 : 0, signal: null };
      },
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof VerificationError);
  assert.equal(failure.code, "failed-stage");
  assert.deepEqual(calls, ["one", "two"]);
  assert.equal(failure.receipt.stages[1].exitCode, 7);
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, "failed", "receipt.json"), "utf8")).status,
    "failed-stage",
  );
  await assert.rejects(readFile(path.join(cwd, ".staging", ".verify.lock", "owner.json")), {
    code: "ENOENT",
  });
});

test("refuses to overwrite an output directory and cleans up its lock", async () => {
  const cwd = await repository();
  await mkdir(path.join(cwd, "existing"));
  await writeFile(path.join(cwd, "existing", "keep.txt"), "keep\n");

  await assert.rejects(
    runVerification({
      cwd,
      out: "existing",
      stages,
      takeSourceSnapshot: async () => snapshot(),
      checkCorpus: completeCorpus,
      runStage: successfulStage,
    }),
    (error) => error instanceof VerificationError && error.code === "output-exists",
  );
  assert.equal(await readFile(path.join(cwd, "existing", "keep.txt"), "utf8"), "keep\n");
  await assert.rejects(readFile(path.join(cwd, ".staging", ".verify.lock", "owner.json")), {
    code: "ENOENT",
  });
});

test("rejects source drift after all stages and records both freezes", async () => {
  const cwd = await repository();
  const snapshots = [snapshot("before"), snapshot("after")];
  let failure;
  try {
    await runVerification({
      cwd,
      out: "drift",
      stages,
      takeSourceSnapshot: async () => snapshots.shift(),
      checkCorpus: completeCorpus,
      runStage: successfulStage,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof VerificationError);
  assert.equal(failure.code, "source-drift");
  assert.equal(failure.receipt.source.stable, false);
  assert.equal(failure.receipt.stages.length, 3);
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, "drift", "source-before.json"), "utf8"))
      .aggregateSha256,
    "before",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, "drift", "source-after.json"), "utf8"))
      .aggregateSha256,
    "after",
  );
  await assert.rejects(readFile(path.join(cwd, ".staging", ".verify.lock", "owner.json")), {
    code: "ENOENT",
  });
});

test("records a thrown stage failure and releases its lock", async () => {
  const cwd = await repository();
  let failure;
  try {
    await runVerification({
      cwd,
      out: "thrown",
      stages,
      takeSourceSnapshot: async () => snapshot(),
      checkCorpus: completeCorpus,
      runStage: async () => {
        throw new Error("stub exploded");
      },
    });
  } catch (error) {
    failure = error;
  }

  assert.equal(failure.code, "failed-stage");
  assert.match(failure.receipt.stages[0].error, /stub exploded/);
  assert.equal(failure.receipt.stages.length, 1);
  await assert.rejects(readFile(path.join(cwd, ".staging", ".verify.lock", "owner.json")), {
    code: "ENOENT",
  });
});

test("refuses unavailable corpus locally and labels an explicit cloud allowance", async () => {
  const cwd = await repository();
  const missingCorpus = async () => ({
    available: false,
    requirements: [{ path: "packages/iconsmith/corpus/corpus.json", kind: "file" }],
    missing: [{ path: "packages/iconsmith/corpus/corpus.json", kind: "file", reason: "missing" }],
  });

  await assert.rejects(
    runVerification({
      cwd,
      out: "local",
      stages,
      checkCorpus: missingCorpus,
      takeSourceSnapshot: async () => snapshot(),
      runStage: successfulStage,
    }),
    (error) =>
      error.code === "corpus-unavailable" &&
      error.receipt.corpus.measurementsAvailable === false &&
      error.receipt.stages.length === 0,
  );

  const cloud = await runVerification({
    cwd,
    out: "cloud",
    stages,
    allowMissingCorpus: true,
    checkCorpus: missingCorpus,
    takeSourceSnapshot: async () => snapshot(),
    runStage: successfulStage,
  });
  assert.equal(cloud.status, "passed");
  assert.equal(cloud.corpus.measurementsAvailable, false);
  assert.equal(cloud.corpus.missingAllowed, true);
});

test("documents the fixed CLI and corpus boundary in help", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "verify.mjs"), "--help"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm run test/);
  assert.match(result.stdout, /git diff --check/);
  assert.match(result.stdout, /--allow-missing-corpus/);
});

test("terminates a running stage before rejecting a log failure", async () => {
  const cwd = await repository();
  const invalidLogFile = path.join(cwd, "log-is-a-directory");
  await mkdir(invalidLogFile);
  const startedAt = Date.now();
  await assert.rejects(
    executeStage(
      {
        id: "long-running",
        command: process.execPath,
        args: ["-e", "setInterval(() => process.stdout.write('still running\\n'), 10)"],
      },
      { cwd, logFile: invalidLogFile },
    ),
  );
  assert.ok(Date.now() - startedAt < 2000);
});

test("records a setup failure after output creation and releases its lock", async () => {
  const cwd = await repository();
  let failure;
  try {
    await runVerification({
      cwd,
      out: "setup-failure",
      stages,
      checkCorpus: completeCorpus,
      takeSourceSnapshot: async () => {
        throw new Error("source snapshot failed");
      },
      runStage: successfulStage,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof VerificationError);
  assert.equal(failure.code, "setup-error");
  assert.equal(failure.receipt.error.message, "source snapshot failed");
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, "setup-failure", "receipt.json"), "utf8")).status,
    "setup-error",
  );
  await assert.rejects(readFile(path.join(cwd, ".staging", ".verify.lock", "owner.json")), {
    code: "ENOENT",
  });
});
