/** Feed one prepared stream-json request to a Claude CLI child. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [inputPath, command, ...args] = process.argv.slice(2);
if (!inputPath || !command) {
  process.stderr.write(
    "usage: local-claude-stream-bridge <input> <absolute-claude> <args>\n"
  );
  process.exit(2);
}
const child = spawnSync(command, args, {
  env: process.env,
  input: readFileSync(inputPath),
  stdio: ["pipe", "inherit", "inherit"],
});
if (child.error) {
  process.stderr.write(String(child.error));
  process.exit(1);
}
process.exit(typeof child.status === "number" ? child.status : 1);
