import { defineAgent, defineDynamic } from "eve";

import {
  refuseForeignSessionTurn,
  STUDIO_SESSION_LIFETIME_MS,
} from "@iconsmith/contract/session-owner";
import "./lib/trust-system-ca";

const model = "google/gemini-3.7-flash";

export default defineAgent({
  description:
    "Orchestrates Iconsmith's deterministic paired-icon generation and visual review pipeline.",
  limits: {
    maxInputTokensPerSession: 250_000,
    maxOutputTokensPerSession: 25_000,
    // One definition, in the contract: `channels/eve.ts` bounds a session id's
    // usable life by this same number, and the studio will not offer a recorded
    // cursor older than it.
    sessionTimeoutMs: STUDIO_SESSION_LIFETIME_MS,
  },
  /**
   * Dynamic only to obtain a seam that can refuse a turn.
   *
   * Every branch returns the same `model`, so nothing about the selection is
   * actually dynamic and the warning about prompt caches being per-model does
   * not apply. What `defineDynamic` supplies is the one authored callback eve
   * runs *before* a turn does any model-dependent work: `dispatchDynamicModelEvent`
   * wraps whatever the handler throws in a `DynamicModelSelectionError`, and
   * `harness/tool-loop.js` catches exactly that around `emitTurnPreamble` and
   * hands it to `failModelSelection` at `stepIndex: 0` — before the step loop,
   * so before `resolveActiveRuntimeModel` and before any provider call. A
   * refused continuation therefore costs one workflow turn and no tokens,
   * against the ~$0.45 `channels/eve.ts` prices the worst turn at.
   *
   * `turn.started`, not `session.started`: the caller of a turn and the caller
   * that opened the session can only disagree on a follow-up, and
   * `session.started` fires once. The dispatcher clears the durable turn-scoped
   * selection before running the handler, so a refusal leaves no model behind
   * for the next turn to inherit.
   *
   * The visible cost is that `GET /eve/v1/info` reports
   * `routing: { kind: "dynamic" }` in place of the model id. Nothing reads it —
   * the Studio never calls `/info`.
   */
  model: defineDynamic({
    events: {
      "turn.started": (_event, ctx) => {
        const refusal = refuseForeignSessionTurn(ctx.session.auth);
        if (refusal) {
          throw new Error(refusal.message);
        }
        return model;
      },
    },
  }),
});
