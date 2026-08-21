---
"iconsmith": minor
---

Give an icon one honest status, measure a keyline before declaring one, and stop
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
