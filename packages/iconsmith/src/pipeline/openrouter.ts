/**
 * OpenRouter as a generate arm.
 *
 * Same tool loop as the gateway: the model calls canvas primitives, never
 * emits a coordinate. The wire is OpenAI chat completions at
 * `https://openrouter.ai/api/v1/chat/completions`. `fetch` is injected so
 * tests stay hermetic.
 */
import { setTimeout as delay } from "node:timers/promises";

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4StreamResult,
  LanguageModelV4ToolCall,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4Usage,
  SharedV4FileData,
  SharedV4Warning,
} from "@ai-sdk/provider";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_PREFIX = "openrouter/";
/** Thinking Machines Inkling on OpenRouter's free tier. */
export const DEFAULT_OPENROUTER_MODEL = "thinkingmachines/inkling:free";
/**
 * Same weights, billed. `:free` is allowlisted to OpenRouter's listed
 * agentic apps; this CLI is not one of them, so the generate arm uses
 * the paid slug when the caller does not name a model that already
 * routes.
 */
export const OPENROUTER_INKLING = "thinkingmachines/inkling";
/**
 * Per-step output cap. The AI SDK default is 65536; OpenRouter reserves
 * that against remaining credits and 402s a small key. Tool args here
 * are tiny, so 4096 is the honest ceiling, not a quality knob.
 */
export const DEFAULT_OPENROUTER_MAX_TOKENS = 4096;

/** Bound a generate step so a missing `maxOutputTokens` cannot reserve 64k. */
export const openrouterMaxTokens = (requested?: number): number => {
  if (
    requested === undefined ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return DEFAULT_OPENROUTER_MAX_TOKENS;
  }
  return Math.min(Math.floor(requested), DEFAULT_OPENROUTER_MAX_TOKENS);
};

export type FetchLike = (
  input: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  }
) => Promise<Response>;

export interface OpenRouterModelOptions {
  apiKey: string;
  /** Injected in tests. Defaults to global `fetch`. */
  fetch?: FetchLike;
  modelId: string;
  /** Injected in tests so a 429 retry does not sleep the suite. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the OpenRouter root. Default {@link OPENROUTER_URL}. */
  url?: string;
}

/** New OpenRouter accounts are 10 rpm on Inkling; each generate step is one POST. */
export const OPENROUTER_RETRY_429 = 8;
export const OPENROUTER_RETRY_WAIT_MS = 7000;

export const retryAfterMs = (response: Response, attempt: number): number => {
  const raw = response.headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  return Math.min(OPENROUTER_RETRY_WAIT_MS * (attempt + 1), 60_000);
};

const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

/** Strip the `openrouter/` routing prefix; the API wants the slug alone. */
export const openrouterModelId = (id: string): string =>
  id.startsWith(OPENROUTER_PREFIX) ? id.slice(OPENROUTER_PREFIX.length) : id;

/**
 * Whether this id should leave the gateway and hit OpenRouter.
 *
 * `openrouter/` is explicit. A `:free` / `:nitro` suffix is OpenRouter's
 * variant grammar. `thinkingmachines/` plus `OPENROUTER_API_KEY` is Inkling
 * without making the caller invent a prefix. `ICONSMITH_PROVIDER=openrouter`
 * forces the rest.
 */
export const usesOpenRouter = (id: string): boolean => {
  if (id.startsWith(OPENROUTER_PREFIX)) {
    return true;
  }
  if (/:[a-z0-9-]+$/iu.test(id)) {
    return true;
  }
  if (present(process.env.ICONSMITH_PROVIDER) === "openrouter") {
    return true;
  }
  return (
    id.startsWith("thinkingmachines/") &&
    present(process.env.OPENROUTER_API_KEY) !== undefined
  );
};

const asBase64 = (data: SharedV4FileData): string | null => {
  if (data.type !== "data") {
    return null;
  }
  return typeof data.data === "string"
    ? data.data
    : Buffer.from(data.data).toString("base64");
};

const imageUrl = (data: SharedV4FileData, mediaType: string): string | null => {
  if (data.type === "url") {
    return data.url.href;
  }
  const b64 = asBase64(data);
  return b64 === null ? null : `data:${mediaType};base64,${b64}`;
};

const jsonText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value ?? {});

const toolOutputText = (output: LanguageModelV4ToolResultOutput): string => {
  if (output.type === "text" || output.type === "error-text") {
    return output.value;
  }
  if (output.type === "json" || output.type === "error-json") {
    return jsonText(output.value);
  }
  if (output.type === "execution-denied") {
    return output.reason ?? "execution denied";
  }
  if (output.type === "content") {
    return output.value
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter((s) => s !== "")
      .join("\n");
  }
  return "";
};

const toolOutputImages = (
  output: LanguageModelV4ToolResultOutput
): { mediaType: string; url: string }[] => {
  if (output.type !== "content") {
    return [];
  }
  const images: { mediaType: string; url: string }[] = [];
  for (const part of output.value) {
    if (part.type !== "file") {
      continue;
    }
    const url = imageUrl(part.data, part.mediaType);
    if (url !== null && part.mediaType.startsWith("image/")) {
      images.push({ mediaType: part.mediaType, url });
    }
  }
  return images;
};

type OpenAIPart =
  | { text: string; type: "text" }
  | { image_url: { url: string }; type: "image_url" };

type OpenAIContent = string | OpenAIPart[];

interface OpenAIToolCall {
  function: { arguments: string; name: string };
  id: string;
  type: "function";
}

interface OpenAIMessage {
  content?: OpenAIContent;
  role: "assistant" | "system" | "tool" | "user";
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

const userParts = (
  content: Extract<LanguageModelV4Message, { role: "user" }>["content"]
): OpenAIContent => {
  const parts: Exclude<OpenAIContent, string> = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ text: part.text, type: "text" });
      continue;
    }
    const url = imageUrl(part.data, part.mediaType);
    if (url !== null) {
      parts.push({ image_url: { url }, type: "image_url" });
    }
  }
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
};

/** Prompt → OpenAI chat messages. Images in tool results ride a follow-up
 *  user turn so the model can see a `render` / `compare` PNG. */
export const toOpenAIMessages = (
  prompt: readonly LanguageModelV4Message[]
): OpenAIMessage[] => {
  const out: OpenAIMessage[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      out.push({ content: message.content, role: "system" });
      continue;
    }
    if (message.role === "user") {
      out.push({ content: userParts(message.content), role: "user" });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      const toolCalls = message.content
        .filter((part) => part.type === "tool-call")
        .map((part) => ({
          function: {
            arguments: jsonText(part.input),
            name: part.toolName,
          },
          id: part.toolCallId,
          type: "function" as const,
        }));
      const row: OpenAIMessage = { role: "assistant" };
      if (text !== "") {
        row.content = text;
      }
      if (toolCalls.length > 0) {
        row.tool_calls = toolCalls;
      }
      out.push(row);
      continue;
    }
    for (const part of message.content) {
      if (part.type !== "tool-result") {
        continue;
      }
      out.push({
        content: toolOutputText(part.output),
        role: "tool",
        tool_call_id: part.toolCallId,
      });
      const images = toolOutputImages(part.output);
      if (images.length > 0) {
        out.push({
          content: [
            {
              text: `Image from tool ${part.toolName}:`,
              type: "text",
            },
            ...images.map((img) => ({
              image_url: { url: img.url },
              type: "image_url" as const,
            })),
          ],
          role: "user",
        });
      }
    }
  }
  return out;
};

interface OpenAITool {
  function: {
    description?: string;
    name: string;
    parameters: LanguageModelV4FunctionTool["inputSchema"];
  };
  type: "function";
}

const toOpenAITools = (
  tools: LanguageModelV4CallOptions["tools"]
): OpenAITool[] | undefined => {
  const fns = (tools ?? []).filter(
    (item): item is LanguageModelV4FunctionTool => item.type === "function"
  );
  if (fns.length === 0) {
    return undefined;
  }
  return fns.map((item) => ({
    function: {
      description: item.description,
      name: item.name,
      parameters: item.inputSchema,
    },
    type: "function",
  }));
};

const toToolChoice = (
  choice: LanguageModelV4CallOptions["toolChoice"]
): unknown => {
  if (choice === undefined || choice.type === "auto") {
    return undefined;
  }
  if (choice.type === "none" || choice.type === "required") {
    return choice.type;
  }
  return { function: { name: choice.toolName }, type: "function" };
};

interface OpenRouterChoice {
  finish_reason?: string;
  message?: {
    content?: string | null;
    reasoning?: string | null;
    reasoning_content?: string | null;
    tool_calls?: {
      function?: { arguments?: string; name?: string };
      id?: string;
    }[];
  };
}

interface OpenRouterUsage {
  completion_tokens?: number;
  prompt_tokens?: number;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string };
  id?: string;
  model?: string;
  usage?: OpenRouterUsage;
}

const finishOf = (reason = "stop"): LanguageModelV4FinishReason => {
  let unified: LanguageModelV4FinishReason["unified"] = "other";
  if (reason === "tool_calls" || reason === "tool-calls") {
    unified = "tool-calls";
  } else if (reason === "length") {
    unified = "length";
  } else if (reason === "content_filter" || reason === "content-filter") {
    unified = "content-filter";
  } else if (reason === "stop") {
    unified = "stop";
  }
  return { raw: reason, unified };
};

const usageOf = (usage: OpenRouterUsage | undefined): LanguageModelV4Usage => {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  return {
    inputTokens: {
      cacheRead: 0,
      cacheWrite: 0,
      noCache: input,
      total: input,
    },
    outputTokens: { reasoning: 0, text: output, total: output },
  };
};

const contentOf = (
  choice: OpenRouterChoice | undefined
): LanguageModelV4Content[] => {
  const content: LanguageModelV4Content[] = [];
  const reasoning =
    choice?.message?.reasoning ?? choice?.message?.reasoning_content;
  if (reasoning) {
    content.push({ text: reasoning, type: "reasoning" });
  }
  const text = choice?.message?.content;
  if (text) {
    content.push({ text, type: "text" });
  }
  for (const called of choice?.message?.tool_calls ?? []) {
    const name = called.function?.name;
    if (name === undefined || called.id === undefined) {
      continue;
    }
    const toolCall: LanguageModelV4ToolCall = {
      input: called.function?.arguments ?? "{}",
      toolCallId: called.id,
      toolName: name,
      type: "tool-call",
    };
    content.push(toolCall);
  }
  return content;
};

const requestHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://github.com/mblode/iconsmith",
  "X-Title": "iconsmith",
});

const errorText = async (response: Response): Promise<string> => {
  const body = await response.text();
  let message = body.slice(0, 400) || `OpenRouter HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
    };
    if (typeof parsed.error === "string") {
      message = parsed.error;
    } else if (parsed.error) {
      const { message: fromError } = parsed.error;
      if (fromError) {
        message = fromError;
      }
    }
  } catch {
    // Keep the raw body when it is not JSON.
  }
  if (response.status === 403 && /agentic harness/iu.test(message)) {
    return (
      `${message} iconsmith is not a listed OpenRouter app, so ` +
      `\`${DEFAULT_OPENROUTER_MODEL}\` is blocked. Use ` +
      `\`--model ${OPENROUTER_INKLING}\` (same weights, billed).`
    );
  }
  return message;
};

/** A LanguageModelV4 that speaks OpenRouter chat completions, tools included. */
export const createOpenRouterModel = (
  options: OpenRouterModelOptions
): LanguageModelV4 => {
  const modelId = openrouterModelId(options.modelId);
  const root = (options.url ?? OPENROUTER_URL).replace(/\/$/u, "");
  const fetchFn = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? delay;
  const generate = async (
    call: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4GenerateResult> => {
    const body = {
      max_tokens: openrouterMaxTokens(call.maxOutputTokens),
      messages: toOpenAIMessages(call.prompt),
      model: modelId,
      temperature: call.temperature,
      tool_choice: toToolChoice(call.toolChoice),
      tools: toOpenAITools(call.tools),
    };
    const headers = requestHeaders(options.apiKey);
    for (const [key, value] of Object.entries(call.headers ?? {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }
    const post = async (attempt: number): Promise<Response> => {
      const next = await fetchFn(`${root}/chat/completions`, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
        signal: call.abortSignal,
      });
      if (next.status !== 429 || attempt >= OPENROUTER_RETRY_429) {
        return next;
      }
      await sleep(retryAfterMs(next, attempt));
      return post(attempt + 1);
    };
    const response = await post(0);
    if (!response.ok) {
      throw new Error(
        `OpenRouter ${response.status}: ${await errorText(response)}`
      );
    }
    const payload = (await response.json()) as OpenRouterResponse;
    if (payload.error?.message) {
      throw new Error(`OpenRouter: ${payload.error.message}`);
    }
    const choice = payload.choices?.[0];
    const warnings: SharedV4Warning[] = [];
    return {
      content: contentOf(choice),
      finishReason: finishOf(choice?.finish_reason),
      request: { body },
      response: {
        body: payload,
        id: payload.id,
        modelId: payload.model ?? modelId,
      },
      usage: usageOf(payload.usage),
      warnings,
    };
  };

  return {
    doGenerate: generate,
    doStream: async (call): Promise<LanguageModelV4StreamResult> => {
      const result = await generate(call);
      return {
        request: result.request,
        response: { headers: result.response?.headers },
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "stream-start",
              warnings: result.warnings,
            });
            for (const part of result.content) {
              if (part.type === "text") {
                controller.enqueue({ id: "0", type: "text-start" });
                controller.enqueue({
                  delta: part.text,
                  id: "0",
                  type: "text-delta",
                });
                controller.enqueue({ id: "0", type: "text-end" });
              } else if (part.type === "tool-call") {
                controller.enqueue(part);
              }
            }
            controller.enqueue({
              finishReason: result.finishReason,
              type: "finish",
              usage: result.usage,
            });
            controller.close();
          },
        }),
      };
    },
    modelId,
    provider: "openrouter",
    specificationVersion: "v4",
    supportedUrls: {},
  };
};
