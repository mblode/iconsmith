import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";

import { readAcceptanceEvidence, registerEvalCommand } from "./eval.js";

const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const directories: string[] = [];
const temporaryFile = (contents: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), "iconsmith-acceptance-"));
  directories.push(directory);
  const file = path.join(directory, "acceptance.json");
  writeFileSync(file, contents);
  return file;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("eval acceptance evidence input", () => {
  it("advertises the paired evidence and byte-hash options", () => {
    const program = new Command().option("--output <format>");
    registerEvalCommand(program);
    const command = program.commands.find(
      (candidate) => candidate.name() === "eval"
    );

    expect(command?.options.map(({ long }) => long)).toEqual(
      expect.arrayContaining(["--acceptance", "--acceptance-sha256"])
    );
  });

  it("allows both options to be omitted and refuses either option alone", () => {
    expect(readAcceptanceEvidence()).toBeUndefined();
    expect(() => readAcceptanceEvidence("evidence.json")).toThrow(
      /must be supplied together/u
    );
    expect(() => readAcceptanceEvidence(undefined, "0".repeat(64))).toThrow(
      /must be supplied together/u
    );
  });

  it("refuses malformed hashes and byte mismatches before parsing", () => {
    const file = temporaryFile("not json");

    expect(() => readAcceptanceEvidence(file, "not-a-hash")).toThrow(
      /lowercase 64-character/u
    );
    expect(() => readAcceptanceEvidence(file, "0".repeat(64))).toThrow(
      /SHA-256 mismatch/u
    );
  });

  it("rejects malformed JSON only after its exact bytes match", () => {
    const contents = "{not-json}";
    const file = temporaryFile(contents);

    expect(() => readAcceptanceEvidence(file, digest(contents))).toThrow(
      /not valid JSON acceptance evidence/u
    );
  });

  it("parses the verified byte snapshot and detects later file mutation", () => {
    const first = JSON.stringify({
      contractVersion: "snapshot-one",
      expectedSlots: [],
      gates: [],
      outputs: [],
      uncertainty: { method: "", resamplingCount: 0, seed: "" },
    });
    const file = temporaryFile(first);
    const frozen = readAcceptanceEvidence(file, digest(first));

    writeFileSync(
      file,
      JSON.stringify({ ...frozen, contractVersion: "mutated" })
    );

    expect(frozen?.contractVersion).toBe("snapshot-one");
    expect(() => readAcceptanceEvidence(file, digest(first))).toThrow(
      /SHA-256 mismatch/u
    );
  });
});
