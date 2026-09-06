/** Inspect a selected native size; no inferred optical-master qualification. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { opticalProof } from "../src/tools/proof.js";

const [source, destination, size = "24"] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error(
    "Usage: review-proof.ts <source.svg> <new-directory> [native-size]"
  );
}
const evidence = await opticalProof(
  readFileSync(source, "utf-8"),
  Number(size)
);
mkdirSync(destination, { recursive: false });
for (const [name, data] of [
  ["proof.png", evidence.proof],
  ["native.png", evidence.native],
  ["retina.png", evidence.retina],
] as const) {
  writeFileSync(path.join(destination, name), data);
}
writeFileSync(
  path.join(destination, "proof.json"),
  JSON.stringify(
    {
      ...evidence.metadata,
      craftApproved: false,
      source: path.resolve(source),
    },
    null,
    2
  )
);

writeFileSync(
  path.join(destination, "pixels.json"),
  JSON.stringify(evidence.pixels, null, 2)
);
