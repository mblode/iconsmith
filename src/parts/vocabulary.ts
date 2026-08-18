/**
 * The vocabulary: the marks the set draws often enough to have earned a word.
 *
 * The DSL's `part` op resolves by id or by name, but a cluster id is an
 * accident of extraction order — `p0031` means nothing to a model and changes
 * when the set does. A name is the whole point of the op: nothing can reason
 * about `p0031`; everything can reason about `cloud`.
 *
 * Each entry carries the canonical drawing of the cluster it names, so
 * `nameParts` matches by shape rather than by id. That is deliberate: the same
 * mechanism the clusterer uses to decide two subpaths are one part decides
 * which part a name belongs to, so the vocabulary survives a re-extraction, a
 * changed threshold, and a set that grew by a hundred icons.
 *
 * Names were read off a contact sheet of the top 50 parts of blode-icons
 * (1,863 stroked icons, 199 parts, these 50 covering 86% of the set), with each
 * part's `icons` list and its measured `turns`/`flips` as corroboration. A
 * mark the set draws at four turns gets an orientation-neutral name — `corner`,
 * not `bottom-left-corner` — because the name has to survive every turn a
 * placement can ask for.
 *
 * `sure: false` marks a name to review before relying on it. Two things put an
 * entry there: a proportion variant that is probably the same mark as its
 * neighbour (the `open-rect` family below), and a name that reads more
 * confidently than the evidence supports. A wrong name is worse than a missing
 * one, because a wrong one gets used.
 *
 * **The open-rect family.** Eight of these fifty are a rounded rectangle with
 * one side left open, at different proportions and node counts: `open-rect`,
 * `open-rect-narrow`, `open-rect-wide`, `open-rect-deep`, `arc-c`, `arch`,
 * `arch-small` and `arch-wide`. Most pairs of them sit under the clustering
 * threshold; the rest only stay apart because `distance` refuses the
 * comparison outright. They are one mark, and the qualifiers here are a
 * holding position until the clusterer merges them.
 */
import { parsePath } from "../geometry/path.js";
import type { Part } from "../types.js";
import { distance, fingerprint } from "./shape.js";

export interface NamedShape {
  /** Canonical drawing of the cluster this name was read off, normalised to
   *  the origin exactly as `extractParts` writes it. */
  d: string;
  /** What the mark is, and why the name is or is not trustworthy. */
  note: string;
  name: string;
  /** False when the name needs a human before anything depends on it. */
  sure: boolean;
}

/** Mean normalised point distance below which a part answers to a name. The
 *  clusterer's own default: a name should reach exactly the cluster its
 *  reference drawing would have joined, and no further. */
export const NAME_THRESHOLD = 0.06;

export const VOCABULARY: NamedShape[] = [
  {
    d: "M0 0L6 0",
    name: "stroke",
    note: "a straight segment; the set draws it horizontal and vertical in near-equal numbers",
    sure: true,
  },
  {
    d: "M7 3.5C7 5.5 5.5 7 3.5 7C1.5 7 0 5.5 0 3.5C0 1.5 1.5 0 3.5 0C5.5 0 7 1.5 7 3.5Z",
    name: "circle",
    note: "ring",
    sure: true,
  },
  {
    d: "M0 0L4 4",
    name: "diagonal",
    note: "a straight segment at 45 degrees, drawn both ways",
    sure: true,
  },
  {
    d: "M4 2.5L4 1.5C4 0.75 3.25 0 2.5 0L1.5 0C0.75 0 0 0.75 0 1.5L0 2.5C0 3.25 0.75 4 1.5 4L2.5 4C3.25 4 4 3.25 4 2.5Z",
    name: "square",
    note: "rounded square; corner radius from the tier system",
    sure: true,
  },
  {
    d: "M8 4L4 0L0 4",
    name: "chevron",
    note: "two segments meeting at a sharp point; the arrow head",
    sure: true,
  },
  {
    d: "M15 0L3 0C1.25 0 0 1.25 0 3L0 11C0 12.75 1.25 14 3 14L15 14C16.75 14 18 12.75 18 11L18 3C18 1.25 16.75 0 15 0Z",
    name: "rect",
    note: "rounded rectangle, near 4:3; the card and panel body",
    sure: true,
  },
  {
    d: "M5.25 2.25L4.5 0.25C4.5 0.25 4.25 0 4 0C3.75 0 3.5 0.25 3.5 0.25L2.75 2.25C2.75 2.5 2.5 2.75 2.25 2.75L0.25 3.5C0.25 3.5 0 3.75 0 4C0 4.25 0.25 4.5 0.25 4.5L2.25 5.25C2.5 5.25 2.75 5.5 2.75 5.75L3.5 7.75C3.5 7.75 3.75 8 4 8C4.25 8 4.5 7.75 4.5 7.75L5.25 5.75C5.25 5.5 5.5 5.25 5.75 5.25L7.75 4.5C7.75 4.5 8 4.25 8 4C8 3.75 7.75 3.5 7.75 3.5L5.75 2.75C5.5 2.75 5.25 2.5 5.25 2.25Z",
    name: "sparkle",
    note: "four-point star; every ai- and -sparkle icon",
    sure: true,
  },
  {
    d: "M0 0C0 3.25 2.75 6 6 6C9.25 6 12 3.25 12 0",
    name: "semicircle",
    note: "half-circle arc, 2:1",
    sure: true,
  },
  {
    d: "M0 0L0 6C0 7.75 1.25 9 3 9L9 9",
    name: "elbow",
    note: "right angle with a rounded corner",
    sure: true,
  },
  {
    d: "M0 4L0 3C0 1.25 1.25 0 3 0L4 0",
    name: "corner-bracket",
    note: "short-armed rounded corner; the scan and focus bracket",
    sure: true,
  },
  {
    d: "M0 5L0 0L5 0",
    name: "corner",
    note: "right angle with a sharp corner",
    sure: true,
  },
  {
    d: "M3.5 0L0.5 3C-0.25 3.5 -0.25 4.5 0.5 5L3.5 8",
    name: "arrowhead",
    note: "chevron with a rounded apex; distinct from `chevron` by the join, not the angle",
    sure: true,
  },
  {
    d: "M2.5 0.25L1 1C0.5 1.5 0 2.25 0 2.75L0 4.5C0 5.25 0.5 6 1 6.25L2.5 7.25C3 7.5 4 7.5 4.5 7.25L6 6.25C6.5 6 7 5.25 7 4.5L7 2.75C7 2.25 6.5 1.5 6 1L4.5 0.25C4 0 3 0 2.5 0.25Z",
    name: "hexagon",
    note: "rounded hexagon; cube faces, gems, donuts",
    sure: true,
  },
  {
    d: "M2 0C2 1 1 2 0 2",
    name: "arc-quarter",
    note: "90-degree arc",
    sure: true,
  },
  {
    d: "M3 2C3 3 2.25 3.75 1.5 3.75C0.75 3.75 0 3 0 2C0 0.75 0.75 0 1.5 0C2.25 0 3 0.75 3 2Z",
    name: "oval",
    note: "the face eye: emoji-, cat, alien, bug-face",
    sure: true,
  },
  {
    d: "M0 1.25L2 0",
    name: "oblique",
    note: "a straight segment at an angle the house spec does not snap to (30 deg here). Four more clusters are the same mark at 38, 51, 59 and 68 degrees, all within the clustering threshold of this one — the fingerprint of a bare segment barely varies with angle, so only the aspect bucket keeps them apart",
    sure: false,
  },
  {
    d: "M0 3C0 1.25 1.25 0 3 0L15 0C16.75 0 18 1.25 18 3L18 8C18 9.75 16.75 11 15 11L3 11C1.25 11 0 9.75 0 8L0 3Z",
    name: "rect-wide",
    note: "rounded rectangle, near 16:10",
    sure: true,
  },
  {
    d: "M10 0L3 0C1.25 0 0 1.25 0 3L0 9C0 10.75 1.25 12 3 12L10 12",
    name: "open-rect",
    note: "rounded rect with one side missing; the package and box body. Head of an eight-cluster family — see the family note",
    sure: false,
  },
  {
    d: "M0 2C0 1 1 0 2 0C3 0 4 1 4 2L4 6C4 7 3 8 2 8C1 8 0 7 0 6L0 2Z",
    name: "capsule",
    note: "stadium, 1:2",
    sure: true,
  },
  {
    d: "M0 3.25L2 5L5.5 0",
    name: "check",
    note: "check mark. The set draws all 21 instances at one turn and never mirrored, so unlike most of this list the name carries no orientation risk",
    sure: true,
  },
  {
    d: "M0 3C0 1.25 1.25 0 3 0L13 0C14.75 0 16 1.25 16 3L16 11C16 12.75 14.75 14 13 14L11.25 14C11.25 14 11 14 10.75 14.25L8 16.5L5.25 14.25C5 14 5 14 4.75 14L3 14C1.25 14 0 12.75 0 11L0 3Z",
    name: "bubble",
    note: "speech bubble with a tail",
    sure: true,
  },
  {
    d: "M4 0C1.5 1.5 0 4.25 0 7.5C0 12.5 4 16.5 9 16.5C14 16.5 18 12.5 18 7.5C18 4.25 16.5 1.5 14 0",
    name: "ring-open",
    note: "circle with a gap; history, share, radar",
    sure: true,
  },
  {
    d: "M11.25 1C10 -0.25 8 -0.25 7 1L1 7C-0.25 8 -0.25 10 1 11.25L7 17.25C8 18.25 10 18.25 11.25 17.25L17.25 11.25C18.25 10 18.25 8 17.25 7L11.25 1Z",
    name: "keyframe",
    note: "rounded diamond",
    sure: true,
  },
  {
    d: "M0 6L1.5 6C2.25 6 3 5.25 3 4.5L3 1.5C3 0.75 2.25 0 1.5 0L0 0",
    name: "open-rect-narrow",
    note: "1:2 open rect; the battery terminal. Family member",
    sure: false,
  },
  {
    d: "M7 16L3 16C1.25 16 0 14.75 0 13L0 3C0 1.25 1.25 0 3 0L13 0C14.75 0 16 1.25 16 3L16 6",
    name: "square-open",
    note: "rounded square with one corner opened; boolean and bezier icons. 0.054 from the 12-unit cluster, which is the same mark",
    sure: false,
  },
  {
    d: "M0 0L0 4C0 5.75 1.25 7 3 7L13 7C14.75 7 16 5.75 16 4L16 0",
    name: "open-rect-wide",
    note: "2.3:1 open rect; bag and box bodies. Family member",
    sure: false,
  },
  {
    d: "M1.75 2.5L6.75 0.25C7.5 0 8.5 0 9.25 0.25L14.25 2.5C15.25 3 16 4 16 5.25L16 10.25C16 14.75 12.5 18.25 8 18.25C3.5 18.25 0 14.75 0 10.25L0 5.25C0 4 0.75 3 1.75 2.5Z",
    name: "shield",
    note: "shield outline",
    sure: true,
  },
  {
    d: "M5.25 2.25L3.25 2.25L3.5 0.25C3.5 0 3.25 0 3 0L0 4C0 4 0 4.25 0.25 4.25L2.25 4.25L2 6.5C2 6.75 2.25 6.75 2.5 6.5L5.5 2.75C5.5 2.5 5.5 2.25 5.25 2.25Z",
    name: "bolt",
    note: "lightning bolt; every car--ev and charging icon",
    sure: true,
  },
  {
    d: "M4 0L3 0C1.25 0 0 1.25 0 3C0 4.75 1.25 6 3 6L4 6",
    name: "arc-c",
    note: "the most curved member of the open-rect family; cup, coin and beer handles",
    sure: false,
  },
  {
    d: "M3.5 2.25L0.75 0C0.5 -0.25 0 0 0 0.5L0 5C0 5.25 0.5 5.5 0.75 5.25L3.5 3C3.75 3 3.75 2.5 3.5 2.25Z",
    name: "triangle",
    note: "rounded triangle; the play and chevron-triangle mark",
    sure: true,
  },
  {
    d: "M16 6L16 3.5C16 1.5 14.5 0 12.5 0L3.5 0C1.5 0 0 1.5 0 3.5L0 6",
    name: "arch-wide",
    note: "16:6 arch; server, garage, sofa. Family member, the turn where the closed side is the long one",
    sure: false,
  },
  {
    d: "M17.25 12L17.75 12C18.75 12 19.75 11 19.75 10L19.75 7.5C19.75 6 18.5 4.75 17.25 4.5L14.5 4.25C14 4 13.5 3.75 13.25 3.25L11.5 1.25C11 0.5 10 0 9.25 0L4.25 0C2.75 0 1.5 1 1.25 2.5L0 9.75C-0.25 11 0.75 12 2 12L2.25 12",
    name: "car",
    note: "car body silhouette; 14 car- icons, never turned",
    sure: true,
  },
  {
    d: "M1 0C0.5 0 0 0.5 0 1C0 1.5 0.5 2 1 2L1 0Z",
    name: "half-disc",
    note: "closed half circle; the half-filled state mark",
    sure: true,
  },
  {
    d: "M4 0C3.5 2 2 3.5 0 4",
    name: "arc-shallow",
    note: "a longer, shallower arc than `arc-quarter`, 0.047 from it — near enough that the fingerprint cannot separate them",
    sure: false,
  },
  {
    d: "M10.5 0L1.5 0C0.75 0 0 0.75 0 1.5C0 2.25 0.75 3 1.5 3L10.5 3C11.25 3 12 2.25 12 1.5C12 0.75 11.25 0 10.5 0Z",
    name: "capsule-wide",
    note: "4:1 stadium; the pause bar",
    sure: true,
  },
  {
    d: "M4 3L4 2C4 1 3 0 2 0C1 0 0 1 0 2L0 3",
    name: "arch-small",
    note: "4:3 arch; the padlock shackle. Family member",
    sure: false,
  },
  {
    d: "M6 5L6 3C6 1.25 4.75 0 3 0C1.25 0 0 1.25 0 3L0 5",
    name: "arch",
    note: "6:5 arch; shopping-bag handles. Family member",
    sure: false,
  },
  {
    d: "M0 2L1.5 3.5L5 0",
    name: "check-small",
    note: "sharper, smaller check mark. Same turn and flip evidence as `check`; probably its small size tier rather than a separate mark",
    sure: false,
  },
  {
    d: "M10 10L11.5 10C13 10 14 9 14 7.5L14 2.5C14 1 13 0 11.5 0L2.5 0C1 0 0 1 0 2.5L0 4",
    name: "rect-open",
    note: "landscape rounded rect with a corner opened; page-link, slides, picture-in-picture",
    sure: false,
  },
  {
    d: "M9 0C4.25 0 0.5 3.5 0 8C0 8.5 0.5 9 1 9L17 9C17.5 9 18 8.5 18 8C17.5 3.5 13.5 0 9 0Z",
    name: "dome",
    note: "closed half circle on a flat base; people shoulders, emoji mouths",
    sure: true,
  },
  {
    d: "M16 4.75L16 11.25C16 13 16 13.75 15.75 14.25C15.5 15 15 15.5 14.25 15.75C13.75 16 13 16 11.25 16L4.75 16C3 16 2.25 16 1.75 15.75C1 15.5 0.5 15 0.25 14.25C0 13.75 0 13 0 11.25L0 4.75C0 3 0 2.25 0.25 1.75C0.5 1 1 0.5 1.75 0.25C2.25 0 3 0 4.75 0L11.25 0C13 0 13.75 0 14.25 0.25C15 0.5 15.5 1 15.75 1.75C16 2.25 16 3 16 4.75Z",
    name: "squircle",
    note: "continuous-curvature square, 16 nodes. 0.042 from `square`: the fingerprint cannot see the corner treatment that separates them, so both names are kept deliberately",
    sure: true,
  },
  {
    d: "M14 0L14 5.25C14 7 12.75 8.25 11 8.25L3 8.25C1.25 8.25 0 7 0 5.25L0 0",
    name: "open-rect-deep",
    note: "1.7:1 open rect; gift, notebook, window. Family member",
    sure: false,
  },
  {
    d: "M0 4.75L0 2.75C0 1.5 0.75 0.5 2 0",
    name: "hook",
    note: "a straight arm turning through 90 degrees; clock hands, hourglass",
    sure: true,
  },
  {
    d: "M0 0.75C0 0.25 0.25 0 0.75 0C1.25 0 1.5 0.25 1.5 0.75L1.5 1.25C1.5 1.75 1.25 2 0.75 2C0.25 2 0 1.75 0 1.25L0 0.75Z",
    name: "capsule-small",
    note: "the smallest stadium tier; probably `capsule` rather than its own mark",
    sure: false,
  },
  {
    d: "M15 14L7 14C3.25 14 0 10.75 0 7C0 3.25 3.25 0 7 0C9.5 0 11.75 1.5 13 3.5C13.25 4 13.75 4 14.25 4C14.5 4 14.75 4 15 4C17.75 4 20 6.25 20 9C20 11.75 17.75 14 15 14Z",
    name: "cloud",
    note: "cloud outline",
    sure: true,
  },
];

/**
 * Name the parts a vocabulary recognises, leaving the rest as they are.
 *
 * Matching is by shape, not by id: each named reference is fingerprinted and
 * paired with its nearest part under `NAME_THRESHOLD`. Pairs are taken best
 * first and each name and each part is claimed once, so a name lands on the
 * part it fits best rather than the first one it merely fits — and a mark the
 * extraction split in two leaves the weaker half unnamed rather than
 * duplicating the word, which is the outcome that shows the split.
 */
export const nameParts = (
  parts: Part[],
  threshold = NAME_THRESHOLD
): Part[] => {
  const pairs: { d: number; name: string; part: number }[] = [];
  const partFps = parts.map((p) => fingerprint(parsePath(p.d)[0]));
  for (const shape of VOCABULARY) {
    const ref = fingerprint(parsePath(shape.d)[0]);
    for (const [i, fp] of partFps.entries()) {
      const d = distance(ref, fp);
      if (d <= threshold) {
        pairs.push({ d, name: shape.name, part: i });
      }
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const takenName = new Set<string>();
  const named = new Map<number, string>();
  for (const pair of pairs) {
    if (takenName.has(pair.name) || named.has(pair.part)) {
      continue;
    }
    takenName.add(pair.name);
    named.set(pair.part, pair.name);
  }

  return parts.map((p, i) => {
    const name = named.get(i);
    return name === undefined ? p : { ...p, name };
  });
};
