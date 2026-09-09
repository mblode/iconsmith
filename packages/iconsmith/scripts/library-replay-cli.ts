import { admitLibrarySources, replayLibrary } from "./library-replay.js";

const args = process.argv.slice(2);
const [
  mode,
  inventory,
  destination,
  expectedInventorySha256,
  revisionFile,
  expectedRevisionSha256,
  master,
  ...extra
] = args;
if (mode === "admit") {
  if (
    !inventory ||
    !destination ||
    !expectedInventorySha256 ||
    !revisionFile ||
    !expectedRevisionSha256 ||
    !master ||
    extra.length
  ) {
    throw new Error(
      "Usage: library-replay-cli.ts admit <inventory.json> <new-output-directory> <inventory-sha256> <revision.json> <revision-sha256> <master>"
    );
  }
  console.log(
    JSON.stringify(
      await admitLibrarySources({
        destination,
        expectedInventorySha256,
        expectedRevisionSha256,
        inventoryFile: inventory,
        master,
        revisionFile,
      }),
      null,
      2
    )
  );
} else {
  const [inventoryFile, out, hash, ...remaining] = args;
  if (!inventoryFile || !out || !hash || remaining.length) {
    throw new Error(
      "Usage: library-replay-cli.ts <inventory.json> <new-output-directory> <frozen-inventory-sha256>"
    );
  }
  console.log(
    JSON.stringify(await replayLibrary(inventoryFile, out, hash), null, 2)
  );
}
