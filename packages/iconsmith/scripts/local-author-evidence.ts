/** Host-owned native trace evidence. Image exposure is not visual approval. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { assertNoAmbientCatalogs } from "./local-author-context.js";

const records = (text: string): Record<string, unknown>[] =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Resolve only the exact emitted thread, then verify its session identity. */
export const readAuthorTrace = (
  stdout: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): string => {
  const threads = records(stdout).filter(
    (item) => item.type === "thread.started"
  );
  const id = threads[0]?.thread_id;
  if (
    threads.length !== 1 ||
    typeof id !== "string" ||
    !/^[a-f\d-]{36}$/u.test(id)
  ) {
    throw new Error("Missing unambiguous native author thread identity");
  }
  const root = path.join(
    env.CODEX_HOME ?? path.join(homedir(), ".codex"),
    "sessions"
  );
  const files = readdirSync(root, {
    encoding: "utf-8",
    recursive: true,
  }).filter((name) => name.endsWith(`-${id}.jsonl`));
  if (files.length !== 1) {
    throw new Error("Missing unambiguous persisted native author trace");
  }
  const trace = readFileSync(path.join(root, files[0]), "utf-8");
  const session = records(trace).find((item) => item.type === "session_meta")
    ?.payload as { id?: string; cwd?: string } | undefined;
  if (session?.id !== id || session.cwd !== cwd) {
    throw new Error("Native author trace identity mismatch");
  }
  return trace;
};

/** Only tool-returned images count; initial attachments and prose do not. */
export const inspectAuthorImages = (
  trace: string,
  images: Readonly<Record<string, Uint8Array>>
) => {
  const exposed = new Set<string>();
  const calls = new Set<string>();
  for (const record of records(trace)) {
    if (record.type !== "response_item") {
      continue;
    }
    const item = record.payload as {
      type?: string;
      call_id?: string;
      status?: string;
      output?: unknown;
    };
    if (
      ["function_call", "custom_tool_call"].includes(item.type ?? "") &&
      item.call_id &&
      item.status !== "failed"
    ) {
      calls.add(item.call_id);
    }
    if (
      !["function_call_output", "custom_tool_call_output"].includes(
        item.type ?? ""
      ) ||
      !item.call_id ||
      !calls.has(item.call_id) ||
      !Array.isArray(item.output)
    ) {
      continue;
    }
    for (const block of item.output) {
      if (
        block?.type === "input_image" &&
        typeof block.image_url === "string" &&
        block.image_url.startsWith("data:image/png;base64,")
      ) {
        exposed.add(hash(Buffer.from(block.image_url.split(",")[1], "base64")));
      }
    }
  }
  const evidence = Object.fromEntries(
    Object.entries(images).map(([name, bytes]) => {
      const sha256 = hash(bytes);
      return [name, { exposed: exposed.has(sha256), sha256 }];
    })
  );
  return {
    complete:
      Object.keys(evidence).length > 0 &&
      Object.values(evidence).every((item) => item.exposed),
    images: evidence,
    traceSha256: hash(Buffer.from(trace)),
    visualJudgmentValidated: false,
  };
};

export const collectAuthorInspection = (
  stdout: string,
  cwd: string,
  paints: readonly string[],
  env: NodeJS.ProcessEnv,
  readTrace = readAuthorTrace
) => {
  try {
    const trace = readTrace(stdout, cwd, env);
    assertNoAmbientCatalogs(trace);
    return {
      imageInspection: inspectAuthorImages(
        trace,
        Object.fromEntries(
          paints.map((paint) => [
            `${paint}.proof.png`,
            readFileSync(path.join(cwd, `${paint}.proof.png`)),
          ])
        )
      ),
      imageInspectionError: null,
    };
  } catch (error) {
    return { imageInspection: null, imageInspectionError: String(error) };
  }
};
