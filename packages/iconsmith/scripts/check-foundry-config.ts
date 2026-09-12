/** Cheap repository invariants; private corpus presence is a separate live gate. */
import fs from "node:fs";
import path from "node:path";

import { parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

const portablePackage = (pkg: {
  bin?: { iconsmith?: string };
  files?: string[];
  version?: string;
}) =>
  pkg.bin?.iconsmith === "dist-agent/cli.js" &&
  Boolean(pkg.version) &&
  JSON.stringify(pkg.files) ===
    JSON.stringify([
      "dist-agent/",
      "SKILL.md",
      "references/",
      "library/blode-icons/",
    ]);

export const checkFoundryConfig = (root: string): string[] => {
  const failures: string[] = [];
  const read = (name: string) =>
    fs.readFileSync(path.join(root, name), "utf-8");
  const json = (name: string) => {
    const errors: ParseError[] = [];
    const parsed = parse(read(name), errors);
    if (errors.length) {
      throw new Error(`Invalid configuration: ${name}`);
    }
    return parsed;
  };
  const rootPackage = json("package.json");
  const pkg = json("packages/iconsmith/package.json");
  const turbo = json("turbo.json");
  const ignores = read(".gitignore")
    .split("\n")
    .map((line) => line.trim());
  if (
    !ignores.includes("/packages/iconsmith/corpus/") ||
    ignores.some((line) => ["corpus/", "/corpus/", "**/corpus/"].includes(line))
  ) {
    failures.push(
      "F11: ignore only /packages/iconsmith/corpus/; broad corpus ignores hide source files."
    );
  }
  if (
    !["dist/**", "dist-agent/**"].every((output) =>
      turbo.tasks?.build?.outputs?.includes(output)
    )
  ) {
    failures.push(
      "F23: cache both dist/** and dist-agent/** so builds restore the published CLI."
    );
  }
  if (turbo.tasks?.test?.cache !== false) {
    failures.push(
      "F12: set turbo.tasks.test.cache=false; ignored corpus bytes cannot be cached safely."
    );
  }
  if (/--passWithNoTests\b/u.test(pkg.scripts?.test ?? "")) {
    failures.push(
      "F51: remove --passWithNoTests from iconsmith tests; a mistyped filter must fail."
    );
  }
  if (rootPackage.devDependencies?.oxlint !== "1.78.0") {
    failures.push(
      "F14: retain oxlint 1.78.0 until the Ultracite compatibility gate is deliberately updated."
    );
  }
  for (const workspace of ["packages/iconsmith"]) {
    const manifest = json(`${workspace}/package.json`);
    for (const tool of ["ultracite", "oxlint", "oxfmt"]) {
      if (manifest.dependencies?.[tool] || manifest.devDependencies?.[tool]) {
        failures.push(
          `F14: keep ${tool} at the repository root, not ${workspace}.`
        );
      }
    }
  }
  if (!portablePackage(pkg)) {
    failures.push(
      "F22: publish only the portable agent CLI and its assets; keep research and corpus out of the package."
    );
  }
  return failures;
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const failures = checkFoundryConfig(
    path.resolve(import.meta.dirname, "../../..")
  );
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      "Foundry configuration guards passed (private corpus presence not asserted)."
    );
  }
}
