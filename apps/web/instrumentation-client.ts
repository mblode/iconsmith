import type { CaptureResult } from "posthog-js";
import posthog from "posthog-js";

import { posthogHost, posthogKey } from "@/lib/site";

const isLocalHost = () => {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
};

const isLocalHostUrl = (url: unknown): boolean => {
  if (typeof url !== "string") {
    return false;
  }
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
};

/**
 * Markers that only appear in exceptions thrown by browser extensions.
 *
 * The one that prompted this: "Invalid call to runtime.sendMessage(). Tab not
 * found." arriving from Mobile Safari on iOS, where `chrome.runtime` does not
 * exist at all, so nothing on the page could have called it. It reaches us
 * because an injected content script throws, the string bubbles up through
 * `window.onerror`, and posthog-js autocaptures it as a stackless synthetic
 * `$exception` attributed to whichever page the visitor was on.
 */
const EXTENSION_EXCEPTION_MARKERS = [
  "runtime.sendMessage",
  "Extension context invalidated",
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
  "adoptedStyleSheets",
  "WNAdoptedStylesManager",
  "_makeContainerForSrcDocIFrame",
];

const NOISE_MESSAGE_MARKERS = [
  "AbortError",
  "The user aborted a request",
  "NetworkError",
  "A network error occurred",
  "Script error.",
  "Internal Next.js error",
];

const matchesMarker = (value: unknown, markers: string[]) =>
  typeof value === "string" && markers.some((m) => value.includes(m));

const isLocalHostEvent = (event: CaptureResult): boolean =>
  isLocalHostUrl(event.properties?.$host) || isLocalHostUrl(event.properties?.$current_url);

const isNoisyException = (event: CaptureResult): boolean => {
  if (event.event !== "$exception") {
    return false;
  }
  const exceptions = event.properties?.$exception_list;
  if (!Array.isArray(exceptions)) {
    return false;
  }
  return exceptions.some((exception) => {
    if (
      matchesMarker(exception?.value, EXTENSION_EXCEPTION_MARKERS) ||
      matchesMarker(exception?.type, EXTENSION_EXCEPTION_MARKERS) ||
      matchesMarker(exception?.value, NOISE_MESSAGE_MARKERS) ||
      matchesMarker(exception?.type, NOISE_MESSAGE_MARKERS)
    ) {
      return true;
    }
    const frames = exception?.stacktrace?.frames;
    if (
      Array.isArray(frames) &&
      frames.some(
        (frame: { abs_path?: unknown; filename?: unknown }) =>
          matchesMarker(frame?.filename, EXTENSION_EXCEPTION_MARKERS) ||
          matchesMarker(frame?.abs_path, EXTENSION_EXCEPTION_MARKERS) ||
          (typeof frame?.filename === "string" &&
            frame.filename.includes("node_modules/next/dist/client")) ||
          (typeof frame?.abs_path === "string" &&
            frame.abs_path.includes("node_modules/next/dist/client")),
      )
    ) {
      return true;
    }
    return false;
  });
};

if (!isLocalHost()) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    before_send: (event) => {
      if (!event) {
        return event;
      }
      if (isLocalHostEvent(event)) {
        return null;
      }
      if (isNoisyException(event)) {
        return null;
      }
      return event;
    },
    defaults: "2026-05-30",
    // api_host is a reverse proxy, so the toolbar and links still need the real app.
    ui_host: "https://us.posthog.com",
  });
}
