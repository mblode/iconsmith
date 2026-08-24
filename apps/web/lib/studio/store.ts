/**
 * Browser-local studio storage.
 *
 * Deliberately small. eve's durable session stream is the store for everything
 * a turn produced, so only two things live here: the cursor that says which
 * session to resume, and the annotations, which are client-only and appear in
 * no eve event. Persisting the rendered event log as well is possible and was
 * rejected: a studio log carries every candidate SVG and every tournament, and
 * that is what exhausts a 5MB quota. Replaying from the cursor costs one round
 * trip and cannot go stale.
 */

/** Reads JSON, treating an unavailable or corrupt store as absent. */
const read = <T>(key: string): T | undefined => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    // Private windows and blocked site data throw on access, not just on write.
    return undefined;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    if (value === undefined) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked store must not take the studio down with it.
  }
};

const sessionKey = (thread: string) => `iconsmith.studio.session.${thread}`;
const annotationKey = (thread: string) => `iconsmith.studio.annotations.${thread}`;

export const readStudioSession = <T>(thread: string): T | undefined => read<T>(sessionKey(thread));

export const writeStudioSession = (thread: string, value: unknown): void => {
  write(sessionKey(thread), value);
};

export const readStudioAnnotations = <T>(thread: string): T | undefined =>
  read<T>(annotationKey(thread));

export const writeStudioAnnotations = (thread: string, value: unknown): void => {
  write(annotationKey(thread), value);
};
