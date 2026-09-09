# Local setup

Follow [Install](../README.md#install), then open the repository in Codex or
Claude Code with your own account.

## Create an icon

Send this prompt:

> Read examples/starter/AGENT.md and execute its drawing task.

Your agent runs parallel authors with the bundled references, then independent
reviewers inspect anonymous candidates and request repairs. Your session needs
subagent and image-viewing support and uses your account's allowance.

For another icon, name it in the prompt:

> Read examples/starter/AGENT.md and create a bookmark-check icon.

## Review the result

The agent saves its work in a new `starter-draft` directory, or chooses another
name if that directory exists.

| File | Contains |
| --- | --- |
| `outlined.svg` | The exported icon. |
| `outlined.icon` | The editable source program. |
| `outlined.proof.png` | Enlarged contours and pixel previews. |
| `outlined.native.png` | The icon at its intended size. |
| `checks.json` | Compiler and structural findings. |
| `reviews/` | Independent visual reviews tied to exact candidates. |
| `selected/` | Selected files, created only when all development gates pass. |
| `review.md` | The task checklist, selection, repairs and remaining issues. |

Each candidate lives in its own directory. The agent selects only candidates
that match the request, replay exactly and pass both independent visual reviews.
Otherwise it reports the unresolved defects with the drafts. A local review score
does not establish a pipeline-wide 10/10 result.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node or dependency error | Use Node.js 24.11 or newer and run `npm ci`. |
| Missing build | Run `npm run build:local`. |
| Output already exists | Ask the agent to use a new directory. |
| Missing references | Use `examples/starter/revision.json`. The bundled blode-icons library needs no private dataset or sibling repository. |
| Agent cannot inspect images or run independent reviewers | Use an agent session with those capabilities. The result remains an unreviewed draft. |
| `generate:local` asks for a route | Ask the agent to follow `examples/starter/AGENT.md`. The unattended research runner needs separate configuration. |
