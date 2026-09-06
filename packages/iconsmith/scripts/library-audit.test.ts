import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { auditLibrary } from "./library-audit.js";

test("whole-library coverage retains unpaired and invalid icons without crediting generation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "library-audit-"));
  try {
    const source = path.join(root, "source");
    mkdirSync(source);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/></svg>';
    for (const name of ["folder", "folder-filled", "key"]) {
      writeFileSync(path.join(source, `${name}.svg`), svg);
    }
    writeFileSync(path.join(source, "broken.svg"), "broken");
    const out = path.join(root, "audit");
    expect(await auditLibrary(source, out)).toMatchObject({
      concepts: 3,
      files: 4,
      generatedRows: 0,
      generationQualified: false,
      parseFailures: 1,
      renderingFailures: 1,
      requiredGenerationRows: 12,
    });
    const coverage = JSON.parse(
      readFileSync(path.join(out, "generation-coverage.json"), "utf-8")
    );
    expect(
      coverage.every(
        (r: { generationStatus: string }) =>
          r.generationStatus === "not-generated"
      )
    ).toBe(true);
    expect(
      coverage
        .filter(
          (r: { concept: string; finish: string }) =>
            r.concept === "key" && r.finish === "filled"
        )
        .every((r: { referencePresent: boolean }) => !r.referencePresent)
    ).toBe(true);
    await expect(auditLibrary(source, out)).rejects.toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
