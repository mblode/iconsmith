import type { StudioFinish, StudioRequest } from "@/lib/studio/types";

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
  const finishAnswer = answerText(request.answers?.finish);
  const finish: StudioFinish =
    finishAnswer === "filled" ||
    request.finish === "filled" ||
    /\b(?:filled|solid)\b/iu.test(request.text)
      ? "filled"
      : "outlined";
  const tags = [
    ...tokensOf(request.text),
    ...tokensOf(answerText(request.answers?.notes)),
    ...(request.attachments ?? []).flatMap((file) => [
      `ref:${file.kind}`,
      ...tokensOf(file.name),
      ...tokensOf(file.text ?? "").slice(0, 12),
    ]),
    ...(request.annotations ?? []).flatMap((annotation) => tokensOf(annotation.text).slice(0, 12)),
  ];
  return { finish, name, tags };
};
