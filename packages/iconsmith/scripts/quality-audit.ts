/** Offline CLI for frozen development manifests and human audit packets. */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { exportAudit, freezeDevelopment } from "./quality-benchmark.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    inputs: { type: "string" },
    manifest: { type: "string" },
  },
});
const [action, directory] = positionals;
if (positionals.length !== 2 || !directory) {
  throw new Error(
    "Usage: quality-audit.ts freeze <new-directory> | export <new-directory> --manifest <manifest.json> --inputs <inputs.json>"
  );
}
if (action === "freeze") {
  console.log(JSON.stringify(freezeDevelopment(directory)));
} else if (action === "export" && values.inputs && values.manifest) {
  console.log(
    JSON.stringify(
      await exportAudit(
        directory,
        JSON.parse(readFileSync(values.inputs, "utf-8")),
        values.manifest
      )
    )
  );
} else {
  throw new Error("Use freeze or export with --manifest and --inputs.");
}
