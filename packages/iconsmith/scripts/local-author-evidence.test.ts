import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  inspectAuthorImages,
  readAuthorTrace,
} from "./local-author-evidence.js";

const png = Buffer.from("fixture PNG bytes");
const image = {
  image_url: `data:image/png;base64,${png.toString("base64")}`,
  type: "input_image",
};
const call = { call_id: "view", status: "completed", type: "custom_tool_call" };
const output = {
  call_id: "view",
  output: [image],
  type: "custom_tool_call_output",
};
const trace = (...items: object[]) =>
  items
    .map((payload) => JSON.stringify({ payload, type: "response_item" }))
    .join("\n");

it("binds actual tool image payloads to current proof bytes", () => {
  const result = inspectAuthorImages(trace(call, output), {
    "outlined.proof.png": png,
  });
  expect(result.complete).toBe(true);
  expect(result.visualJudgmentValidated).toBe(false);
  expect(
    inspectAuthorImages(trace(call, output), {
      "outlined.proof.png": Buffer.from("new revision"),
    }).complete
  ).toBe(false);
});

it("rejects initial attachments, orphaned outputs, failed calls and empty evidence", () => {
  for (const text of [
    trace({ content: [image], role: "user", type: "message" }),
    trace(output),
    trace({ ...call, status: "failed" }, output),
    "",
  ]) {
    expect(inspectAuthorImages(text, { proof: png }).complete).toBe(false);
  }
  expect(inspectAuthorImages(trace(call, output), {}).complete).toBe(false);
  expect(() => inspectAuthorImages("invalid trace", { proof: png })).toThrow();
});

it("reads only the exact native session and verifies its working directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-trace-"));
  const id = "01a07589-deda-7d42-bc68-39c19d15b639";
  const stdout = JSON.stringify({ thread_id: id, type: "thread.started" });
  mkdirSync(path.join(root, "sessions"));
  const text = JSON.stringify({
    payload: { cwd: "/expected", id },
    type: "session_meta",
  });
  writeFileSync(path.join(root, "sessions", `rollout-${id}.jsonl`), text);
  try {
    expect(readAuthorTrace(stdout, "/expected", { CODEX_HOME: root })).toBe(
      text
    );
    expect(() =>
      readAuthorTrace(stdout, "/wrong", { CODEX_HOME: root })
    ).toThrow("identity mismatch");
    expect(() =>
      readAuthorTrace(`${stdout}\n${stdout}`, "/expected", { CODEX_HOME: root })
    ).toThrow("identity");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
