import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { turnRecordDirectory, turnRecordPath } from "./turn-record.ts";

/**
 * The replay record is the only thing standing between a redelivered turn and
 * a second tournament, and for six recorded generations it stood nowhere: the
 * address was built from `import.meta.dirname`, which eve leaves verbatim in a
 * bundle inside the per-rebuild snapshot. The records landed in
 * `<snapshot>/source/apps/web/.eve/.eve/studio-turns`, a directory a rebuild
 * replaces and eve's reaper later deletes.
 *
 * Nothing asserted where the file went, so nothing failed. These are the two
 * assertions that would have.
 */
describe("turnRecordDirectory", () => {
  it("is not inside a .eve directory, which a rebuild replaces", () => {
    const segments = turnRecordDirectory.split(/[/\\]/u);
    assert.ok(
      !segments.includes(".eve"),
      `records must not live under .eve — got ${turnRecordDirectory}`,
    );
  });

  it("is not inside the dev-runtime snapshot tree, which eve garbage-collects", () => {
    assert.ok(
      !turnRecordDirectory.includes("dev-runtime"),
      `records must outlive a snapshot — got ${turnRecordDirectory}`,
    );
    assert.ok(
      !turnRecordDirectory.includes("snapshots"),
      `records must outlive a snapshot — got ${turnRecordDirectory}`,
    );
  });

  it("is honoured from the environment, so a deployment can point it at shared storage", () => {
    // tmpdir() is per-instance and per-cold-start, so the override is the seam
    // a correct production fix hangs on. It has to actually be read.
    const override = process.env.ICONSMITH_TURN_RECORD_DIR;
    assert.ok(
      override
        ? turnRecordDirectory === override
        : turnRecordDirectory.includes("iconsmith-studio-turns"),
      `unexpected record directory ${turnRecordDirectory}`,
    );
  });

  it("gives each operation its own file, with separators neutralised", () => {
    const p = turnRecordPath("wrun_01ABC-turn_0");
    assert.equal(path.dirname(p), turnRecordDirectory);
    assert.equal(path.basename(p), "wrun_01ABC-turn_0.json");
    // An operation id reaches this from the runtime, so a separator in it must
    // not be able to steer the write out of the directory.
    assert.equal(path.dirname(turnRecordPath("a/../../b")), turnRecordDirectory);
  });
});
