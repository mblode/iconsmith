/**
 * Claude Code's harness contract over a language model instead of a local
 * executable. Eve's authored runtime cannot spawn child processes, and a
 * deployed server has no `claude` binary; this adapter preserves the same
 * staged skill, brief, program, preview, and repair loop through AI Gateway.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateText } from "ai";
import type { LanguageModel, UserContent } from "ai";

import { AUDIT_FILE, PREVIEW_FILE } from "./audit.js";
import type { ApiCost } from "./cost.js";
import { tokenUsageOf } from "./cost.js";
import { DEFAULT_MODEL, gatewayCostTracker, resolveModel } from "./gateway.js";
import type { HarnessRun, Spawn } from "./harness.js";

const BRIEF_FILE = "BRIEF.md";
const PARTS_FILE = "parts.json";
const PROGRAM_FILE = "icon.icon";
/** What came back when it was not a program. Written only on that failure, so
 *  its presence in a scratch directory is itself the diagnosis. */
const REJECTED_FILE = "REJECTED.txt";
const SKILL_FILE = "SKILL.md";

interface GatewayHarnessRequest {
  abortSignal?: AbortSignal;
  preview: Buffer | null;
  prompt: string;
  system: string;
}

type GatewayHarnessAsk = (request: GatewayHarnessRequest) => Promise<{
  cost?: ApiCost;
  /** Why the model stopped. `"length"` is the one value the caller cannot
   *  infer from the text: a completion cut at the output-token limit and a
   *  model that answered in prose are the same string with different fixes. */
  finishReason?: string;
  text: string;
}>;

export interface GatewayHarnessOptions {
  apiKey?: string;
  ask?: GatewayHarnessAsk;
  model?: LanguageModel;
}

const readIfPresent = (dir: string, name: string): string | null => {
  const file = path.join(dir, name);
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
};

const vocabularyNames = (source: string | null): string => {
  if (!source) {
    return "No parts vocabulary is staged.";
  }
  try {
    const parsed = JSON.parse(source) as {
      parts?: {
        closed?: boolean;
        h?: number;
        icons?: string[];
        id?: string;
        name?: string;
        nodes?: number;
        w?: number;
      }[];
    };
    return JSON.stringify(
      (parsed.parts ?? []).map(({ closed, h, icons, id, name, nodes, w }) => ({
        closed,
        h,
        icons,
        id,
        name,
        nodes,
        w,
      })),
      null,
      2
    );
  } catch {
    return "The staged parts vocabulary was invalid; use primitives.";
  }
};

/** Any info string, not only `icon` and `text`. A block opened as ```dsl used
 *  to miss this and fall through to the bare-text branch, which found the
 *  header inside the fence and returned the backticks with it — a program whose
 *  first and last lines are ops the compiler has never heard of. */
const FENCE = /```[^\n]*\n(?<program>[\s\S]*?)```/u;

/** The header, read as `dsl.ts` reads it: that parser strips a comment before
 *  it tokenises, so `icon clock # the face` is a legal header there. A check
 *  stricter than the compiler it feeds rejects programs that would have drawn. */
const HEADER = /^icon\s+[a-z0-9][a-z0-9-]*\s*(?:#.*)?$/imu;

/** Enough of the grammar to tell a partial edit from prose, and nothing more:
 *  this list feeds an error message, never a decision about what runs. `dsl.ts`
 *  stays the only authority on what an op is, so a list that falls behind it
 *  costs a less specific sentence rather than a wrong one. */
const PROGRAM_LINE =
  /^(?:keyline|finish|part|rect|circle|arc|diamond|hole|line|dot|cent(?:er|re)|fit|cohort)\b/imu;

/** Accept a plain answer or one fenced block, but never fish prose for loose
 * geometry. A harness response is a whole `.icon` program or a failed run. */
export const programFromHarnessText = (text: string): string | null => {
  const trimmed = text.trim();
  const candidate = (FENCE.exec(trimmed)?.groups?.program ?? trimmed).trim();
  if (!HEADER.test(candidate)) {
    return null;
  }
  return `${candidate}\n`;
};

/** The first line, capped: an error message is one line and the rest of the
 *  response is on disk. */
const opening = (text: string): string => {
  const [first = ""] = text.trim().split("\n");
  return first.length > 96 ? `${first.slice(0, 96)}…` : first;
};

/**
 * Why a response was not a program, in the terms whoever reads the failure
 * needs.
 *
 * "Returned no complete .icon program" is the one fact that narrows nothing:
 * an empty completion, a refusal, a partial edit and a headerless program all
 * produce it and each has a different fix. The response itself was discarded
 * into a `stdout` no caller printed, so telling them apart meant paying for the
 * run again — one campaign left 53 scratch directories holding a brief, a skill
 * and nothing the model had said.
 */
export const describeRejection = (
  text: string,
  finishReason?: string
): string => {
  const cut =
    finishReason === "length" ? " and was cut at the output-token limit" : "";
  const trimmed = text.trim();
  if (!trimmed) {
    return `the response was empty${cut}`;
  }
  const fenced = FENCE.exec(trimmed)?.groups?.program?.trim();
  if (fenced) {
    return `a fenced block with no \`icon <slug>\` header${cut}, opening \`${opening(fenced)}\``;
  }
  if (PROGRAM_LINE.test(trimmed)) {
    return `program lines with no \`icon <slug>\` header${cut}, opening \`${opening(trimmed)}\``;
  }
  return `${trimmed.length} characters of prose${cut}, opening \`${opening(trimmed)}\``;
};

const defaultAsk =
  (options: GatewayHarnessOptions): GatewayHarnessAsk =>
  async ({ abortSignal, preview, prompt, system }) => {
    abortSignal?.throwIfAborted();
    const content: UserContent = [{ text: prompt, type: "text" }];
    if (preview) {
      content.push({ data: preview, mediaType: "image/png", type: "file" });
    }
    const costTracker = gatewayCostTracker(options.apiKey);
    const model = options.model ?? DEFAULT_MODEL;
    const result = await generateText({
      abortSignal,
      messages: [{ content, role: "user" }],
      model: resolveModel(model, options.apiKey),
      system,
    });
    costTracker.record(result.providerMetadata);
    return {
      cost: await costTracker.measure({
        model: typeof model === "string" ? model : model.modelId,
        operation: "claude-harness",
        usage: tokenUsageOf(result.totalUsage),
      }),
      finishReason: result.finishReason,
      text: result.text,
    };
  };

/** A {@link Spawn} backed by Claude through Vercel AI Gateway. The adapter
 * deliberately writes the same `icon.icon` deliverable as the CLI, so the
 * harness's compiler, raster audit, and repair recursion remain unchanged. */
export const gatewayHarnessSpawn = (
  options: GatewayHarnessOptions = {}
): Spawn => {
  const ask = options.ask ?? defaultAsk(options);
  return async (invocation): Promise<HarnessRun> => {
    const skill = readIfPresent(invocation.cwd, SKILL_FILE);
    const brief = readIfPresent(invocation.cwd, BRIEF_FILE);
    if (!(skill && brief)) {
      return {
        code: 1,
        stderr: "The staged harness skill or brief is missing.",
        stdout: "",
      };
    }
    const prior = readIfPresent(invocation.cwd, PROGRAM_FILE);
    const audit = readIfPresent(invocation.cwd, AUDIT_FILE);
    const previewPath = path.join(invocation.cwd, PREVIEW_FILE);
    const preview = existsSync(previewPath) ? readFileSync(previewPath) : null;
    const prompt = [
      brief,
      "",
      "Addressable parts (names and measurements only; no path data):",
      vocabularyNames(readIfPresent(invocation.cwd, PARTS_FILE)),
      ...(prior ? ["", "Current program to improve:", prior] : []),
      ...(audit ? ["", "Host audit to resolve:", audit] : []),
      "",
      "Return only the complete icon.icon program. No prose and no Markdown fence.",
    ].join("\n");
    // `timeoutMs` is part of the Spawn contract and `nodeSpawn` enforces it
    // with a SIGKILL timer — a wedged CLI cannot hold a benchmark open
    // overnight. The gateway adapter honoured only `abortSignal`, so a hung
    // `generateText` ran unbounded unless a caller happened to pass one. Fold
    // the timeout in as a second abort source.
    const deadline = AbortSignal.timeout(invocation.timeoutMs);
    const signal = invocation.abortSignal
      ? AbortSignal.any([invocation.abortSignal, deadline])
      : deadline;
    try {
      const response = await ask({
        abortSignal: signal,
        preview,
        prompt,
        system: [
          "You are Claude Code operating as Iconsmith's non-interactive drawing harness.",
          "Follow this skill exactly. The DSL is the only drawing authority.",
          "Do not output SVG or path data.",
          "",
          skill,
        ].join("\n"),
      });
      const program = programFromHarnessText(response.text);
      if (!program) {
        // Beside the brief, because that is where the rest of this run's
        // evidence already is and a failed run keeps the directory.
        writeFileSync(
          path.join(invocation.cwd, REJECTED_FILE),
          `${response.text}\n`
        );
        return {
          code: 1,
          costs: response.cost ? [response.cost] : undefined,
          stderr: `Claude Gateway returned no complete .icon program: ${describeRejection(response.text, response.finishReason)}. Full response at ${REJECTED_FILE}.`,
          stdout: response.text,
        };
      }
      writeFileSync(path.join(invocation.cwd, PROGRAM_FILE), program);
      return {
        code: 0,
        costs: response.cost ? [response.cost] : undefined,
        stderr: "",
        stdout: response.text,
      };
    } catch (error) {
      // A real caller cancellation propagates; the timeout is a failed run, not
      // a cancellation, so it falls through to a code:1 result the way a killed
      // `nodeSpawn` does.
      invocation.abortSignal?.throwIfAborted();
      let stderr: string;
      if (deadline.aborted) {
        stderr = `Claude Gateway did not answer within ${invocation.timeoutMs}ms.`;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
      }
      return { code: 1, stderr, stdout: "" };
    }
  };
};
