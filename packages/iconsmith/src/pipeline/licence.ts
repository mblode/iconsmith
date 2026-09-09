/**
 * What a model is allowed to be shown.
 *
 * Generated icons ship in blode-icons under MIT, as the author's own work. So
 * the only icons that may *condition* a generation — style references, few-shot
 * examples, neighbours held up beside a draft — are the author's own: Central
 * and blode-icons. The seven third-party packs are readable for
 * concept-coverage analysis and for eval baselines, and for nothing else.
 *
 * The gate is not licence compatibility. Five of the seven packs are MIT, and
 * MIT is perfectly compatible — with the notice travelling alongside the copy.
 * A generated icon carries no notice, cannot say which of 23,731 third-party
 * drawings shaped it, and lands in a set that is shipped as one work. That is
 * the thing that cannot be undone after the fact, so it is checked before the
 * fact.
 *
 * `Licensed<T>` is how it is checked. The brand key is a module-local
 * `unique symbol`: nothing outside this file can name it, so no object literal,
 * spread, or `satisfies` anywhere else can produce the type. `asReference` is
 * the only expression in the project that does, which makes "may this icon
 * condition a generation" a question with exactly one place to answer it.
 *
 * A deliberate `as Licensed<T>` cast still defeats it, as it defeats every
 * nominal type in TypeScript. That is the intended residue: a cast is one
 * greppable token in a diff, an accidental leak is not.
 *
 * `corpus/baselines.ts` is the other half — it returns `BaselineIcon`, which
 * has no field named `name` or `svg` and so cannot even be offered to
 * `asReference` — and `scripts/check-boundaries.ts` is the third: no file under
 * `pipeline/` may import that loader at all.
 */
import type { Provenance } from "../types.js";

declare const house: unique symbol;

/**
 * `T`, plus a brand only this module can apply. Structurally still a `T`, so a
 * `Licensed<ReferenceIcon>` is usable wherever a `ReferenceIcon` is; the
 * implication does not run the other way, which is the whole point.
 */
type Licensed<T> = T & { readonly [house]: true };

/** An icon offered to a model to work *from*: the shape `pipeline/tools.ts`
 *  already passes as a neighbour. Only ever handled as `Reference`. */
export interface ReferenceIcon {
  name: string;
  svg: string;
  tags?: string[];
}

/** The only form in which a reference icon reaches a prompt. */
export type Reference = Licensed<ReferenceIcon>;

/** Thrown when an icon that may not condition a generation is offered as one.
 *  The message names the failing field, because by the time this throws the
 *  caller has a record in hand and needs to know which part of it is wrong. */
export class LicenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenceError";
  }
}

/**
 * The origins that are the author's own work.
 *
 * This is currently every member of `Provenance["origin"]`, and that is not an
 * oversight: a third-party pack has no representable origin, which is why
 * `BaselineIcon` carries no `Provenance` at all. The check earns its keep at
 * the parse boundary, where provenance arrives as JSON read off disk and the
 * union is a claim rather than a guarantee.
 */
const HOUSE_ORIGINS: ReadonlySet<string> = new Set([
  "central",
  "derived",
  "literal",
  "original",
]);

/** The sets a `derived` or `literal` icon may be derived from. An allowlist
 *  rather than a list of the seven packs, so this file needs no knowledge of
 *  `corpus/baselines.ts` — which it is forbidden to import. */
const HOUSE_SETS: ReadonlySet<string> = new Set([
  "blode-icons",
  "central",
  "centralicons",
]);

/**
 * House sets whose terms the owner holds out of band, so a non-MIT licence
 * string on the record is not a refusal.
 *
 * Central alone. It is a paid third-party set: `corpus.json` carries no licence
 * file, `.central-provenance.json` records `licenseKeyPresent: false` because
 * the scraper never had a key to record, and `sources.ts` therefore labels it
 * `proprietary` truthfully rather than inventing terms nobody has read. The
 * owner confirmed on 2026-08-19 that they hold a Central licence.
 *
 * This is deliberately not fixed by relabelling Central as MIT in `sources.ts`.
 * That would put a false licence in 2,085 records to satisfy one check, and the
 * record store is the thing every later measurement reads. The label stays
 * honest and the exception is named here, where it is one greppable line
 * carrying its own justification.
 *
 * The tension is real and worth stating: blode-icons is ~96% Central-derived
 * and already ships MIT, so terms permitting that evidently exist. Nothing here
 * asserts what they say — only that the owner has them.
 */
const LICENSED_OUT_OF_BAND: ReadonlySet<string> = new Set([
  "central",
  "centralicons",
]);

/** Case- and spacing-insensitive: these strings are read out of JSON records
 *  and out of pack metadata, not typed at a call site. */
const norm = (s: string): string => s.trim().toLowerCase();

/**
 * The sole constructor of a `Reference`.
 *
 * Three claims must hold: the origin is a house origin, the set — when the
 * record names one — is a house set, and no licence other than MIT governs it.
 * MIT is the licence blode-icons ships under; anything else on the record means
 * a second set's terms would have to travel with the generated icon, and none
 * can.
 */
export const asReference = (
  icon: ReferenceIcon,
  provenance: Provenance
): Reference => {
  if (!HOUSE_ORIGINS.has(norm(provenance.origin))) {
    throw new LicenceError(
      `"${icon.name}" has origin "${provenance.origin}", which is not one of ` +
        `${[...HOUSE_ORIGINS].join(", ")}. Only the author's own icons may ` +
        "condition a generation; third-party packs load through " +
        "corpus/baselines.ts and are for analysis and eval baselines only."
    );
  }
  if (provenance.set !== undefined && !HOUSE_SETS.has(norm(provenance.set))) {
    throw new LicenceError(
      `"${icon.name}" is from the set "${provenance.set}", which is not one of ` +
        `${[...HOUSE_SETS].join(", ")}. A house origin on a foreign set is a ` +
        "mislabelled record, not a licence to use it as a reference."
    );
  }
  const attested =
    provenance.set !== undefined &&
    LICENSED_OUT_OF_BAND.has(norm(provenance.set));
  const foreign = (provenance.licenses ?? []).filter(
    (l) => norm(l) !== "mit" && norm(l) !== "mit license"
  );
  if (foreign.length > 0 && !attested) {
    throw new LicenceError(
      `"${icon.name}" is governed by ${foreign.join(", ")}. A generated icon ` +
        "ships under MIT as one work and carries no per-icon notice, so only " +
        "MIT-licensed house icons may condition it."
    );
  }
  return icon as Reference;
};

/** `asReference` over a set, so the common case is one call and one failure
 *  message rather than a loop at every call site. */
export const asReferences = (
  icons: readonly ReferenceIcon[],
  provenance: Provenance
): Reference[] => icons.map((icon) => asReference(icon, provenance));
