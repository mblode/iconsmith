/**
 * OpenRouter adapter, without a network.
 *
 * The live Inkling eval is a different question. This file checks that the
 * generate arm builds the chat-completions request the loop needs — tools,
 * tool results, a render PNG — and that a `:free` slug does not go looking
 * for a gateway token.
 */
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
  LanguageModelV4Message,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENROUTER_MAX_TOKENS,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_INKLING,
  OPENROUTER_URL,
  createOpenRouterModel,
  openrouterMaxTokens,
  openrouterModelId,
  toOpenAIMessages,
  usesOpenRouter,
} from "./openrouter.js";

const tool = (name: string): LanguageModelV4FunctionTool => ({
  inputSchema: {
    properties: { x: { type: "number" } },
    type: "object",
  },
  name,
  type: "function",
});

const call = (
  prompt: LanguageModelV4Message[],
  extras: Partial<LanguageModelV4CallOptions> = {}
): LanguageModelV4CallOptions => ({
  prompt,
  ...extras,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

describe("usesOpenRouter / openrouterModelId", () => {
  it("treats an OpenRouter prefix and a :free variant as OpenRouter", () => {
    expect(usesOpenRouter("openrouter/thinkingmachines/inkling")).toBe(true);
    expect(usesOpenRouter(DEFAULT_OPENROUTER_MODEL)).toBe(true);
    expect(usesOpenRouter("anthropic/claude-opus-5")).toBe(false);
    expect(openrouterModelId("openrouter/thinkingmachines/inkling:free")).toBe(
      "thinkingmachines/inkling:free"
    );
  });
});

describe("toOpenAIMessages", () => {
  it("keeps system text and turns a render PNG into a user image", () => {
    const messages = toOpenAIMessages([
      { content: "Draw with tools.", role: "system" },
      { content: [{ text: "heart", type: "text" }], role: "user" },
      {
        content: [
          {
            input: { cx: 12, cy: 12, r: 8 },
            toolCallId: "c1",
            toolName: "circle",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                {
                  data: { data: "aaa", type: "data" },
                  mediaType: "image/png",
                  type: "file",
                },
                { text: "look", type: "text" },
              ],
            },
            toolCallId: "c1",
            toolName: "render",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ]);
    expect(messages[0]).toEqual({
      content: "Draw with tools.",
      role: "system",
    });
    expect(messages[1]).toEqual({ content: "heart", role: "user" });
    expect(messages[2]?.tool_calls?.[0]?.function.name).toBe("circle");
    expect(messages[3]).toEqual({
      content: "look",
      role: "tool",
      tool_call_id: "c1",
    });
    expect(messages[4]).toEqual({
      content: [
        { text: "Image from tool render:", type: "text" },
        {
          image_url: { url: "data:image/png;base64,aaa" },
          type: "image_url",
        },
      ],
      role: "user",
    });
  });
});

describe("createOpenRouterModel", () => {
  it("posts tools and the stripped slug to chat/completions", async () => {
    const seen: { body: unknown; url: string }[] = [];
    const model = createOpenRouterModel({
      apiKey: "or-test-key",
      fetch: (url, init) => {
        seen.push({
          body: JSON.parse(init?.body ?? "{}"),
          url,
        });
        return Promise.resolve(
          jsonResponse({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: '{"cx":12,"cy":12,"r":8}',
                        name: "circle",
                      },
                      id: "call-1",
                    },
                  ],
                },
              },
            ],
            usage: { completion_tokens: 4, prompt_tokens: 20 },
          })
        );
      },
      modelId: "openrouter/thinkingmachines/inkling:free",
    });

    const result = await model.doGenerate(
      call([{ content: [{ text: "clock", type: "text" }], role: "user" }], {
        tools: [tool("circle"), tool("lint")],
      })
    );

    expect(model.provider).toBe("openrouter");
    expect(model.modelId).toBe("thinkingmachines/inkling:free");
    expect(seen[0]?.url).toBe(`${OPENROUTER_URL}/chat/completions`);
    const body = seen[0]?.body as {
      model: string;
      tools: { function: { name: string } }[];
    };
    expect(body.model).toBe("thinkingmachines/inkling:free");
    expect(body.tools.map((item) => item.function.name)).toEqual([
      "circle",
      "lint",
    ]);
    const posted = seen[0]?.body as { max_tokens: number } | undefined;
    expect(posted?.max_tokens).toBe(DEFAULT_OPENROUTER_MAX_TOKENS);
    expect(result.finishReason.unified).toBe("tool-calls");
    expect(result.content).toEqual([
      {
        input: '{"cx":12,"cy":12,"r":8}',
        toolCallId: "call-1",
        toolName: "circle",
        type: "tool-call",
      },
    ]);
    expect(JSON.stringify(seen[0]?.body)).not.toContain("or-test-key");
  });

  it("throws an HTTP error without repeating the key", async () => {
    const model = createOpenRouterModel({
      apiKey: "sk-or-secret-should-not-leak",
      fetch: () =>
        Promise.resolve(
          jsonResponse({ error: { message: "model not found" } }, 404)
        ),
      modelId: DEFAULT_OPENROUTER_MODEL,
    });
    await expect(
      model.doGenerate(
        call([{ content: [{ text: "hi", type: "text" }], role: "user" }])
      )
    ).rejects.toThrow(/model not found/u);
    await expect(
      model.doGenerate(
        call([{ content: [{ text: "hi", type: "text" }], role: "user" }])
      )
    ).rejects.not.toThrow(/sk-or-secret/u);
  });

  it("explains a harness-gated :free 403 without leaking the key", async () => {
    const model = createOpenRouterModel({
      apiKey: "sk-or-secret-should-not-leak",
      fetch: () =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                message:
                  "thinkingmachines/inkling:free is only available on agentic harnesses.",
              },
            },
            403
          )
        ),
      modelId: DEFAULT_OPENROUTER_MODEL,
    });
    await expect(
      model.doGenerate(
        call([{ content: [{ text: "hi", type: "text" }], role: "user" }])
      )
    ).rejects.toThrow(
      new RegExp(`--model ${OPENROUTER_INKLING.replace("/", "\\/")}`, "u")
    );
    await expect(
      model.doGenerate(
        call([{ content: [{ text: "hi", type: "text" }], role: "user" }])
      )
    ).rejects.not.toThrow(/sk-or-secret/u);
  });
});

describe("openrouterMaxTokens", () => {
  it("caps the SDK 64k default so OpenRouter cannot reserve it", () => {
    expect(openrouterMaxTokens()).toBe(DEFAULT_OPENROUTER_MAX_TOKENS);
    expect(openrouterMaxTokens(65_536)).toBe(DEFAULT_OPENROUTER_MAX_TOKENS);
    expect(openrouterMaxTokens(512)).toBe(512);
  });
});
