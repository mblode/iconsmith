import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { validateNativeCodexTrace } from "./local-native-trace.js";

const sessionId = "00000000-0000-0000-0000-000000000001";
const image = Buffer.from("fixture-image");
const answer = '{"answer":"ok"}';
const record = (value: object) => JSON.stringify(value);
const trace = (extra: object[] = []) =>
  [
    { payload: { id: sessionId }, type: "session_meta" },
    { payload: { model: "gpt-6-astra" }, type: "turn_context" },
    {
      payload: {
        content: [
          { text: "Inspect.", type: "input_text" },
          {
            detail: "high",
            image_url: `data:image/png;base64,${image.toString("base64")}`,
            type: "input_image",
          },
        ],
        role: "user",
        type: "message",
      },
      type: "response_item",
    },
    ...extra,
    {
      payload: {
        content: [{ text: answer, type: "output_text" }],
        role: "assistant",
        type: "message",
      },
      type: "response_item",
    },
  ]
    .map(record)
    .join("\n");

const expectation = {
  evidenceMode: "images" as const,
  expectedAttachments: [
    {
      name: "proof.png",
      sha256: createHash("sha256").update(image).digest("hex"),
    },
  ],
  expectedFinalAnswer: answer,
  expectedModel: "gpt-6-astra",
  expectedSessionId: sessionId,
};

it("binds native trace identity, initial attachments and final answer", () => {
  expect(validateNativeCodexTrace(trace(), expectation)).toMatchObject({
    model: "gpt-6-astra",
    sessionId,
  });
});

it("refuses tools, ambiguous identity, attachment drift and answer drift", () => {
  expect(() =>
    validateNativeCodexTrace(
      trace([{ payload: { type: "local_shell_call" }, type: "response_item" }]),
      expectation
    )
  ).toThrow("prohibited tool");
  expect(() =>
    validateNativeCodexTrace(
      trace([{ payload: null, type: "response_item" }]),
      expectation
    )
  ).toThrow("payload is malformed");
  expect(() =>
    validateNativeCodexTrace(
      `${trace()}\n${record({ payload: { model: "gpt-6-astra" }, type: "turn_context" })}`,
      expectation
    )
  ).toThrow("model identity");
  expect(() =>
    validateNativeCodexTrace(trace(), {
      ...expectation,
      expectedAttachments: [{ name: "proof.png", sha256: "0".repeat(64) }],
    })
  ).toThrow("attachment order");
  expect(() =>
    validateNativeCodexTrace(trace(), {
      ...expectation,
      expectedFinalAnswer: '{"answer":"forged"}',
    })
  ).toThrow("final answer");
  expect(() =>
    validateNativeCodexTrace(
      trace([
        {
          payload: {
            content: [
              { text: answer, type: "output_text" },
              { text: answer, type: "output_text" },
            ],
            role: "assistant",
            type: "message",
          },
          type: "response_item",
        },
      ]),
      expectation
    )
  ).toThrow("malformed or ambiguous");
});
