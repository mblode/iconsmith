/**
 * The list of conversations this browser knows about.
 *
 * eve holds each conversation durably and the studio holds a cursor per thread,
 * but nothing until now remembered that a thread existed, so a session you left
 * was unreachable even though the server still had it. This is that index: ids,
 * titles and when each was last touched. The conversations themselves stay on
 * the server.
 */

const THREADS_KEY = "iconsmith.studio.threads";

export interface StudioThread {
  readonly id: string;
  readonly kind: "campaign" | "chat";
  /** The concept slug, for a thread opened from the campaign backlog. */
  readonly slug?: string;
  /** Taken from the first brief, because that is what the user called it. */
  readonly title: string;
  readonly updatedAt: number;
}

const read = (): StudioThread[] => {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as StudioThread[]) : [];
  } catch {
    return [];
  }
};

const write = (threads: readonly StudioThread[]): void => {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
  } catch {
    // A blocked or full store must not take the studio down with it.
  }
};

/** Most recently touched first, which is the order you look for them in. */
export const readThreads = (): StudioThread[] =>
  read().toSorted((a, b) => b.updatedAt - a.updatedAt);

/**
 * Records a thread, or refreshes the one already there.
 *
 * A title only improves: a thread that has been named by its first brief keeps
 * that name rather than reverting to a placeholder on a later visit.
 */
export const recordThread = (thread: StudioThread): void => {
  const existing = read();
  const previous = existing.find((row) => row.id === thread.id);
  write([
    ...existing.filter((row) => row.id !== thread.id),
    { ...thread, title: thread.title || previous?.title || "" },
  ]);
};

export const forgetThread = (id: string): void => {
  write(read().filter((row) => row.id !== id));
  try {
    localStorage.removeItem(`iconsmith.studio.session.${id}`);
    localStorage.removeItem(`iconsmith.studio.annotations.${id}`);
  } catch {
    // Nothing to clean up where the store is unavailable.
  }
};

export const newThreadId = (): string =>
  `chat:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
