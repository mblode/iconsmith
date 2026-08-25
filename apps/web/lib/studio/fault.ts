/**
 * Eve fetch failures sometimes surface the whole Next 404 document as
 * `error.message`. The studio banner already says the brief is still here; the
 * message next to it has to stay a sentence, not an HTML dump.
 */
const MARKUP = /<!DOCTYPE html|<html[\s>]|next-error-h1|This page could not be found/iu;

export const studioFaultMessage = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "The studio could not reach the drawing.";
  }
  if (MARKUP.test(trimmed) || trimmed.startsWith("<")) {
    return "The icon agent could not be reached.";
  }
  return trimmed;
};

const messageOf = (error: unknown): string | undefined => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
};

export const studioFaultFromUnknown = (error: unknown, fallback: string): string =>
  studioFaultMessage(messageOf(error) ?? fallback);
