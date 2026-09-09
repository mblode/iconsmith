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
 * Names were read off contact sheets, with each part's `icons` list and its
 * measured `turns`/`flips` as corroboration. A mark the set draws at four turns
 * gets an orientation-neutral name — `corner`, not `bottom-left-corner` —
 * because the name has to survive every turn a placement can ask for.
 *
 * The first 61 were read off the top 90 parts of blode-icons (1,863 stroked
 * icons, 199 parts, the top 50 covering 86% of the set) and are shape words. The
 * next 30 were read off the object families — the parts whose source icons agree
 * on what the mark *is* — over the full 1,106-part extraction of the same set.
 *
 * A PROVENANCE WORD IS TAKEN ONLY WHERE THE SHAPE CORROBORATES IT. `folder` is
 * named from its icons because 5 of 5 are folder- *and* the mark is a rectangle
 * with a tab. Where the two disagree the geometry gets the word and `sure` goes
 * false: `clock-hands` is `corner` with the arms at 1:2.6, and says so. This is
 * the same standard the older entries were held to — `bell` is flagged because
 * only 3 of its 9 icons are bells, `mouse` because the shape does not carry the
 * word.
 *
 * THE OBJECT FAMILIES ARE NOT WHERE THEY WERE EXPECTED. A mature set is usually
 * described as ~90 object families — arrows, boxes, buildings, charts, devices,
 * faces, flags, hands, people — and blode has about that many. They are *icon*
 * families, not part families: this extractor decomposes an icon into subpaths,
 * and only some families have a body subpath distinctive enough to earn a word.
 * Ranked by instance count, the unnamed head of the extraction is not folders
 * and envelopes but proportion variants of marks already named — obliques at
 * seven angles, rounded rects at six aspects, arcs at four sweeps. Only 99
 * unnamed parts carry a dominant source word at all, and reading every one of
 * their contact sheets yielded 30 defensible names, not 90. The list stops at
 * three instances: below that a mark is drawn once or twice, and a search on the
 * icons it came from already reaches it.
 *
 * `sure: false` marks a name to review before relying on it. Two things put an
 * entry there: a proportion variant that is probably the same mark as its
 * neighbour (both families below), and a name that reads more confidently than
 * the evidence supports. A wrong name is worse than a missing one, because a
 * wrong one gets used.
 *
 * NOT EVERY PART GETS A WORD. The unnamed ranks still hold marks the set draws
 * often, and they are left unnamed where a name would only be a proportion of a
 * mark already named — the stadiums at 1:2.7 (p0156) and 1:3.3 (p0157) beside
 * `capsule` at 1:2, the ellipse at 1:1.5 (p0087) beside `oval` at 1:1.25. Words
 * are what a model chooses between, so an extra word buying no extra mark is a
 * cost, not coverage.
 *
 * ONE ASSIGNMENT IS WRONG AND IS NOT FIXED HERE. `circle-cut` claims the
 * 528-icon ring and `circle` is left on an 18-unit cluster of 8 — the flattened
 * chord is 0.05 of the fingerprint and the greedy pass takes the closer pair
 * first. It predates the object-family names and is unchanged by them (the same
 * 61 names land on the same 61 parts before and after), so it is recorded here
 * rather than repaired inside a naming change: swapping it means moving a
 * reference drawing, which is a claim about the set and wants its own evidence.
 *
 * TWO FAMILIES ARE ONE MARK EACH, SPLIT BY THE CLUSTERER.
 *
 * **The open-rect family** — a rounded rectangle with one side left open. Eight
 * are named (`open-rect` p0094, `open-rect-narrow` p0038, `open-rect-wide`
 * p0117, `open-rect-deep` p0044, `arc-c` p0019, `arch` p0075, `arch-small`
 * p0073, `arch-wide` p0076, `page-open` p0138) and at least eleven more sit
 * unnamed in the top 90: p0007, p0031, p0039, p0042, p0067, p0069, p0083,
 * p0095, p0118, p0127, p0141, plus `square-open` p0005 and `rect-open` p0140,
 * which are the same mark with the opening shortened to a notch.
 *
 * **The transposes.** `trapezoid` at 3.62x2.22 has a second cluster at 2.22x3.62
 * drawing the same quadrilateral on its side, and the aspect gate in
 * `turnsToTry` refuses to compare them, so the word goes to one of the two. Same
 * mechanism as the two families below, one pair rather than twenty.
 *
 * **The straight-run family** — one bare segment at an angle the house spec
 * does not snap to. `oblique` p0046 is named at 38 degrees; p0164, p0111,
 * p0048, p0112, p0173 and p0017 are the same segment at 27, 30, 51, 59, 66 and
 * 68 degrees and are left unnamed for it. Which cluster carries the word is not
 * a judgement about shape — the shapes are indistinguishable — so it goes to
 * the one the most icons draw.
 *
 * Both splits come from `bucketKey` in `extract.ts`, not from the distance
 * threshold, and that distinction matters for anyone trying to fix it. Members
 * are filed by open/closed, node count and folded aspect in thirds, and two
 * candidates in different buckets are never compared at all. So the family
 * members that would obviously fold are not near misses: p0111 to p0112 is
 * 0.006, p0044 to p0042 is 0.006, p0038 to p0039 is 0.013, p0127 to p0118 is
 * 0.016 — an order of magnitude inside the 0.06 threshold, and separate parts
 * regardless. The rest score `Infinity`, refused outright by the aspect gate in
 * `turnsToTry`. Raising the threshold reaches neither group.
 *
 * That makes these a different failure from the one isolated alongside them,
 * where a mark and its transpose ARE compared and miss the fold by 0.010
 * against 0.06 — a threshold-or-resolution question about one pair. Here the
 * comparison never happens, which is a bucketing question about roughly twenty
 * parts. Widening the threshold closes the first and none of the second, and
 * the qualifiers in the names above are a holding position until the clusterer
 * merges what it should.
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
const NAME_THRESHOLD = 0.06;

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
    d: "M0 0L7 5.5",
    name: "oblique",
    note: "a straight segment at an angle the house spec does not snap to (38 deg here). Six more clusters are the same mark at 27, 30, 51, 59, 66 and 68 degrees — the fingerprint of a bare segment barely varies with angle, so only the aspect bucket keeps them apart. The word goes to this one because 25 icons draw it against the next one's 23, and when the shape cannot choose the bearer, use is the only thing left that can; the other six are left unnamed rather than given six words for one mark",
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
    note: "rounded rect with one side missing; the package and box body. Head of a family of about twenty clusters — see the family note",
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
    name: "elbow-tall",
    note: "a straight arm turning through a quarter circle at 1:2.4; clock hands, hourglass. Was `hook`, which named an object where the mark is a proportion of `elbow` — and only by eye, because the aspect gate refuses to measure the two against each other",
    sure: false,
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
  {
    d: "M0 6.5L0 5.75C0 4.75 0.25 4 1 3.5L4 0.5C4.5 -0.25 5.5 -0.25 6 0.5C6.5 1 6.5 1.75 6 2.5L3 5.5C2.25 6 1.5 6.5 0.75 6.5L0 6.5Z",
    name: "pencil",
    note: "slanted lozenge with one squared end; all 11 icons that draw it are pencil- or -edit, and all 11 draw it at one turn and unmirrored, so the mark has a fixed handedness the way `check` does",
    sure: true,
  },
  {
    d: "M0 9L0 3C0 1.25 1.25 0 3 0L11 0C12.75 0 14 1.25 14 3L14 15C14 16.75 12.75 18 11 18L7 18",
    name: "page-open",
    note: "the page body with a gap where a badge sits; all 10 of its icons are page-, and all draw it at one turn. An open-rect family member, and 0.064 from the 8-icon cluster that draws the same thing — the word goes to the more used of the two rather than to both",
    sure: false,
  },
  {
    d: "M6 8L2.75 8C1 8 -0.5 6.5 0 5C1 2.25 3.25 0 7 0",
    name: "shoulders",
    note: "the arc under a head in a person glyph; all 8 of its icons are user- or people-, and all 8 draw it at one turn and unmirrored. `dome` is the closed half-circle that serves the same role in other icons",
    sure: true,
  },
  {
    d: "M0 4L0 6.25L2.25 6.25L5.75 2.75C6.5 2.25 6.5 1.25 5.75 0.5C5.25 -0.25 4.25 -0.25 3.5 0.5L0 4Z",
    name: "pencil-tip",
    note: "`pencil` with the far end cut to a nib rather than rounded; 8 of its 10 icons are also edit marks. Flagged because the tip is the only thing separating it from `pencil`, and a model choosing between the two by name will not see that",
    sure: false,
  },
  {
    d: "M3 0C1.25 1.75 0 4 0 6.75C0 9.25 1.25 11.75 3 13.5",
    name: "arc-long",
    note: "a shallow arc over 4.5 times its own width; the cheek of a face, the closed eye. Same family as `arc-quarter` and `arc-shallow`, kept apart only by the aspect bucket",
    sure: false,
  },
  {
    d: "M0.5 6.5C1.25 2.75 4.25 0 8 0C11.75 0 15 2.75 15.5 6.5L16 10.5C16.25 12.5 15 14 13 14L3 14C1.25 14 -0.25 12.5 0 10.5L0.5 6.5Z",
    name: "bell",
    note: "dome flaring to a wider flat base. Named from the mark rather than the icons: only 3 of its 9 are bell-, and it also serves as a cap, a trophy cup and an emoji mouth",
    sure: false,
  },
  {
    d: "M0 6.25C0 4.25 0 3.25 0.5 2.25C0.75 1.5 1.5 1 2 0.5C3 0.25 4 0 5.75 0C8 0 10 0 12.25 0C14 0 15 0.25 16 0.5C16.5 1 17.25 1.5 17.5 2.25C18 3.25 18 4.25 18 6.25L18 7.75C18 9.75 18 10.75 17.5 11.75C17.25 12.5 16.5 13 16 13.5C15 13.75 14 14 12.25 14C10 14 8 14 5.75 14C4 14 3 13.75 2 13.5C1.5 13 0.75 12.5 0.5 11.75C0 10.75 0 9.75 0 7.75L0 6.25Z",
    name: "squircle-wide",
    note: "the 16-node continuous-curvature treatment of `squircle` at 9:7; card, archive, sd-card. Flagged as the landscape tier of `squircle` rather than a mark of its own",
    sure: false,
  },
  {
    d: "M5 15C2.25 15 0 12.75 0 10L0 5C0 2.25 2.25 0 5 0C7.75 0 10 2.25 10 5L10 10C10 12.75 7.75 15 5 15Z",
    name: "mouse",
    note: "geometrically a 2:3 stadium — `capsule` at another proportion — and named from its icons instead: mouse, mouse-classic, mouse-scroll-. Flagged because the shape does not carry the word; 5 of its 9 icons are something else",
    sure: false,
  },
  {
    d: "M0.25 4.5C0.75 5.25 1.75 6 3 6C4.75 6 6 4.75 6 3C6 1.25 4.75 0 3 0C1.25 0 0 1.25 0 3C0 3.5 0 4 0.25 4.5Z",
    name: "circle-cut",
    note: "circle with one chord flattened, which is what a circle looks like where something joins or knocks out of it — the magnifier lens meeting its handle, a share node meeting its arm. Named for the geometry because the icons do not agree on one object",
    sure: false,
  },
  {
    d: "M2.25 0.25C2.5 0 2.5 0 2.75 0L3.5 1.25C3.5 1.25 3.5 1.25 3.75 1.25L5 1.5C5.25 1.5 5.25 1.75 5.25 2L4.5 3C4.25 3.25 4.25 3.25 4.25 3.25L4.5 4.75C4.5 4.75 4.5 5 4.25 5L3 4.5C2.75 4.5 2.75 4.5 2.75 4.5L1.5 5C1.25 5.25 1 5 1 5L1.25 3.5C1.25 3.5 1 3.25 1 3.25L0 2.25C0 2.25 0 2 0.25 2L1.5 1.5C1.5 1.5 1.75 1.5 1.75 1.5L2.25 0.25Z",
    name: "star",
    note: "five-point star; the review and favourite mark. Distinct from `sparkle`, which has four points and concave sides",
    sure: true,
  },
  {
    d: "M0 4.5L3.25 7.75C5 9.5 8 9.5 9.75 7.75C11.5 6 11.5 3 9.75 1.25C8 -0.5 5 -0.5 3.25 1.25L0 4.5Z",
    name: "drop",
    note: "circle drawn to a point on one side; drop, map-pin, fire, footprint",
    sure: true,
  },
  {
    d: "M6 13L3 13C1.25 13 -0.25 11.25 0 9.5L1 2.5C1.25 1 2.5 0 4 0L10 0C11.5 0 12.75 1 13 2.5L13 4",
    name: "bag",
    note: "open rect with tapered sides; all 8 of its icons are shopping-bag or package, and all 8 draw it at one turn",
    sure: true,
  },
  {
    d: "M5.25 9L0.75 6.75C-0.25 6.25 -0.25 4.5 1 4L12.75 0C14 -0.25 15 0.75 14.75 2L10.75 13.75C10.25 15 8.5 15 8 14L5.75 9.5C5.75 9.25 5.5 9 5.25 9Z",
    name: "pointer",
    note: "the cursor arrow; also the send paper-plane, which is the same mark turned",
    sure: true,
  },
  {
    d: "M2 3.75L3.25 3.75C3.75 3.75 4.25 3.75 4.5 3.5L8.25 0.25C9 -0.25 10 0.25 10 1L10 14.75C10 15.5 9 16 8.25 15.5L4.5 12.25C4.25 12 3.75 11.75 3.25 11.75L2 11.75C1 11.75 0 11 0 9.75L0 5.75C0 4.75 1 3.75 2 3.75Z",
    name: "speaker",
    note: "speaker cone and box in one outline; all 8 of its icons are volume- or sound",
    sure: true,
  },
  {
    d: "M3 0L7.25 0C7.75 0 8.25 0.25 8.5 0.5L13.5 5.5C13.75 5.75 14 6.25 14 6.75L14 15C14 16.75 12.75 18 11 18L3 18C1.25 18 0 16.75 0 15L0 3C0 1.25 1.25 0 3 0Z",
    name: "page",
    note: "portrait rect with one corner cut back; the document body",
    sure: true,
  },
  {
    d: "M12 0L2 0C0.5 0 -0.5 1.5 0.25 3L5.25 13C6 14.25 8 14.25 8.75 13L13.75 3C14.5 1.5 13.5 0 12 0Z",
    name: "triangle-large",
    note: "`triangle` at 14 units and equilateral rather than 3.7 and isosceles; arrow-triangle-, exclamation-triangle. Flagged as a size and proportion tier of `triangle`",
    sure: false,
  },
  {
    d: "M0 3L0 12C0 13.75 1.25 15 3 15L15 15C16.75 15 18 13.75 18 12L18 6C18 4.25 16.75 3 15 3L10 3C9.5 3 8.75 2.75 8.5 2L7.5 1C7.25 0.25 6.5 0 6 0L3 0C1.25 0 0 1.25 0 3Z",
    name: "folder",
    note: "a rectangle with a raised tab on the left; the folder body. All 5 of its icons are folder-, and all 5 draw it at one turn and unmirrored. `folder-open` is the same body with a gap where a badge sits, the way `page-open` relates to `page`",
    sure: true,
  },
  {
    d: "M0 6L0 3C0 1.25 1.25 0 3 0L6 0C6.5 0 7.25 0.25 7.5 1L8.5 2C8.75 2.75 9.5 3 10 3L15 3C16.75 3 18 4.25 18 6L18 12C18 13.75 16.75 15 15 15L9 15",
    name: "folder-open",
    note: "the folder body with a gap in one side where a badge sits; all 6 of its icons are badged folder- (folder-add-left, folder-bookmarks, folder-cloud, folder-delete, folder-restricted, folder-sparkle). A separate cluster from `folder` at the same 18x15, and named separately for the same reason `page-open` is",
    sure: true,
  },
  {
    d: "M0.25 3.75L7.75 7.25C8.5 7.75 9.5 7.75 10.25 7.25L17.5 3.75C17.75 3.5 18 3.25 18 3C18 1.25 16.75 0 15 0L3 0C1.25 0 0 1.25 0 3L0 11C0 12.75 1.25 14 3 14L8 14",
    name: "envelope",
    note: "a rectangle with the flap creased into it; all 6 of its icons are email-2-, and all 6 draw it at one turn and unmirrored",
    sure: true,
  },
  {
    d: "M6.5 2.25C6.5 4.25 3.5 5.75 3.25 5.75C3 5.75 0 4.25 0 2.25C0 0.75 1 0 1.75 0C2.75 0 3.25 0.5 3.25 0.5C3.25 0.5 3.75 0 4.75 0C5.5 0 6.5 0.75 6.5 2.25Z",
    name: "heart",
    note: "the heart mark. Two clusters draw it — this one at 6 icons and a second at 4 (broken-heart, heart-2, heart-beat, heart-donation); the word goes to the more used of the two rather than to both",
    sure: true,
  },
  {
    d: "M17 9C17 10.75 15.75 12 14 12L3 12C1.25 12 0 10.75 0 9L0 3C0 1.25 1.25 0 3 0L14 0C15.75 0 17 1.25 17 3",
    name: "battery",
    note: "a landscape rounded rect with the terminal notched out of one end; all 5 of its icons are battery-, at one turn, never mirrored. `open-rect-narrow` is the terminal itself, drawn separately in other icons",
    sure: true,
  },
  {
    d: "M14 16L14 4.75C14 3 14 2.25 13.75 1.75C13.5 1 13 0.5 12.25 0.25C11.75 0 11 0 9.25 0L4.75 0C3 0 2.25 0 1.75 0.25C1 0.5 0.5 1 0.25 1.75C0 2.25 0 3 0 4.75L0 16C0 17 0 17.5 0.25 17.75C0.5 18 0.75 18 1 18C1.25 18 1.75 17.75 2.5 17.25L6 14.75C6.5 14.5 6.5 14.25 6.75 14.25C7 14.25 7 14.25 7.25 14.25C7.5 14.25 7.5 14.5 8 14.75L11.5 17.25C12.25 17.75 12.75 18 13 18C13.25 18 13.5 18 13.75 17.75C14 17.5 14 17 14 16Z",
    name: "bookmark",
    note: "a tall rect with a notch cut up into its base; the bookmark ribbon. 3 of its 5 icons are bookmark-, and the shape carries the word on its own",
    sure: true,
  },
  {
    d: "M13 15.75C6.5 14.5 1.25 9.5 0 2.75C-0.25 1.25 1 0 2.5 0C3.75 0 4.75 0.75 5.25 2L5.5 3C5.75 3.5 5.5 4.25 5 4.75C4.5 5.25 4.25 6.25 4.75 6.75C5.75 8.5 7.25 10 9 11C9.75 11.5 10.5 11.25 11 10.75C11.5 10.25 12.25 10 12.75 10.25L13.75 10.5C15 11 15.75 12 15.75 13.25C15.75 14.75 14.5 16 13 15.75Z",
    name: "handset",
    note: "the telephone handset; all 4 of its icons are call-, call-incoming, call-outgoing and telephone, all at one turn and unmirrored",
    sure: true,
  },
  {
    d: "M7 0C3.25 0 0 3.25 0 7C0 9.5 1.25 11.75 3.5 13C3.75 13.25 4 13.5 4 14L4 16C4 17.75 5.25 19 7 19C8.75 19 10 17.75 10 16L10 14C10 13.5 10.25 13.25 10.5 13C12.75 11.75 14 9.5 14 7C14 3.25 10.75 0 7 0Z",
    name: "lightbulb",
    note: "a bulb over a narrower base; 3 of its 4 icons are light-bulb- or lightbulb-, all at one turn. The fourth is `ear`, which draws the same outline",
    sure: true,
  },
  {
    d: "M0 5.75C0 4.75 0.5 3.75 1.5 3.25L6.5 0.5C7.5 -0.25 8.5 -0.25 9.5 0.5L14.5 3.25C15.5 3.75 16 4.75 16 5.75L16 14.5C16 16.25 14.75 17.5 13 17.5L3 17.5C1.25 17.5 0 16.25 0 14.5L0 5.75Z",
    name: "home",
    note: "a rectangle with a gable; the house body. form-pentagon, home-circle, home-plus and wind-power, drawn at two turns",
    sure: true,
  },
  {
    d: "M10 11L10 3C10 1.25 8.5 0 7 0C5.25 0 4 1.25 4 3L4 11L0.5 11C0 11 -0.25 11.5 0 11.75L5.75 18.5C6.5 19.25 7.5 19.25 8 18.5L13.75 11.75C14 11.5 13.75 11 13.25 11L10 11Z",
    name: "arrow",
    note: "shaft and head as one closed outline, rather than the `chevron` head over a separate `stroke`. All 4 of its icons are arrow-path-, which is the set drawing an arrow as one mark; the set draws it at all four turns",
    sure: true,
  },
  {
    d: "M0.25 1.25C0.75 1.25 1.25 0.75 1.25 0.25C1.25 0.25 1.25 0 1.25 0C1.75 0 2 0.5 2 1C2 1.5 1.5 2 1 2C0.5 2 0 1.75 0 1.25C0 1.25 0.25 1.25 0.25 1.25Z",
    name: "crescent",
    note: "a circle with a second circle taken out of one side; the moon, and the cut a golf ball's dimple leaves. 2 of its 4 icons are moon-",
    sure: true,
  },
  {
    d: "M12 2.75L10 1C9 -0.25 7 -0.25 6 1L0 6.75",
    name: "mountain",
    note: "a low peak inside a frame; the mountain in a photograph. 3 of its 5 icons are images-, but subscription-tick-1 draws the same mark as a check, and at 12 units it is over twice `check`'s width — flagged because a model choosing by name will not see that second reading",
    sure: false,
  },
  {
    d: "M0 6L3 0.25C3.25 0 3.75 0 4 0.25L6.75 6C7 6.25 6.75 6.75 6.25 6.75L3.75 5.75C3.5 5.5 3.5 5.5 3.25 5.75L0.75 6.75C0.25 6.75 -0.25 6.25 0 6Z",
    name: "needle",
    note: "a kite with a concave base; the compass needle, and the same mark is the paper plane in paper-plane-top-right. Drawn at two turns",
    sure: true,
  },
  {
    d: "M16 0C6.25 0 9.75 14 0 14",
    name: "s-curve",
    note: "one stroke turning through two opposite bends; the easing curve. animation-auto, animation-ease, bezier-curves and math-notes, all at one turn and unmirrored",
    sure: true,
  },
  {
    d: "M9 18C14 18 18 14 18 9C18 4 14 0 9 0C4 0 0 4 0 9C0 10.25 0.25 11.5 0.75 12.75C1 13 1 13.25 1 13.5L0 16C-0.25 17.25 0.75 18.25 2 18L4.5 17.25C4.75 17 5 17.25 5.25 17.25C6.5 17.75 7.75 18 9 18Z",
    name: "bubble-round",
    note: "a circle with a tail; the round speech bubble. Distinct from `bubble`, which is the rounded-rect body with the same tail — the two are different marks, not two sizes of one",
    sure: true,
  },
  {
    d: "M3 8.75L3 14.5C3 15.25 2.25 16 1.5 16C0.75 16 0 15.25 0 14.5L0 4.5C0 2 2 0 4.5 0C4.75 0 5.25 0 5.5 0C6.5 0.25 7 1.25 7 2.25L7 6.75C7 7.75 6.5 8.75 5.5 9C5.25 9 4.75 9 4.5 9C4 9 3.5 9 3 8.75Z",
    name: "earbud",
    note: "a round head over a straight stem; all 3 of its icons are airpod-, and the set mirrors it to draw the other ear",
    sure: true,
  },
  {
    d: "M2.5 0C1 0 0 0.5 0 2C1.5 2 2.5 1.5 2.5 0Z",
    name: "leaf",
    note: "a pointed oval, drawn at two turns; the leaves of a wreath. `alien` draws the same mark as an eye, which is what the shape is when it is not a leaf",
    sure: true,
  },
  {
    d: "M5.5 2.5L5.5 0L2.5 0L2.5 2.5L0 2.5L0 5.5L2.5 5.5L2.5 8L5.5 8L5.5 5.5L8 5.5L8 2.5L5.5 2.5Z",
    name: "cross",
    note: "the equal-armed cross; all 3 of its icons are medical-cross-. Distinct from a plus drawn as two crossing `stroke`s, because this is one closed outline",
    sure: true,
  },
  {
    d: "M0 0L0 5.5L4 4.5L8 5.5L8 0",
    name: "ribbon",
    note: "a banner with a notch cut up into its base; all 3 of its icons are the medal set, at one turn and unmirrored",
    sure: true,
  },
  {
    d: "M1 8.75C0.5 8.75 0 8.25 0 7.75C0 7.5 0 7.25 0.25 7L2.25 1.25C2.5 0.5 3 0 4 0C4.75 0 5.25 0.5 5.75 1.25L7.75 7C7.75 7.25 8 7.5 8 7.75C8 8.25 7.5 8.75 6.75 8.75C6.25 8.75 5.75 8.5 5.75 7.75L5.5 6.75L2.5 6.75L2.25 7.75C2 8.5 1.75 8.75 1 8.75Z",
    name: "letter-a",
    note: "the letter A as one outline; alt, letter-a-circle, letter-a-square. The set draws a handful of glyphs as parts, and this is the one that recurs",
    sure: true,
  },
  {
    d: "M2.25 7.75L2.25 2L2 2L1.5 2.5C1 2.75 1 2.75 0.75 2.75C0.25 2.75 0 2.5 0 2C0 1.75 0.25 1.5 0.5 1.25L1.5 0.5C2 0.25 2.5 0 3 0C3.75 0 4.25 0.5 4.25 1.25L4.25 7.75C4.25 8.5 3.75 8.75 3.25 8.75C2.5 8.75 2.25 8.5 2.25 7.75Z",
    name: "numeral-1",
    note: "the digit 1. back-10s, forwards-10s, gold-medal, number-1-circle, number-1-square",
    sure: true,
  },
  {
    d: "M1 8.75C0.25 8.75 0 8.25 0 7.75C0 7.25 0.25 7 0.5 6.75L3 4.5C4 3.5 4.25 3.25 4.25 2.75C4.25 2 3.75 1.5 3 1.5C2.5 1.5 2.25 2 2 2.5C1.5 2.75 1.25 3 1 3C0.25 3 0 2.75 0 2.25C0 2 0 1.75 0 1.75C0.5 0.75 1.5 0 3.25 0C5 0 6.25 1 6.25 2.5C6.25 3.5 5.75 4.25 4.5 5.5L2.75 7L2.75 7L5.75 7C6.25 7 6.5 7.25 6.5 7.75C6.5 8.25 6.25 8.75 5.75 8.75L1 8.75Z",
    name: "numeral-2",
    note: "the digit 2. number-2-circle, number-2-square, silver-medal",
    sure: true,
  },
  {
    d: "M3.25 9C1.5 9 0.5 8 0 7.25C0 7 0 7 0 6.75C0 6.25 0.25 5.75 1 5.75C1.25 5.75 1.5 6 1.75 6.25C2.25 7 2.5 7.25 3.25 7.25C4 7.25 4.5 6.75 4.5 6.25C4.5 5.5 4 5 3 5L3 5C2.5 5 2.25 4.75 2.25 4.25C2.25 4 2.5 3.5 3 3.5L3 3.5C4 3.5 4.5 3.25 4.5 2.5C4.5 2 4 1.5 3.25 1.5C2.75 1.5 2.25 1.75 2 2.25C1.75 2.75 1.5 3 1 3C0.5 3 0.25 2.5 0.25 2.25C0.25 2 0.25 1.75 0.25 1.5C0.5 0.75 1.5 0 3.25 0C5 0 6.5 0.75 6.5 2.25C6.5 3.25 5.75 4 4.75 4.25L4.75 4.25C6 4.5 6.75 5.25 6.75 6.25C6.75 7.75 5.5 9 3.25 9Z",
    name: "numeral-3",
    note: "the digit 3. bronce-medal, number-3-circle, number-3-square",
    sure: true,
  },
  {
    d: "M3.75 9C2.25 9 1.25 8.25 0.5 7C0.25 6.5 0 5.5 0 4.5C0 1.75 1.5 0 3.75 0C5.25 0 6.25 0.75 6.75 1.5C6.75 1.5 6.75 1.75 6.75 2C6.75 2.25 6.5 2.75 5.75 2.75C5.5 2.75 5.25 2.5 5 2.25C4.5 1.75 4.25 1.75 3.75 1.75C2.5 1.75 2 2.75 2 4.25L2 4.5L2 4.5C2.5 3.75 3.25 3 4.25 3C6 3 7 4.25 7 5.75C7 7.5 5.75 9 3.75 9Z",
    name: "numeral-6",
    note: "the digit 6, which the set also draws upside down as a 9 — number-6-circle, number-6-square, number-9-circle, number-9-square, and the measured turns say 0 and 180 for exactly that reason",
    sure: true,
  },
  {
    d: "M0 1.5L2 3.5L3.5 2L1.5 0L0 1.5Z",
    name: "diamond",
    note: "a square on its corner with sharp joins; distinct from `keyframe`, which is the same rotation with the corners rounded. Drawn at all four turns",
    sure: true,
  },
  {
    d: "M11 2C11 3 8.5 4 5.5 4C2.5 4 0 3 0 2C0 1 2.5 0 5.5 0C8.5 0 11 1 11 2Z",
    name: "ellipse-flat",
    note: "an ellipse near 3:1; the globe's equator and the rim of a stack seen edge-on. Flagged as a proportion tier of `oval` at 1:1.25 rather than a mark of its own — the aspect bucket is the only thing keeping them apart",
    sure: false,
  },
  {
    d: "M0 4.5L7.5 0.5C8.5 -0.25 9.5 -0.25 10.5 0.5L18 4.5",
    name: "chevron-large",
    note: "a chevron near 4:1, against `chevron`'s 2:1. The set's own word — 4 of its 5 icons are chevron-large- — but flagged as a size tier of `chevron` rather than a separate mark",
    sure: false,
  },
  {
    d: "M0 0L0 4L2.5 6.5",
    name: "clock-hands",
    note: "two arms of unequal length meeting at a sharp corner; the clock hands. 2 of its 4 icons are clock-, and the mark is geometrically `corner` with the arms in a 1:2.6 ratio, so the word describes the use rather than the shape",
    sure: false,
  },
  {
    d: "M0 2.25C0.75 2.25 1.5 2.25 2 2.25C2.5 2.25 3.25 2 3.5 1.75L2.75 0C2.5 0 2.25 0.25 2 0.25C1.5 0.25 0.75 0.25 0 0.25L0 2.25Z",
    name: "trapezoid",
    note: "a quadrilateral with one pair of sides parallel; a key or panel seen in perspective, across keyboard- and layout-. Its transpose is a separate cluster at 2.22x3.62 that the aspect gate in `turnsToTry` refuses to compare against it, so the two are one mark the clusterer split — see the family note above",
    sure: false,
  },
  {
    d: "M6 0L1.75 1.25C1.5 1.25 1.25 1.5 1.25 1.75L0 6C0 6.25 0.25 6.75 0.75 6.5L4.75 5.5C5 5.25 5.25 5 5.5 4.75L6.5 0.75C6.75 0.25 6.25 0 6 0Z",
    name: "parallelogram",
    note: "a quadrilateral with both pairs of sides parallel; the compass face and the map plane, seen in perspective. Three icons is the floor this list stops at",
    sure: false,
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
