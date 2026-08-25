import type { StudioFinish, StudioRequest } from "@iconsmith/contract/types";

const INTENT = new Set([
  "an",
  "and",
  "draw",
  "for",
  "filled",
  "generate",
  "icon",
  "icons",
  "image",
  "logo",
  "make",
  "me",
  "my",
  "new",
  "nice",
  "outline",
  "outlined",
  "picture",
  "please",
  "something",
  "solid",
  "the",
]);

const TWEAK =
  /^(?:again|bigger|change|filled|less|make|more|outlined|refine|smaller|taller|try|use|wider)\b/iu;

/**
 * Short words that carry the meaning rather than filler.
 *
 * The length filter below used to be `>= 3` with nothing beside it, which is a
 * proxy for "filler" that this vocabulary breaks. Measured over the 60-concept
 * sealed benchmark, it renamed 13 concepts and landed 4 of them on a DIFFERENT
 * icon the set already ships:
 *
 *   wifi-no-signal -> wifi-signal   the negation stripped, the meaning inverted
 *   bell-2-off     -> bell-off      a real, different house icon
 *   write-2        -> write         likewise
 *   bag-3          -> bag           likewise
 *   ai-slop        -> slop
 *   arrow-up-wall  -> arrow-wall
 *
 * A digit is never filler in this set — it is how a variant is named — and
 * neither is a negation or a direction. `INTENT` below is where filler belongs,
 * and it is the part that should grow when a filler word is found.
 */
const MEANINGFUL_SHORT = new Set([
  "3d",
  "ai",
  "id",
  "no",
  "ok",
  "on",
  "pc",
  "qr",
  "tv",
  "up",
  "vr",
]);

export const tokensOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (token) =>
        !INTENT.has(token) &&
        (token.length >= 3 || /\d/u.test(token) || MEANINGFUL_SHORT.has(token)),
    );

export const slugOf = (text: string): string => tokensOf(text).slice(0, 4).join("-");

export const isTweak = (text: string, lastName?: string): boolean =>
  Boolean(lastName) && TWEAK.test(text.trim());

export const isVague = (text: string): boolean => slugOf(text).length === 0;

const answerText = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  return value?.trim() ?? "";
};

export const conceptOf = (
  request: StudioRequest,
): { finish: StudioFinish; name: string; tags: string[] } => {
  const object = answerText(request.answers?.object) || slugOf(request.text);
  const name = isTweak(request.text, request.lastName)
    ? (request.lastName ?? object)
    : object || request.lastName || "icon";
  /**
   * An answered paint wins over the toolbar, in both directions.
   *
   * This used to be one OR chain, so `filled` from any source won and
   * `outlined` could only ever be the fallback. `request.finish` is toolbar
   * state that `applyStudioResponse` overwrites from whichever version led the
   * last draw, so it outlives the icon it was chosen for: draw a filled icon,
   * start a new one, answer "Which paint leads?" with outlined, and the stale
   * toolbar `filled` still won — the questionnaire asked a question whose
   * answer it then ignored.
   *
   * The answer is the surface that wins because it is the only one that is
   * about THIS icon: it was typed in reply to a direct question on this turn,
   * where the toolbar and the "filled"/"solid" sniff of the brief are both
   * standing state. An unrecognised answer decides nothing and falls through.
   */
  const answered = answerText(request.answers?.finish).toLowerCase();
  const inferred: StudioFinish =
    request.finish === "filled" || /\b(?:filled|solid)\b/iu.test(request.text)
      ? "filled"
      : "outlined";
  const finish: StudioFinish =
    answered === "filled" || answered === "outlined" ? answered : inferred;
  const tags = [
    ...tokensOf(request.text),
    // Sliced like the attachment and annotation text below it, and unlike the
    // brief above it: those three describe the concept, the brief IS it.
    ...tokensOf(answerText(request.answers?.notes)).slice(0, 12),
    ...(request.attachments ?? []).flatMap((file) => [
      `ref:${file.kind}`,
      ...tokensOf(file.name),
      ...tokensOf(file.text ?? "").slice(0, 12),
    ]),
    ...(request.annotations ?? []).flatMap((annotation) => tokensOf(annotation.text).slice(0, 12)),
  ];
  return { finish, name, tags };
};
