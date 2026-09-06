import { replayLibrary } from "./library-replay.js";

const [inventory, destination, ...extra] = process.argv.slice(2);
if (!inventory || !destination || extra.length) {
  throw new Error(
    "Usage: library-replay-cli.ts <inventory.json> <new-output-directory>"
  );
}
console.log(
  JSON.stringify(await replayLibrary(inventory, destination), null, 2)
);
