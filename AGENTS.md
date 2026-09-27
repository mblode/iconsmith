# iconsmith

Public agent skill and Claude Code plugin for the hosted Iconsmith model (`iconsmith-1`, https://blode.co/iconsmith). There is no code here: the skill is `skills/iconsmith/SKILL.md`, the plugin manifests are `.claude-plugin/`. The model, compiler, web app, and API live in the private `mblode/iconsmith-internal` repo.

## Commands

No package manager, build, or test suite. These are the checks:

```bash
claude plugin validate .                            # marketplace.json
claude plugin validate .claude-plugin/plugin.json   # plugin manifest
bash ../agent-skills/skills/agent-skills-creator/scripts/validate.sh skills/iconsmith   # skill format + house style; needs a sibling agent-skills checkout
npx -y skills add . --list                          # the skill is discoverable the way the README installs it
```

## Gotchas

- `skills/iconsmith/SKILL.md` is a public URL. The iconsmith-internal README, its docs, and the npm `iconsmith` README link to it and to `npx skills add mblode/iconsmith --skill iconsmith` / `iconsmith@iconsmith`. Renaming the folder, the skill, or the plugin breaks those installs; change them together with iconsmith-internal.
- The API facts in SKILL.md and README.md (body fields, limits, error shape, auth prefixes, MCP tool names) mirror the live service. Check a change against https://blode.co/iconsmith/openapi.json, not memory; if the service changed, the fix starts in iconsmith-internal.
- The npm `iconsmith` package ships a different skill for the local compiler. This skill only calls the hosted model; keep it from drifting into compiler or `.icon` DSL instructions.
- Examples use the sandbox key `ism_test_` plus 32 zeros (no provider call, `credits: 0`). Never put an `ism_live_` key in a file.
- SKILL.md must stay free of em dashes and under 500 lines; the validator's `no-em-dashes` and `body-under-500-lines` checks fail otherwise.
- Bump `version` in `.claude-plugin/plugin.json` when the skill changes, so installed plugins update.

## Verification

Prove a change by running the four commands above (all pass on `main` as of 27 Sep 2026) and, when API text changed, a sandbox draw against the live model:

```bash
curl -sS https://blode.co/iconsmith/api/v1/icons -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ism_test_00000000000000000000000000000000' \
  -d '{"model":"iconsmith-1","concept":"bookmark-check","n":1}'   # expect data[].svg and "credits":0
```

There is no `npm run doctor`, `npm run verify`, feature map, CI, or git hook. Gap: nothing runs the validators on a PR, and nothing checks that SKILL.md still matches the served OpenAPI, so drift is caught only by hand.
