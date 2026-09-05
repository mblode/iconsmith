import posthog from "posthog-js";

import { shouldDropClientEvent } from "@/lib/posthog-filter";
import { posthogHost, posthogKey } from "@/lib/site";

const isLocalHost = () => {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
};

if (!isLocalHost()) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    before_send: (event) => {
      if (!event) {
        return event;
      }
      if (shouldDropClientEvent(event)) {
        return null;
      }
      return event;
    },
    defaults: "2026-05-30",
    // api_host is a reverse proxy, so the toolbar and links still need the real app.
    ui_host: "https://us.posthog.com",
  });
}
