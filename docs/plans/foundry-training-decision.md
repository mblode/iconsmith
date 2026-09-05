# When to train an icon model

5 September 2026. The user authorized training if needed, within the existing $50 round ceiling. No training job has been launched. Current work remains a bounded generator experiment, not fine-tuning.

## Decision

Fine-tuning is an available technique, not yet a demonstrated solution to this failure. The rejected specimens reveal missing construction capability and an unreliable critic. Training on those drawings or optimizing against their 10/10 scores would reinforce the failure.

First establish an achievable high-quality output representation: style-owned constructions and replayable programs that preserve the relevant contours, counters and paint relationships. Test whether a strong base model can use them with a few clear demonstrations. A trained model would receive that same interface.

## What would be trained

- **Generator:** reference family and concept → construction choices, bounded tool calls and optical corrections. Targets must compile, replay and satisfy the actual native-size quality standard. A retrieved whole reference icon is reconstruction, not successful invention.
- **Critic, only if necessary:** paired candidates and family context → preference plus localized defect evidence. The current gross-weight experiment is useful diagnostic data, but does not qualify a general craft critic. Do not use the current judge as an RL reward for production quality.

Start with a small curated demonstration set rather than the entire mixed Blode repository. Each example needs source provenance, pinned style/master, concept family, program, rendered result and its evaluation evidence. Whole concept families, alternate names, finishes, sizes and near-duplicate geometry must stay on one side of a train/evaluation split. Use unseen concepts to distinguish learned design rules from memorized icon retrieval.

A training run is justified only when the representation supports the desired drawing, the dataset contains reliable examples, the base-model comparison remains inadequate, and the run has a priced ceiling that fits the remaining authorized budget. Evaluate the trained model against the unchanged base-model baseline. Keep it only if held-out native-size quality improves without increased replay failures or copying.

## Current provider research

OpenAI's current supervised fine-tuning guide says its fine-tuning platform is winding down and closed to new users, with existing users able to create jobs for the coming months. Do not design a new dependency around assumed access. The same guide recommends establishing evaluation first and starting with about 50 well-crafted demonstrations. These are provider recommendations, not evidence that 50 examples will produce professional icons. [Official guide](https://developers.openai.com/api/docs/guides/supervised-fine-tuning)

A provider-neutral dataset and a small model adaptation are the plausible next training experiment. Training a foundation model from scratch is not the scope of this $50 experiment. No model/vendor, training price or claimed accuracy has been invented in advance of a usable dataset and current account access.

## Component experiment

`folder-lock-components-02` compares a different input condition with the rejected primitive-only attempts:

- Actual 24/2 Blode reference pairs, with each image labelled by name/paint.
- Twelve explicitly admitted curved components from folder and lock references.
- A brief grounded in the source study's external-badge composition and counter-space findings.
- High reasoning effort with a bounded 16,384-token per-call allowance, a 24-step maximum and a $4 pair reservation.
- The existing constrained tools, replay checks, complete attempt costs and pair gate.

This is an exploratory change of several inputs, so it cannot isolate which input causes any improvement. It tests whether giving the model real construction vocabulary is promising enough to justify a controlled follow-up. Reusing source components is explicit; the resulting composition must not be described as wholly novel source geometry or as a fine-tuned model's output.


The first component run cost $0.464283 and exposed a CLI forwarding defect: its recorded 16,384-token allowance was not forwarded, leaving the old 4,096-token limit. Both paints ended with `finishReason: length`. Its partial shield and incomplete filled body were rejected, but cannot establish the intended high-reasoning condition. The forwarding is fixed; the corrected attempt uses a separate $4 reservation. The original plan and outputs are retained alongside `execution-correction.json`, not overwritten.


## Completed component experiment and replay repair

The corrected generation cost $0.82881725. It produced a legible outlined folder-lock and a filled composition, but the filled program exposed a host serialization defect: a 0.45 part multiplier was emitted as absolute `size 0.45`. The DSL now has an explicit `scale` multiplier; legacy `size` remains an absolute dimension. Explicit part positions also bypass a redundant center conversion that introduced floating-point drift. Regression coverage checks both paints, fractional scales, rotation/reflection, legacy size and invalid combinations.

Both original AI SVGs replay byte-for-byte after host serialization repair. No artwork was manually edited or regenerated. Original failed programs and attempts remain intact; repaired derivatives record their lineage in `.staging/foundry-round-1/folder-lock-components-replay-02`. The first repair review cost $0.0305745 and exposed the position drift; the final review cost $0.029787.

The final pair is rejected. Outlined visual extent is 20×18 versus filled 20×17; a 0.88-unit inter-component gap also falls below the 1-unit warning threshold. The visual reviewer scored outlined SC 10/PQ 8 and filled SC 8.5/PQ 5.5, identifying the uneven cutout and overhanging folder corner. These scores remain exploratory because the critic is not qualified. Direct visual inspection agrees that the filled shield-derived opening does not fit the lock and the scaled keyhole is uneven.

Cumulative measured spend is $3.28230835 of the authorized $50, with no outstanding reservation. No training job or upload occurred. This experiment supports developing reusable contour construction and badge-specific clearance before training; it does not establish professional quality, unseen-family generalization, or a successful AI-generated library. These rejected compositions must not become positive training demonstrations.
