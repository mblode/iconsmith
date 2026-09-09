# Local setup

Follow [Install](../README.md#install), then open the repository in Codex or
Claude Code with your own account.

## Create an icon

Send this prompt:

> Read examples/starter/AGENT.md and execute its drawing task.

Your agent uses the bundled references, writes the icon program, runs the checks,
and inspects the rendered icon. Either agent works. Your session controls the
model and permissions and uses your account's allowance.

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
| `review.md` | The agent's visual review and remaining issues. |

Inspect the SVG and native-size proof. Ask the agent to fix anything that looks
wrong and rerun the checks. Structural checks and AI reviews do not establish
drawing quality.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node or dependency error | Use Node.js 24.11 or newer and run `npm ci`. |
| Missing build | Run `npm run build:local`. |
| Output already exists | Ask the agent to use a new directory. |
| Missing references | Use `examples/starter/revision.json`. The starter needs no private dataset or sibling repository. |
| Agent cannot inspect images | Open the proof yourself. Visual review remains incomplete until someone inspects it. |
| `generate:local` asks for a route | Ask the agent to follow `examples/starter/AGENT.md`. The unattended research runner needs separate configuration. |
