/** Offline CLI for frozen development manifests and independent-AI audit packets. */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  exportAudit,
  freezeDevelopment,
  mergeExportedAuditInputs,
} from "./quality-benchmark.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    inputs: { type: "string" },
    manifest: { type: "string" },
    source: { multiple: true, type: "string" },
  },
});
const [action, directory] = positionals;
if (positionals.length !== 2 || !directory) {
  throw new Error(
    "Usage: quality-audit.ts freeze <new-directory> | export <new-directory> --manifest <manifest.json> --inputs <inputs.json> | refresh <new-directory> --manifest <manifest.json> --source <audit-directory> [--source ...]"
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
} else if (action === "refresh" && values.manifest && values.source?.length) {
  console.log(
    JSON.stringify(
      await exportAudit(
        directory,
        mergeExportedAuditInputs(values.source),
        values.manifest
      )
    )
  );
} else {
  throw new Error(
    "Use freeze, export, or refresh with their required options."
  );
}
