<div align="center">

# Iconsmith

**An AI model for icons.** It draws in a family’s hand and keeps to its grid.

[blode.co/iconsmith](https://blode.co/iconsmith) · model id `iconsmith-1`

</div>

This repository is the **public agent skill**. It tells a coding agent how to call the hosted model. The compiler, foundry and web zone live elsewhere.

## Install

Use one installation method.

If you’re in Claude Code:

```bash
claude plugin marketplace add mblode/iconsmith
claude plugin install iconsmith@iconsmith
```

If you’re in another agent:

```bash
npx skills add mblode/iconsmith --skill iconsmith
```

Read the skill at [skills/iconsmith/SKILL.md](./skills/iconsmith/SKILL.md) ([raw](https://raw.githubusercontent.com/mblode/iconsmith/main/skills/iconsmith/SKILL.md)). Then use the Iconsmith skill when drawing icons.

## Call the model

- Playground: https://blode.co/iconsmith
- Draw: `POST https://blode.co/iconsmith/api/v1/icons`
- Models: `GET https://blode.co/iconsmith/api/v1/models/iconsmith-1`
- OpenAPI: https://blode.co/iconsmith/openapi.json
- MCP: https://blode.co/iconsmith/mcp
- Docs: https://blode.co/iconsmith/docs

Auth is `Authorization: Bearer ism_test_…` (sandbox), `ism_live_…` (credits), or no key for the free allowance.

The npm package `iconsmith` is a local compiler (`prepare`, `check`, `draw`, `lint`). It does not call this model.

## License

MIT
