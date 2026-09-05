import type { CaptureResult } from "posthog-js";

const EXTENSION_EXCEPTION_MARKERS = [
  "runtime.sendMessage",
  "Extension context invalidated",
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
  "WNAdoptedStylesManager",
  "_makeContainerForSrcDocIFrame",
];

const matchesMarker = (value: unknown): boolean =>
  typeof value === "string" && EXTENSION_EXCEPTION_MARKERS.some((marker) => value.includes(marker));

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

const isLocalHostEvent = (event: CaptureResult): boolean =>
  isLocalHostUrl(event.properties?.$host) || isLocalHostUrl(event.properties?.$current_url);

const isExtensionException = (event: CaptureResult): boolean => {
  if (event.event !== "$exception") {
    return false;
  }
  const exceptions = event.properties?.$exception_list;
  if (!Array.isArray(exceptions)) {
    return false;
  }
  return exceptions.some((exception) => {
    if (matchesMarker(exception?.value) || matchesMarker(exception?.type)) {
      return true;
    }
    const frames = exception?.stacktrace?.frames;
    return (
      Array.isArray(frames) &&
      frames.some(
        (frame: { abs_path?: unknown; filename?: unknown }) =>
          matchesMarker(frame.filename) || matchesMarker(frame.abs_path),
      )
    );
  });
};

/** Only discard local events and exceptions attributable to injected extensions. */
export const shouldDropClientEvent = (event: CaptureResult): boolean =>
  isLocalHostEvent(event) || isExtensionException(event);
