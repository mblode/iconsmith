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
const SKILL_FILE = "SKILL.md";

export interface GatewayHarnessRequest {
  abortSignal?: AbortSignal;
  preview: Buffer | null;
  prompt: string;
  system: string;
}

export type GatewayHarnessAsk = (
  request: GatewayHarnessRequest
) => Promise<{ cost?: ApiCost; text: string }>;

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

/** Accept a plain answer or one fenced block, but never fish prose for loose
 * geometry. A harness response is a whole `.icon` program or a failed run. */
export const programFromHarnessText = (text: string): string | null => {
  const trimmed = text.trim();
  const fenced = /```(?:icon|text)?\s*\n(?<program>[\s\S]*?)```/iu.exec(trimmed)
    ?.groups?.program;
  const candidate = (fenced ?? trimmed).trim();
  if (!/^icon\s+[a-z0-9][a-z0-9-]*\s*$/imu.test(candidate)) {
    return null;
  }
  return `${candidate}\n`;
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
    try {
      const response = await ask({
        abortSignal: invocation.abortSignal,
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
        return {
          code: 1,
          costs: response.cost ? [response.cost] : undefined,
          stderr: "Claude Gateway returned no complete .icon program.",
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
      invocation.abortSignal?.throwIfAborted();
      return {
        code: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout: "",
      };
    }
  };
};
