---
"iconsmith": patch
---

OpenRouter is a second generate arm.

`OPENROUTER_API_KEY` plus `--model thinkingmachines/inkling:free` (or
`openrouter/…`) runs the same tool-calling loop as the gateway. The model
still calls canvas primitives; it never emits a coordinate. A missing
OpenRouter key fails with one line naming `OPENROUTER_API_KEY`.
