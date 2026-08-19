/**
 * The boundary translations, tested at the boundary.
 *
 * `assertDirectory` exists because `readdirSync` fails from inside a library
 * that was already told what it was reading: `ENOENT ... scandir '/x'` names
 * the syscall, not the mistake.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertDirectory, InputError } from "./read.js";

const temp = () => mkdtempSync(path.join(tmpdir(), "iconsmith-read-"));

describe("assertDirectory", () => {
  it("passes a real directory through", () => {
    expect(() =>
      assertDirectory(temp(), "a directory of .svg icons")
    ).not.toThrow();
  });

  it("names the path and the kind wanted when there is nothing there", () => {
    const dir = path.join(temp(), "absent");
    expect(() => assertDirectory(dir, "a directory of .svg icons")).toThrow(
      new RegExp(`Cannot read "${dir}": no such directory\\.`, "u")
    );
  });

  it("distinguishes a file from a missing path — the fix is different", () => {
    const file = path.join(temp(), "parts.json");
    writeFileSync(file, "{}");
    expect(() => assertDirectory(file, "a directory of .svg icons")).toThrow(
      /that is a file, not a directory/u
    );
  });

  it("fails as InputError, so the CLI reports code INPUT", () => {
    try {
      assertDirectory(path.join(temp(), "absent"), "a directory of .svg icons");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InputError);
      expect((error as InputError).code).toBe("INPUT");
    }
  });
});
