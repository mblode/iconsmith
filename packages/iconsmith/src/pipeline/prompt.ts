/**
 * The system prompt: the house spec and the DSL grammar, in the model's words.
 *
 * Every number here is read out of `SPEC` rather than typed into the prose. A
 * prompt that restates the spec from memory drifts away from the code that
 * enforces it, and the model then spends turns fighting `lint` over rules the
 * prompt told it were different. One source, formatted twice.
 */
import { SPEC } from "../tools/canvas.js";
import type { CohortTarget } from "../tools/cohort.js";
import type { Keyline } from "../types.js";

export interface Concept {
  /** Category from the host set, when the concept comes from one. */
  category?: string;
  /** Icon name, kebab-case: the thing to draw. */
  name: string;
  /** A reference SVG to work *from*, not to copy — its geometry is off-spec. */
  reference?: string;
  /** Synonyms and neighbouring senses; they disambiguate the concept. */
  tags?: string[];
}

const list = (o: Record<string, number>): string =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");

const keylines = (): string =>
  Object.entries(SPEC.keylines)
    .map(([k, [w, h]]) => `- \`${k}\` — ${w}×${h}`)
    .join("\n");

/** The invariant, stated as a capability rather than a restriction: the model
 *  is told what it controls, not what it is prevented from doing. */
const HOUSE = (): string => `# The house spec

You draw on a ${SPEC.canvas}×${SPEC.canvas} canvas. Y grows downward; (0,0) is
top-left.

- **Stroke** ${SPEC.stroke}px, round caps, round joins, no fills. Every shape you
  place is an outline, so a "solid" shape does not exist — suggest mass with an
  enclosing outline, never by filling one.
- **Grid** every coordinate lands on a ${SPEC.grid} step. You do not round
  anything yourself; the primitives quantise for you.
- **Keylines** the four canonical extents. Pick the one that suits the concept
  and keep the whole drawing inside it:
${keylines()}
- **Corner radii** come from tiers, not from taste: ${SPEC.radiusTiers.join(", ")}.
  Ask for the one you want and the nearest legal tier for that shape's size is
  what gets drawn.
- **Dot sizes** by role, as visual diameters: ${list(SPEC.dots)}.
- **Minimum gap** ${SPEC.minGap}px of clear space between any two strokes that
  are not meant to touch. Below that they merge into a smudge at 16px.
- **Clearance** keep ${SPEC.clearance}px in from the canvas edge; a stroke that
  runs to the edge is clipped by every container the icon is put in.
- **Optical centring** the drawing's visual extent — path bounds inflated by the
  stroke, half on each side — is what must sit centred, not the path bounds.

The set this joins is a stroke set of thousands of icons. An icon that is
*correct* but drawn in its own dialect is worse than one that is plain and
drawn in the set's. Reach for the ordinary solution.`;

const GRAMMAR = `# What you can draw

You never write coordinates into a path. You call primitives, and they place
geometry on-spec: they quantise to the grid, snap angles to 0/45/90, and take
radii from the tiers above. You choose *what* and *where*; the canvas chooses
*how*. If a primitive refuses your input it has corrected it — read what came
back rather than trying to force the original numbers through.

- \`rect\` — a rectangle, optionally rounded by tier. Bodies, screens, cards,
  frames.
- \`circle\` — a circle. Heads, lenses, clock faces, buttons.
- \`line\` — a polyline through two or more points, angles snapped. Arrows,
  ticks, strokes, connectors, chart lines. Segments within a few degrees of
  0/45/90 are pulled onto the axis; one further out is refused unless you add
  \`off-axis\`, which says the diagonal is the shape rather than a slip. Roughly
  one edge in seven in this set is off-axis, so it is a real choice — but make
  it on purpose, and keep both endpoints on the grid.
- \`dot\` — a small solid disc with a role: \`terminal\` ends a stroke,
  \`more\` is one of an ellipsis or a list bullet, \`floating\` is a separate
  interior mark (a dice pip, an eye, a day on a calendar), and \`node\` is a
  point the drawing is *about* — a cell of a dot grid, a bezier handle, a
  data point, the centre of a target.
- \`part\` — place a shape from the extracted vocabulary by id. Prefer this over
  drawing a common form from scratch: it is *the same* folder, chevron, or
  magnifier that the rest of the set already uses, which is the whole point.
- \`remove\` — delete a draw op by index when you change your mind.
- \`center\` — recentre the drawing optically on the canvas.
- \`fit\` — scale the drawing to the chosen keyline. Do this once, near the end.

# How to work

1. \`listParts\` for the shapes your concept implies, by name and by synonym.
   Two searches beat inventing a form the set already owns.
2. Block in the largest element first, then the details. Fewer, larger elements
   read better at 16px than many small ones.
3. \`render\` and **look at the image**. You are the only check on whether it
   reads as the thing. Ask: at 16px, what is this? If the answer is "a blob" or
   "some other icon", change the drawing, not the size.
4. \`compare\` against the nearest existing icons. If yours looks like a
   different set drew it, it is wrong even when it lints clean.
5. \`lint\` and fix what it reports. Clean lint is the floor, not the goal.
6. When it lints clean and reads correctly, stop and reply with one sentence
   describing what you drew. Do not keep polishing.`;

/** The family a new icon joins, with the extent its members measurably occupy. */
export interface CohortBrief {
  extent: CohortTarget;
  /** Members the icon will be swapped with, for the model's sense of the set. */
  members?: string[];
  name: string;
}

const axis = (t: [number, number] | null, name: string): string =>
  t
    ? `- ${name} spans ${t[0].toFixed(2)}..${t[1].toFixed(2)}.`
    : `- ${name} has no agreed extent in this family; centre it.`;

/**
 * Stated only when the caller has measured a cohort, because it names an op
 * that is meaningless without one — and because the extent is a measurement,
 * not a rule of the house: writing it into the standing prompt would be the
 * drift this file's header warns about.
 */
const COHORT = (c: CohortBrief): string => `# The family this icon joins

This icon is a member of \`${c.name}\`${c.members?.length ? `, alongside ${c.members.join(", ")}` : ""}.
Those icons replace each other in place — a toggle, a state, a variant — so they
must occupy the same box. Their measured path extent is:

${axis(c.extent.x, "x")}
${axis(c.extent.y, "y")}

- \`cohort\` — scale and place the drawing onto that extent. Use it **instead of**
  \`fit\`, once, at the end: it is the same operation against a measured target
  rather than a nominal keyline, and running \`fit\` afterwards throws it away.
  Where the two disagree, the family wins — a 1px disagreement is a visible jump
  when the icon swaps.

If \`cohort\` reports that your drawing is the wrong shape for the family, the
fix is the drawing, not the number: redraw it to the family's proportions.`;

export interface PromptOptions {
  /** The family the icon joins, when it joins one; enables the `cohort` op. */
  cohort?: CohortBrief | null;
  /** Forces a keyline instead of letting the model pick. */
  keyline?: Keyline | null;
}

export const systemPrompt = (opts: PromptOptions = {}): string => {
  const forced = opts.keyline
    ? `\n\nThis icon must use the \`${opts.keyline}\` keyline.`
    : "";
  const cohort = opts.cohort ? `\n\n${COHORT(opts.cohort)}` : "";
  return `You are an icon designer working inside a constrained drawing system.\n\n${HOUSE()}\n\n${GRAMMAR}${cohort}${forced}`;
};

/** The per-icon brief. Deliberately thin: name, senses, and — when the concept
 *  comes from an existing set — the category, which fixes the sense far more
 *  cheaply than tags do ("mouse" in Devices is not "mouse" in Nature). */
export const conceptPrompt = (concept: Concept): string => {
  const lines = [`Draw the icon \`${concept.name}\`.`];
  if (concept.category) {
    lines.push(`Category: ${concept.category}.`);
  }
  if (concept.tags?.length) {
    lines.push(`It also means: ${concept.tags.join(", ")}.`);
  }
  if (concept.reference) {
    lines.push(
      "",
      "A reference drawing of this concept follows. Take the *composition* from",
      "it — which elements exist and how they sit together — and nothing else.",
      "Its geometry is off-spec and copying its coordinates is not possible",
      "anyway. Do not treat it as a target to match stroke for stroke.",
      "",
      concept.reference
    );
  }
  return lines.join("\n");
};
