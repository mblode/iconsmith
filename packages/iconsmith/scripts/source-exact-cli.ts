import { readFileSync } from "node:fs";

import {
  compileSourceExactBundle,
  loadSourceExactHostContext,
  replaySourceExactBundle,
  writeNewSourceExactFile,
} from "./source-exact-host.js";

const [mode, manifestPath, manifestSha256, inputPath, outputPath, ...extra] =
  process.argv.slice(2);

const requiredPath = (value: string | undefined, label: string): string => {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

if (
  !mode ||
  !manifestPath ||
  !manifestSha256 ||
  extra.length > 0 ||
  !["resolve", "compile", "replay"].includes(mode) ||
  (mode === "resolve" ? inputPath || outputPath : !inputPath || !outputPath)
) {
  throw new Error(
    "Usage: source-exact-cli.ts resolve <manifest.json> <manifest-sha256> | " +
      "compile <manifest.json> <manifest-sha256> <program.icon> <new-bundle.json> | " +
      "replay <manifest.json> <manifest-sha256> <bundle.json> <new-output.svg>"
  );
}

if (mode === "resolve") {
  const context = await loadSourceExactHostContext(
    manifestPath,
    manifestSha256
  );
  process.stdout.write(
    `${JSON.stringify({
      bindingId: context.bindingId,
      manifestPath: context.manifestPath,
      manifestSha256: context.manifestSha256,
      master: context.master,
      registryHash: context.resolver.registryHash,
      requestSha256: context.requestSha256,
    })}\n`
  );
} else if (mode === "compile") {
  const programPath = requiredPath(inputPath, "program path");
  const bundlePath = requiredPath(outputPath, "bundle path");
  const bundle = await compileSourceExactBundle({
    expectedManifestSha256: manifestSha256,
    manifestPath,
    program: readFileSync(programPath, "utf-8"),
  });
  writeNewSourceExactFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ outputPath: bundlePath, revisionHash: bundle.revisionHash })}\n`
  );
} else {
  const bundlePath = requiredPath(inputPath, "bundle path");
  const replayPath = requiredPath(outputPath, "replay path");
  const svg = await replaySourceExactBundle({
    bundle: JSON.parse(readFileSync(bundlePath, "utf-8")),
    expectedManifestSha256: manifestSha256,
    manifestPath,
  });
  writeNewSourceExactFile(replayPath, `${svg}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath: replayPath })}\n`);
}
