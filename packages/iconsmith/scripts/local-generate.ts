/** Local subscription CLI entry point. No API judge and no billing fallback. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { harnessArm, subscriptionEnv } from "../src/pipeline/harness.js";
import { png } from "../src/tools/render.js";
import { runLocalStyle } from "./local-style-run.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: "string" },
    finish: { type: "string" },
    master: { type: "string" },
    revision: { type: "string" },
  },
});
const [agent, concept, destination] = positionals;
if (
  !concept ||
  !destination ||
  !["codex", "claude", "cursor"].includes(agent ?? "")
) {
  throw new Error(
    "Usage: local-generate.ts <codex|claude|cursor> <concept> <new-output-directory>"
  );
}
if (values.revision && (agent !== "codex" || !values.master)) {
  throw new Error(
    "Selected-style generation currently requires codex and --master."
  );
}
if ((values.master || values.finish || values.brief) && !values.revision) {
  throw new Error("Style options require --revision.");
}
if (values.finish && !["outlined", "filled"].includes(values.finish)) {
  throw new Error("--finish must be outlined or filled; omit for both.");
}
const out = path.resolve(destination);
mkdirSync(out, { recursive: false });
const command =
  agent === "cursor"
    ? path.join(process.env.HOME ?? "", ".local/bin/cursor-agent")
    : agent;
const authEnv = subscriptionEnv(process.env);
if (agent === "codex") {
  const status = spawnSync(command, ["login", "status"], {
    encoding: "utf-8",
    env: authEnv,
  });
  if (
    status.status !== 0 ||
    !`${status.stdout}${status.stderr}`.includes("Logged in using ChatGPT")
  ) {
    throw new Error("Codex must be signed in using ChatGPT.");
  }
}
if (agent === "claude") {
  const status = JSON.parse(
    execFileSync(command, ["auth", "status"], {
      encoding: "utf-8",
      env: authEnv,
    })
  );
  if (!status.loggedIn || status.authMethod !== "claude.ai") {
    throw new Error("Claude Code must be signed in using claude.ai.");
  }
}
if (agent === "cursor") {
  const status = execFileSync(command, ["status"], {
    encoding: "utf-8",
    env: authEnv,
  });
  if (!status.includes("Logged in as")) {
    throw new Error("Cursor must be signed in with its native account.");
  }
}
const args = (brief: string): string[] => {
  if (agent === "codex") {
    return [
      "exec",
      "--ignore-user-config",
      "-c",
      'model_reasoning_effort="high"',
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      brief,
    ];
  }
  if (agent === "claude") {
    return [
      "-p",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--tools",
      "Read,Write,Edit,Bash",
      "--allowedTools",
      "Read,Write,Edit,Bash(iconsmith *)",
      "--",
      brief,
    ];
  }
  return [
    "--print",
    "--trust",
    "--sandbox",
    "enabled",
    "--workspace",
    out,
    brief,
  ];
};
writeFileSync(
  path.join(out, "run.json"),
  JSON.stringify(
    {
      agent,
      apiAudit: false,
      billing: "subscription",
      concept,
      requestedReasoningEffort: agent === "codex" ? "high" : null,
      startedAt: new Date().toISOString(),
    },
    null,
    2
  )
);
try {
  if (values.revision) {
    const result = await runLocalStyle({
      args,
      command,
      concept,
      env: authEnv,
      finish: values.finish as "outlined" | "filled" | undefined,
      guidance: values.brief ? readFileSync(values.brief, "utf-8") : undefined,
      master: values.master ?? "",
      out,
      revisionPath: path.resolve(values.revision),
    });
    console.log(JSON.stringify(result));
    if (result.status !== "delivered") {
      process.exitCode = 1;
    }
  } else {
    const result = await harnessArm({
      args,
      billing: "subscription",
      command,
      keep: true,
      root: out,
      timeoutMs: 300_000,
    })({ name: concept }, { finish: "outlined" });
    writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(result, null, 2)
    );
    writeFileSync(path.join(out, "icon.svg"), result.svg);
    writeFileSync(path.join(out, "icon.icon"), result.program ?? "");
    writeFileSync(path.join(out, "preview.png"), await png(result.svg, 192));
    console.log(`Saved ${out}; compile success is not a craft approval.`);
  }
} catch (error) {
  writeFileSync(path.join(out, "failure.txt"), String(error));
  throw error;
}
