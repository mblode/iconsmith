/** Shared fail-closed validation for retained native Codex JSONL traces. */
import { createHash } from "node:crypto";

import { assertNoAmbientCatalogs } from "./local-author-context.js";

interface NativeTraceAttachment {
  name: string;
  sha256: string;
}

export interface NativeTraceExpectation {
  evidenceMode?: "images" | "sealed-text";
  expectedAttachments?: readonly NativeTraceAttachment[];
  expectedFinalAnswer?: string;
  expectedModel?: string;
  expectedSessionId?: string;
}

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const records = (trace: string) => {
  try {
    return trace
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          throw new TypeError("Native trace record is not an object");
        }
        return value as Record<string, unknown>;
      });
  } catch (error) {
    throw new Error("Native trace is not valid JSONL", { cause: error });
  }
};

const payload = (record: Record<string, unknown>) =>
  typeof record.payload === "object" &&
  record.payload !== null &&
  !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : undefined;

const content = (message: Record<string, unknown>) => {
  if (
    !Array.isArray(message.content) ||
    message.content.some(
      (block) =>
        typeof block !== "object" || block === null || Array.isArray(block)
    )
  ) {
    throw new Error("Native trace message content is malformed");
  }
  return message.content as Record<string, unknown>[];
};

// oxlint-disable-next-line eslint/complexity -- one fail-closed pass binds every semantic trace dimension.
export const validateNativeCodexTrace = (
  trace: string,
  expectation: NativeTraceExpectation
) => {
  assertNoAmbientCatalogs(trace);
  const traceRecords = records(trace);
  const responseRecords = traceRecords.filter(
    (record) => record.type === "response_item"
  );
  const responseItems = responseRecords.map(payload);
  if (responseItems.some((item) => item === undefined)) {
    throw new Error("Native trace response item payload is malformed");
  }
  const validResponseItems = responseItems as Record<string, unknown>[];
  if (
    validResponseItems.some(
      (item) =>
        typeof item.type === "string" &&
        (item.type.endsWith("_call") || item.type.endsWith("_call_output"))
    )
  ) {
    throw new Error("Native trace used a prohibited tool");
  }

  const models = traceRecords
    .filter((record) => record.type === "turn_context")
    .map(payload)
    .map((item) => item?.model);
  if (
    expectation.expectedModel !== undefined &&
    (models.length !== 1 || models[0] !== expectation.expectedModel)
  ) {
    throw new Error("Native trace model identity is ambiguous");
  }
  const sessions = traceRecords
    .filter((record) => record.type === "session_meta")
    .map(payload)
    .map((item) => item?.id);
  if (
    expectation.expectedSessionId !== undefined &&
    (sessions.length !== 1 ||
      sessions[0] !== expectation.expectedSessionId ||
      !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u.test(
        expectation.expectedSessionId
      ))
  ) {
    throw new Error("Native trace session identity is ambiguous");
  }

  const messages = validResponseItems.filter((item) => item.type === "message");
  if (
    messages.some(
      (message) =>
        !["assistant", "developer", "system", "user"].includes(
          String(message.role)
        )
    )
  ) {
    throw new Error("Native trace message role is malformed");
  }
  const parsedMessages = messages.map((message) => ({
    content: content(message),
    role: message.role,
  }));
  const userMessages = parsedMessages.filter(
    (message) => message.role === "user"
  );
  const allImages = parsedMessages.flatMap((message, messageIndex) =>
    message.content
      .filter((block) => block.type === "input_image")
      .map((block) => ({ block, messageIndex }))
  );
  if (expectation.evidenceMode !== undefined && !userMessages.length) {
    throw new Error("Native trace lacks an initial user message");
  }
  if (expectation.evidenceMode === "sealed-text") {
    if ((expectation.expectedAttachments?.length ?? 0) || allImages.length) {
      throw new Error("Native sealed-text trace exposed image attachments");
    }
  } else if (expectation.evidenceMode === "images") {
    const expectedAttachments = expectation.expectedAttachments ?? [];
    const attachmentMessageIndexes = new Set(
      allImages.map(({ messageIndex }) => messageIndex)
    );
    const [initialUserIndex] = attachmentMessageIndexes;
    if (
      attachmentMessageIndexes.size !== 1 ||
      parsedMessages[initialUserIndex ?? -1]?.role !== "user"
    ) {
      throw new Error("Native trace lacks one initial user attachment message");
    }
    const supplied = allImages.map(({ block, messageIndex }) => {
      if (
        messageIndex !== initialUserIndex ||
        typeof block.image_url !== "string" ||
        !block.image_url.startsWith("data:image/png;base64,") ||
        !["high", "original"].includes(String(block.detail))
      ) {
        throw new Error(
          "Native trace attachment is not an initial high-detail PNG"
        );
      }
      return digest(Buffer.from(block.image_url.split(",")[1] ?? "", "base64"));
    });
    if (
      supplied.length !== expectedAttachments.length ||
      supplied.some(
        (sha256, index) => sha256 !== expectedAttachments[index]?.sha256
      )
    ) {
      throw new Error(
        "Native trace attachment order does not match the request"
      );
    }
  }

  if (expectation.expectedFinalAnswer !== undefined) {
    const assistantAnswers = parsedMessages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .filter(({ message }) => message.role === "assistant")
      .flatMap(({ message, messageIndex }) => {
        const blocks = message.content.filter(
          (block) =>
            block.type === "output_text" && typeof block.text === "string"
        );
        if (
          blocks.length !== 1 ||
          message.content.some(
            (block) =>
              block.type !== "output_text" || typeof block.text !== "string"
          )
        ) {
          throw new Error(
            "Native trace assistant answer is malformed or ambiguous"
          );
        }
        return [{ messageIndex, text: blocks[0]?.text }];
      });
    if (
      assistantAnswers.length !== 1 ||
      assistantAnswers[0]?.messageIndex !== parsedMessages.length - 1 ||
      assistantAnswers[0]?.text !== expectation.expectedFinalAnswer
    ) {
      throw new Error(
        "Native trace final answer does not match settled stdout"
      );
    }
  }

  return Object.freeze({
    model: models[0],
    sessionId: sessions[0],
    traceSha256: digest(Buffer.from(trace)),
  });
};
