"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Reads a media query without a post-hydration flash.
 *
 * `useSyncExternalStore` hands React a server snapshot and the real client
 * value in the same commit, so a desktop layout is not painted once as the
 * stacked one and then swapped, which the `useEffect` version would do.
 * `subscribe` needs no server guard: React never calls it while rendering on
 * the server.
 */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
};
