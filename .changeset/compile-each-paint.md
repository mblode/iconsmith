---
"iconsmith": patch
---

Compile each paint of a house icon as itself, and expand an open part into
filled bars instead of refusing it.

Two house files of one slug are two reconstructions. Deriving filled from the
outlined program is the fallback for a net-new icon; when both files exist,
`compilePaint` runs the filled file as `finish filled` so a solid plus is not
restroked as four empty segments.

An open vocabulary mark under fill is the same stroke expanded to a bar,
segment by segment — the bargain a two-point `line` already made. A filled
twin is never a blank canvas.
