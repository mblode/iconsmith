# Original starter family

These four icons were authored for this repository using the constrained DSL.
They are illustrative MIT-licensed examples, not copied from Blode, Lucide or the
private corpus. Keep the included license when redistributing this family.

`revision.json` embeds every reference SVG, a 24px master, an original short
policy, and the current compiler identity. No external library, admitted part,
private path or download is needed. `references/*.icon` are the editable sources;
`references/*.svg` are their exact compiled outputs. The regression test rejects
stale compiler identities or source/SVG divergence.

From the repository root, after installation and build:

```bash
npm run generate:local -- square-check ./starter-run --revision examples/starter/revision.json --master 24 --meanings examples/starter/meanings.json --finish outlined --model YOUR_CODEX_MODEL
```

Replace `YOUR_CODEX_MODEL` with a model available to your Codex account.
The output directory must not exist. Generation requires the native agent logins
and runtime described in [local setup](../../docs/local-setup.md) and consumes
subscription usage. The bundled inputs do not supply credentials or remove
independent review requirements. See that guide for selecting installed agents.

The four alternatives in `meanings.json` are an illustrative square-check label
set. Freeze suitable alternatives for a different requested concept before a run.
This family remains `unvalidated`: a runnable example and successful structural
checks are not professional craft approval or critic qualification.
