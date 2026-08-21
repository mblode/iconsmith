---
"iconsmith": patch
---

OpenRouter is a second generate arm.

`OPENROUTER_API_KEY` plus `--model thinkingmachines/inkling` (or
`openrouter/…`) runs the same tool-calling loop as the gateway. The
model still calls canvas primitives; it never emits a coordinate.
`thinkingmachines/inkling:free` is accepted but OpenRouter allowlists
that slug to listed apps and 403s this CLI; the default is the billed
slug. A missing OpenRouter key fails with one line naming
`OPENROUTER_API_KEY`.
