---
"iconsmith": patch
---

Keyed filled twins compile the filled house file. `iconsmith new --finish filled`,
`reach`, and `iconsmith view` use `compilePaint` when that file exists;
`adaptProgram` is only the fallback for a missing filled house or a net-new name.

The viewer loads sibling `parts.json` extras so a compile program (`part heart-0`)
replays instead of showing a dsl error. Analog picks a concept family
(tower / peak / volcano / tube / plant / horn / mushroom / hourglass / sailboat)
from a name token so a cactus is not a hub. Ordinary names (`bananas`, `kiwi`,
`stapler`) have host constructions; `ANALOG_ALIASES` maps synonyms offline.
A name with no token, alias, kin, or named part is `unknown`. A filled house
path with holes stays one evenodd compound so cutouts are not painted as ink.
