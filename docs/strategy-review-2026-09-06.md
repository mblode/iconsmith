# Icon generation strategy review — 6 September 2026

The best supported direction is a vector-first production pipeline with optional image-assisted composition. Keep a capable multimodal LLM in a render-and-repair loop, let the host construct and measure geometry, and use generated images when they help explore an unfamiliar form. Neither a raster model nor a stricter DSL alone establishes a coherent, readable icon family. Do not fine-tune yet.

This is a development screen and an implemented pipeline improvement, **not a universal model ranking or a demonstrated 10/10**. The three subjects were cloud upload, jellyfish, and satellite dish, with two paints each. All initial arms received the same semantic requirements and no target drawings, reference family, or parts. The primitive-only condition deliberately isolates representation; it is not a complete test of the production parts-assisted workflow. The hybrid follow-up added a sketch, full instructions, and rendered feedback, so those effects cannot be separated.

[Inspect the native-size comparison](../.staging/strategy-screen-2026-09-06/comparison.png). Each cell shows a larger preview, enlarged 16px pixels, and actual 16px/24px samples. Image-sheet icons were cropped and fitted proportionally to a 20-unit ink extent on a 24-unit canvas. This normalization changes layout; it is recorded in the extraction receipt, not presented as untouched model output. Recraft row crops explicitly exclude overlap from its extra row. The unrestricted SVG arm was rendered but was **not** evaluated for production conformance. Partial DSL renders illustrate failed submissions and are not accepted artifacts.

## What was actually tested

| Model / route | Observed output | Implication |
| --- | --- | --- |
| GPT-6 Astra, native Codex, high | Six constrained programs; five parse, one also clears geometry checks in the first pass. Six unrestricted SVG controls render. | Working native author. The unrestricted jellyfish has more natural tentacles than its first DSL attempt; this is a visual observation, not a blind preference result. |
| Claude Fable 5.1, gateway, high, streaming | Six programs; all parse after the declaration-order fix, two clear geometry checks. About 378 seconds and $1.46912 for the successful batch. | Viable candidate, but not an overall winner from three subjects. Native subscription access returned 404. Earlier calls truncated or timed out and remain in the record. |
| Gemini 3.8 Flash, gateway, high | Six programs after increasing the output allowance; five parse after the fix, none clear all geometry checks. About 190 seconds and $0.121599. | Lower measured API cost in this screen; errors and poor constructions still require repair. The original 10k-token call truncated. |
| Grok 4.6, gateway | No delivered answer within the tested bounds, including an eight-minute streaming call. | Unranked for quality. These are delivery/transport failures, not proof it cannot draw. Charges for interrupted calls are unknown. |
| ChatGPT built-in image generation | Six raster icons with smooth curves; exact backend model identity was not exposed by the tool. | Useful composition candidates. Some detail becomes crowded at 16px. No editable SVG was supplied. Do not label this a verified GPT Image 2 API trial. |
| Nano Banana Pro (`google/gemini-3-pro-image`) | Raster output, about 42 seconds, $0.148304; nine icons rather than six, with visible cell borders. | Useful forms, but output assembly and small-size adaptation are additional work. The square-sheet/square-cell request left spare vertical space; it is not a clean layout benchmark. |
| Seedream 5.0 Pro, gateway | Six raster icons, about 65 seconds, $0.035. | Strong inexpensive sketch candidate in this small sample, still requiring vector construction and optical adaptation. |
| Recraft 4.1 utility with vector style | Real SVG bytes despite `image/png` metadata, about 15 seconds, $0.08. Nine icons rather than six. | A credible direct-vector experimental arm. Actual bytes must be inspected; its contours are not admitted production geometry or measured house style. |

Higgsfield is a provider surface, not one model. Its Nano Banana request failed, Seedream was rate-limited, and Recraft required a higher plan. Its balance remained eight credits; no purchase or trial activation occurred. Gateway alternatives were recorded separately. Seedance was not tested; this task needs static icons, and the tested ByteDance still-image route was Seedream.

## First-principles conclusions

**Both SVG paths and a DSL are text to an LLM.** The useful distinction is the amount of geometry it must invent and the feedback it receives. A path asks it to predict control points, continuity, topology and proportions together. A semantic drawing program can delegate those calculations to code. However, a vocabulary that cannot conveniently describe a form can steer the model toward a poor approximation.

**Constraints remove particular mistakes, not all style drift.** A shared stroke width and grid do not guarantee a convincing metaphor, appropriate detail, optical balance, or family resemblance. The primitive-only first-pass results demonstrate that distinction. The later constrained jellyfish uses flowing circular arcs successfully, so its earlier rigid construction did not prove the form was impossible in the DSL.

**Do not discard useful visual evidence prematurely.** The older raster proposal arm reduces its selected image to coarse composition words before drawing. That can preserve placement while losing contour intent. The new optional sketch input preserves the image for the author, with no permission to trace paths into production.

**Measure what code can measure.** Parsing, exact replay, paint identity, bounds, stroke facts and native raster samples should come from the host. Independent visual review should address recognition and perceptual questions, with uncertainty retained. In the hybrid run, the reviewer correctly withheld a style verdict without family references, but also described a five-unit pitch where the final program uses six. It is not a qualified numerical or aesthetic authority.

**A useful drawing system needs both search and a stopping rule.** Render the actual candidate, inspect it, repair a named defect, retain the best valid version, and stop if improvement cannot be demonstrated. A missing capability should produce an explicit representation finding. More models voting on the same weak metric does not establish correctness.

The recommended stage assignment is:

1. Specify the concept, confusions, family references, paint and native sizes.
2. Let Astra plan the metaphor and select admitted source parts. Keep this route as the local default; model alternatives must retain exact identity and receipts.
3. Optionally generate a composition image for difficult form exploration. Generate individual assets for production rather than relying on an ambiguous multi-icon sheet.
4. Construct editable geometry through the constrained compiler. Admit additional curve vocabulary only after a concrete representation gap is demonstrated.
5. Render native proofs, measure construction, and use bounded visual repair. Keep 16px design and a 24px downsample distinct.
6. Evaluate recognition and family appearance independently. General autonomous craft approval remains unavailable until the evaluator passes appropriate controls and the full pipeline succeeds on held-out concepts.

## Implemented and verified

- Local generation now defaults to `gpt-6-astra` at high effort and prefers the installed ChatGPT app CLI. Explicit model/binary selection remains available.
- `--sketch` plus `--sketch-source` validates and snapshots an actual single PNG, attaches it as an unapproved composition hypothesis, protects its bytes and provenance, and excludes it from style references and independent review.
- Corrected contradictory filled-line guidance in the skill and its packaged mirror. Filled two-point lines and arcs already expand correctly; the model should not replace them with differently rounded rectangles.
- Compiler15 treats `finish` as a global declaration, regardless of position. Unknown and conflicting declarations still fail. The original compiler already applied the global value before drawing; removing its redundant late-position refusal recovers Fable from 0/6 to 6/6 parses and Gemini from 0/6 to 5/6. **All 18 re-evaluated SVGs remain byte-identical.** Geometry findings are retained; parse success is not craft approval.
- The native sketch route delivered an eight-primitive outlined jellyfish with exact replay, zero geometry findings, unchanged protected inputs, and confirmed final-image exposure. Independent review: meaning and optics pass, style uncertain without family references. This is a 24px master with a 16px downsample, one paint only. Its geometry also replays byte-identically under a new compiler15 revision.
- Fixed two misplaced numeric fields in local Codex configuration, preserving their values and a private backup. Normal login and the real runtime/context preflights now pass without the temporary wrapper. Authentication errors also retain the actual CLI diagnostic.

**Validation:** 1,586 tests across 122 files, zero skipped; typecheck, build, lint and layering checks pass. Compiler14 receipts remain historical; create a current revision explicitly rather than silently migrating it. No public UI, deployment or fine-tuning job was added. Changes remain uncommitted.

## Costs and remaining uncertainty

New confirmed gateway charges total **$2.40315825**, taking the existing $50 round to **$13.06220785 confirmed**. Four interrupted calls have unknown charges; **$11.37126575 remains reserved conservatively**, not counted as free or confirmed spend. All local provider processes are terminal. Native subscription and built-in image-tool usage are separate from gateway billing. Higgsfield stayed at eight credits.

Training from scratch is not justified. Fine-tuning becomes worth evaluating only after there are accepted, rights-cleared examples in the chosen representation, a useful held-out benchmark, and evidence that residual failures come from model behavior rather than missing geometry, misleading instructions, transport failures or an unreliable judge. No current result establishes that fine-tuning is needed.

The next decisive experiment is a balanced parts-assisted, reference-guided comparison of direct generation and sketch-assisted generation with identical render/repair budgets. Use multiple concepts and repetitions, blind native-size preference judgments, and independently controlled recognition tests. The current screen informs that experiment; it does not replace it.

## Evidence

- [Compact durable receipt and exact model programs](log/strategy-screen-2026-09-06.json)
- [Append-only decisions, failures and reservations](foundry-log.md)
- [Local workflow and sketch command](local-foundry.md)
- [Provider catalog snapshot](../.staging/strategy-screen-2026-09-06/catalog.json)
- Primary provider references: [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2), [Anthropic Fable 5.1](https://www.anthropic.com/claude-fable-and-mythos-5-1), [Google model endpoints](https://ai.google.dev/gemini-api/docs/models), [Grok API](https://x.ai/api), [Recraft vector support through AI Gateway](https://vercel.com/changelog/recraft-image-models-now-on-ai-gateway). Provider descriptions establish availability and interfaces, not icon-quality rankings.
