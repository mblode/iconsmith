import { ForbiddenError, localDev, none, vercelOidc } from "eve/channels/auth";
import type { AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

const WINDOW_MS = 60 * 60 * 1000;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

const publicDemo: AuthFn<Request> = (request) => {
  if (request.method === "POST") {
    const now = Date.now();
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const current = requestCounts.get(ip);

    if (!current || now > current.resetAt) {
      requestCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else if (current.count >= 80) {
      throw new ForbiddenError({
        code: "rate_limited",
        message: "Too many Studio agent requests. Try again in an hour.",
      });
    } else {
      current.count += 1;
    }
  }

  return none<Request>()(request);
};

export default eveChannel({
  auth: [localDev(), vercelOidc(), publicDemo],
});
