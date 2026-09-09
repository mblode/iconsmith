import { spawnSync } from "node:child_process";
import type * as NodeFs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { writeDurableJson } from "./durable-json.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    linkSync: (...args: Parameters<typeof actual.linkSync>) => {
      if (process.env.DURABLE_CRASH_PHASE === "before-exclusive-install") {
        process.exit(71);
      }
      actual.linkSync(...args);
      if (process.env.DURABLE_CRASH_PHASE === "after-exclusive-install") {
        process.exit(72);
      }
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (process.env.DURABLE_CRASH_PHASE === "before-replace-install") {
        process.exit(73);
      }
      actual.renameSync(...args);
      if (process.env.DURABLE_CRASH_PHASE === "after-replace-install") {
        process.exit(74);
      }
    },
  };
});

const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "iconsmith-durable-json-"));
  const nested = path.join(directory, "evidence");
  mkdirSync(nested);
  return { directory: nested, file: path.join(nested, "terminal.json") };
};

const temporaryFiles = (directory: string) =>
  readdirSync(directory).filter((name) => name.endsWith(".tmp"));

const crashPhase = process.env.DURABLE_CRASH_PHASE;
const ordinary = test.skipIf(Boolean(crashPhase));

if (crashPhase) {
  test("durable commit interruption child", () => {
    const file = process.env.DURABLE_CRASH_TARGET;
    if (!file) {
      throw new Error("Crash child needs its target");
    }
    writeDurableJson(
      file,
      { payload: "complete-next-value", phase: crashPhase },
      crashPhase.includes("replace") ? "replace" : "exclusive"
    );
  });
}

const interrupt = (phase: string, file: string) =>
  spawnSync(
    process.execPath,
    [
      path.resolve(import.meta.dirname, "../node_modules/vitest/vitest.mjs"),
      "run",
      path.resolve(import.meta.dirname, "durable-json.test.ts"),
      "--maxWorkers=1",
    ],
    {
      encoding: "utf-8",
      env: {
        ...process.env,
        DURABLE_CRASH_PHASE: phase,
        DURABLE_CRASH_TARGET: file,
      },
    }
  );

ordinary(
  "exclusive durable commit installs complete JSON and never replaces it",
  () => {
    const { directory, file } = fixture();
    writeDurableJson(file, { attempt: 1, status: "complete" });
    const original = readFileSync(file, "utf-8");
    expect(JSON.parse(original)).toEqual({ attempt: 1, status: "complete" });
    expect(statSync(file).mode % 0o1000).toBe(0o600);
    expect(() =>
      writeDurableJson(file, { attempt: 2, status: "complete" })
    ).toThrow();
    expect(readFileSync(file, "utf-8")).toBe(original);
    expect(temporaryFiles(directory)).toEqual([]);
  }
);

ordinary(
  "replaceable durable commit exposes the prior or complete next JSON",
  () => {
    const { directory, file } = fixture();
    writeDurableJson(file, { generation: 1 }, "replace");
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ generation: 1 });
    writeDurableJson(file, { generation: 2, rows: [1, 2, 3] }, "replace");
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({
      generation: 2,
      rows: [1, 2, 3],
    });
    expect(temporaryFiles(directory)).toEqual([]);
  }
);

ordinary("serialization failure leaves no target or temporary evidence", () => {
  const { directory, file } = fixture();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect(() => writeDurableJson(file, cyclic)).toThrow();
  expect(() => readFileSync(file, "utf-8")).toThrow();
  expect(temporaryFiles(directory)).toEqual([]);
});

ordinary("undefined cannot install non-JSON bytes", () => {
  const { directory, file } = fixture();
  const value: unknown = undefined;
  expect(() => writeDurableJson(file, value)).toThrow(
    "Durable JSON value is not serializable"
  );
  expect(() => readFileSync(file, "utf-8")).toThrow();
  expect(temporaryFiles(directory)).toEqual([]);
});

ordinary.each([
  ["before-exclusive-install", null],
  ["after-exclusive-install", "complete-next-value"],
  ["before-replace-install", "prior-value"],
  ["after-replace-install", "complete-next-value"],
] as const)(
  "process interruption at %s exposes only an absent, prior or complete final",
  (phase, expectedPayload) => {
    const { file } = fixture();
    if (phase.includes("replace")) {
      writeDurableJson(file, { payload: "prior-value" }, "replace");
    }
    const child = interrupt(phase, file);
    expect(child.status).not.toBe(0);
    if (expectedPayload === null) {
      expect(() => readFileSync(file, "utf-8")).toThrow();
    } else {
      expect(JSON.parse(readFileSync(file, "utf-8"))).toMatchObject({
        payload: expectedPayload,
      });
    }
  }
);
