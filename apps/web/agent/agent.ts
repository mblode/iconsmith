import { defineAgent } from "eve";

import "./lib/trust-system-ca";

const model = "google/gemini-3.1-flash-lite";

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
