/**
 * The design language as data.
 *
 * The system prompt used to be nine template literals. Prose in a `.ts` file
 * cannot be varied programmatically, diffed one principle at a time, or
 * attributed when a variant wins, and a loop that improves the prompt can only
 * optimise what it can represent and edit. So the prompt is a policy: an
 * ordered list of principle records, rendered by `renderPolicy`.
 *
 * Three properties are load-bearing.
 *
 * 1. ORDER IS THE DOCUMENT. `principles` is a list, not a map. Reordering the
 *    list reorders the prompt, which is one of the things worth measuring.
 * 2. PROVENANCE IS NOT DECORATION. When a variant wins, the question is whether
 *    the principle that won was grounded or invented, and `measured` records
 *    must carry the number they came from — validation refuses them otherwise.
 * 3. CAPACITY IS BOUNDED. An acceptance gate alone does not keep a loop safe:
 *    if the artefact can grow without limit, a run of individually beneficial
 *    edits can make a learnable problem unlearnable. `LIMITS` caps the slot
 *    count, the length of one principle, and the summed length of all of them,
 *    so the design language can be rewritten but not inflated. Every mutation
 *    that can grow the policy re-validates against them.
 * 4. A MALFORMED POLICY IS LOUD. A loop writing policies will write broken
 *    ones. Falling back to defaults would render a variant that never applied
 *    and score it as neutral, which is worse than a crash: it is a wrong
 *    number that looks like a right one. `parsePolicy` throws.
 */
import { z } from "zod";

import raw from "./policy.default.json" with { type: "json" };

/** Where a principle came from. The reason the whole file exists. */
export type Provenance =
  /** A number measured off the corpus. `evidence` carries it. */
  | "measured"
  /** A rule taken from a published design guide (Lucide, Cursor). */
  | "published"
  /** Someone's reasoning. Defensible, unmeasured, and the first to cut. */
  | "inferred";

/** Which run conditions a section is written for. */
export type Condition = "always" | "cohort" | "keyline" | "proposal";

/** The separator placed *before* a principle, within its section. `tight` is a
 *  single newline — one item of a run of bullets or numbered steps. `loose`,
 *  the default, is a blank line: a new paragraph. */
export type Gap = "loose" | "tight";

/**
 * The capacity cap. Headroom over the house policy — 47 principles, 8 sections,
 * 8,003 characters of text, longest principle 667 — and no more than that: a
 * cap the current file already strains against is a cap that gets raised, and a
 * cap raised by the thing it bounds is not a cap.
 *
 * `totalText` is the binding one. The count and length caps alone would still
 * license 64 maximal principles, i.e. six times today's prompt; the summed
 * budget is what makes the loop trade prose away to buy prose, which is the
 * behaviour the bound exists to produce.
 */
export const LIMITS = {
  /** Characters of `evidence` on one principle. Not rendered; bounded anyway. */
  evidence: 400,
  id: 48,
  principles: 64,
  sections: 12,
  /** Characters of prompt text in one principle. */
  text: 800,
  /** Characters of prompt text summed over every principle, enabled or not. */
  totalText: 12_000,
} as const;

const sectionSchema = z
  .object({
    heading: z.string().min(1).max(LIMITS.text).nullable(),
    id: z.string().min(1).max(LIMITS.id),
    when: z.enum(["always", "cohort", "keyline", "proposal"]),
  })
  .strict();

const principleSchema = z
  .object({
    enabled: z.boolean(),
    /** The measurement behind a `measured` principle. Required for one. */
    evidence: z.string().min(1).max(LIMITS.evidence).optional(),
    gap: z.enum(["loose", "tight"]).optional(),
    id: z.string().min(1).max(LIMITS.id),
    provenance: z.enum(["inferred", "measured", "published"]),
    /** The section this belongs to, by id. */
    section: z.string().min(1).max(LIMITS.id),
    /** Verbatim prompt text, with `{{token}}` holes for the run's numbers. */
    text: z.string().min(1).max(LIMITS.text),
  })
  .strict();

const policySchema = z
  .object({
    principles: z.array(principleSchema).max(LIMITS.principles),
    sections: z.array(sectionSchema).max(LIMITS.sections),
  })
  .strict();

export type Section = z.infer<typeof sectionSchema>;
export type Principle = z.infer<typeof principleSchema>;
export type Policy = z.infer<typeof policySchema>;

/** Thrown by `parsePolicy`. Never caught by the render path: a policy that does
 *  not parse has no defensible rendering. */
export class PolicyError extends Error {
  constructor(problems: string[]) {
    super(`invalid policy:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "PolicyError";
  }
}

const TOKEN = /\{\{(?<name>[a-zA-Z]+)\}\}/gu;

/** Cross-record rules zod cannot state: shape is per-record, these are not. */
const crossChecks = (policy: Policy): string[] => {
  const problems: string[] = [];
  const total = policy.principles.reduce((n, p) => n + p.text.length, 0);
  if (total > LIMITS.totalText) {
    problems.push(
      `policy text is ${total} characters, over the ${LIMITS.totalText} cap; cut a principle to add one`
    );
  }
  const sections = new Set<string>();
  for (const s of policy.sections) {
    if (sections.has(s.id)) {
      problems.push(`duplicate section id \`${s.id}\``);
    }
    sections.add(s.id);
  }
  const ids = new Set<string>();
  for (const p of policy.principles) {
    if (ids.has(p.id)) {
      problems.push(`duplicate principle id \`${p.id}\``);
    }
    ids.add(p.id);
    if (!sections.has(p.section)) {
      problems.push(
        `principle \`${p.id}\` names unknown section \`${p.section}\``
      );
    }
    if (p.provenance === "measured" && !p.evidence) {
      problems.push(
        `principle \`${p.id}\` is measured but carries no evidence; state the number or mark it inferred`
      );
    }
  }
  return problems;
};

/**
 * Parse and validate a policy. Throws `PolicyError` listing every problem.
 *
 * The most important error path in this file. A self-improving loop writes
 * policies mechanically, and the failure mode that ruins an experiment is a
 * variant that silently did not apply.
 */
export const parsePolicy = (value: unknown): Policy => {
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) {
    throw new PolicyError(
      parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
      )
    );
  }
  const problems = crossChecks(parsed.data);
  if (problems.length > 0) {
    throw new PolicyError(problems);
  }
  return parsed.data;
};

/** The house policy. Validated at import: a broken default fails the process
 *  rather than half of the prompts it renders. */
export const DEFAULT_POLICY: Policy = parsePolicy(raw);

/** The values a render substitutes into `{{token}}` holes. Which tokens exist
 *  depends on the run, which is why an unknown one throws at render rather
 *  than at parse: `{{cohortX}}` is legal only when a cohort was measured. */
export type Tokens = Record<string, string>;

export interface RenderOptions {
  /** Conditions that hold for this run. `always` is added for you. */
  conditions?: Iterable<Condition>;
  tokens?: Tokens;
}

const expand = (text: string, tokens: Tokens, id: string): string =>
  text.replaceAll(TOKEN, (whole, name: string) => {
    const value = tokens[name];
    if (value === undefined) {
      throw new PolicyError([
        `principle \`${id}\` uses unknown token \`${whole}\``,
      ]);
    }
    return value;
  });

/** `tight` is one newline — the next item of a bullet run or a numbered list.
 *  `loose`, the default, is the blank line between two paragraphs. */
const separator = (index: number, gap: Gap | undefined): string => {
  if (index === 0) {
    return "";
  }
  return gap === "tight" ? "\n" : "\n\n";
};

/** Render a policy to prompt text. Disabled principles and sections with no
 *  enabled member vanish entirely — a bare heading over nothing is worse than
 *  no heading. */
export const renderPolicy = (
  policy: Policy,
  opts: RenderOptions = {}
): string => {
  const active = new Set<Condition>(["always", ...(opts.conditions ?? [])]);
  const tokens = opts.tokens ?? {};
  const blocks: string[] = [];
  for (const section of policy.sections) {
    if (!active.has(section.when)) {
      continue;
    }
    const items = policy.principles.filter(
      (p) => p.enabled && p.section === section.id
    );
    if (items.length === 0) {
      continue;
    }
    let body = "";
    for (const [i, p] of items.entries()) {
      body += separator(i, p.gap) + expand(p.text, tokens, p.id);
    }
    blocks.push(section.heading ? `${section.heading}\n\n${body}` : body);
  }
  return blocks.join("\n\n");
};

/** The mutation surface, by id. Every one returns a new policy; nothing here
 *  edits in place, so a variant cannot leak into the run that made it. */
export const findPrinciple = (
  policy: Policy,
  id: string
): Principle | undefined => policy.principles.find((p) => p.id === id);

const mapPrinciple = (
  policy: Policy,
  id: string,
  f: (p: Principle) => Principle
): Policy => {
  if (!findPrinciple(policy, id)) {
    throw new PolicyError([`no principle with id \`${id}\``]);
  }
  return {
    ...policy,
    principles: policy.principles.map((p) => (p.id === id ? f(p) : p)),
  };
};

/** Turn one principle on or off. The cheapest variant there is: an ablation. */
export const setEnabled = (
  policy: Policy,
  id: string,
  enabled: boolean
): Policy => mapPrinciple(policy, id, (p) => ({ ...p, enabled }));

/**
 * Reword one principle. `provenance` must be restated, because a reworded
 * principle is not the one that was measured — leaving the old attribution
 * attached is how a loop's invention comes to be credited to the corpus.
 */
export const replacePrinciple = (
  policy: Policy,
  id: string,
  patch: Pick<Principle, "provenance" | "text"> & Partial<Principle>
): Policy =>
  parsePolicy({
    ...mapPrinciple(policy, id, (p) => ({ ...p, ...patch, id: p.id })),
  });

/** Insert a principle after `afterId`, or at the top of the list when null.
 *  The loop adds principles as well as editing them. */
export const insertPrinciple = (
  policy: Policy,
  principle: Principle,
  afterId: string | null
): Policy => {
  const at =
    afterId === null
      ? 0
      : policy.principles.findIndex((p) => p.id === afterId) + 1;
  if (at === 0 && afterId !== null) {
    throw new PolicyError([`no principle with id \`${afterId}\``]);
  }
  const principles = [...policy.principles];
  principles.splice(at, 0, principle);
  return parsePolicy({ ...policy, principles });
};
