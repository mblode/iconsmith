---
"iconsmith": minor
---

Rename the package and its binary from `icon-forge` / `forge` to `iconsmith`.

`forge` collides on `PATH` with foundry-rs, which is installed by every Ethereum
developer, and this tool tells people to `npm install -g`. There is no alias: an
alias would reintroduce exactly the collision the rename removes.

The repo is now a turborepo. The CLI lives in `packages/iconsmith`, which is the
only published workspace, so `npm install iconsmith` is unchanged in shape.
