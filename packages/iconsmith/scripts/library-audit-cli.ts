import { auditLibrary } from "./library-audit.js";

const [source, destination, ...extra] = process.argv.slice(2);
if (!source || !destination || extra.length) {
  throw new Error(
    "Usage: library-audit-cli.ts <source-svg-directory> <new-output-directory>"
  );
}
console.log(JSON.stringify(await auditLibrary(source, destination), null, 2));
