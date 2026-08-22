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

export const tokensOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !INTENT.has(token));

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
