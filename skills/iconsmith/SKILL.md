---
name: iconsmith
description: Draws SVG icons with the hosted Iconsmith model (iconsmith-1). Use when asked to create an icon with iconsmith, match the Blode icon family, or POST to the iconsmith API or MCP.
---

# Iconsmith

Iconsmith is a hosted AI model, id `iconsmith-1`, at https://blode.co/iconsmith. You call it over HTTP (or MCP). You do not draw the icon in this session, you do not run a local compiler to generate it, and you do not invent SVG path data to stand in for a draw.

## Install note

This file is the skill. The host already loaded it. Do not also run `npx iconsmith skill`.

## Draw

`POST https://blode.co/iconsmith/api/v1/icons`

```bash
curl https://blode.co/iconsmith/api/v1/icons \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ism_test_00000000000000000000000000000000' \
  -d '{"model":"iconsmith-1","concept":"bookmark-check","n":2}'
```

Body: `{ model?, prompt?, concept?, images?, cut?, n?, stream? }`. At least one of `prompt`, `concept`, or `images`.

- `model` must be `iconsmith-1` or omitted (the served id).
- `prompt` is free text, max 500 characters.
- `concept` is an explicit slug; otherwise it derives from the prompt.
- `images` is up to four `{ mime, base64 }` PNG, JPEG or WebP entries (base64 only, never a URL for the server to fetch).
- `cut` defaults to the house cut (24px, stroke 2, radius 3, outlined). Size 16, 20 or 24; finish outlined or filled.
- `n` is 1 or 2.
- `stream: true` answers `text/event-stream`.
- Unknown fields are refused with `param` naming them.

Response: `{ id, object: "icon.draw", created, model, revision, concept, prompt, images, cut, data, usage, credits?, took_ms }`. `data[]` holds `svg`, `program`, `status`, `findings`. Image bytes are never echoed. A result is `checked`, never approved.

Errors are JSON `{ status, code, message, request_id, param?, retry_after? }`.

## Auth

- `Authorization: Bearer ism_test_` plus 32 characters: sandbox draw, no provider call, `credits: 0`. Any well-formed test key works; none is issued.
- `ism_live_…`: spends a credit when credits are on.
- No key: free allowance.

Do not log live keys. Prefer `ICONSMITH_API_KEY` from the environment when the user has one.

## Models and docs

- `GET https://blode.co/iconsmith/api/v1/models`
- `GET https://blode.co/iconsmith/api/v1/models/iconsmith-1`
- OpenAPI: https://blode.co/iconsmith/openapi.json
- Docs: https://blode.co/iconsmith/docs
- Auth notes: https://blode.co/iconsmith/auth.md

## MCP

If the host speaks MCP, use https://blode.co/iconsmith/mcp with the same Bearer header.

- `draw_icon` → `POST /api/v1/icons` (`stream` off)
- `list_models` → `GET /api/v1/models`

Discovery: https://blode.co/iconsmith/.well-known/mcp.json

## What not to do

- Do not author `.icon` DSL locally as a substitute for a draw from `iconsmith-1`.
- Do not call third-party image models to fake an Iconsmith icon.
- Do not treat the npm `iconsmith` CLI as the generator. That CLI compiles and lints; it does not call this model.
- This skill does not create logos or a new icon family.

Show the person the SVG from `data[].svg`. Mention `status` and any `findings`.
