# iconsmith

## 0.1.1

### Patch Changes

- 22132df: Return structured CLI failures with stable codes and recovery hints, support piped SVG linting and rendering, expose a command schema, and align skill guidance with prepared requests and the bundled revision.
- 83ad037: Restore the public CLI on cached builds, remove unused internal helpers, consolidate evidence serialization, and separate checker reports from CLI output handling.
- 0209f26: Document the published skill installation, reference preparation, reviewed icon workflow and local CLI commands.
- 96dcb6a: Preserve existing output when drawing validation fails, including with --force. Refuse concurrent file creation when exporting without --force.

## 0.1.0

### Minor Changes

- 6ebe980: Sparse mixture of experts for generation, and a two-stage A/B that updates the routing table.

  `iconsmith new` defaults to that gate: cheap host arms (compile, mark, analog) before the gateway or OpenRouter agent. `mixture.inventory.json` is a names-only pack table so a consensus gap (`database`) is inventory, not net-new, on a machine with no corpus. Analysis-only packs contribute concept _names_ and consensus counts — never SVG. `iconsmith improve` screens then decides one expert against another on one concept class; `--apply` rewrites `mixture.default.json` only on keep. `npx tsx scripts/mixture-lab.ts` exercises the gate with no credits. The model still never emits a coordinate.

- c8ed982: Give an icon one honest status, measure a keyline before declaring one, and stop
  answering with a house glyph nobody asked for.

  A staged icon's status is now the union of every paint's findings and the record
  the arm wrote, so a recorded error cannot display as `clean` and the header count
  cannot disagree with the cards. A paint the page fails to draw is a `dsl` error on
  the card rather than one fewer thumbnail, and `thinking` derives `clean` from its
  own issues so the two cannot contradict each other.

  `compileArm`, `hub` and `replay` each declared `keyline square` without measuring
  first — a claimed keyline that is missed is an error, and `fit` preserves aspect,
  so it never made square anything that was not already. All three now measure
  through `tools/declare.ts` and declare only what the drawing occupies.

  `adaptProgram` re-paints a program's closed shapes instead of relabelling its
  `finish`: a stroked circle becomes a ring, a rect becomes a frame, and arcs become
  ribbons, so a filled twin is a real program rather than a `#` note. New `diamond`
  op draws a lozenge whose edges sit on 45° by construction.

  A declared `off-axis` diagonal warns rather than waiving the rule. The canvas
  refuses an undeclared diagonal, so suppression would have silenced the rule for
  everything the pipeline draws. Filled drawings are no longer measured for edge
  angles at all, which was reporting the outline expander rather than a design.

  `glyph` is a fourth `unkeyed` arm, asked for by name. `classifyReach` no longer
  matches a slug ahead of the caller's choice, and `analogConstructions` no longer
  returns a glyph in place of the family it was asked for.

- c976e18: Rename the package and its binary from `icon-forge` / `forge` to `iconsmith`.

  `forge` collides on `PATH` with foundry-rs, which is installed by every Ethereum
  developer, and this tool tells people to `npm install -g`. There is no alias: an
  alias would reintroduce exactly the collision the rename removes.

  The repo is now a turborepo. The CLI lives in `packages/iconsmith`, which is the
  only published workspace, so `npm install iconsmith` is unchanged in shape.

### Patch Changes

- 3b55c79: Run the generation-pipeline meta-loop inline.

  `npx tsx scripts/autoresearch.ts --rounds N` applies one in-process change
  per round (playbook and/or OpenRouter from `OPENROUTER_API_KEY` /
  `/tmp/openrouter.env`), measures, and keeps or `git reset`s.
  `autoresearch.md` stays the standing file the loop cannot write. The
  editable surface is pipeline / tools / commands / tests / SKILL. Frozen
  gates and bench calibrations stay put. Cursor Cloud Agents are not this
  loop — no spawn brief, nothing to paste into an external agent
  runner. Overnight is `--rounds 50`.

- 7dcd412: Compile each paint of a house icon as itself, and expand an open part into
  filled bars instead of refusing it.

  Two house files of one slug are two reconstructions. Deriving filled from the
  outlined program is the fallback for a net-new icon; when both files exist,
  `compilePaint` runs the filled file as `finish filled` so a solid plus is not
  restroked as four empty segments.

  An open vocabulary mark under fill is the same stroke expanded to a bar,
  segment by segment — the bargain a two-point `line` already made. A filled
  twin is never a blank canvas.

- 112e75c: Analog draws house `home` as a pentagon in both paints.

  A recipe token fires the family — no `ANALOG_KINS` row — so `home` is
  the peaked silhouette (outlined outer stroke, filled body plus seated
  roof), not a frame-and-dot. `house` and `tree-house` stay unknown.
  `star` and host glyphs stay unvolunteered.

- 5335678: Analog draws house zap, shield, and heart from compile, and raises home eaves.

  Recipe tokens fire the families — no new `ANALOG_KINS` rows — so zap is the
  closed bolt, shield the heater, heart the closed lobes (filled evenodd, not
  three circles), and home the high-eave pentagon. `star`, `compass`, `quokka`,
  and `xyzzy` stay unknown.

- 48640f6: Analog traces remaining house twins on their own vertices.

  Play, home, and shield sample the house cubics. Airdrop keeps its inner
  chord and under-beam pockets. Sun ticks sit on the r9–r10 rays. Airplane
  fill uses the outlined vertices. Arrow filled is the house fat shaft —
  house paints already diverge in extent, so pairing warns instead of
  erroring.

- 3955f49: Draw pack-inventory analog families in the Central / blode house voice.

  Inbox is an on-axis tray on wide, QR is four tiles, briefcase a full-width
  clasp, wifi the house wide fan, umbrella a three-mark canopy. Cursor and
  Lucide stay descriptive in `SKILL.md`; the corpus keeps the numbers.
  `star`, `compass`, `quokka`, and `xyzzy` stay unknown.

- 82f2b3c: OpenRouter is a second generate arm.

  `OPENROUTER_API_KEY` plus `--model thinkingmachines/inkling` (or
  `openrouter/…`) runs the same tool-calling loop as the gateway. The
  model still calls canvas primitives; it never emits a coordinate.
  `thinkingmachines/inkling:free` is accepted but OpenRouter allowlists
  that slug to listed apps and 403s this CLI; the default is the billed
  slug. A missing OpenRouter key fails with one line naming
  `OPENROUTER_API_KEY`.

- 56031c6: Apply twin-pair findings and hole targeting on the product path.

  `twinPairIssues` now runs from analog, mark, glyph, the missing-house
  filled adapt, and `iconsmith view` (host/adapt twins, not two house
  files). `hole` fails a filled disc whose knockout attached to a later
  mark. `clean: false` without a named error is a recorded error, so the
  viewer cannot say `0 error(s)` about a drawing the arm called dirty.

- 7508146: Keyed filled twins compile the filled house file. `iconsmith new --finish filled`,
  `reach`, and `iconsmith view` use `compilePaint` when that file exists;
  `adaptProgram` is only the fallback for a missing filled house or a net-new name.

  The viewer loads sibling `parts.json` extras so a compile program (`part heart-0`)
  replays instead of showing a dsl error. Analog picks a concept family
  (tower / peak / volcano / tube / plant / horn / mushroom / hourglass / sailboat)
  from a name token so a cactus is not a hub. Ordinary names (`bananas`, `kiwi`,
  `stapler`) have host constructions; `ANALOG_ALIASES` maps synonyms offline.
  A name with no token, alias, kin, or named part is `unknown`. A filled house
  path with holes stays one evenodd compound so cutouts are not painted as ink.

- 1e23b9a: Measure lint `gap` edge-to-edge, and name the paint on a generation run.

  Vertex-to-vertex over flatten is endpoints-only for a straight: a slash
  through a ring reported a 0.485 overhang (`ban`) and staggered parallels
  under `minGap` were silent. `polylineDistance` is the quantity a generator
  is told to fix. `twinPairIssues` fails an empty tile, a restamped finish,
  or a filled twin that does not occupy the outlined extent. The system
  prompt and the per-icon brief say which paint this canvas is, so a filled
  run is not told to draw outlines on a tool set that has deleted `line`.

- 24a5dcf: Analog draws the rest of the 20-set toward house compile, and generate
  shares that steer.

  Pause, play, chevron, arrow, bookmark, share, airdrop, and airplane become
  families (recipe tokens, no `ANALOG_KINS` rows). `listParts` and the per-icon
  brief use `steerBrief` so a house recipe or a star holdout reaches the
  model. `star`, `compass`, `quokka`, and `xyzzy` stay unknown.
