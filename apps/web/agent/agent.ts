import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "eve";

import "./lib/trust-system-ca";

const model = process.env.OPENAI_API_KEY
  ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-5.4-mini")
  : "anthropic/claude-haiku-4.5";

export default defineAgent({
  description:
    "Orchestrates Iconsmith's deterministic paired-icon generation and visual review pipeline.",
  limits: {
    maxInputTokensPerSession: 250_000,
    maxOutputTokensPerSession: 25_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1000,
  },
  model,
});
