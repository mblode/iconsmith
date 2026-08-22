# Iconsmith Studio plan

Status: vertical slice implemented; persistence and production publishing remain.

## Product brief

- **User:** an icon designer or product team extending a coherent icon family.
- **Job:** explore many candidates quickly, compare them in context, direct precise refinements, and deliberately promote one result into the canonical set.
- **Current state:** generation is powerful but linear. Results are easy to make and hard to organise, compare, annotate, or revisit.
- **Desired state:** a chat-led exploration studio with a durable version graph underneath it, a set-wide consistency view, and an explicit approval boundary before publishing.
- **Success:** a user can move from a concept to an approved outline/filled pair without losing variants, comments, references, or provenance.
- **Non-goals:** a general-purpose vector editor, a free-form node canvas as the default interface, or automatic publishing after generation.

The primary object is an **exploration**. Generate, refine, compare, comment, and attach references affect only the current exploration. **Publish** is a separate, named action whose scope and consequences must be shown before it changes the canonical library.

## Product rules

These stable IDs should be used in review notes and implementation plans.

- `rule/preserve-mental-model`: the visible workflow is chat → variations → compare → approve; the graph is supporting infrastructure.
- `rule/smallest-intervention`: add tools at the point of need instead of turning the studio into a general canvas application.
- `rule/inline-before-modal`: use panels, popovers, and inline confirmation before modal flows.
- `rule/name-object-scope-consequence`: destructive and publishing actions name the exact icon, versions, destination, and effect.
- `rule/cover-reachable-states`: every async surface covers empty, loading, partial, error, retry, and completed states.
- `rule/preserve-user-input`: prompts, attachments, annotations, selections, and failed jobs survive retry and navigation.
- `rule/error-states-recovery`: errors state what happened, what was preserved, and the next safe action.
- `rule/keyboard-complete-flow`: generation, selection, comparison, commenting, approval, and publishing are operable without a pointer.
- `rule/accessible-name-required`: icon-only controls have accessible names and visible focus.
- `rule/one-primary-action`: each pane has one visually dominant next action.
- `rule/structure-before-containers`: grouping comes from layout and hierarchy before extra cards and borders.
- `rule/version-bound-annotation` *(proposed coverage rule)*: every comment stores the immutable version and normalised region it describes; later variants never silently inherit it.
- `rule/observable-agent-pipeline`: every generation includes an AI draw or visual-review agent, and the chat shows rendered outputs, recorded tool events, audit findings, and the exact program without presenting private chain-of-thought as product data.

## Research decisions

### Interaction model

Use a chat-led studio with three modes of attention:

1. **Focus** for the selected outline/filled pair, actual-size checks, and precise comments.
2. **Explorations** for dozens of candidates organised into generation batches and lineages.
3. **Overviews** for set-wide consistency audits before approval.

This follows the working pattern in [The Making of Cursor's Icons](https://www.minoradventures.co/blog/the-making-of-cursors-icons): exploration is intentionally prolific, overviews reveal recurring inconsistencies, and the canonical library stays separate. Figma Weave's useful lesson is branching and comparison, while its underlying graph should remain progressive disclosure rather than the default UI ([Figma AI design tools](https://www.figma.com/solutions/figma-ai-design-tool/), [Weave tools](https://help.figma.com/hc/en-us/articles/40779260614935-Use-Weave-tools-in-Figma)).

Comments follow Agentation's exact-target model: coordinates are normalised, threads belong to immutable versions, and status can later become explicit ([features](https://www.agentation.com/features), [schema](https://www.agentation.com/schema)). Conversational edits should always fork instead of overwrite because region-based image edits can affect more than the selected area ([ChatGPT Images help](https://help.openai.com/en/articles/11084440-im)).

### Reference libraries

Start with a small allowlist: first-party Blode plus Lucide, Tabler, and Phosphor. These sets have permissive licences and broad semantic coverage. Search results attach **meaning only**—library, name, source, and licence. External geometry is never inserted into the generation prompt or passed to the model. This preserves Iconsmith's analysis-only geometry boundary.

The current vertical slice queries Iconify at runtime for the three external sets. Before production, replace that dependency with a pinned, committed catalogue and keep Iconify only as the normalisation/import tool. Sources: [Iconify search API](https://iconify.design/docs/api/search.html), [Lucide licence](https://github.com/lucide-icons/lucide/blob/main/LICENSE), [Tabler icon package](https://github.com/tabler/tabler-icons/blob/main/packages/icons/README.md), and [Phosphor core](https://github.com/phosphor-icons/core).

### Eve framework

**Decision: defer the framework, not agents.** AI agents are a required stage in every Studio generation: net-new concepts use the tool-calling drawer, while host constructions are selected or checked by a visual-review agent. Eve is attractive for resumable streamed runs, tool calls, human approval, and durable chat sessions, but it does not replace Iconsmith's required project, asset, annotation, version-DAG, indexing, or job-idempotency model. Adding it now would introduce a second Next.js runtime boundary before those needs are proven.

Reconsider Eve when at least two of these are real requirements: refresh-resumable jobs, user cancellation, long-running multi-tool orchestration, or server-side approval gates. Keep the boundary clean if adopted: the app owns `StudioService`, domain data, and the generation pipeline; Eve owns session orchestration and calls typed Studio tools. `packages/iconsmith` must never import Eve. Validate base-path routing, auth, resume/cancel, approval, and idempotency in a disposable spike first. Sources: [Eve repository](https://github.com/vercel/eve), [tools](https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx), [sessions and streaming](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md), and [Next.js guide](https://github.com/vercel/eve/blob/main/docs/guides/frontend/nextjs.mdx).

## Delivery phases

### Phase 0 — research and direction

- [x] Audit the existing Iconsmith generation and composition pipeline.
- [x] Study Cursor Icons, Weave, Higgsfield, ChatGPT Images, and Agentation patterns.
- [x] Evaluate icon-library coverage, licences, and the geometry boundary.
- [x] Evaluate Eve against the actual domain and orchestration gaps.
- [x] Choose a chat-led exploration model with progressive-disclosure graph lineage.

### Phase 1 — useful vertical slice

- [x] Build the responsive `/studio` three-pane workspace.
- [x] Reuse `mixtureArm`, `compose`, and the existing outline/filled pipeline.
- [x] Add image, SVG, text, JSON, Markdown, and library-name attachments.
- [x] Add semantic library search for Lucide, Tabler, and Phosphor.
- [x] Generate paired variants in batches with parent lineage.
- [x] Add Focus and Explorations views.
- [x] Add actual-size previews and safe SVG export.
- [x] Add version-bound point comments and comment-led refinement.
- [x] Run an AI drawer or visual-review agent for every generated paint.
- [x] Show both visual renders, the complete recorded pipeline trace, audit findings, lint results, and Iconsmith program in the chat turn.
- [x] Cover initial, thinking, approval, partial, error, and completed UI states.
- [ ] Persist projects and reload the current exploration. Current state is client-only.

### Phase 2 — durable projects and jobs

- [ ] Model projects, assets, batches, variants, parents, selections, and annotations in the app database.
- [ ] Store generated SVG and source attachments in durable object storage.
- [ ] Move generation to idempotent background jobs with per-variant progress.
- [ ] Add retry, cancel, stale-job recovery, and refresh-resume behaviour.
- [ ] Preserve the submitted prompt and attachments when any step fails.
- [ ] Replace runtime Iconify search with a pinned, committed semantic catalogue.
- [ ] Add project list, rename, duplicate, archive, and restore flows.

### Phase 3 — comparison and consistency

- [ ] Compare two to four variants side by side with synchronised zoom.
- [ ] Overlay variants and show differences without modifying source geometry.
- [ ] Add 12, 16, 20, and 24 px light/dark context checks.
- [ ] Build the Cursor-style Overview: optical shapes, gaps, modifiers, hinting, solids, dots, diagonals, and repeated objects.
- [ ] Let users define a reference family and audit candidates against its tokens.
- [ ] Save named selections and rationale without promoting them to canonical status.

### Phase 4 — approval and publishing

- [ ] Add explicit Approve and Publish steps; generation never publishes.
- [ ] Show icon name, outline/filled pair, target package, conflicts, and validation results before publishing.
- [ ] Validate SVG safety, 24 px viewBox, geometry constraints, metadata, and naming.
- [ ] Generate a reviewable diff and an auditable publish record.
- [ ] Support revert/replace without deleting exploration history.
- [ ] Require an authorised role for canonical publishing.

### Phase 5 — collaboration and advanced workflows

- [ ] Add comment threads, assignees, open/resolved status, and presence.
- [ ] Add reusable exploration templates and controlled parameter sweeps.
- [ ] Add a graph inspector for expert users without replacing the default workflow.
- [ ] Add team libraries, project permissions, and shareable read-only reviews.
- [ ] Re-evaluate Eve against measured job duration and orchestration complexity.

## Reachable-state checklist

| Surface | Required states |
| --- | --- |
| Composer | empty, ready, uploading, validation error, submitting, preserved-after-error |
| Generation | queued, thinking, approval required, running, partial pair, failed, retrying, complete, cancelled |
| Focus canvas | no selection, selected, unsafe SVG, comment mode, exporting |
| Explorations | empty, populated, filtered-empty, selection preserved |
| Library | idle, searching, results, no results, upstream unavailable, retry |
| Comments | empty, drafting, saved, editing, deleted, unresolved, resolved |
| Publish | validation, conflict, confirmation, in progress, success, failure with unchanged canonical set |

## Open decisions before Phase 2

- Choose the existing app database and object-storage primitives after checking nearby monorepo patterns.
- Decide whether public project links are in scope; do not infer collaboration permissions from project access.
- Define retention and deletion policy for uploaded references and generated assets.
- Define the canonical publish target and required reviewer role.
